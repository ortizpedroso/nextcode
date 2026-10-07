import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { SmartRouter, AvailableKeys } from "@/core/router/smart-router";
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
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import type { SessionQueueResult } from "@/core/orchestrator/session-queue";
import { getSessionBudget, BUDGET_AUTHORIZED_ACTION } from "@/core/orchestrator/budget-guard";

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

      const activeTasks = session.tasks.filter((t) => t.specVersion === session.specVersion);
      const budget = await getSessionBudget(session.id).catch(() => null);
      return NextResponse.json({
        session: { ...session, tasks: activeTasks },
        tasks: activeTasks,
        messages: session.messages,
        budget,
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

    const latestActiveTasks = latestSession
      ? latestSession.tasks.filter((t) => t.specVersion === latestSession.specVersion)
      : [];

    return NextResponse.json({
      session: latestSession ? { ...latestSession, tasks: latestActiveTasks } : null,
      tasks: latestActiveTasks,
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

    // Ação 1: Garantir que a sessão existe e devolver os nós já existentes (sem criar TaskNode antes da aprovação da Spec)
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

      const activeTasks = updatedSession
        ? updatedSession.tasks.filter((t) => t.specVersion === updatedSession.specVersion)
        : [];

      return NextResponse.json({
        success: true,
        sessionId: activeSessionId,
        intent,
        tasks: activeTasks,
        messages: updatedSession?.messages || [],
        session: updatedSession ? { ...updatedSession, tasks: activeTasks } : null,
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
      const execResult = await executeTaskNode(task);

      if (execResult.claimed === false) {
        return NextResponse.json(
          {
            error: "Nó já reservado ou em execução",
            details: `O nó "${task.title}" não pôde ser reservado atomicamente (claimed=false).`,
          },
          { status: 409 }
        );
      }

      if (execResult.finalStatus === "blocked") {
        await cascadeBlockedNodes(task.sessionId);
        await reportBlockedNodeToHuman(task.sessionId, task.id);
      }

      const { specCompleteness } = await postCompletionMessageIfDone(task.sessionId, {
        canonicalSpec: task.session.canonicalSpec,
        projectPath: task.session.project?.path,
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

    // Ação 5: Autorização humana de mais verba depois do teto de custo (trilha BUDGET_AUTHORIZED)
    if (action === "authorize_budget" && (sessionId || body.sessionId)) {
      const targetSessionId: string = sessionId || body.sessionId;
      const acrescimoUsd = Number(body.acrescimoUsd);
      if (!Number.isFinite(acrescimoUsd) || acrescimoUsd <= 0 || acrescimoUsd > 50) {
        return NextResponse.json({ error: "acrescimoUsd deve estar entre 0 e 50" }, { status: 400 });
      }
      const before = await getSessionBudget(targetSessionId);
      await prisma.telemetryLog.create({
        data: {
          sessionId: targetSessionId,
          action: BUDGET_AUTHORIZED_ACTION,
          details: JSON.stringify({ acrescimoUsd, gastoAteAgoraUsd: before.spentUsd, tetoAnteriorUsd: before.limitUsd }),
        },
      });
      const current = await prisma.session.findUnique({ where: { id: targetSessionId }, select: { phase: true } });
      if (current?.phase === "BLOQUEADA") {
        await applyPhaseEvent(targetSessionId, { type: "DESBLOQUEIO_HUMANO" });
      }
      await enqueueSessionQueueJob(targetSessionId);
      const budget = await getSessionBudget(targetSessionId);
      return NextResponse.json({
        success: true,
        message: `Teto do projeto ampliado para US$ ${budget.limitUsd.toFixed(2)}. Execução retomada.`,
        budget,
      });
    }

    // Ação 4: Desbloqueio e re-tentativa manual de um nó com falha/bloqueado
    if (action === "retry_node" && nodeId) {
      const targetTask = await prisma.taskNode.findUnique({ where: { id: nodeId } });
      if (!targetTask) {
        return NextResponse.json({ error: "Nó não encontrado" }, { status: 404 });
      }

      const sessionBeforeUnblock = await prisma.session.findUnique({
        where: { id: targetTask.sessionId },
        select: { phase: true, specVersion: true },
      });
      const currentSpecVersion = sessionBeforeUnblock?.specVersion ?? targetTask.specVersion;

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
        where: { sessionId: targetTask.sessionId, specVersion: currentSpecVersion },
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

      if (sessionBeforeUnblock?.phase === "BLOQUEADA") {
        await applyPhaseEvent(targetTask.sessionId, { type: "DESBLOQUEIO_HUMANO" });
      }
      await enqueueSessionQueueJob(targetTask.sessionId);

      const updatedTasks = await prisma.taskNode.findMany({
        where: { sessionId: targetTask.sessionId, specVersion: currentSpecVersion },
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
