import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
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

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
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

      // Auto-liberação de Trava T1 na criação da DAG
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: true },
      });

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

      const autonomousWorkerPrompt = `Você é um Engenheiro de Software Sênior (${task.role}) responsável pela etapa "${task.title}".
DIRETRIZES DE EXECUÇÃO:
1. Execute a tarefa de forma 100% autônoma e completa. NUNCA faça perguntas ou solicite confirmações.
2. Para cada arquivo no escopo (${task.filesScope || "[]"}), você DEVE OBRIGATORIAMENTE retornar o código-fonte completo em blocos de código formatados com a indicação do arquivo no topo:
\`\`\`typescript
// file: caminho/relativo/do/arquivo.ts
<código completo aqui>
\`\`\`
3. Não inclua discursos sobre governança, desculpas ou cabeçalhos robóticos. Retorne apenas o código funcional e explicações técnicas diretas.`;

      const dispatchMessages: DispatchMessage[] = [
        { role: "system", content: autonomousWorkerPrompt },
      ];
      if (projectContextBlock) dispatchMessages.push({ role: "system", content: projectContextBlock });
      if (skillInstructionBlock) dispatchMessages.push({ role: "system", content: skillInstructionBlock });

      dispatchMessages.push({
        role: "user",
        content: `[EXECUÇÃO DA ETAPA DA DAG: ${task.title}]\nPapel/Função: ${task.role}\nEscopo de Arquivos: ${task.filesScope || "[]"}\nObjetivo: Execute esta etapa de forma 100% autônoma e retorne os códigos de todos os arquivos no escopo.`,
      });

      let stepResultText = "";
      try {
        const stepTimeoutMs = Number(process.env.DAG_STEP_TIMEOUT_MS) || 45000;
        // C5 — timeout REAL: AbortSignal.timeout cancela ativamente os fetches dos
        // provedores (OmniRoute/Groq/NVIDIA/DeepSeek/Gemini) quando estoura, em vez
        // de apenas abandonar a promise via Promise.race (timeout decorativo, que
        // deixava requisições zumbis consumindo cota e conexões após o "timeout").
        const stepSignal = AbortSignal.timeout(stepTimeoutMs);
        const dispatchPromise = smartRouter.dispatchWithFallback({
          messages: dispatchMessages,
          tier: "fast",
          geminiKey: readSecret(setting?.geminiKey),
          omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
          omniRouteKey: readSecret(setting?.omniRouteKey),
          stream: false,
          signal: stepSignal,
        });

        const timeoutPromise = new Promise<null>((resolve) => {
          if (stepSignal.aborted) return resolve(null);
          stepSignal.addEventListener("abort", () => resolve(null), { once: true });
        });

        const dispatchRes = (await Promise.race([dispatchPromise, timeoutPromise])) as any;
        if (!dispatchRes) {
          throw new Error(`Timeout de resposta excedido na etapa da DAG (limite ${Math.round(stepTimeoutMs / 1000)}s) — requisição abortada.`);
        }

        if (dispatchRes) {
          const resJson = await dispatchRes.response.json().catch(() => ({}));
          if (resJson.choices?.[0]?.message?.content) {
            stepResultText = resJson.choices[0].message.content;
          } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
            stepResultText = resJson.candidates[0].content.parts[0].text;
          } else {
            stepResultText = `Etapa "${task.title}" executada pelo motor autônomo.`;
          }
        }
      } catch (err) {
        stepResultText = `[AVISO] Notificação da etapa: ${String(err)}`;
        console.warn(`[DAG_TIMEOUT_GUARD] Exceção/Timeout na etapa "${task.title}":`, String(err));
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

      return NextResponse.json({
        success: true,
        executedTask: updatedTask,
        promotedPath: promotionTarget,
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

      let processedCount = 0;
      let isProcessing = true;

      while (isProcessing) {
        const currentDbTasks = await prisma.taskNode.findMany({
          where: { sessionId: targetSessionId },
          orderBy: { createdAt: "asc" },
        });

        const dagNodes: DAGNode[] = currentDbTasks.map((t) => ({
          id: t.id,
          title: t.title,
          role: t.role,
          status: t.status as DAGNode["status"],
          dependencies: JSON.parse(t.dependencies || "[]"),
          mcpScope: t.mcpScope || undefined,
          filesScope: t.filesScope ? JSON.parse(t.filesScope) : [],
          attempts: t.attempts,
          maxAttempts: t.maxAttempts,
        }));

        const dagEngine = new DAGEngine(dagNodes);
        const executableNodes = dagEngine.getExecutableNodes();

        if (executableNodes.length === 0) {
          isProcessing = false;
          break;
        }

        // Processa o primeiro nó elegível da fila
        const nodeToExecute = executableNodes[0];
        const taskDb = currentDbTasks.find((t) => t.id === nodeToExecute.id);
        if (!taskDb) break;

        // Atualiza estado para 'running'
        await prisma.taskNode.update({
          where: { id: taskDb.id },
          data: { status: "running" },
        });

        // 1. Contexto do projeto local
        let projectContextBlock = "";
        if (session.project && session.project.path) {
          projectContextBlock = buildProjectContextBlock(session.project) || "";
        }

        // 2. Skill de instrução
        let skillInstructionBlock = "";
        const firstUserMsg = await prisma.message.findFirst({
          where: { sessionId: targetSessionId, role: "user" },
          orderBy: { createdAt: "asc" },
        });

        if (firstUserMsg && firstUserMsg.content.startsWith("/")) {
          const skillRes = resolveSkillOrCommand(
            firstUserMsg.content,
            session.project?.path || process.cwd()
          );
          if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
            skillInstructionBlock = skillRes.skillBlock;
          }
        }

        // 3. Dispatch via SmartRouter (Timeout resiliente de 90s)
        const setting = await prisma.setting.findUnique({ where: { id: "default" } });
        const smartRouter = new SmartRouter();

        const autonomousWorkerPrompt = `Você é um Engenheiro de Software Sênior (${taskDb.role}) responsável pela etapa "${taskDb.title}".
DIRETRIZES DE EXECUÇÃO:
1. Execute a tarefa de forma 100% autônoma e completa. NUNCA faça perguntas ou solicite confirmações.
2. Para cada arquivo no escopo (${taskDb.filesScope || "[]"}), você DEVE OBRIGATORIAMENTE retornar o código-fonte completo em blocos de código formatados com a indicação do arquivo no topo:
\`\`\`typescript
// file: caminho/relativo/do/arquivo.ts
<código completo aqui>
\`\`\`
3. Não inclua discursos sobre governança, desculpas ou cabeçalhos robóticos. Retorne apenas o código funcional e explicações técnicas diretas.`;

        const dispatchMessages: DispatchMessage[] = [
          { role: "system", content: autonomousWorkerPrompt },
        ];
        if (projectContextBlock) dispatchMessages.push({ role: "system", content: projectContextBlock });
        if (skillInstructionBlock) dispatchMessages.push({ role: "system", content: skillInstructionBlock });

        dispatchMessages.push({
          role: "user",
          content: `[EXECUÇÃO DA ETAPA DA DAG: ${taskDb.title}]\nPapel/Função: ${taskDb.role}\nEscopo de Arquivos: ${taskDb.filesScope || "[]"}\nObjetivo: Execute esta etapa de forma 100% autônoma e retorne os códigos de todos os arquivos no escopo.`,
        });

        let stepResultText = "";
        try {
          const stepTimeoutMs = Number(process.env.DAG_STEP_TIMEOUT_MS) || 90000;
          const stepSignal = AbortSignal.timeout(stepTimeoutMs);
          const dispatchPromise = smartRouter.dispatchWithFallback({
            messages: dispatchMessages,
            tier: "fast",
            geminiKey: readSecret(setting?.geminiKey),
            groqKey: readSecret((setting as any)?.groqKey),
            nvidiaKey: readSecret((setting as any)?.nvidiaKey),
            deepseekKey: readSecret((setting as any)?.deepseekKey),
            omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
            omniRouteKey: readSecret(setting?.omniRouteKey),
            stream: false,
            signal: stepSignal,
          });

          const timeoutPromise = new Promise<null>((resolve) => {
            if (stepSignal.aborted) return resolve(null);
            stepSignal.addEventListener("abort", () => resolve(null), { once: true });
          });

          const dispatchRes = (await Promise.race([dispatchPromise, timeoutPromise])) as any;
          if (!dispatchRes) {
            throw new Error(`Timeout de resposta excedido na etapa da DAG (limite ${Math.round(stepTimeoutMs / 1000)}s) — requisição abortada.`);
          }

          if (dispatchRes) {
            const resJson = await dispatchRes.response.json().catch(() => ({}));
            if (resJson.choices?.[0]?.message?.content) {
              stepResultText = resJson.choices[0].message.content;
            } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
              stepResultText = resJson.candidates[0].content.parts[0].text;
            } else {
              stepResultText = `Etapa "${taskDb.title}" executada pelo motor autônomo.`;
            }
          }
        } catch (err) {
          stepResultText = `[AVISO] Notificação da etapa: ${String(err)}`;
          console.warn(`[DAG_TIMEOUT_GUARD] Exceção/Timeout na etapa "${taskDb.title}":`, String(err));
        }

        // 4. Quarentena e Auditoria Dupla-Lente
        const qm = new QuarantineManager();
        const filesScopeArr: string[] = taskDb.filesScope ? JSON.parse(taskDb.filesScope) : [];
        const codeContentMap = qm.extractAndWriteCodeBlocks(taskDb.id, stepResultText, filesScopeArr);
        const type1Res = DualLensAuditor.validateType1(codeContentMap);
        const type2Res = DualLensAuditor.validateType2(type1Res, taskDb.title, stepResultText, codeContentMap);

        let finalStatus: "completed" | "failed" | "blocked" = "completed";
        let promotionTarget: string | null = null;
        const newAttempts = (taskDb.attempts || 0) + 1;

        if (type2Res.verdict === "APPROVED") {
          finalStatus = "completed";
          const targetProjectRoot = session.project?.path || process.cwd();
          qm.promoteToMainRepo(taskDb.id, targetProjectRoot, filesScopeArr);
          promotionTarget = targetProjectRoot;
        } else {
          qm.purgeWorkspace(taskDb.id);
          if (newAttempts >= (taskDb.maxAttempts || 3)) {
            finalStatus = "blocked";
          } else {
            finalStatus = "failed";
          }
        }

        const mcpRes = {
          success: type2Res.verdict === "APPROVED",
          nodeId: taskDb.id,
          title: taskDb.title,
          output: stepResultText,
          auditVerdict: type2Res.verdict,
          promotedPath: promotionTarget,
        };

        await prisma.taskNode.update({
          where: { id: taskDb.id },
          data: {
            status: finalStatus,
            attempts: newAttempts,
            result: JSON.stringify(mcpRes),
          },
        });

        processedCount++;

        TelemetryLogger.log({
          sessionId: targetSessionId,
          action: `NODE_EXECUTION_${finalStatus.toUpperCase()}`,
          details: { nodeId: taskDb.id, title: taskDb.title, verdict: type2Res.verdict, promotedPath: promotionTarget },
        });

        // Se o nó falhou definitivamente (blocked), propaga bloqueio
        if (finalStatus === "blocked") {
          dagEngine.updateNodeStatus(taskDb.id, "blocked");
          for (const remainingNode of dagEngine.getNodes()) {
            if (remainingNode.status === "blocked") {
              await prisma.taskNode.update({
                where: { id: remainingNode.id },
                data: { status: "blocked" },
              });
            }
          }
        }
      }

      // Consulta estado final dos nós da sessão
      const finalSessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: targetSessionId },
        orderBy: { createdAt: "asc" },
      });

      const allCompleted = finalSessionTasks.length > 0 && finalSessionTasks.every((t) => t.status === "completed");
      if (allCompleted) {
        const completedSummary = finalSessionTasks
          .map((t) => `• **${t.title}** (${t.role}): Concluído com sucesso`)
          .join("\n");

        const firstUserMsg = await prisma.message.findFirst({
          where: { sessionId: targetSessionId, role: "user" },
          orderBy: { createdAt: "asc" },
        });

        const skillHeader = firstUserMsg?.content.startsWith("/")
          ? firstUserMsg.content.split(" ")[0]
          : "/autonomo";

        await prisma.message.create({
          data: {
            sessionId: targetSessionId,
            role: "assistant",
            content: `⚡ **[Skill ${skillHeader}] — Execução Autônoma Concluída!**\n\nTodas as etapas da DAG foram executadas, auditadas e promovidas no servidor:\n\n${completedSummary}\n\n📁 _Arquivos gravados e sincronizados em: \`${session.project?.path || process.cwd()}\`_`,
          },
        });
      }

      return NextResponse.json({
        success: true,
        processedCount,
        allCompleted,
        tasks: finalSessionTasks,
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
