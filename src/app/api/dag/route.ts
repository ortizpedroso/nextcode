import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { SmartRouter, AvailableKeys, DispatchMessage } from "@/core/router/smart-router";
import { MCPClient } from "@/core/mcp/mcp-client";
import { readSecret } from "@/core/security/crypto";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor, LLMDispatchFn } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { buildErrorSignature } from "@/core/telemetry/error-signature";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { IncidentReporter, FailureAttemptRecord } from "@/core/governance/incident-reporter";
import { promoteWithEmpiricalGate, firstBuildErrorLine } from "@/core/governance/empirical-gate";
import type { Setting } from "@prisma/client";

/** Minera telemetria em plano de fundo após cada execução de nó — nunca bloqueia a resposta. */
function mineTelemetryInBackground(): void {
  SkillMiner.analyzeAndPropose().catch((err) => console.error("[SkillMiner] analyzeAndPropose falhou:", err));
  SkillMiner.detectRecurringBugs().catch((err) => console.error("[SkillMiner] detectRecurringBugs falhou:", err));
}

/**
 * Trava T6 (D-RANHO): acumula cada tentativa rejeitada de um nó em `failureHistory` — sem
 * isso, `result` (campo único, sobrescrito a cada tentativa) perdia o histórico das rejeições
 * anteriores e o IncidentReporter nunca tinha dados reais para citar quando o nó atingia o
 * limite de tentativas e era bloqueado.
 */
function appendFailureAttempt(existingHistoryJson: string | null | undefined, record: FailureAttemptRecord): string {
  let history: FailureAttemptRecord[] = [];
  try {
    history = existingHistoryJson ? JSON.parse(existingHistoryJson) : [];
  } catch {
    history = [];
  }
  history.push(record);
  return JSON.stringify(history);
}

/**
 * Trava T6 (D-RANHO): propaga em cascata o bloqueio de nós falhados definitivamente para
 * todos os dependentes (diretos e transitivos) ainda pendentes da sessão e persiste o novo
 * status no banco. Antes, o bloqueio ficava só na memória do DAGEngine (process_queue) ou
 * nem era propagado (execute_node), e os dependentes continuavam "pending" no SQLite.
 */
async function cascadeBlockedNodes(sessionId: string): Promise<string[]> {
  const sessionTasks = await prisma.taskNode.findMany({ where: { sessionId } });
  const knownIds = new Set(sessionTasks.map((t) => t.id));
  const engine = new DAGEngine(
    sessionTasks.map((t) => ({
      id: t.id,
      title: t.title,
      role: t.role,
      status: t.status as DAGNode["status"],
      dependencies: (JSON.parse(t.dependencies || "[]") as string[]).filter((depId) => knownIds.has(depId)),
      attempts: t.attempts,
      maxAttempts: t.maxAttempts,
    }))
  );
  const newlyBlocked = engine.propagateBlockState();
  for (const blockedId of newlyBlocked) {
    await prisma.taskNode.update({ where: { id: blockedId }, data: { status: "blocked" } });
  }
  return newlyBlocked;
}

/**
 * Trava T6 (D-RANHO): quando um nó esgota o ciclo de tentativas automáticas (maxAttempts,
 * padrão 3) a engine para de tentar sozinha e REPORTA AO HUMANO — publica no chat da sessão
 * o relatório de incidente direcionado ao erro (causa classificada, erro exato, se se repetiu,
 * ação recomendada, dependentes bloqueados). Antes o relatório só ficava no JSON `result` do
 * nó, sem nenhum aviso visível na conversa.
 */
async function reportBlockedNodeToHuman(sessionId: string, nodeId: string): Promise<void> {
  const sessionTasks = await prisma.taskNode.findMany({ where: { sessionId } });
  const node = sessionTasks.find((t) => t.id === nodeId);
  if (!node) return;

  const blockedDependents: string[] = [];
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of sessionTasks) {
      if (seen.has(t.id)) continue;
      const deps: string[] = JSON.parse(t.dependencies || "[]");
      if (deps.includes(current)) {
        seen.add(t.id);
        queue.push(t.id);
        if (t.status === "blocked") blockedDependents.push(t.title);
      }
    }
  }

  let history: FailureAttemptRecord[] = [];
  try {
    history = JSON.parse(node.failureHistory || "[]");
  } catch {
    history = [];
  }

  const report = IncidentReporter.generateIncidentReport(node.id, node.title, node.cluster, history, {
    maxAttempts: node.maxAttempts,
    blockedDependents,
  });

  await prisma.message.create({
    data: {
      sessionId,
      role: "assistant",
      content: `🛑 **Etapa "${node.title}" bloqueada após ${history.length} tentativa(s) automática(s) — intervenção humana necessária.**

${report}`,
    },
  });
  TelemetryLogger.log({
    sessionId,
    action: "NODE_BLOCKED_HUMAN_NOTIFIED",
    details: { nodeId, attempts: history.length, blockedDependents },
  });
}

/**
 * Item 8 (Spec-vs-disco): compara os `arquivos_afetados` declarados na Spec Canônica
 * aprovada contra o que de fato existe em disco no diretório do projeto. Isso cobre o caso
 * em que a DAG termina (sem mais nós executáveis) mas algum arquivo prometido na Spec nunca
 * chegou a ser gerado/promovido por nenhum nó — algo que o status "completed" por nó não
 * detecta, pois cada nó só sabe sobre o próprio filesScope, não sobre a Spec como um todo.
 * Retorna null quando não há Spec estruturada para comparar (formato antigo/prosa livre),
 * para não transformar ausência de dado em falso-bloqueio.
 */
function checkSpecCompletenessOnDisk(
  canonicalSpec: string | null | undefined,
  projectPath: string | null | undefined
): { complete: boolean; declaredFiles: string[]; missingFiles: string[] } | null {
  if (!canonicalSpec) return null;
  const parsed = parseSpecDocument(canonicalSpec);
  if (!parsed || parsed.arquivosAfetados.length === 0) return null;

  const basePath = projectPath || process.cwd();
  const declaredFiles = parsed.arquivosAfetados;
  const missingFiles = declaredFiles.filter((f) => !fs.existsSync(path.join(basePath, f)));

  return { complete: missingFiles.length === 0, declaredFiles, missingFiles };
}

/**
 * Reconstrói o Brief real da etapa (não apenas o título curto) a partir do payload salvo
 * pelo SpecDecomposerSkill (`{ goal, context, step }`). Sem isso, a Lente 1 (Auditor Cego)
 * não teria o objetivo original para comparar contra o código — só um rótulo genérico como
 * "Desenvolvimento dos Componentes e APIs", insuficiente para qualquer verificação semântica.
 */
function buildBriefMarkdown(task: { title: string; role?: string | null; filesScope?: string | null; payload?: string | null }): string {
  let goal = "";
  try {
    const parsed = task.payload ? JSON.parse(task.payload) : null;
    if (parsed && typeof parsed.goal === "string") goal = parsed.goal;
  } catch {
    /* payload ausente/malformado: segue apenas com o título */
  }
  return `# Etapa: ${task.title}\n\n## Objetivo original (Brief)\n${
    goal || "(objetivo detalhado não disponível — avalie apenas pelo título da etapa)"
  }\n\n## Escopo de arquivos esperado\n${task.filesScope || "[]"}`;
}

/** Adapta o SmartRouter (tier fast, mesmas chaves BYOK já resolvidas na etapa) para o formato de dispatchFn que o DualLensAuditor espera, mantendo o auditor desacoplado dos provedores. */
function makeBlindAuditDispatchFn(smartRouter: SmartRouter, setting: Setting | null): LLMDispatchFn {
  return async (messages) => {
    try {
      const res = await smartRouter.dispatchWithFallback({
        messages,
        tier: "fast",
        geminiKey: readSecret(setting?.geminiKey),
        groqKey: readSecret((setting as any)?.groqKey),
        nvidiaKey: readSecret((setting as any)?.nvidiaKey),
        deepseekKey: readSecret((setting as any)?.deepseekKey),
        omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
        omniRouteKey: readSecret(setting?.omniRouteKey),
        stream: false,
        // Trava T5: sem veredito da Lente Cega nada é aprovado — 10s derrubava auditorias em
        // provedores lentos e virava rejeição; limite configurável via BLIND_AUDIT_TIMEOUT_MS.
        signal: AbortSignal.timeout(Number(process.env.BLIND_AUDIT_TIMEOUT_MS) || 30000),
      });
      const json = await res.response.json().catch(() => null);
      return (
        json?.choices?.[0]?.message?.content ??
        json?.candidates?.[0]?.content?.parts?.[0]?.text ??
        null
      );
    } catch {
      return null;
    }
  };
}

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

      // Trava T1: criar/decompor os nós da DAG NUNCA aprova a Spec por si só — os nós ficam
      // "pending" até o usuário aprovar explicitamente (modal) ou o /api/chat detectar aprovação
      // por palavra-chave. A execução real (execute_node / process_queue) já valida
      // session.specApproved antes de gravar qualquer arquivo em disco.

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

      // Fonte de verdade real do escopo de arquivos: a Spec Canônica já declara
      // `arquivos_afetados` (dinâmico por projeto, sem keyword-sniffing). Só cai na
      // heurística de domínio dentro de SpecDecomposerSkill quando a Spec ainda não
      // existe ou não os declarou.
      const sessionForScope = await prisma.session.findUnique({
        where: { id: activeSessionId },
        select: { canonicalSpec: true },
      });
      const specFilesScope = sessionForScope?.canonicalSpec
        ? parseSpecDocument(sessionForScope.canonicalSpec)?.arquivosAfetados
        : undefined;

      // Decompõe em nós via SpecDecomposerSkill
      const { nodes: decomposedNodes } = SpecDecomposerSkill.decompose(targetPrompt, undefined, specFilesScope);

      // Salva os nós no banco de dados SQLite
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

      // Trava T6 (D-RANHO): o botão "Executar nó" não pode furar o limite de tentativas nem
      // a ordem da DAG. Só executa nós que o próprio DAGEngine consideraria executáveis:
      // pendentes (ou "failed" com tentativas restantes) e com todas as dependências concluídas.
      // Nó "blocked" só volta ao ciclo via retry_node (desbloqueio humano explícito).
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
      let skillInstructionUntrusted = false;
      const firstUserMsg = await prisma.message.findFirst({
        where: { sessionId: task.sessionId, role: "user" },
        orderBy: { createdAt: "asc" },
      });

      if (firstUserMsg && firstUserMsg.content.startsWith("/")) {
        const skillRes = await resolveSkillOrCommand(
          firstUserMsg.content,
          task.session.project?.path || process.cwd()
        );
        if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
          skillInstructionBlock = skillRes.skillBlock;
          skillInstructionUntrusted = Boolean(skillRes.untrustedSource);
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
      // SEGURANÇA: conteúdo de skill instalada (terceiros) vai como "user", não "system" — ver skill-resolver.ts.
      if (skillInstructionBlock) {
        dispatchMessages.push({ role: skillInstructionUntrusted ? "user" : "system", content: skillInstructionBlock });
      }

      // Auto-Healing Feedback Loop: Se for uma re-tentativa após falha, injeta o erro exato da auditoria anterior
      if ((task.attempts || 0) > 0 && task.result) {
        try {
          const prevRes = JSON.parse(task.result);
          if (prevRes.auditVerdict !== "APPROVED" || prevRes.rejectionReason) {
            const feedbackText = `\n\n⚠️ [AUTO-HEALING FEEDBACK - RE-TENTATIVA #${(task.attempts || 0) + 1}]\nA tentativa anterior foi REJEITADA pela auditoria com os seguintes erros:\n${prevRes.rejectionReason || "Erros de compilação/sintaxe"}\nVocê DEVE obrigatoriamente corrigir esses erros e garantir que todos os imports e módulos existam!`;
            dispatchMessages.push({ role: "system", content: feedbackText });
          }
        } catch {}
      }

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
      //
      // Tudo a partir daqui roda sob try/catch: o nó já foi marcado "running" no banco
      // (acima) e, sem essa rede, qualquer exceção não prevista (fs, parsing, auditor,
      // build) escapava direto para o catch do POST e deixava o nó travado em "running"
      // para sempre — getExecutableNodes() não considera "running" retomável, e nada no
      // front-end re-chama process_queue sozinho (só re-busca o estado via GET). Era
      // exatamente o "fica ali eternamente" sem botão de retry (UI só mostra retry para
      // failed/blocked).
      let finalStatus: "completed" | "failed" | "blocked" = "completed";
      let promotionTarget: string | null = null;
      let empiricalBuildResult: Awaited<ReturnType<typeof TerminalExecutionEngine.verifyProjectBuild>> = null;
      let empiricalFailureLine: string | undefined;
      let mcpRes: Record<string, unknown>;
      let newFailureHistory: string | undefined;

      // Trava T6 (D-RANHO): se esta tentativa falhar, ela já atinge o limite de tentativas
      // do nó? Decide "failed" (segue elegível para retry) vs "blocked" (bloqueio mecânico +
      // cascata para dependentes, ver DAGEngine.propagateBlockState) — este caminho
      // (execução de um único nó via botão "Executar nó") nunca aplicava esse limite.
      const maxAttempts = task.maxAttempts || 3;
      const wouldReachBlockThreshold = task.attempts + 1 >= maxAttempts;

      try {
        const qm = new QuarantineManager();
        const filesScope: string[] = task.filesScope ? JSON.parse(task.filesScope) : [];
        const targetProjectRoot = task.session.project?.path || process.cwd();

        // Extrai os blocos de código gerados e grava no workspace isolado de quarentena
        const codeContentMap = qm.extractAndWriteCodeBlocks(task.id, stepResultText, filesScope, { strictPaths: true });

        // Executa a Auditoria em Duas Lentes (Tipo 1 Mecânico + Tipo 2 Auditor Cego)
        const type1Res = DualLensAuditor.validateType1(
          codeContentMap,
          [],
          targetProjectRoot,
          filesScope,
          qm.extractionIssues
        );
        const type2Res = await DualLensAuditor.validateType2(
          type1Res,
          buildBriefMarkdown(task),
          stepResultText,
          codeContentMap,
          makeBlindAuditDispatchFn(smartRouter, setting)
        );

        if (type2Res.divergenceDetected) {
          TelemetryLogger.log({
            sessionId: task.sessionId,
            action: "WORKER_SELF_REPORT_DIVERGENCE",
            details: {
              errorSignature: buildErrorSignature("divergence", `nodeId=${task.id}|verdict=${type2Res.verdict}`),
              sample: type2Res.lens2CrossVerification,
            },
          });
        }

        if (type2Res.verdict === "APPROVED") {
          finalStatus = "completed";
          // Trava T4: promove com prova empírica real (type-check do projeto mesclado) e
          // desfaz a promoção se ela introduzir erros novos — antes o nó virava "failed" mas o
          // código quebrado permanecia no repositório principal.
          const gate = await promoteWithEmpiricalGate(qm, task.id, targetProjectRoot, filesScope);
          empiricalBuildResult = gate.buildResult;
          promotionTarget = gate.rolledBack ? null : targetProjectRoot;
          if (gate.preexistingFailure) {
            TelemetryLogger.log({
              sessionId: task.sessionId,
              action: "EMPIRICAL_BUILD_PREEXISTING_FAILURE",
              details: { nodeId: task.id },
            });
          }
          if (!gate.passed && empiricalBuildResult) {
            empiricalFailureLine = firstBuildErrorLine(empiricalBuildResult, gate.newErrors);
            TelemetryLogger.log({
              sessionId: task.sessionId,
              action: "EMPIRICAL_BUILD_FAILED",
              details: {
                errorSignature: buildErrorSignature("build", empiricalFailureLine),
                sample: empiricalFailureLine,
                rolledBack: gate.rolledBack,
              },
            });
            // Item (B): antes o nó ficava "completed" mesmo com o type-check real do projeto
            // quebrado — a DAG avançava sobre uma base inválida sem nenhum sinal de retry.
            finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
          }
        } else {
          finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
          qm.purgeWorkspace(task.id);

          TelemetryLogger.log({
            sessionId: task.sessionId,
            action: "AUDIT_REJECTED",
            details: {
              errorSignature: buildErrorSignature("type2", type2Res.rejectionReason || "divergência semântica"),
              sample: type2Res.rejectionReason || "",
            },
          });
        }

        const empiricalFailureReason = empiricalFailureLine
          ? `Verificação empírica (type-check real pós-promoção) falhou — promoção desfeita: ${empiricalFailureLine}`
          : undefined;

        const rejectionReason =
          empiricalFailureReason || (type2Res.verdict !== "APPROVED" ? type2Res.rejectionReason : undefined);

        // Trava T6 (D-RANHO): acumula o histórico de tentativas rejeitadas e, ao atingir o
        // limite (status "blocked"), gera o relatório de incidente citando esse histórico —
        // sem isso o IncidentReporter nunca tinha dados reais para citar.
        let incidentReportMarkdown: string | undefined;
        if (finalStatus === "failed" || finalStatus === "blocked") {
          newFailureHistory = appendFailureAttempt(task.failureHistory, {
            attemptNumber: task.attempts + 1,
            rejectionReason: rejectionReason || "Falha não especificada.",
            filesScope,
            timestamp: new Date().toISOString(),
          });
          if (finalStatus === "blocked") {
            const history: FailureAttemptRecord[] = JSON.parse(newFailureHistory);
            incidentReportMarkdown = IncidentReporter.generateIncidentReport(task.id, task.title, task.cluster, history, { maxAttempts });
          }
        }

        mcpRes = {
          success: finalStatus === "completed",
          nodeId: task.id,
          title: task.title,
          output: stepResultText,
          auditVerdict: type2Res.verdict,
          auditMethod: type2Res.method,
          promotedPath: promotionTarget,
          empiricalBuildPassed: empiricalBuildResult ? empiricalBuildResult.success : null,
          rejectionReason,
          incidentReport: incidentReportMarkdown,
        };
      } catch (err) {
        finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
        newFailureHistory = appendFailureAttempt(task.failureHistory, {
          attemptNumber: task.attempts + 1,
          rejectionReason: `Exceção não tratada durante auditoria/promoção: ${String(err)}`,
          filesScope: task.filesScope ? JSON.parse(task.filesScope) : [],
          timestamp: new Date().toISOString(),
        });
        const incidentReportMarkdown =
          finalStatus === "blocked"
            ? IncidentReporter.generateIncidentReport(task.id, task.title, task.cluster, JSON.parse(newFailureHistory), {
                maxAttempts,
              })
            : undefined;
        mcpRes = {
          success: false,
          nodeId: task.id,
          title: task.title,
          output: stepResultText,
          auditVerdict: "ERROR",
          rejectionReason: `Exceção não tratada durante auditoria/promoção: ${String(err)}`,
          incidentReport: incidentReportMarkdown,
        };
        console.error(`[DAG_NODE_CRASH] Nó "${task.title}" travou após 'running':`, err);
      }

      // Atualiza estado do nó no SQLite
      const updatedTask = await prisma.taskNode.update({
        where: { id: nodeId },
        data: {
          status: finalStatus,
          attempts: finalStatus === "failed" || finalStatus === "blocked" ? task.attempts + 1 : task.attempts,
          result: JSON.stringify(mcpRes),
          ...(newFailureHistory ? { failureHistory: newFailureHistory } : {}),
        },
      });

      TelemetryLogger.log({
        sessionId: task.sessionId,
        action: `NODE_EXECUTION_${finalStatus.toUpperCase()}`,
        details: {
          nodeId: task.id,
          title: task.title,
          verdict: (mcpRes as any).auditVerdict,
          auditMethod: (mcpRes as any).auditMethod,
          promotedPath: promotionTarget,
        },
      });
      mineTelemetryInBackground();

      if (finalStatus === "blocked") {
        await cascadeBlockedNodes(task.sessionId);
        await reportBlockedNodeToHuman(task.sessionId, task.id);
      }

      // Checa se todos os nós da sessão foram concluídos
      const sessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: task.sessionId },
      });

      const allCompleted = sessionTasks.length > 0 && sessionTasks.every((t) => t.status === "completed");
      const specCompleteness = checkSpecCompletenessOnDisk(task.session.canonicalSpec, task.session.project?.path);

      if (allCompleted) {
        const existingCompletionMsg = await prisma.message.findFirst({
          where: {
            sessionId: task.sessionId,
            role: "assistant",
            content: { contains: "Execução Autônoma Concluída!" },
          },
        });

        if (!existingCompletionMsg) {
          const completedSummary = sessionTasks
            .map((t) => `• **${t.title}** (${t.role}): Concluído com sucesso`)
            .join("\n");

          const skillHeader = firstUserMsg?.content.startsWith("/")
            ? firstUserMsg.content.split(" ")[0]
            : "/autonomo";

          const completenessBlock =
            specCompleteness && !specCompleteness.complete
              ? `\n\n⚠️ **Spec vs. disco: ${specCompleteness.missingFiles.length} arquivo(s) declarado(s) na Spec não foram encontrados no projeto:**\n${specCompleteness.missingFiles
                  .map((f) => `- ❌ \`${f}\``)
                  .join("\n")}`
              : "";

          await prisma.message.create({
            data: {
              sessionId: task.sessionId,
              role: "assistant",
              content: `⚡ **[Skill ${skillHeader}] — Execução Autônoma Concluída!**\n\nTodas as etapas da DAG foram executadas, auditadas e promovidas para o projeto:\n\n${completedSummary}\n\n📁 _Arquivos gravados e sincronizados em: \`${task.session.project?.path || process.cwd()}\`_${completenessBlock}`,
            },
          });
        }
      }

      return NextResponse.json({
        success: true,
        executedTask: updatedTask,
        promotedPath: promotionTarget,
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

      // Recuperação de nós "zumbis": um crash/restart do processo entre a escrita de
      // "running" e a escrita do status final (ver try/catch em executeNodeInQueue abaixo)
      // deixa o nó travado em "running" para sempre, invisível para getExecutableNodes()
      // e sem botão de retry na UI. Qualquer nó "running" há mais tempo que o timeout de
      // uma etapa + margem é tratado como órfão e devolvido ao ciclo normal de retry/bloqueio.
      const staleThresholdMs = (Number(process.env.DAG_STEP_TIMEOUT_MS) || 90000) + 30000;
      const staleRunningTasks = await prisma.taskNode.findMany({
        where: {
          sessionId: targetSessionId,
          status: "running",
          updatedAt: { lt: new Date(Date.now() - staleThresholdMs) },
        },
      });
      for (const stale of staleRunningTasks) {
        const staleAttempts = (stale.attempts || 0) + 1;
        const staleStatus: "failed" | "blocked" = staleAttempts >= (stale.maxAttempts || 3) ? "blocked" : "failed";
        const staleRejectionReason = "Nó recuperado após travar em 'running' (processo provavelmente interrompido).";
        const staleFailureHistory = appendFailureAttempt(stale.failureHistory, {
          attemptNumber: staleAttempts,
          rejectionReason: staleRejectionReason,
          filesScope: stale.filesScope ? JSON.parse(stale.filesScope) : [],
          timestamp: new Date().toISOString(),
        });
        const staleIncidentReport =
          staleStatus === "blocked"
            ? IncidentReporter.generateIncidentReport(
                stale.id,
                stale.title,
                stale.cluster,
                JSON.parse(staleFailureHistory)
              )
            : undefined;
        await prisma.taskNode.update({
          where: { id: stale.id },
          data: {
            status: staleStatus,
            attempts: staleAttempts,
            failureHistory: staleFailureHistory,
            result: JSON.stringify({
              success: false,
              auditVerdict: "ERROR",
              rejectionReason: staleRejectionReason,
              incidentReport: staleIncidentReport,
            }),
          },
        });
      }

      // Nós bloqueados antes desta chamada (ex.: recuperação de "zumbis" acima) ainda podem
      // ter dependentes "pending" no banco — getExecutableNodes só os bloqueia em memória.
      await cascadeBlockedNodes(targetSessionId);
      for (const stale of staleRunningTasks) {
        if ((stale.attempts || 0) + 1 >= (stale.maxAttempts || 3)) {
          await reportBlockedNodeToHuman(targetSessionId, stale.id);
        }
      }

      let processedCount = 0;
      let isProcessing = true;

      while (isProcessing) {
        const currentDbTasks = await prisma.taskNode.findMany({
          where: { sessionId: targetSessionId },
          orderBy: { createdAt: "asc" },
        });

        const knownIds = new Set(currentDbTasks.map((t) => t.id));

        const dagNodes: DAGNode[] = currentDbTasks.map((t, idx) => {
          const rawDeps: string[] = JSON.parse(t.dependencies || "[]");
          const validDeps = rawDeps.filter((depId) => knownIds.has(depId));
          const hasUnresolvedUnknownDep = rawDeps.some((depId) => !knownIds.has(depId));
          const autoResolvedDeps =
            hasUnresolvedUnknownDep && idx > 0 && currentDbTasks[idx - 1].status === "completed"
              ? [currentDbTasks[idx - 1].id]
              : validDeps;

          return {
            id: t.id,
            title: t.title,
            role: t.role,
            status: t.status as DAGNode["status"],
            dependencies: autoResolvedDeps,
            mcpScope: t.mcpScope || undefined,
            filesScope: t.filesScope ? JSON.parse(t.filesScope) : [],
            attempts: t.attempts,
            maxAttempts: t.maxAttempts,
          };
        });

        const dagEngine = new DAGEngine(dagNodes);
        const executableNodes = dagEngine.getExecutableNodes();

        if (executableNodes.length === 0) {
          isProcessing = false;
          break;
        }

        // Execução Concorrente de Subagentes: Processa em lote (máx. 3 nós paralelos sem dependências mútuas)
        const batchToExecute = executableNodes.slice(0, 3);
        const tasksToExecute = batchToExecute
          .map((node) => currentDbTasks.find((t) => t.id === node.id))
          .filter((t): t is typeof currentDbTasks[0] => Boolean(t));

        if (tasksToExecute.length === 0) break;

        const executeNodeInQueue = async (taskDb: typeof tasksToExecute[0]) => {
          await prisma.taskNode.update({
            where: { id: taskDb.id },
            data: { status: "running" },
          });

          let projectContextBlock = "";
          if (session.project && session.project.path) {
            projectContextBlock = buildProjectContextBlock(session.project) || "";
          }

          let skillInstructionBlock = "";
          let skillInstructionUntrusted = false;
          const firstUserMsg = await prisma.message.findFirst({
            where: { sessionId: targetSessionId, role: "user" },
            orderBy: { createdAt: "asc" },
          });

          if (firstUserMsg && firstUserMsg.content.startsWith("/")) {
            const skillRes = await resolveSkillOrCommand(
              firstUserMsg.content,
              session.project?.path || process.cwd()
            );
            if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
              skillInstructionBlock = skillRes.skillBlock;
              skillInstructionUntrusted = Boolean(skillRes.untrustedSource);
            }
          }

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
          // SEGURANÇA: conteúdo de skill instalada (terceiros) vai como "user", não "system" — ver skill-resolver.ts.
          if (skillInstructionBlock) {
            dispatchMessages.push({ role: skillInstructionUntrusted ? "user" : "system", content: skillInstructionBlock });
          }

          // Auto-Healing Feedback Loop: Se for uma re-tentativa após falha, injeta o erro exato da auditoria anterior
          if ((taskDb.attempts || 0) > 0 && taskDb.result) {
            try {
              const prevRes = JSON.parse(taskDb.result);
              if (prevRes.auditVerdict !== "APPROVED" || prevRes.rejectionReason) {
                const feedbackText = `\n\n⚠️ [AUTO-HEALING FEEDBACK - RE-TENTATIVA #${(taskDb.attempts || 0) + 1}]\nA tentativa anterior foi REJEITADA pela auditoria com os seguintes erros:\n${prevRes.rejectionReason || "Erros de compilação/sintaxe"}\nVocê DEVE obrigatoriamente corrigir esses erros e garantir que todos os imports e módulos existam!`;
                dispatchMessages.push({ role: "system", content: feedbackText });
              }
            } catch {}
          }

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

          // Mesma rede de segurança do execute_node (ver comentário acima dele): o nó já
          // está "running" no banco, e sem try/catch aqui uma exceção não prevista
          // (fs/parsing/auditor/build) rejeita a Promise, derruba o Promise.all do lote
          // inteiro e deixa o nó travado em "running" para sempre — sem retry automático
          // (getExecutableNodes não retoma "running") nem botão manual (UI só mostra
          // retry para failed/blocked).
          let finalStatus: "completed" | "failed" | "blocked" = "completed";
          let promotionTarget: string | null = null;
          let empiricalBuildResult: Awaited<ReturnType<typeof TerminalExecutionEngine.verifyProjectBuild>> = null;
          const newAttempts = (taskDb.attempts || 0) + 1;
          let mcpRes: Record<string, unknown>;
          let newFailureHistory: string | undefined;

          try {
            const qm = new QuarantineManager();
            const filesScopeArr: string[] = taskDb.filesScope ? JSON.parse(taskDb.filesScope) : [];
            const targetProjectRoot = session.project?.path || process.cwd();
            const codeContentMap = qm.extractAndWriteCodeBlocks(taskDb.id, stepResultText, filesScopeArr, {
              strictPaths: true,
            });
            const type1Res = DualLensAuditor.validateType1(
              codeContentMap,
              [],
              targetProjectRoot,
              filesScopeArr,
              qm.extractionIssues
            );
            const type2Res = await DualLensAuditor.validateType2(
              type1Res,
              buildBriefMarkdown(taskDb),
              stepResultText,
              codeContentMap,
              makeBlindAuditDispatchFn(smartRouter, setting)
            );

            if (type2Res.divergenceDetected) {
              TelemetryLogger.log({
                sessionId: targetSessionId,
                action: "WORKER_SELF_REPORT_DIVERGENCE",
                details: {
                  errorSignature: buildErrorSignature("divergence", `nodeId=${taskDb.id}|verdict=${type2Res.verdict}`),
                  sample: type2Res.lens2CrossVerification,
                },
              });
            }

            let rejectionReason: string | undefined;

            if (type2Res.verdict === "APPROVED") {
              finalStatus = "completed";
              // Trava T4: mesma prova empírica com rollback do execute_node (ver acima).
              const gate = await promoteWithEmpiricalGate(qm, taskDb.id, targetProjectRoot, filesScopeArr);
              empiricalBuildResult = gate.buildResult;
              promotionTarget = gate.rolledBack ? null : targetProjectRoot;
              if (gate.preexistingFailure) {
                TelemetryLogger.log({
                  sessionId: targetSessionId,
                  action: "EMPIRICAL_BUILD_PREEXISTING_FAILURE",
                  details: { nodeId: taskDb.id },
                });
              }
              if (!gate.passed && empiricalBuildResult) {
                const firstErrorLine = firstBuildErrorLine(empiricalBuildResult, gate.newErrors);
                TelemetryLogger.log({
                  sessionId: targetSessionId,
                  action: "EMPIRICAL_BUILD_FAILED",
                  details: {
                    errorSignature: buildErrorSignature("build", firstErrorLine),
                    sample: firstErrorLine,
                    rolledBack: gate.rolledBack,
                  },
                });
                finalStatus = newAttempts >= (taskDb.maxAttempts || 3) ? "blocked" : "failed";
                rejectionReason = `Verificação empírica (type-check real pós-promoção) falhou — promoção desfeita: ${firstErrorLine}`;
              }
            } else {
              qm.purgeWorkspace(taskDb.id);
              finalStatus = newAttempts >= (taskDb.maxAttempts || 3) ? "blocked" : "failed";
              rejectionReason = type2Res.rejectionReason || "Divergência semântica.";

              TelemetryLogger.log({
                sessionId: targetSessionId,
                action: "AUDIT_REJECTED",
                details: {
                  errorSignature: buildErrorSignature("type2", type2Res.rejectionReason || "divergência semântica"),
                  sample: type2Res.rejectionReason || "",
                },
              });
            }

            // Trava T6 (D-RANHO): acumula o histórico de tentativas rejeitadas e, ao atingir
            // o limite ("blocked"), gera o relatório de incidente citando esse histórico.
            let incidentReportMarkdown: string | undefined;
            if (finalStatus === "failed" || finalStatus === "blocked") {
              newFailureHistory = appendFailureAttempt(taskDb.failureHistory, {
                attemptNumber: newAttempts,
                rejectionReason: rejectionReason || "Falha não especificada.",
                filesScope: filesScopeArr,
                timestamp: new Date().toISOString(),
              });
              if (finalStatus === "blocked") {
                const history: FailureAttemptRecord[] = JSON.parse(newFailureHistory);
                incidentReportMarkdown = IncidentReporter.generateIncidentReport(
                  taskDb.id,
                  taskDb.title,
                  taskDb.cluster,
                  history,
                  { maxAttempts: taskDb.maxAttempts || 3 }
                );
              }
            }

            mcpRes = {
              success: finalStatus === "completed",
              nodeId: taskDb.id,
              title: taskDb.title,
              output: stepResultText,
              auditVerdict: type2Res.verdict,
              auditMethod: type2Res.method,
              promotedPath: promotionTarget,
              empiricalBuildPassed: empiricalBuildResult ? empiricalBuildResult.success : null,
              rejectionReason,
              incidentReport: incidentReportMarkdown,
            };
          } catch (err) {
            finalStatus = newAttempts >= (taskDb.maxAttempts || 3) ? "blocked" : "failed";
            newFailureHistory = appendFailureAttempt(taskDb.failureHistory, {
              attemptNumber: newAttempts,
              rejectionReason: `Exceção não tratada durante auditoria/promoção: ${String(err)}`,
              filesScope: taskDb.filesScope ? JSON.parse(taskDb.filesScope) : [],
              timestamp: new Date().toISOString(),
            });
            const incidentReportMarkdown =
              finalStatus === "blocked"
                ? IncidentReporter.generateIncidentReport(
                    taskDb.id,
                    taskDb.title,
                    taskDb.cluster,
                    JSON.parse(newFailureHistory)
                  )
                : undefined;
            mcpRes = {
              success: false,
              nodeId: taskDb.id,
              title: taskDb.title,
              output: stepResultText,
              auditVerdict: "ERROR",
              rejectionReason: `Exceção não tratada durante auditoria/promoção: ${String(err)}`,
              incidentReport: incidentReportMarkdown,
            };
            console.error(`[DAG_NODE_CRASH] Nó "${taskDb.title}" travou após 'running':`, err);
          }

          await prisma.taskNode.update({
            where: { id: taskDb.id },
            data: {
              status: finalStatus,
              attempts: newAttempts,
              result: JSON.stringify(mcpRes),
              ...(newFailureHistory ? { failureHistory: newFailureHistory } : {}),
            },
          });

          TelemetryLogger.log({
            sessionId: targetSessionId,
            action: `NODE_EXECUTION_${finalStatus.toUpperCase()}`,
            details: {
              nodeId: taskDb.id,
              title: taskDb.title,
              verdict: (mcpRes as any).auditVerdict,
              auditMethod: (mcpRes as any).auditMethod,
              promotedPath: promotionTarget,
            },
          });
          mineTelemetryInBackground();

          return { id: taskDb.id, finalStatus };
        };

        const batchResults = await Promise.all(tasksToExecute.map((t) => executeNodeInQueue(t)));
        processedCount += batchResults.length;

        // Propaga bloqueio em cascata (persistido) se algum nó do lote falhou definitivamente
        if (batchResults.some((res) => res.finalStatus === "blocked")) {
          await cascadeBlockedNodes(targetSessionId);
          for (const res of batchResults) {
            if (res.finalStatus === "blocked") await reportBlockedNodeToHuman(targetSessionId, res.id);
          }
        }
      }

      // Consulta estado final dos nós da sessão
      const finalSessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: targetSessionId },
        orderBy: { createdAt: "asc" },
      });

      const allCompleted = finalSessionTasks.length > 0 && finalSessionTasks.every((t) => t.status === "completed");

      // Item 8: Verificação de completude Spec-vs-disco. Roda sempre que a fila para de ter
      // nós executáveis (concluída ou bloqueada), para também sinalizar lacunas mesmo em
      // cenários de bloqueio parcial, não só no caminho feliz de 100% completo.
      const specCompleteness = checkSpecCompletenessOnDisk(session.canonicalSpec, session.project?.path);

      if (allCompleted) {
        const existingCompletionMsg = await prisma.message.findFirst({
          where: {
            sessionId: targetSessionId,
            role: "assistant",
            content: { contains: "Execução Autônoma Concluída!" },
          },
        });

        if (!existingCompletionMsg) {
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

          const completenessBlock =
            specCompleteness && !specCompleteness.complete
              ? `\n\n⚠️ **Spec vs. disco: ${specCompleteness.missingFiles.length} arquivo(s) declarado(s) na Spec não foram encontrados no projeto:**\n${specCompleteness.missingFiles
                  .map((f) => `- ❌ \`${f}\``)
                  .join("\n")}`
              : "";

          await prisma.message.create({
            data: {
              sessionId: targetSessionId,
              role: "assistant",
              content: `⚡ **[Skill ${skillHeader}] — Execução Autônoma Concluída!**\n\nTodas as etapas da DAG foram executadas, auditadas e promovidas no servidor:\n\n${completedSummary}\n\n📁 _Arquivos gravados e sincronizados em: \`${session.project?.path || process.cwd()}\`_${completenessBlock}`,
            },
          });
        }
      }

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

      // Desbloqueia o nó selecionado resetando tentativas, status e o histórico de falhas
      // (Trava T6 - D-RANHO): um novo ciclo de tentativas começa limpo, sem o relatório de
      // incidente da rodada anterior.
      await prisma.taskNode.update({
        where: { id: nodeId },
        data: { status: "pending", attempts: 0, failureHistory: "[]" },
      });

      // Libera nós em cascata da mesma sessão que estavam bloqueados
      const sessionTasks = await prisma.taskNode.findMany({
        where: { sessionId: targetTask.sessionId },
      });

      for (const task of sessionTasks) {
        if (task.status === "blocked") {
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
