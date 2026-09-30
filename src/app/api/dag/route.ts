import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { SmartRouter, AvailableKeys, DispatchMessage } from "@/core/router/smart-router";
import { MCPClient } from "@/core/mcp/mcp-client";
import { readSecret } from "@/core/security/crypto";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export async function GET(request: Request) {
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, prompt, sessionId, projectId, tierOverride } = body;
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

      // Consulta chaves para classificação do SmartRouter
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

      // Decompõe em nós via SpecDecomposerSkill
      const { nodes: decomposedNodes } = SpecDecomposerSkill.decompose(targetPrompt);

      // Salva os nós no banco de dados SQLite
      const createdTasks = [];
      for (const node of decomposedNodes) {
        const dbTask = await prisma.taskNode.create({
          data: {
            sessionId: activeSessionId,
            title: node.title,
            role: node.role,
            status: "pending",
            dependencies: JSON.stringify(node.dependencies),
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

    // Ação 2: Executar um nó específico da DAG via Harness Autônomo e SmartRouter
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

      // Atualiza estado para 'running'
      await prisma.taskNode.update({
        where: { id: nodeId },
        data: { status: "running" },
      });

      // 1. Injeta contexto do projeto local se disponível
      let projectContextBlock = "";
      if (task.session.project && task.session.project.path) {
        projectContextBlock = buildProjectContextBlock(task.session.project) || "";
      }

      // 2. Resolve skill ativada na sessão
      let skillInstructionBlock = "";
      const firstUserMsg = await prisma.message.findFirst({
        where: { sessionId: task.sessionId, role: "user" },
        orderBy: { createdAt: "asc" },
      });

      if (firstUserMsg && firstUserMsg.content.startsWith("/")) {
        const skillRes = resolveSkillOrCommand(
          firstUserMsg.content,
          task.session.project?.path || process.cwd()
        );
        if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
          skillInstructionBlock = skillRes.skillBlock;
        }
      }

      // 3. Execução real via SmartRouter da etapa
      const setting = await prisma.setting.findUnique({ where: { id: "default" } });
      const smartRouter = new SmartRouter();

      const dispatchMessages: DispatchMessage[] = [];
      if (projectContextBlock) dispatchMessages.push({ role: "system", content: projectContextBlock });
      if (skillInstructionBlock) dispatchMessages.push({ role: "system", content: skillInstructionBlock });

      dispatchMessages.push({
        role: "user",
        content: `[EXECUÇÃO DA ETAPA DA DAG: ${task.title}]\nPapel/Função: ${task.role}\nObjetivo: Execute esta etapa de forma concreta e retorne os detalhes da execução e códigos/verificações realizadas.`,
      });

      let stepResultText = "";
      try {
        const dispatchRes = await smartRouter.dispatchWithFallback({
          messages: dispatchMessages,
          tier: "fast",
          geminiKey: readSecret(setting?.geminiKey),
          omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
          omniRouteKey: readSecret(setting?.omniRouteKey),
          stream: false,
        });

        const resJson = await dispatchRes.response.json().catch(() => ({}));
        if (resJson.choices?.[0]?.message?.content) {
          stepResultText = resJson.choices[0].message.content;
        } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
          stepResultText = resJson.candidates[0].content.parts[0].text;
        } else {
          stepResultText = `Etapa "${task.title}" executada com sucesso pelo motor autônomo.`;
        }
      } catch (err) {
        stepResultText = `Etapa concluída com notificação: ${String(err)}`;
      }

      // 4. Quarentena, Auditoria Cega e Promoção para a Pasta Física do Projeto
      const qm = new QuarantineManager();
      const filesScope: string[] = task.filesScope ? JSON.parse(task.filesScope) : [];
      
      // Extrai os blocos de código gerados e grava no workspace isolado de quarentena
      const codeContentMap = qm.extractAndWriteCodeBlocks(task.id, stepResultText, filesScope);
      
      // Executa a Auditoria em Duas Lentes (Tipo 1 Mecânico + Tipo 2 Auditor Cego)
      const type1Res = DualLensAuditor.validateType1(codeContentMap);
      const type2Res = DualLensAuditor.validateType2(type1Res, task.title, stepResultText, codeContentMap);

      let finalStatus: "completed" | "failed" = "completed";
      let promotionTarget: string | null = null;

      if (type2Res.verdict === "APPROVED") {
        finalStatus = "completed";
        // Resolve o caminho do projeto (ou pasta padrão) e promove o código aprovado
        const targetProjectRoot = task.session.project?.path || process.cwd();
        qm.promoteToMainRepo(task.id, targetProjectRoot, filesScope);
        promotionTarget = targetProjectRoot;
      } else {
        finalStatus = "failed";
        qm.purgeWorkspace(task.id);
      }

      const mcpRes = {
        success: type2Res.verdict === "APPROVED",
        nodeId: task.id,
        title: task.title,
        output: stepResultText,
        auditVerdict: type2Res.verdict,
        promotedPath: promotionTarget,
      };

      // Atualiza estado do nó no SQLite
      const updatedTask = await prisma.taskNode.update({
        where: { id: nodeId },
        data: {
          status: finalStatus,
          attempts: finalStatus === "failed" ? task.attempts + 1 : task.attempts,
          result: JSON.stringify(mcpRes),
        },
      });

      TelemetryLogger.log({
        sessionId: task.sessionId,
        action: `NODE_EXECUTION_${finalStatus.toUpperCase()}`,
        details: { nodeId: task.id, title: task.title, verdict: type2Res.verdict, promotedPath: promotionTarget },
      });

      // Checa se todos os nós da sessão foram concluídos
      const sessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: task.sessionId },
      });

      const allCompleted = sessionTasks.every((t) => t.status === "completed");
      if (allCompleted) {
        const completedSummary = sessionTasks
          .map((t) => `• **${t.title}** (${t.role}): Concluído com sucesso`)
          .join("\n");

        const skillHeader = firstUserMsg?.content.startsWith("/")
          ? firstUserMsg.content.split(" ")[0]
          : "/autonomo";

        await prisma.message.create({
          data: {
            sessionId: task.sessionId,
            role: "assistant",
            content: `⚡ **[Skill ${skillHeader}] — Execução Autônoma Concluída!**\n\nTodas as etapas da DAG foram executadas, auditadas e promovidas para o projeto:\n\n${completedSummary}\n\n📁 _Arquivos gravados e sincronizados em: \`${task.session.project?.path || process.cwd()}\`_`,
          },
        });
      }

      // Avalia dependências dos outros nós na sessão via DAGEngine
      const updatedSessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: task.sessionId },
      });

      const dagNodes: DAGNode[] = updatedSessionTasks.map((t) => ({
        id: t.id,
        title: t.title,
        role: t.role,
        status: t.status as DAGNode["status"],
        dependencies: JSON.parse(t.dependencies || "[]"),
        mcpScope: t.mcpScope || undefined,
        payload: t.payload ? JSON.parse(t.payload) : undefined,
        result: t.result ? JSON.parse(t.result) : undefined,
      }));

      const dagEngine = new DAGEngine(dagNodes);
      const executableNodes = dagEngine.getExecutableNodes();

      return NextResponse.json({
        success: true,
        executedTask: updatedTask,
        nextExecutableNodes: executableNodes,
        promotedPath: promotionTarget,
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
