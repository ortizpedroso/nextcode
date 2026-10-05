import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { SmartRouter, DispatchMessage } from "@/core/router/smart-router";
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
import { promoteWithEmpiricalGate, empiricalStageLabel, type EmpiricalStage } from "@/core/governance/empirical-gate";
import type { Setting, TaskNode } from "@prisma/client";

/**
 * Aviso para a mensagem de conclusão quando nada foi compilado de verdade: o portão empírico
 * só roda o type-check com tsconfig.json, e um projeto sem package.json nem roda. Sem isso a
 * mensagem dizia "auditadas e promovidas" para código que nunca foi verificado (sessão gateway).
 */
export function describeUnverifiedBuild(tasks: TaskNode[], projectPath?: string | null): string {
  const root = projectPath || process.cwd();
  const touchesTs = tasks.some((t) => {
    try {
      return (JSON.parse(t.filesScope || "[]") as string[]).some((f) => /\.(ts|tsx)$/i.test(f));
    } catch {
      return false;
    }
  });
  if (!touchesTs) return "";

  const missing: string[] = [];
  if (!fs.existsSync(path.join(root, "tsconfig.json"))) missing.push("`tsconfig.json`");
  let hasDeps = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    hasDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length > 0;
  } catch {
    /* sem package.json legível */
  }
  if (!hasDeps) missing.push("`package.json` com dependências");
  if (missing.length === 0) return "";

  return (
    `\n\n🚫 **Código NÃO compilado nem executado.** O projeto não tem ${missing.join(" nem ")}, ` +
    "então a verificação empírica (type-check e lint) não rodou: os arquivos foram aprovados só pela " +
    "auditoria de texto. Trate como rascunho até o projeto ter essa base e passar no build."
  );
}

/** Minera telemetria em plano de fundo após cada execução de nó — nunca bloqueia a resposta. */
export function mineTelemetryInBackground(): void {
  SkillMiner.analyzeAndPropose().catch((err) => console.error("[SkillMiner] analyzeAndPropose falhou:", err));
  SkillMiner.detectRecurringBugs().catch((err) => console.error("[SkillMiner] detectRecurringBugs falhou:", err));
}

/**
 * Trava T6 (D-RANHO): acumula cada tentativa rejeitada de um nó em `failureHistory`.
 */
export function appendFailureAttempt(existingHistoryJson: string | null | undefined, record: FailureAttemptRecord): string {
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
 * status no banco.
 */
export async function cascadeBlockedNodes(sessionId: string): Promise<string[]> {
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
 * Trava T6 (D-RANHO): quando um nó esgota o ciclo de tentativas automáticas, reporta ao humano no chat.
 */
export async function reportBlockedNodeToHuman(sessionId: string, nodeId: string): Promise<void> {
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
      content: `🛑 **Etapa "${node.title}" bloqueada após ${history.length} tentativa(s) automática(s) — intervenção humana necessária.**\n\n${report}`,
    },
  });
  TelemetryLogger.log({
    sessionId,
    action: "NODE_BLOCKED_HUMAN_NOTIFIED",
    details: { nodeId, attempts: history.length, blockedDependents },
  });
}

/**
 * Spec-vs-disco: compara arquivos afetados declarados na Spec Canônica com os existentes no disco.
 */
export function checkSpecCompletenessOnDisk(
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

/** Reconstrói o Brief real da etapa para o Auditor Cego. */
export function buildBriefMarkdown(task: { title: string; role?: string | null; filesScope?: string | null; payload?: string | null }): string {
  let goal = "";
  try {
    const parsed = task.payload ? JSON.parse(task.payload) : null;
    if (parsed && typeof parsed.goal === "string") goal = parsed.goal;
  } catch {
    /* payload ausente/malformado */
  }
  return `# Etapa: ${task.title}\n\n## Objetivo original (Brief)\n${
    goal || "(objetivo detalhado não disponível — avalie apenas pelo título da etapa)"
  }\n\n## Escopo de arquivos esperado\n${task.filesScope || "[]"}`;
}

/** Adapta o SmartRouter para a função de despacho LLM que o DualLensAuditor espera. */
export function makeBlindAuditDispatchFn(smartRouter: SmartRouter, setting: Setting | null): LLMDispatchFn {
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

export interface NodeExecutionResult {
  success: boolean;
  claimed?: boolean;
  executedTask: TaskNode;
  finalStatus: "completed" | "failed" | "blocked";
  promotionTarget: string | null;
}

export interface PostCompletionMessageOptions {
  canonicalSpec?: string | null;
  projectPath?: string | null;
}

/**
 * Verifica se todos os nós da sessão foram concluídos e, em caso afirmativo,
 * envia a mensagem de conclusão (uma única vez) no chat da sessão.
 */
export async function postCompletionMessageIfDone(
  sessionId: string,
  opts: PostCompletionMessageOptions = {}
): Promise<{
  tasks: TaskNode[];
  allCompleted: boolean;
  specCompleteness: ReturnType<typeof checkSpecCompletenessOnDisk>;
}> {
  const { canonicalSpec, projectPath } = opts;

  const sessionTasks = await prisma.taskNode.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  const allCompleted = sessionTasks.length > 0 && sessionTasks.every((t) => t.status === "completed");
  const specCompleteness = checkSpecCompletenessOnDisk(canonicalSpec, projectPath);

  if (allCompleted) {
    const existingCompletionMsg = await prisma.message.findFirst({
      where: {
        sessionId,
        role: "assistant",
        content: { contains: "Execução Autônoma Concluída!" },
      },
    });

    if (!existingCompletionMsg) {
      const completedSummary = sessionTasks
        .map((t) => `• **${t.title}** (${t.role}): Concluído com sucesso`)
        .join("\n");

      const firstUserMsg = await prisma.message.findFirst({
        where: { sessionId, role: "user" },
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

      const unverifiedBlock = describeUnverifiedBuild(sessionTasks, projectPath);

      await prisma.message.create({
        data: {
          sessionId,
          role: "assistant",
          content: `⚡ **[Skill ${skillHeader}] — Execução Autônoma Concluída!**\n\nTodas as etapas da DAG foram executadas, auditadas e promovidas para o projeto:\n\n${completedSummary}\n\n📁 _Arquivos gravados e sincronizados em: \`${projectPath || process.cwd()}\`_${completenessBlock}${unverifiedBlock}`,
        },
      });
    }
  }

  return {
    tasks: sessionTasks,
    allCompleted,
    specCompleteness,
  };
}

export interface NodeExecutionOptions {}

/**
 * Serviço único de orquestração de execução de um nó da DAG (Etapa 0 - Passo 2).
 * Encapsula a montagem do prompt, despacho LLM, quarentena, auditoria em duas lentes,
 * portão empírico, persistência no SQLite e telemetria.
 * Não executa cascata de bloqueio, relatório ao chat ou mensagem de conclusão da sessão.
 */
export async function executeTaskNode(
  taskDb: TaskNode & { session: { id: string; canonicalSpec?: string | null; project?: { id: string; name: string; path?: string | null } | null } },
  _opts: NodeExecutionOptions = {}
): Promise<NodeExecutionResult> {
  const stepTimeoutMs = Number(process.env.DAG_STEP_TIMEOUT_MS) || 90000;

  // Reserva atômica do nó (Passo 4a - 4.5): só executa se conseguir transicionar de pending/failed para running
  const claimRes = await prisma.taskNode.updateMany({
    where: {
      id: taskDb.id,
      status: { in: ["pending", "failed"] },
    },
    data: { status: "running" },
  });

  if (claimRes.count !== 1) {
    return {
      success: false,
      claimed: false,
      executedTask: taskDb,
      finalStatus:
        taskDb.status === "completed" || taskDb.status === "blocked"
          ? (taskDb.status as "completed" | "blocked")
          : "failed",
      promotionTarget: null,
    };
  }

  let projectContextBlock = "";
  if (taskDb.session.project && taskDb.session.project.path) {
    projectContextBlock = buildProjectContextBlock(taskDb.session.project) || "";
  }

  let skillInstructionBlock = "";
  let skillInstructionUntrusted = false;
  const firstUserMsg = await prisma.message.findFirst({
    where: { sessionId: taskDb.sessionId, role: "user" },
    orderBy: { createdAt: "asc" },
  });

  if (firstUserMsg && firstUserMsg.content.startsWith("/")) {
    const skillRes = await resolveSkillOrCommand(
      firstUserMsg.content,
      taskDb.session.project?.path || process.cwd()
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
  if (skillInstructionBlock) {
    dispatchMessages.push({ role: skillInstructionUntrusted ? "user" : "system", content: skillInstructionBlock });
  }

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
    const stepSignal = AbortSignal.timeout(stepTimeoutMs);
    const dispatchPromise = smartRouter.dispatchWithFallback({
      messages: dispatchMessages,
      // O worker gera o código do nó: modelo pesado do gateway (FreeLLMAPI: auto:smart).
      // O Auditor Cego continua no rápido (makeBlindAuditDispatchFn).
      tier: "heavy",
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

  let finalStatus: "completed" | "failed" | "blocked" = "completed";
  let promotionTarget: string | null = null;
  let empiricalBuildResult: Awaited<ReturnType<typeof TerminalExecutionEngine.verifyProjectBuild>> = null;
  let empiricalFailureLine: string | undefined;
  let empiricalFailureStage: EmpiricalStage | null = null;
  let mcpRes: Record<string, unknown>;
  let newFailureHistory: string | undefined;

  const maxAttempts = taskDb.maxAttempts || 3;
  const newAttempts = (taskDb.attempts || 0) + 1;
  const wouldReachBlockThreshold = newAttempts >= maxAttempts;

  try {
    const qm = new QuarantineManager();
    const filesScopeArr: string[] = taskDb.filesScope ? JSON.parse(taskDb.filesScope) : [];
    const targetProjectRoot = taskDb.session.project?.path || process.cwd();

    const codeContentMap = qm.extractAndWriteCodeBlocks(taskDb.id, stepResultText, filesScopeArr, { strictPaths: true });

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
        sessionId: taskDb.sessionId,
        action: "WORKER_SELF_REPORT_DIVERGENCE",
        details: {
          errorSignature: buildErrorSignature("divergence", `nodeId=${taskDb.id}|verdict=${type2Res.verdict}`),
          sample: type2Res.lens2CrossVerification,
        },
      });
    }

    if (type2Res.verdict === "APPROVED") {
      finalStatus = "completed";
      const gate = await promoteWithEmpiricalGate(qm, taskDb.id, targetProjectRoot, filesScopeArr);
      empiricalBuildResult = gate.buildResult;
      promotionTarget = gate.rolledBack ? null : targetProjectRoot;
      if (gate.preexistingFailure) {
        TelemetryLogger.log({
          sessionId: taskDb.sessionId,
          action: "EMPIRICAL_BUILD_PREEXISTING_FAILURE",
          details: { nodeId: taskDb.id },
        });
      }
      if (!gate.passed) {
        empiricalFailureLine = gate.failureLine || "falha na verificação empírica pós-promoção";
        empiricalFailureStage = gate.failedStage;
        TelemetryLogger.log({
          sessionId: taskDb.sessionId,
          action: "EMPIRICAL_BUILD_FAILED",
          details: {
            errorSignature: buildErrorSignature("build", empiricalFailureLine),
            sample: empiricalFailureLine,
            rolledBack: gate.rolledBack,
          },
        });
        finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
      }
    } else {
      finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
      qm.purgeWorkspace(taskDb.id);

      TelemetryLogger.log({
        sessionId: taskDb.sessionId,
        action: "AUDIT_REJECTED",
        details: {
          errorSignature: buildErrorSignature("type2", type2Res.rejectionReason || "divergência semântica"),
          sample: type2Res.rejectionReason || "",
        },
      });
    }

    const empiricalFailureReason = empiricalFailureLine
      ? `Verificação empírica (${empiricalStageLabel(empiricalFailureStage)}) falhou — promoção desfeita: ${empiricalFailureLine}`
      : undefined;

    const rejectionReason =
      empiricalFailureReason ||
      (type2Res.verdict !== "APPROVED"
        ? type2Res.rejectionReason || "Divergência semântica."
        : undefined);

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
        incidentReportMarkdown = IncidentReporter.generateIncidentReport(taskDb.id, taskDb.title, taskDb.cluster, history, { maxAttempts });
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
    finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
    newFailureHistory = appendFailureAttempt(taskDb.failureHistory, {
      attemptNumber: newAttempts,
      rejectionReason: `Exceção não tratada durante auditoria/promoção: ${String(err)}`,
      filesScope: taskDb.filesScope ? JSON.parse(taskDb.filesScope) : [],
      timestamp: new Date().toISOString(),
    });
    const incidentReportMarkdown =
      finalStatus === "blocked"
        ? IncidentReporter.generateIncidentReport(taskDb.id, taskDb.title, taskDb.cluster, JSON.parse(newFailureHistory), {
            maxAttempts,
          })
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

  const updatedAttempts =
    finalStatus === "failed" || finalStatus === "blocked"
      ? newAttempts
      : taskDb.attempts;

  const updatedTask = await prisma.taskNode.update({
    where: { id: taskDb.id },
    data: {
      status: finalStatus,
      attempts: updatedAttempts,
      result: JSON.stringify(mcpRes),
      ...(newFailureHistory ? { failureHistory: newFailureHistory } : {}),
    },
  });

  TelemetryLogger.log({
    sessionId: taskDb.sessionId,
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

  return {
    success: finalStatus === "completed",
    claimed: true,
    executedTask: updatedTask,
    finalStatus,
    promotionTarget,
  };
}
