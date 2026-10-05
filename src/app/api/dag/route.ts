import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { SmartRouter, AvailableKeys } from "@/core/router/smart-router";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import {
  executeTaskNode,
  cascadeBlockedNodes,
  reportBlockedNodeToHuman,
  postCompletionMessageIfDone,
} from "@/core/orchestrator/node-executor";
import {
  enqueueSessionQueueJob,
  claimJob,
  executeClaimedJob,
} from "@/core/orchestrator/job-queue";
import { getProcessWorkerId } from "@/core/orchestrator/job-worker";
import type { SessionQueueResult } from "@/core/orchestrator/session-queue";

export async function GET(request: Request) {
  // requireReadAuth: GET expõe dados locais (sessões, DAG, projetos, configurações) — exige
  // o token da sessão local, sem rate limit (a UI faz polling).
  const readGuard = requireReadAuth(request);
  if (readGuard.response) return readGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    // Limpa mensagens técnicas legadas do tipo 'system' para garantir chat limpo
    await prisma.message.deleteMany({ where: { role: "system" } }).catch(() => {});

    if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          project: {
            select: { id: true, name: true, path: true },
          },
          tasks: {
            orderBy: { createdAt: "asc" },
          },
          messages: {
            where: { role: { in: ["user", "assistant"] } },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!session) {
        return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
      }

      return NextResponse.json({
        session,
        tasks: session.tasks,
        messages: session.messages,
      });
    }

    const latestSession = await prisma.session.findFirst({
      orderBy: { createdAt: "desc" },
      include: {
        project: {
          select: { id: true, name: true, path: true },
        },
        tasks: { orderBy: { createdAt: "asc" } },
        messages: {
          where: { role: { in: ["user", "assistant"] } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json({
      session: latestSession,
      tasks: latestSession?.tasks || [],
      messages: latestSession?.messages || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao recuperar tarefas da DAG", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const body = await request.json();
    const { action, prompt, sessionId, projectId } = body;
    const nodeId = body.nodeId;

    // Limpa mensagens de log do tipo 'system'
    await prisma.message.deleteMany({ where: { role: "system" } }).catch(() => {});

    // Ação 1: Criar e Decompor um novo objetivo em nós de DAG
    if (action === "create_dag" || prompt) {
      const targetPrompt = prompt || "Novo Objetivo NextCode";
      let activeSessionId = sessionId;

      if (!activeSessionId) {
        const session = await prisma.session.create({
          data: {
            title: targetPrompt.length > 30 ? `${targetPrompt.substring(0, 30)}...` : targetPrompt,
            projectId: projectId || null,
          },
        });
        activeSessionId = session.id;
      } else {
        const existingSession = await prisma.session.findUnique({ where: { id: activeSessionId } });
        if (existingSession && existingSession.title.startsWith("Nova Sessão")) {
          await prisma.session.update({
            where: { id: activeSessionId },
            data: {
              title: targetPrompt.length > 30 ? `${targetPrompt.substring(0, 30)}...` : targetPrompt,
            },
          });
        }
      }

      // Trava T1: criar/decompor os nós da DAG NUNCA aprova a Spec por si só
      const setting = await prisma.setting.findUnique({ where: { id: "default" } });
      const availableKeys: AvailableKeys = {
        hasGeminiKey: Boolean(setting?.geminiKey),
        hasClaudeKey: Boolean(setting?.claudeKey),
        hasOpenaiKey: Boolean(setting?.openaiKey),
        hasOmniRouteKey: Boolean(setting?.omniRouteKey),
        customEndpoint: setting?.customEndpoint,
      };

      const smartRouter = new SmartRouter();
      const rawAnalysis = smartRouter.routeTask({ prompt: targetPrompt });
      const intent = smartRouter.resolveFallback(rawAnalysis, availableKeys);

      const sessionForScope = await prisma.session.findUnique({
        where: { id: activeSessionId },
        select: { canonicalSpec: true },
      });
      const specFilesScope = sessionForScope?.canonicalSpec
        ? parseSpecDocument(sessionForScope.canonicalSpec)?.arquivosAfetados
        : undefined;

      const { nodes: decomposedNodes } = SpecDecomposerSkill.decompose(targetPrompt, undefined, specFilesScope);

      const createdTasks = [];
      for (const node of decomposedNodes) {
        const dbTask = await prisma.taskNode.create({
          data: {
            id: node.id,
            sessionId: activeSessionId,
            title: node.title,
            role: node.role,
            status: "pending",
            dependencies: JSON.stringify(node.dependencies),
            filesScope: JSON.stringify(node.filesScope || []),
            mcpScope: node.mcpScope,
            payload: JSON.stringify({
              ...(typeof node.payload === "object" && node.payload !== null ? node.payload : { data: node.payload }),
              intent,
            }),
          },
        });
        createdTasks.push(dbTask);
      }

      const updatedSession = await prisma.session.findUnique({
        where: { id: activeSessionId },
        include: {
          project: { select: { id: true, name: true } },
          tasks: { orderBy: { createdAt: "asc" } },
          messages: {
            where: { role: { in: ["user", "assistant"] } },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return NextResponse.json({
        success: true,
        sessionId: activeSessionId,
        intent,
        tasks: updatedSession?.tasks || createdTasks,
        messages: updatedSession?.messages || [],
        session: updatedSession,
      });
    }

    // Ação 2: Executar um nó específico da DAG via serviço de orquestração desacoplado
    if (action === "execute_node" && nodeId) {
      const task = await prisma.taskNode.findUnique({
        where: { id: nodeId },
        include: {
          session: {
            include: { project: true },
          },
        },
      });

      if (!task) {
        return NextResponse.json({ error: "Nó não encontrado" }, { status: 404 });
      }

      // Trava T1: Se a Spec não foi aprovada pelo usuário, impede a execução de nós no disco
      if (!task.session.specApproved) {
        return NextResponse.json(
          {
            error: "Trava T1 Violada (Spec Approval Lock)",
            details: "A Spec Canônica precisa ser aprovada pelo usuário antes de executar alterações no disco.",
          },
          { status: 400 }
        );
      }

      // TODO(passo-4): unificar — guardas de entrada específicas de execute_node
      const maxAttemptsGuard = task.maxAttempts || 3;
      const isRetryableFailure = task.status === "failed" && task.attempts < maxAttemptsGuard;
      if (!(task.status === "pending" || task.status === "standby" || isRetryableFailure)) {
        return NextResponse.json(
          {
            error: "Trava T6 (D-RANHO): nó não executável",
            details:
              task.status === "blocked" || task.status === "failed"
                ? `O nó atingiu o limite de ${maxAttemptsGuard} tentativas e está bloqueado. Use "Re-tentar" para liberá-lo explicitamente.`
                : `O nó está com status "${task.status}" e não pode ser executado novamente.`,
          },
          { status: 409 }
        );
      }
      const depIds: string[] = JSON.parse(task.dependencies || "[]");
      if (depIds.length > 0) {
        const deps = await prisma.taskNode.findMany({
          where: { id: { in: depIds } },
          select: { title: true, status: true },
        });
        const pendingDeps = deps.filter((d) => d.status !== "completed");
        if (pendingDeps.length > 0) {
          return NextResponse.json(
            {
              error: "Dependências não concluídas",
              details: `Conclua antes: ${pendingDeps.map((d) => `"${d.title}" (${d.status})`).join(", ")}.`,
            },
            { status: 409 }
          );
        }
      }

      // Executa o nó via serviço único de orquestração
      const execResult = await executeTaskNode(task, {
        // TODO(passo-4): unificar — timeout da etapa (45s em execute_node)
        stepTimeoutMs: Number(process.env.DAG_STEP_TIMEOUT_MS) || 45000,
        // TODO(passo-4): unificar — chaves BYOK passadas no despacho do worker (apenas Gemini/Omni)
        includeCloudByokKeys: false,
        // TODO(passo-4): unificar — incremento de tentativas em sucesso (não incrementa no sucesso)
        alwaysIncrementAttempts: false,
        // TODO(passo-4): unificar — fallback de motivo de rejeição do Tipo 2 (sem fallback extra em execute_node)
        type2RejectionFallback: undefined,
      });

      if (execResult.finalStatus === "blocked") {
        await cascadeBlockedNodes(task.sessionId);
        await reportBlockedNodeToHuman(task.sessionId, task.id);
      }

      const { specCompleteness } = await postCompletionMessageIfDone(task.sessionId, {
        canonicalSpec: task.session.canonicalSpec,
        projectPath: task.session.project?.path,
        // TODO(passo-4): unificar — mensagem de conclusão ("promovidas para o projeto")
        completionMessageTargetText: "promovidas para o projeto",
      });

      return NextResponse.json({
        success: true,
        executedTask: execResult.executedTask,
        promotedPath: execResult.promotionTarget,
        specCompleteness,
      });
    }

    // Ação 3: Processamento autônomo contínuo da fila de DAG no Servidor
    if (action === "process_queue" && (sessionId || body.sessionId)) {
      const targetSessionId = sessionId || body.sessionId;
      const session = await prisma.session.findUnique({
        where: { id: targetSessionId },
        include: { project: true },
      });

      if (!session) {
        return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
      }

      if (!session.specApproved) {
        return NextResponse.json(
          {
            error: "Trava T1 Violada (Spec Approval Lock)",
            details: "A Spec Canônica precisa ser aprovada antes do processamento no servidor.",
          },
          { status: 400 }
        );
      }

      // TODO(passo-6): responder 202 Accepted e deixar a interface apenas observar os eventos do servidor
      const jobId = await enqueueSessionQueueJob(targetSessionId);
      const workerId = getProcessWorkerId();
      const claimed = await claimJob(jobId, workerId);

      let completedJob = claimed
        ? await executeClaimedJob(jobId, workerId)
        : null;

      if (!claimed) {
        const waitTimeoutMs = Number(process.env.NEXTCODE_JOB_WAIT_TIMEOUT_MS) || 300000;
        const deadline = Date.now() + waitTimeoutMs;
        while (Date.now() < deadline) {
          const currentJob = await prisma.job.findUnique({ where: { id: jobId } });
          if (!currentJob || currentJob.status === "done" || currentJob.status === "failed") {
            completedJob = currentJob;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      if (!completedJob || completedJob.status !== "done" || !completedJob.result) {
        throw new Error(
          completedJob?.lastError || "Falha ou timeout ao aguardar a conclusão do Job da fila da sessão."
        );
      }

      const {
        processedCount,
        allCompleted,
        tasks: finalSessionTasks,
        specCompleteness,
      } = JSON.parse(completedJob.result) as SessionQueueResult;

      return NextResponse.json({
        success: true,
        processedCount,
        allCompleted,
        tasks: finalSessionTasks,
        specCompleteness,
      });
    }

    // Ação 4: Desbloqueio e re-tentativa manual de um nó com falha/bloqueado
    if (action === "retry_node" && nodeId) {
      const targetTask = await prisma.taskNode.findUnique({ where: { id: nodeId } });
      if (!targetTask) {
        return NextResponse.json({ error: "Nó não encontrado" }, { status: 404 });
      }

      const logHumanUnblock = (t: typeof targetTask, cascade: boolean) =>
        TelemetryLogger.log({
          sessionId: t.sessionId,
          action: "NODE_UNBLOCKED_BY_HUMAN",
          details: {
            nodeId: t.id,
            title: t.title,
            previousStatus: t.status,
            previousAttempts: t.attempts,
            discardedFailureHistory: t.failureHistory || "[]",
            unblockedVia: cascade ? `cascata de ${nodeId}` : "retry_node",
          },
        });
      logHumanUnblock(targetTask, false);

      await prisma.taskNode.update({
        where: { id: nodeId },
        data: { status: "pending", attempts: 0, failureHistory: "[]" },
      });

      const sessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: targetTask.sessionId },
      });

      for (const task of sessionTasks) {
        if (task.status === "blocked") {
          logHumanUnblock(task, true);
          await prisma.taskNode.update({
            where: { id: task.id },
            data: { status: "pending", attempts: 0, failureHistory: "[]" },
          });
        }
      }

      const updatedTasks = await prisma.taskNode.findMany({
        where: { sessionId: targetTask.sessionId },
        orderBy: { createdAt: "asc" },
      });

      return NextResponse.json({
        success: true,
        message: `Nó "${targetTask.title}" e nós bloqueados em cascata foram liberados para re-tentativa.`,
        tasks: updatedTasks,
      });
    }

    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Erro no processamento da DAG", details: String(error) },
      { status: 500 }
    );
  }
}
