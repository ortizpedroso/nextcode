import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { SmartRouter, DispatchMessage } from "@/core/router/smart-router";
import { readSecret } from "@/core/security/crypto";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";
import { loadRoleSkill, buildSkillSystemPrompt, type LoadedRoleSkill } from "@/core/skills/skill-runtime";
import { sessionScoreboardMarkdown } from "@/core/orchestrator/session-scoreboard";
import {
  runExecutorToolLoop,
  buildExecutorToolProtocolPrompt,
  type HarnessDenial,
} from "@/core/skills/executor-tool-loop";
import { dispatchStrongEvaluator } from "@/core/llm/evaluator-models";
import { loadPaidGatewaysForTier } from "@/core/llm/paid-routing";
import { recordLlmCost } from "@/core/llm/cost";
import {
  resolveVerdictAction,
  resolveExecutorTierForAttempt,
  loadOrchestrationPolicy,
  type ClusterKind,
  type OrchestrationPolicy,
} from "@/core/config/orchestration-policy";
import {
  inferClusterFromFilePath,
  renderMicrobriefMarkdown,
  renderMicrobriefReparoMarkdown,
  stripExecutorReportBlocks,
  extractAndValidateExecutorReport,
  type MicrobriefAndReportDocument,
} from "@/core/templates/artifact-templates";
import { MAX_PAUSAS_AVALIADOR } from "@/core/orchestrator/phase-machine";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor, LLMDispatchFn } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { buildErrorSignature } from "@/core/telemetry/error-signature";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { IncidentReporter, FailureAttemptRecord } from "@/core/governance/incident-reporter";
import {
  computeFailureRoutePersistence,
  diagnoseStageFailureWithJev,
  failureRouteApplies,
  formatFailureDiagnosisFeedbackLine,
  verifyStageEvidenceWithJev,
  type JevFailureDiagnosis,
} from "@/core/decision/jev-execution-checks";
import { checkSecretsInCodeWithJev } from "@/core/governance/secret-guard";
import { promoteWithEmpiricalGate, empiricalStageLabel, type EmpiricalStage } from "@/core/governance/empirical-gate";
import { ensureProjectBase, npmInstaller, type Installer, type ProjectBaseResult } from "@/core/execution/project-base";
import type { Setting, TaskNode } from "@prisma/client";
import { readRepairPayload, supersededByRepair, contractBenchRequest } from "@/core/orchestrator/repair-payload";
import { runTestBench } from "@/core/execution/test-bench";
import { regeneratePrismaClient, touchesPrismaSchema } from "@/core/execution/project-base";

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
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { specVersion: true },
  });
  const currentSpecVersion = session?.specVersion ?? 0;
  const sessionTasks = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: currentSpecVersion },
  });
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
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { specVersion: true },
  });
  const currentSpecVersion = session?.specVersion ?? 0;
  const sessionTasks = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: currentSpecVersion },
  });
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
    placar: await sessionScoreboardMarkdown(sessionId),
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

/**
 * Lê o conteúdo real dos arquivos do projeto existentes no disco para auditoria de entrega.
 */
export function readProjectFilesContent(
  files: string[],
  projectPath?: string | null
): Record<string, string> {
  const basePath = projectPath || process.cwd();
  const map: Record<string, string> = {};
  for (const f of files) {
    const full = path.join(basePath, f);
    if (fs.existsSync(full)) {
      try {
        map[f] = fs.readFileSync(full, "utf-8");
      } catch {
        map[f] = "";
      }
    }
  }
  return map;
}

export interface DeliveryVerificationT10Result {
  passed: boolean;
  specFilesComplete: boolean;
  allReqsApproved: boolean;
  buildVerified: boolean;
  missingFiles: string[];
  unapprovedReqs: string[];
  gaps: string[];
}

/**
 * Item 9 do PLANO-DE-ACAO.md (Trava T10 — Entrega):
 * Garante que o projeto só seja considerado "Entregue" (VERIFICACAO -> ENTREGUE) quando:
 * 1) Todos os arquivos declarados na Spec existem no disco do projeto;
 * 2) Todos os requisitos (`REQ-001...`) foram aprovados como implementados;
 * 3) O build do projeto foi verificado sem falhas empíricas.
 */
export function verifyProjectDeliveryT10(opts: {
  canonicalSpec?: string | null;
  projectPath?: string | null;
  tasks: TaskNode[];
  requireFullBuild?: boolean;
}): DeliveryVerificationT10Result {
  const gaps: string[] = [];
  const specCompleteness = checkSpecCompletenessOnDisk(opts.canonicalSpec, opts.projectPath);

  const hasRealPromotionRecord = opts.tasks.some(
    (t) => typeof t.result === "string" && t.result.includes('"promotedPath"')
  );
  const checkDiskStrict = Boolean(
    opts.requireFullBuild || (opts.projectPath && hasRealPromotionRecord)
  );
  const missingFiles =
    checkDiskStrict && specCompleteness && !specCompleteness.complete
      ? specCompleteness.missingFiles
      : [];
  const specFilesComplete = missingFiles.length === 0;
  if (!specFilesComplete) {
    gaps.push(`Arquivos da Spec ausentes no disco: ${missingFiles.join(", ")}`);
  }

  const parsedSpec = opts.canonicalSpec ? parseSpecDocument(opts.canonicalSpec) : null;
  const declaredReqs = parsedSpec?.requisitosIds ?? [];
  const approvedReqsSet = new Set<string>();
  const failedReqsSet = new Set<string>();
  let anyEmpiricalBuildFailed = false;
  // J2b: etapa substituída por um reparo concluído não conta — vale o veredito do reparo.
  const superseded = supersededByRepair(opts.tasks);

  for (const t of opts.tasks) {
    if (t.role === "scaffold") continue;
    if (superseded.has(t.id)) continue;
    const payload = readNodePayload(t.payload);
    let parsedResult: Record<string, any> | null = null;
    try {
      parsedResult = t.result ? JSON.parse(t.result) : null;
    } catch {
      parsedResult = null;
    }

    if (parsedResult?.empiricalBuildPassed === false) {
      anyEmpiricalBuildFailed = true;
    }

    if (Array.isArray(parsedResult?.reqVerdicts) && parsedResult.reqVerdicts.length > 0) {
      for (const rv of parsedResult.reqVerdicts) {
        if (rv.status === "implementado") {
          approvedReqsSet.add(String(rv.id));
        } else {
          failedReqsSet.add(String(rv.id));
        }
      }
    } else if (t.status === "completed" && parsedResult?.auditVerdict === "APPROVED") {
      for (const reqId of payload.reqsCobertos ?? []) {
        approvedReqsSet.add(reqId);
      }
    }
  }

  for (const reqId of declaredReqs) {
    if (failedReqsSet.has(reqId) || (!approvedReqsSet.has(reqId) && opts.requireFullBuild)) {
      failedReqsSet.add(reqId);
    }
  }

  const unapprovedReqs = Array.from(failedReqsSet);
  const allReqsApproved = unapprovedReqs.length === 0;
  if (!allReqsApproved) {
    gaps.push(`Requisitos não aprovados: ${unapprovedReqs.join(", ")}`);
  }

  const unverifiedWarning = opts.requireFullBuild
    ? describeUnverifiedBuild(opts.tasks, opts.projectPath)
    : "";
  const buildVerified = !anyEmpiricalBuildFailed && unverifiedWarning === "";
  if (!buildVerified) {
    gaps.push(
      anyEmpiricalBuildFailed
        ? "Falha na verificação empírica de build em uma ou mais etapas."
        : "Build do projeto não verificado (tsconfig.json ou package.json ausente)."
    );
  }

  return {
    passed: specFilesComplete && allReqsApproved && buildVerified,
    specFilesComplete,
    allReqsApproved,
    buildVerified,
    missingFiles,
    unapprovedReqs,
    gaps,
  };
}

/**
 * Limite de uma etapa (chamada do executor + leitura da resposta). 90 s cortava a resposta de
 * modelos de raciocínio em etapas de tela (~9 mil tokens; teste real P2 de 07/10): a resposta
 * chegava vazia e ia para o avaliador. Padrão: 5 min.
 */
export const DEFAULT_STEP_TIMEOUT_MS = 300_000;
export function getStepTimeoutMs(): number {
  const raw = Number(process.env.DAG_STEP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STEP_TIMEOUT_MS;
}

/** Quedas seguidas do avaliador que não gastam tentativa do executor. */
/** Mudança 24 (fundador 18/10): 3 reavaliações sem gastar tentativa; depois a sessão pausa 5 min (não gasta). */
export const MAX_FREE_EVALUATOR_RETRIES = 3;
export const EVALUATOR_PAUSE_MS = 5 * 60_000;

/** Falhas que não se resolvem esperando (chave, permissão, crédito) → bloquear na hora. */
export function isEvaluatorAccessFailure(failures: string[]): boolean {
  if (failures.length === 0) return false;
  return failures.every((f) =>
    /HTTP 40[13]|sem chave|credit|billing|authentication|permission|mesma família/i.test(f)
  );
}

export function readEvaluatorOutageStreak(result?: string | null): number {
  try {
    const n = result ? JSON.parse(result)?.evaluatorOutageStreak : 0;
    return typeof n === "number" && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Nível de modelo planejado (Jev); nós antigos, sem plano, ficam no pesado como antes. */
export function readPlannedTier(payload?: string | null): "rapido" | "medio" | "pesado" {
  try {
    const p = payload ? JSON.parse(payload) : null;
    const t = p?.jevPlan?.nivelModelo ?? p?.microbrief?.nivelModeloSugerido;
    return t === "rapido" || t === "medio" || t === "pesado" ? t : "pesado";
  } catch {
    return "pesado";
  }
}

/** Microbrief gravado pelo decompositor no payload do nó (ausente em nós antigos). */
export function readNodeMicrobrief(payload?: string | null): MicrobriefAndReportDocument | null {
  try {
    const mb = payload ? JSON.parse(payload)?.microbrief : null;
    return mb && mb.documento === "microbrief" && Array.isArray(mb.reqsCobertos) && mb.arquivosPermitidos ? mb : null;
  } catch {
    return null;
  }
}

/** Reconstrói o Brief real da etapa para o Auditor Cego. */
/** Spec completa, arquivos, cluster e REQs desta etapa, gravados no payload pelo decompositor. */
export function readNodePayload(payload?: string | null): {
  goal: string;
  nodeFiles: string[];
  cluster?: ClusterKind;
  reqsCobertos?: string[];
  jevPlan?: {
    nivelModelo?: string;
    source?: string;
    precisaDividir?: boolean;
    clusterSugerido?: string;
    aplicarTasteSkillPublico?: boolean;
    aplicarReactPerfCritico?: boolean;
  };
} {
  try {
    const parsed = payload ? JSON.parse(payload) : null;
    const rawCluster = parsed?.cluster;
    const cluster =
      rawCluster && ["core", "backend", "frontend", "integration"].includes(rawCluster)
        ? (rawCluster as ClusterKind)
        : undefined;
    return {
      goal: parsed && typeof parsed.goal === "string" ? parsed.goal : "",
      nodeFiles: Array.isArray(parsed?.nodeFiles)
        ? parsed.nodeFiles.filter((f: unknown) => typeof f === "string")
        : [],
      cluster,
      reqsCobertos: Array.isArray(parsed?.reqsCobertos)
        ? parsed.reqsCobertos.filter((r: unknown) => typeof r === "string")
        : undefined,
      jevPlan: parsed?.jevPlan && typeof parsed.jevPlan === "object" ? parsed.jevPlan : undefined,
    };
  } catch {
    return { goal: "", nodeFiles: [] };
  }
}

export function resolveNodeCluster(task: {
  role?: string | null;
  cluster?: string | null;
  filesScope?: string | null;
  payload?: string | null;
}): ClusterKind {
  const fromPayload = readNodePayload(task.payload).cluster;
  if (fromPayload) return fromPayload;

  const roleLower = (task.role || "").toLowerCase();
  if (roleLower.includes("frontend")) return "frontend";
  if (roleLower.includes("integration")) return "integration";
  if (roleLower.includes("backend")) return "backend";
  if (roleLower.includes("core") || roleLower === "architect") return "core";

  const clusterLower = (task.cluster || "").toLowerCase();
  if (["frontend", "integration", "backend"].includes(clusterLower)) {
    return clusterLower as ClusterKind;
  }

  try {
    const files: string[] = task.filesScope ? JSON.parse(task.filesScope) : [];
    if (files.length > 0) {
      return inferClusterFromFilePath(files[0]);
    }
  } catch {
    /* ignore */
  }
  return "core";
}

export function buildBriefMarkdown(task: { title: string; role?: string | null; filesScope?: string | null; payload?: string | null }): string {
  const { goal, nodeFiles } = readNodePayload(task.payload);
  // Microbrief do analista (YAML + Markdown): critérios por REQ e só o recorte da Spec da etapa.
  const microbrief = readNodeMicrobrief(task.payload);
  if (microbrief) {
    return renderMicrobriefMarkdown(microbrief, { titulo: task.title, spec: goal });
  }
  if (nodeFiles.length > 0) {
    // Etapa de um grupo de arquivos: o Auditor Cego julga SÓ o que cabe a estes arquivos.
    // Sem isso, cada etapa era reprovada por "não implementar a Spec inteira".
    return [
      `# Etapa: ${task.title}`,
      "",
      "## O que ESTA etapa entrega",
      `Somente os arquivos: ${nodeFiles.join(", ")}.`,
      "As demais partes da Spec são entregues por outras etapas da DAG e NÃO contam como pendência aqui.",
      "Aprove se estes arquivos implementam, de forma real e completa, a parte da Spec que lhes corresponde.",
      "",
      "## Spec Canônica do projeto (contexto)",
      goal || "(Spec indisponível)",
    ].join("\n");
  }
  return `# Etapa: ${task.title}\n\n## Objetivo original (Brief)\n${
    goal || "(objetivo detalhado não disponível — avalie apenas pelo título da etapa)"
  }\n\n## Escopo de arquivos esperado\n${task.filesScope || "[]"}`;
}

/** Adapta o SmartRouter para a função de despacho LLM que o DualLensAuditor espera. */
export function makeBlindAuditDispatchFn(
  smartRouter: SmartRouter,
  setting: Setting | null,
  sessionId?: string,
  nodeId?: string,
  executorFamily: string = "deepseek"
): LLMDispatchFn & { lastFailures: string[] } {
  const state = { lastFailures: [] as string[] };
  const fn = async (messages: Parameters<LLMDispatchFn>[0]) => {
    // AV1.1: avaliador = Claude (Sonnet 5.5 → Opus 5.5), nunca a família do executor real da etapa.
    // Sem resposta → null (o chamador trata como avaliador fora). Antes caía no roteador livre
    // (`tier: fast`), que podia ser o próprio DeepSeek do executor ou um gratuito aprovando sozinho.
    const strong = await dispatchStrongEvaluator(messages, {
      executorFamily: (executorFamily as any) || "deepseek",
    }).catch(() => null);
    // Mudança 24: guarda o motivo da última falha para decidir entre pausar e bloquear.
    state.lastFailures = strong?.content ? [] : (strong?.failures ?? ["avaliador: exceção na chamada"]);
    TelemetryLogger.log({
      sessionId,
      action: "EVALUATOR_MODEL",
      details: {
        provider: strong?.provider ?? "nenhum",
        model: strong?.model ?? null,
        independentFromExecutor: strong?.independent ?? false,
        failures: strong?.failures ?? [],
      },
    });
    for (const w of strong?.wastedUsage ?? []) {
      await recordLlmCost({ sessionId, nodeId, papel: "avaliador", provider: "claude", model: w.model, usage: w.usage }).catch(() => 0);
    }
    if (strong?.content && strong.provider && strong.model) {
      await recordLlmCost({ sessionId, nodeId, papel: "avaliador", provider: strong.provider, model: strong.model, usage: strong.usage });
      return strong.content;
    }
    // Só nos testes (mesmo padrão do analista, `execution-trigger.ts` `skipModel`): os testes de
    // integração respondem executor e avaliador pelo roteador falso. EVALUATOR_STRICT_IN_TESTS=true
    // testa o comportamento real. Em desenvolvimento e produção, nunca há esta queda.
    if (process.env.NODE_ENV === "test" && process.env.EVALUATOR_STRICT_IN_TESTS !== "true") {
      try {
        const res = await smartRouter.dispatchWithFallback({
          messages,
          tier: "fast",
          omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
          omniRouteKey: readSecret(setting?.omniRouteKey),
          stream: false,
          signal: AbortSignal.timeout(Number(process.env.BLIND_AUDIT_TIMEOUT_MS) || 30000),
        });
        const json = await res.response.json().catch(() => null);
        const text = json?.choices?.[0]?.message?.content ?? json?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
        // O falso respondeu: se não houver veredito válido, o motivo é a resposta, não falta de chave.
        if (text) state.lastFailures = ["avaliador: resposta sem veredito válido"];
        return text;
      } catch {
        return null;
      }
    }
    return null;
  };
  return Object.defineProperty(fn, "lastFailures", { get: () => state.lastFailures }) as LLMDispatchFn & {
    lastFailures: string[];
  };
}

export interface NodeExecutionResult {
  success: boolean;
  claimed?: boolean;
  executedTask: TaskNode;
  finalStatus: "completed" | "failed" | "blocked" | "paused";
  pausedDueToNoLlm?: boolean;
  executorSkillUsed?: string;
  evaluatorSkillUsed?: string;
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

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { specVersion: true },
  });
  const currentSpecVersion = session?.specVersion ?? 0;

  const sessionTasks = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: currentSpecVersion },
    orderBy: { createdAt: "asc" },
  });

  const allCompleted =
    sessionTasks.length > 0 && sessionTasks.every((t) => t.status === "completed");
  const specCompleteness = checkSpecCompletenessOnDisk(canonicalSpec, projectPath);

  if (allCompleted) {
    const versionSuffix = currentSpecVersion > 1 ? ` (Spec v${currentSpecVersion})` : "";
    const completionMarker = `Execução Autônoma Concluída!${versionSuffix}`;

    const existingCompletionMsg = await prisma.message.findFirst({
      where: {
        sessionId,
        role: "assistant",
        content: { contains: completionMarker },
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
      // As etapas são nomeadas por arquivos; o nome do projeto vem do título da Spec.
      const specTitle = canonicalSpec ? parseSpecDocument(canonicalSpec)?.titulo : null;
      const specTitleLine = specTitle ? `📋 **${specTitle}**\n\n` : "";

      await prisma.message.create({
        data: {
          sessionId,
          role: "assistant",
          content: `⚡ **[Skill ${skillHeader}] — ${completionMarker}**\n\n${specTitleLine}Todas as etapas da DAG foram executadas, auditadas e promovidas para o projeto:\n\n${completedSummary}\n\n📁 _Arquivos gravados e sincronizados em: \`${projectPath || process.cwd()}\`_${completenessBlock}${unverifiedBlock}`,
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
 * Conteúdo atual, no disco do projeto, dos arquivos entregues pelas etapas de que este nó depende
 * (diretas e indiretas), para o executor usar os tipos e funções exatamente como existem.
 */
export async function buildDependencyContext(
  taskDb: TaskNode & { session: { project?: { path?: string | null } | null } }
): Promise<string | null> {
  const projectRoot = taskDb.session.project?.path;
  if (!projectRoot) return null;
  const all = await prisma.taskNode.findMany({
    where: { sessionId: taskDb.sessionId, specVersion: taskDb.specVersion },
    select: { id: true, dependencies: true, filesScope: true, status: true },
  });
  const byId = new Map(all.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack: string[] = JSON.parse(taskDb.dependencies || "[]");
  const files: string[] = [];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const dep = byId.get(id);
    if (!dep) continue;
    if (dep.status === "completed") {
      for (const f of JSON.parse(dep.filesScope || "[]") as string[]) {
        if (/\.(ts|tsx|prisma)$/.test(f) && !files.includes(f)) files.push(f);
      }
    }
    stack.push(...(JSON.parse(dep.dependencies || "[]") as string[]));
  }
  const MAX_TOTAL = 40000;
  let used = 0;
  const blocks: string[] = [];
  for (const f of files) {
    const abs = path.join(projectRoot, f);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    // Um arquivo grande não pode esconder os menores que vêm depois dele.
    if (used + content.length > MAX_TOTAL) continue;
    used += content.length;
    blocks.push(`--- ${f} ---\n${content}`);
  }
  if (blocks.length === 0) return null;
  return (
    "ARQUIVOS JÁ EXISTENTES NO PROJETO (entregues pelas etapas anteriores — use os tipos, nomes e assinaturas " +
    "EXATAMENTE como estão abaixo; não os altere nem os redeclare):\n\n" +
    blocks.join("\n\n")
  );
}

export const FIXED_CONTEXT_MAX_FILE_CHARS = 20000;
export const FIXED_CONTEXT_MAX_TOTAL_CHARS = 40000;

/**
 * TR1 (13): o que toda etapa precisa e o executor lia de novo a cada turno (teste real `8e2f2052`:
 * tsconfig lido 42×, schema 21×) — tsconfig, schema do Prisma e os contratos do Microbrief
 * (`lerContratos`) que ainda não vieram no bloco das dependências. Lido do disco do projeto.
 */
export function buildExecutorFixedContext(
  projectRoot: string | null | undefined,
  lerContratos: string[],
  alreadyIncluded: string | null
): string | null {
  if (!projectRoot) return null;
  const candidates = ["tsconfig.json", "prisma/schema.prisma", ...lerContratos];
  let used = 0;
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const f = raw.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    if (seen.has(f)) continue;
    seen.add(f);
    if (alreadyIncluded?.includes(`--- ${f} ---`)) continue;
    const abs = path.join(projectRoot, f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    let content = fs.readFileSync(abs, "utf8");
    if (content.length > FIXED_CONTEXT_MAX_FILE_CHARS) {
      content = `${content.slice(0, FIXED_CONTEXT_MAX_FILE_CHARS)}\n...[cortado em ${FIXED_CONTEXT_MAX_FILE_CHARS} caracteres; use read_file para o resto]`;
    }
    if (used + content.length > FIXED_CONTEXT_MAX_TOTAL_CHARS) continue;
    used += content.length;
    blocks.push(`--- ${f} ---\n${content}`);
  }
  if (blocks.length === 0) return null;
  return (
    "CONTEXTO FIXO DO PROJETO (conteúdo atual no disco — NÃO leia estes arquivos de novo com read_file; " +
    "use-os como estão):\n\n" +
    blocks.join("\n\n")
  );
}

async function scoreboardSuffix(sessionId: string): Promise<string> {
  const placar = await sessionScoreboardMarkdown(sessionId).catch(() => "");
  return placar ? `

${placar}` : "";
}

export const PREVIOUS_ATTEMPT_MAX_TOTAL_CHARS = 60000;

/**
 * TR1 (14): código que a tentativa reprovada deixou na quarentena, para a próxima partir dele.
 * Guardado só no modo laço e nunca quando a guarda de segredos reprovou (o código voltaria ao LLM).
 */
export function pickAttemptCodeToKeep(codeContentMap: Record<string, string>): Record<string, string> | undefined {
  const kept: Record<string, string> = {};
  let used = 0;
  for (const [file, content] of Object.entries(codeContentMap)) {
    if (used + content.length > PREVIOUS_ATTEMPT_MAX_TOTAL_CHARS) continue;
    used += content.length;
    kept[file] = content;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Lê o código da tentativa anterior do `result` do nó, só dos arquivos ainda no escopo da etapa. */
export function readPreviousAttemptCode(
  resultJson: string | null | undefined,
  allowedScopeFiles: string[]
): Record<string, string> | null {
  if (!resultJson) return null;
  try {
    const prev = JSON.parse(resultJson);
    if (prev?.success || !prev?.codigoTentativa || typeof prev.codigoTentativa !== "object") return null;
    const scope = new Set(allowedScopeFiles.map((f) => f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "")));
    const out: Record<string, string> = {};
    for (const [file, content] of Object.entries(prev.codigoTentativa as Record<string, unknown>)) {
      if (typeof content === "string" && scope.has(file)) out[file] = content;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Instalador usado pela etapa de base; trocado nos testes para não acessar a rede. */
let scaffoldInstaller: Installer = npmInstaller;
export function setScaffoldInstallerForTests(installer: Installer | null): void {
  scaffoldInstaller = installer ?? npmInstaller;
}

export type ExecutorMode = "laco" | "chamada_unica";
let executorModeOverrideForTests: ExecutorMode | null = null;
export function setExecutorModeForTests(mode: ExecutorMode | null): void {
  executorModeOverrideForTests = mode;
}

let paidOnlyOverrideForTests: boolean | null = null;
/** Testes de fila/worker/rotas usam o LLM falso pela rota antiga; desligam o "somente pago" só para eles. */
export function setPaidOnlyRoutingForTests(value: boolean | null): void {
  paidOnlyOverrideForTests = value;
}
export function isPaidOnlyRouting(policy: OrchestrationPolicy): boolean {
  return paidOnlyOverrideForTests ?? policy.roteamentoPapeisCriticos.somentePago;
}

/**
 * Etapa de base (M1): package.json com as dependências da stack, tsconfig e npm install no
 * projeto-alvo. Falha (ex.: npm sem rede) segue a política normal de tentativas (T6).
 */
async function runScaffoldNode(
  taskDb: TaskNode & { session: { project?: { path?: string | null } | null } },
  stack: string[]
): Promise<NodeExecutionResult> {
  const projectRoot = taskDb.session.project?.path || process.cwd();
  const newAttempts = (taskDb.attempts || 0) + 1;
  const maxAttempts = taskDb.maxAttempts || 3;
  let base: ProjectBaseResult;
  try {
    const specFiles = parseSpecDocument(readNodePayload(taskDb.payload).goal || "")?.arquivosAfetados ?? [];
    base = await ensureProjectBase(projectRoot, stack, scaffoldInstaller, specFiles);
  } catch (err) {
    base = { ok: false, changedFiles: [], installed: false, log: `exceção: ${String(err)}` };
  }

  const finalStatus: "completed" | "failed" | "blocked" = base.ok
    ? "completed"
    : newAttempts >= maxAttempts
      ? "blocked"
      : "failed";
  const rejectionReason = base.ok ? undefined : `Base do projeto falhou: ${base.log}`;
  const newFailureHistory = base.ok
    ? undefined
    : appendFailureAttempt(taskDb.failureHistory, {
        attemptNumber: newAttempts,
        rejectionReason: rejectionReason!,
        filesScope: ["package.json", "tsconfig.json"],
        timestamp: new Date().toISOString(),
      });

  const updatedTask = await prisma.taskNode.update({
    where: { id: taskDb.id },
    data: {
      status: finalStatus,
      attempts: base.ok ? taskDb.attempts : newAttempts,
      result: JSON.stringify({
        success: base.ok,
        nodeId: taskDb.id,
        title: taskDb.title,
        output: base.log,
        auditVerdict: base.ok ? "APPROVED" : "REJECTED",
        auditMethod: "scaffold",
        promotedPath: base.ok ? projectRoot : null,
        changedFiles: base.changedFiles,
        rejectionReason,
      }),
      ...(newFailureHistory ? { failureHistory: newFailureHistory } : {}),
    },
  });

  TelemetryLogger.log({
    sessionId: taskDb.sessionId,
    action: `NODE_EXECUTION_${finalStatus.toUpperCase()}`,
    details: { nodeId: taskDb.id, title: taskDb.title, step: "scaffold", changedFiles: base.changedFiles, installed: base.installed },
  });

  return {
    success: base.ok,
    claimed: true,
    executedTask: updatedTask,
    finalStatus,
    promotionTarget: base.ok ? projectRoot : null,
  };
}

/**
 * Trava Mecânica T-SPEC-SHIELD:
 * Garante que papéis executores NUNCA recebam a Spec Canônica completa quando um Microbrief existir.
 * Se algum vazamento tentar injetar "SPEC CANÔNICA APROVADA", suprime o bloco e emite telemetria.
 */
export function enforceExecutorSpecIsolation(
  messages: DispatchMessage[],
  role: string,
  sessionId?: string | null,
  nodeId?: string
): DispatchMessage[] {
  const isExecutorRole = role.startsWith("executor-") || role === "worker";
  if (!isExecutorRole) return messages;

  const hasMicrobrief = messages.some((m) =>
    typeof m.content === "string" && m.content.includes("MICROBRIEF DESTA ETAPA")
  );

  if (!hasMicrobrief) return messages;

  return messages.filter((m) => {
    const content = typeof m.content === "string" ? m.content : "";
    const isFullSpecLeak = content.includes("SPEC CANÔNICA APROVADA");
    if (isFullSpecLeak) {
      TelemetryLogger.log({
        sessionId: sessionId ?? undefined,
        action: "EXECUTOR_SPEC_LEAK_BLOCKED",
        details: { nodeId, role },
      });
      return false;
    }
    return true;
  });
}

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
  const stepTimeoutMs = getStepTimeoutMs();

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

  // Etapa de base (M1): sem IA, sem quarentena e sem auditor — só prepara o ambiente para o
  // código das próximas etapas ser compilado de verdade.
  let scaffoldStack: string[] | null = null;
  try {
    const parsedPayload = taskDb.payload ? JSON.parse(taskDb.payload) : null;
    if (parsedPayload?.step === "scaffold") scaffoldStack = Array.isArray(parsedPayload.stack) ? parsedPayload.stack : [];
  } catch {
    /* payload malformado: segue como etapa comum */
  }
  if (scaffoldStack) {
    return runScaffoldNode(taskDb, scaffoldStack);
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

  const resolvedCluster = resolveNodeCluster(taskDb);
  const executorSkillName = `executor-${resolvedCluster}`;
  let loadedExecutorSkill: LoadedRoleSkill | null = null;
  let executorSkillInstructions = "";
  try {
    loadedExecutorSkill = loadRoleSkill(executorSkillName);
    // Sanitiza palavras-chave reservadas dos servidores falsos de teste ("Brief", "Auditor Cego", "implemented")
    executorSkillInstructions =
      "\n\n[SKILL DECLARATIVA DO PAPEL: " +
      loadedExecutorSkill.name +
      "]\n" +
      buildSkillSystemPrompt(loadedExecutorSkill)
        .replace(/\bBrief\b/g, "Microbrief")
        .replace(/Auditor Cego/g, "Avaliador")
        .replace(/\bimplemented\b/g, "implementado");
  } catch {
    /* fallback silencioso caso skills/ não esteja acessível */
  }

  const policy = loadOrchestrationPolicy();
  const nodePayload = readNodePayload(taskDb.payload);
  const nodeMicrobrief = readNodeMicrobrief(taskDb.payload);
  const policyExecutorMode: ExecutorMode = policy.execucao?.modoExecutor ?? "laco";
  const effectiveExecutorMode: ExecutorMode = executorModeOverrideForTests ?? policyExecutorMode;
  const useToolLoop = Boolean(effectiveExecutorMode === "laco" && nodeMicrobrief && loadedExecutorSkill);

  const autonomousWorkerPrompt = useToolLoop
    ? `Você é um Engenheiro de Software Sênior (${taskDb.role} / cluster ${resolvedCluster}) responsável pela etapa "${taskDb.title}".
DIRETRIZES DE EXECUÇÃO:
1. Execute a tarefa de forma 100% autônoma e completa. NUNCA faça perguntas ou solicite confirmações.
2. Escopo de arquivos desta etapa: ${taskDb.filesScope || "[]"}. Grave cada arquivo na quarentena usando a ferramenta \`write_file\` (ou \`edit_file\`), confira a compilação com \`run_check\` (\`{"comando": "typecheck"}\`) e encerre com \`finish\` passando o YAML de \`relatorio_executor\` listando cada requisito (REQ) desta etapa com o arquivo do escopo e as linhas reais (1-indexadas).
Use \`status: atendido | parcial | nao_atendido\`. Os campos medidos (\`compilou\`, \`testes\`, \`arquivos_alterados\`) NÃO vêm do modelo: o harness carimba com \`stampHarnessMeasuredFields\`.
3. Não inclua discursos sobre governança, desculpas ou cabeçalhos robóticos. Em cada turno, responda com UM bloco \`\`\`json acao (uma ação ou uma lista de ações independentes).${executorSkillInstructions}\n\n${buildExecutorToolProtocolPrompt()}`
    : `Você é um Engenheiro de Software Sênior (${taskDb.role} / cluster ${resolvedCluster}) responsável pela etapa "${taskDb.title}".
DIRETRIZES DE EXECUÇÃO:
1. Execute a tarefa de forma 100% autônoma e completa. NUNCA faça perguntas ou solicite confirmações.
2. Para cada arquivo no escopo (${taskDb.filesScope || "[]"}), você DEVE OBRIGATORIAMENTE retornar o código-fonte completo em blocos de código formatados com a indicação do arquivo no topo:
\`\`\`typescript
// file: caminho/relativo/do/arquivo.ts
<código completo aqui>
\`\`\`
3. Depois dos blocos de código, escreva UM bloco \`relatorio_executor\` listando cada requisito (REQ) desta etapa com o arquivo do escopo e as linhas reais (1-indexadas):
\`\`\`yaml relatorio_executor
reqs:
  - id: REQ-001
    status: atendido
    arquivo_linha: "src/lib/x.ts:10-25"
    como: "uma frase"
\`\`\`
Use \`status: atendido | parcial | nao_atendido\`. Os campos medidos (\`compilou\`, \`testes\`, \`arquivos_alterados\`) NÃO vêm do modelo: o harness carimba com \`stampHarnessMeasuredFields\`.
4. Não inclua discursos sobre governança, desculpas ou cabeçalhos robóticos. Retorne apenas o código funcional e o bloco \`relatorio_executor\`.${executorSkillInstructions}`;

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
      if (!prevRes.pausado && (prevRes.auditVerdict !== "APPROVED" || prevRes.rejectionReason)) {
        const diagLine =
          policy.jevExecucao.diagnosticoFalha === "ativo"
            ? formatFailureDiagnosisFeedbackLine(
                prevRes.jevDiagnostico,
                policy.jevExecucao.limiarConfiancaDiagnostico
              )
            : null;
        const feedbackText =
          `\n\n⚠️ [AUTO-HEALING FEEDBACK - RE-TENTATIVA #${(taskDb.attempts || 0) + 1}]\nA tentativa anterior foi REJEITADA pela auditoria com os seguintes erros:\n${prevRes.rejectionReason || "Erros de compilação/sintaxe"}\nVocê DEVE obrigatoriamente corrigir esses erros e garantir que todos os imports e módulos existam!` +
          (diagLine ? `\n${diagLine}` : "");
        dispatchMessages.push({ role: "system", content: feedbackText });
      }
    } catch {}
  }

  // Governança: O Executor NUNCA recebe a Spec Canônica completa quando o Microbrief existir.
  // Ele recebe exclusivamente o Microbrief da etapa (Markdown + YAML) e os contratos das dependências.
  if (nodeMicrobrief) {
    dispatchMessages.push({
      role: "system",
      content:
        "MICROBRIEF DESTA ETAPA (contrato: o Avaliador julga cada REQ abaixo contra estes critérios):\n\n" +
        renderMicrobriefMarkdown(nodeMicrobrief, { titulo: taskDb.title, spec: nodePayload.goal }),
    });
  } else if (nodePayload.goal) {
    // Fallback restrito apenas para nós legados que não possuem Microbrief gerado
    dispatchMessages.push({
      role: "system",
      content:
        "OBJETIVO DA ETAPA (fallback sem Microbrief):\n\n" +
        nodePayload.goal,
    });
  }

  // Saída das dependências (arquitetura §4.4): o código REAL dos arquivos que as etapas anteriores
  // já gravaram. Sem isso o executor importava tipos sem conhecê-los (smoke M1 de 06/10: a rota
  // usou AsaasCharge com outro formato → TS2322 nas 3 tentativas).
  const dependencyBlock = await buildDependencyContext(taskDb);
  if (dependencyBlock) {
    dispatchMessages.push({ role: "system", content: dependencyBlock });
  }
  if (useToolLoop) {
    const fixedBlock = buildExecutorFixedContext(
      taskDb.session.project?.path,
      nodeMicrobrief?.arquivosPermitidos.lerContratos ?? [],
      dependencyBlock
    );
    if (fixedBlock) dispatchMessages.push({ role: "system", content: fixedBlock });
  }
  // TR1 (14): retentativa parte do código anterior (já na quarentena) + defeitos do feedback acima.
  const previousAttemptCode =
    useToolLoop && nodeMicrobrief
      ? readPreviousAttemptCode(taskDb.result, [
          ...(nodeMicrobrief.arquivosPermitidos.criar ?? []),
          ...(nodeMicrobrief.arquivosPermitidos.modificar ?? []),
        ])
      : null;
  if (previousAttemptCode) {
    dispatchMessages.push({
      role: "system",
      content:
        (/"pausado":true/.test(taskDb.result || "")
          ? "CÓDIGO DA TENTATIVA ANTERIOR (execução pausada por queda do provedor; já está na quarentena desta etapa — " +
            "continue a partir dele com edit_file/write_file; não reescreva do zero nem releia estes arquivos):\n\n"
          : "CÓDIGO DA TENTATIVA ANTERIOR (já está na quarentena desta etapa — corrija SÓ os defeitos apontados " +
            "com edit_file; não reescreva do zero nem releia estes arquivos):\n\n") +
        Object.entries(previousAttemptCode)
          .map(([f, c]) => `--- ${f} ---\n${c}`)
          .join("\n\n"),
    });
  }

  // J2b: etapa de reparo da entrega — Microbrief de reparo (defeitos da verificação final) + código atual
  // do projeto nos arquivos do escopo, para corrigir com edit_file sem reler nem reescrever do zero.
  const repairPayload = readRepairPayload(taskDb.payload);
  if (repairPayload) {
    const currentCode = pickAttemptCodeToKeep(
      readProjectFilesContent(repairPayload.microbriefReparo.filesScope, taskDb.session.project?.path)
    );
    dispatchMessages.push({
      role: "system",
      content:
        renderMicrobriefReparoMarkdown(repairPayload.microbriefReparo) +
        (currentCode
          ? "\n\n## Código atual dos arquivos (já no projeto)\n\n" +
            Object.entries(currentCode)
              .map(([f, c]) => `--- ${f} ---\n${c}`)
              .join("\n\n")
          : "") +
        // Mudança 43.3: os testes que provam os defeitos são o contrato — o reparo só vale com eles passando.
        (repairPayload.testesReproducao?.length
          ? "\n\n## Testes que provam os defeitos (contrato deste reparo)\n\n" +
            "NÃO altere estes testes: o reparo só é aceito quando todos passam (o portão roda cada um na bancada). " +
            'Rode `run_check` com `{"comando": "test"}` para conferir antes do finish. ' +
            "Se um teste é do próprio projeto e está no seu escopo, só mude o teste se ele contradiz a Spec — nunca para enfraquecê-lo.\n\n" +
            repairPayload.testesReproducao
              .map(
                (t) =>
                  (t.regressao ? "[REGRESSÃO — já passava; tem de continuar passando] " : "") +
                  `--- ${t.existente ? t.caminho : `.nextcode-repro/${t.caminho}`}${t.existente ? " (teste do projeto)" : ""} ---\n${t.conteudo}` +
                  (t.saida ? `\n\nSaída da falha:\n${t.saida.slice(0, 2000)}` : "")
              )
              .join("\n\n")
          : ""),
    });
  }

  dispatchMessages.push({
    role: "user",
    content: useToolLoop
      ? `[EXECUÇÃO DA ETAPA DA DAG: ${taskDb.title}]\nPapel/Função: ${taskDb.role}\nEscopo de Arquivos: ${taskDb.filesScope || "[]"}\nObjetivo: Execute esta etapa de forma 100% autônoma usando o protocolo de ferramentas (UM bloco \`\`\`json acao por turno, com uma ação ou uma lista) até chamar finish.`
      : `[EXECUÇÃO DA ETAPA DA DAG: ${taskDb.title}]\nPapel/Função: ${taskDb.role}\nEscopo de Arquivos: ${taskDb.filesScope || "[]"}\nObjetivo: Execute esta etapa de forma 100% autônoma e retorne os códigos de todos os arquivos no escopo.`,
  });

  // Trava Mecânica T-SPEC-SHIELD: Garante que papéis executores NUNCA recebam a Spec Canônica completa
  const finalDispatchMessages = enforceExecutorSpecIsolation(
    dispatchMessages,
    taskDb.role,
    taskDb.sessionId,
    taskDb.id
  );

  const plannedTier = readPlannedTier(taskDb.payload);
  const executorTier = resolveExecutorTierForAttempt(plannedTier, (taskDb.attempts || 0) + 1);
  TelemetryLogger.log({
    sessionId: taskDb.sessionId,
    action: "EXECUTOR_TIER",
    details: { nodeId: taskDb.id, plannedTier, attempt: (taskDb.attempts || 0) + 1, executorTier },
  });

  const paidGateways = isPaidOnlyRouting(policy)
    ? await loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos)
    : undefined;
  if (paidGateways) {
    TelemetryLogger.log({
      sessionId: taskDb.sessionId,
      action: "EXECUTOR_ROTA_PAGA",
      details: {
        nodeId: taskDb.id,
        executorTier,
        modelos: paidGateways.map((g) => g.modelHeavy),
        gateways: paidGateways.map((g) => g.id),
      },
    });
  }

  const qm = new QuarantineManager();
  const filesScopeArr: string[] = taskDb.filesScope ? JSON.parse(taskDb.filesScope) : [];
  const targetProjectRoot = taskDb.session.project?.path || process.cwd();
  const executorMaxTokens = Number(process.env.EXECUTOR_MAX_TOKENS) || 32000;

  let stepResultText = "";
  let noLlmAvailable = false;
  let loopCodeContentMap: Record<string, string> | null = null;
  let loopHarnessDenials: HarnessDenial[] = [];
  let actualExecutorFamily = "deepseek";

  if (useToolLoop && nodeMicrobrief && loadedExecutorSkill) {
    const loopRes = await runExecutorToolLoop({
      sessionId: taskDb.sessionId,
      nodeId: taskDb.id,
      taskTitle: taskDb.title,
      skill: loadedExecutorSkill,
      microbrief: nodeMicrobrief,
      initialMessages: finalDispatchMessages,
      seedFiles: previousAttemptCode ?? undefined,
      smartRouter,
      qm,
      projectRoot: targetProjectRoot,
      executorTier,
      maxTokens: executorMaxTokens,
      stepTimeoutMs,
      paidGateways,
      allowedRoutedViaPrefixes: paidGateways ? policy.roteamentoPapeisCriticos.prefixosRotaPaga : undefined,
      // Mudança 43.3: com testes do contrato, o executor roda `run_check test` na bancada.
      contractTests: repairPayload?.testesReproducao,
      routerKeys: {
        geminiKey: readSecret(setting?.geminiKey),
        groqKey: readSecret((setting as any)?.groqKey),
        nvidiaKey: readSecret((setting as any)?.nvidiaKey),
        deepseekKey: readSecret((setting as any)?.deepseekKey),
        omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
        omniRouteKey: readSecret(setting?.omniRouteKey),
      },
    });

    noLlmAvailable = loopRes.noLlmAvailable;
    loopCodeContentMap = loopRes.codeContentMap;
    loopHarnessDenials = loopRes.harnessDenials ?? [];
    stepResultText = loopRes.finishReportText || loopRes.failureReason || "";
    if (loopRes.lastModelUsed) {
      if (/qwen/i.test(loopRes.lastModelUsed)) actualExecutorFamily = "qwen";
      else if (/claude/i.test(loopRes.lastModelUsed)) actualExecutorFamily = "claude";
      else if (/gemini/i.test(loopRes.lastModelUsed)) actualExecutorFamily = "gemini";
      else if (/nemotron|nvidia/i.test(loopRes.lastModelUsed)) actualExecutorFamily = "nvidia";
      else actualExecutorFamily = "deepseek";
    }
    qm.extractionIssues = [];
    if (!loopRes.noLlmAvailable) {
      if (!loopRes.finished && loopRes.failureReason) {
        qm.extractionIssues.push(loopRes.failureReason);
      } else if (loopRes.finished) {
        if (filesScopeArr.length > 0 && Object.keys(loopCodeContentMap).length === 0) {
          qm.extractionIssues.push(
            "[NO FILES] O laço do executor terminou sem gravar nenhum arquivo do escopo na quarentena."
          );
        } else {
          const missing = filesScopeArr.filter(
            (f) => !Object.prototype.hasOwnProperty.call(loopCodeContentMap!, f.trim().replace(/^\\|^\//, ""))
          );
          if (missing.length > 0) {
            qm.extractionIssues.push(
              `[MISSING FILE] O laço do executor não gravou ${missing.join(", ")} na quarentena.`
            );
          }
        }
      }
    }
  } else {
    try {
      const stepSignal = AbortSignal.timeout(stepTimeoutMs);
      const dispatchPromise = paidGateways
        ? smartRouter.dispatchWithFallback({
            messages: finalDispatchMessages,
            sessionId: taskDb.sessionId,
            tier: "heavy",
            gateways: paidGateways,
            allowedRoutedViaPrefixes: policy.roteamentoPapeisCriticos.prefixosRotaPaga,
            maxTokens: executorMaxTokens,
            stream: false,
            signal: stepSignal,
          })
        : smartRouter.dispatchWithFallback({
            messages: finalDispatchMessages,
            sessionId: taskDb.sessionId,
            // Nível escolhido pelo Jev no planejamento, com escalada a cada nova tentativa
            // (rápido → médio → pesado). rápido = FreeLLMAPI gratuito; médio/pesado = DeepSeek.
            tier: executorTier === "rapido" ? "fast" : "heavy",
            // Modelos de raciocínio (DeepSeek v4) gastam parte do limite pensando: com 8192 a resposta de
            // uma etapa com tela era cortada no meio do 2º arquivo (teste real P2 de 07/10).
            maxTokens: executorMaxTokens,
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

      if (dispatchRes.providerUsed === "none" || dispatchRes.tierTag === "exhausted") {
        noLlmAvailable = true;
      } else if (dispatchRes) {
        const resJson = await dispatchRes.response.json().catch((err: unknown) => {
          // Leitura da resposta abortada (limite da etapa) ou corpo inválido: registra e segue vazio —
          // o Validador Tipo 1 reprova "sem arquivos" sem gastar o avaliador.
          TelemetryLogger.log({
            sessionId: taskDb.sessionId,
            action: "EXECUTOR_RESPONSE_UNREADABLE",
            details: { nodeId: taskDb.id, aborted: stepSignal.aborted, error: String(err).slice(0, 200) },
          });
          return {};
        });
        if (dispatchRes.modelUsed) {
          if (/qwen/i.test(dispatchRes.modelUsed)) actualExecutorFamily = "qwen";
          else if (/claude/i.test(dispatchRes.modelUsed)) actualExecutorFamily = "claude";
          else if (/gemini/i.test(dispatchRes.modelUsed)) actualExecutorFamily = "gemini";
          else if (/nemotron|nvidia/i.test(dispatchRes.modelUsed)) actualExecutorFamily = "nvidia";
          else actualExecutorFamily = "deepseek";
        }
        await recordLlmCost({
          sessionId: taskDb.sessionId,
          nodeId: taskDb.id,
          papel: "executor",
          provider: String(dispatchRes.providerUsed),
          model: String(dispatchRes.modelUsed || ""),
          usage: resJson.usage,
        });
        if (resJson.choices?.[0]?.finish_reason === "length") {
          TelemetryLogger.log({
            sessionId: taskDb.sessionId,
            action: "EXECUTOR_OUTPUT_TRUNCATED",
            details: { nodeId: taskDb.id, modelUsed: dispatchRes.modelUsed, providerUsed: dispatchRes.providerUsed },
          });
        }
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
  }

  // Item 1 (Fila nunca para): se todos os provedores de LLM estiverem fora do ar (providerUsed === "none"),
  // falha de provedor NÃO conta como tentativa da etapa (policy.tentativas.falhaProvedorContaComoTentativa === false).
  // Reverte o nó para "pending" sem incrementar attempts e pausa a sessão (SEM_LLM).
  if (noLlmAvailable && !policy.tentativas.falhaProvedorContaComoTentativa) {
    // TR1 (1): o que o laço já gravou volta na retomada (mesmo caminho da retentativa, P3).
    const pausedCode = loopCodeContentMap ? pickAttemptCodeToKeep(loopCodeContentMap) : undefined;
    const revertedTask = await prisma.taskNode.update({
      where: { id: taskDb.id },
      data: {
        status: "pending",
        attempts: taskDb.attempts,
        ...(pausedCode ? { result: JSON.stringify({ success: false, pausado: true, codigoTentativa: pausedCode }) } : {}),
      },
    });

    await applyPhaseEvent(taskDb.sessionId, { type: "SEM_LLM" });

    const pauseMarker = "Execução pausada temporariamente: todos os provedores de LLM estão indisponíveis";
    const existingPauseMsg = await prisma.message.findFirst({
      where: {
        sessionId: taskDb.sessionId,
        role: "assistant",
        content: { contains: pauseMarker },
      },
    });
    if (!existingPauseMsg) {
      await prisma.message.create({
        data: {
          sessionId: taskDb.sessionId,
          role: "assistant",
          content: `⚠️ **${pauseMarker}.** A etapa "${taskDb.title}" voltou para a fila sem consumir nenhuma tentativa (${taskDb.attempts || 0}/${taskDb.maxAttempts || 3}). O supervisor retomará a execução automaticamente assim que um gateway responder.${await scoreboardSuffix(taskDb.sessionId)}`,
        },
      });
    }

    TelemetryLogger.log({
      sessionId: taskDb.sessionId,
      action: "SESSION_PAUSED_NO_LLM",
      details: {
        nodeId: taskDb.id,
        title: taskDb.title,
        attemptsPreserved: taskDb.attempts,
      },
    });

    return {
      success: false,
      claimed: true,
      executedTask: revertedTask,
      finalStatus: "paused",
      pausedDueToNoLlm: true,
      executorSkillUsed: executorSkillName,
      promotionTarget: null,
    };
  }

  let finalStatus: "completed" | "failed" | "blocked" = "completed";
  let promotionTarget: string | null = null;
  let empiricalBuildResult: Awaited<ReturnType<typeof TerminalExecutionEngine.verifyProjectBuild>> = null;
  let empiricalFailureLine: string | undefined;
  let empiricalFailureStage: EmpiricalStage | null = null;
  let empiricalGateErrors: string[] = [];
  let mcpRes: Record<string, unknown>;
  let evaluatorOutageStreak = 0;
  let evaluatorOutageFreeRetry = false;
  let blockedByAmbiguousSpec = false;
  let blockedByPlanError = false;
  let planErrorSkipAttempt = false;
  let evaluatorErrorFreeRetry = false;
  let failureRouteDono: string | undefined;
  let blockedByHarnessRule = false;
  let newFailureHistory: string | undefined;
  let evaluatorSkillUsed = `avaliador-${resolvedCluster}`;

  const maxAttempts = taskDb.maxAttempts || policy.tentativas.maxTentativasPorExecutor || 3;
  const newAttempts = (taskDb.attempts || 0) + 1;
  const wouldReachBlockThreshold = newAttempts >= maxAttempts;

  try {
    const codeContentMap =
      loopCodeContentMap ??
      qm.extractAndWriteCodeBlocks(
        taskDb.id,
        stripExecutorReportBlocks(stepResultText),
        filesScopeArr,
        { strictPaths: true }
      );

    const secretGuardRes = await checkSecretsInCodeWithJev({
      sessionId: taskDb.sessionId,
      nodeId: taskDb.id,
      codeContentMap,
      modo: policy.jevExecucao.guardaSegredosCodigo,
      limiarSegredoNoul: policy.jevExecucao.limiarSegredoNoul,
    });

    const type1Res = DualLensAuditor.validateType1(
      codeContentMap,
      [],
      targetProjectRoot,
      filesScopeArr,
      qm.extractionIssues
    );

    // AV1.4 — porteiro: o tsc (e o ESLint) do projeto mesclado rodam ANTES do avaliador, no modo
    // "só conferir" (o projeto volta ao estado de antes). Erro novo de tipo/lint reprova a etapa como
    // Tipo 1 — sem gastar o avaliador — e o erro vai ao executor. Antes o tsc só rodava depois da
    // aprovação, e o avaliador aprovava código que não compilava (225 EMPIRICAL_BUILD_FAILED, 03–05/10).
    // Só com pasta de projeto vinculada: sem ela o caminho cai em process.cwd() (o próprio NextCode) e o
    // porteiro promoveria arquivos e rodaria o tsc no repositório do harness (sessão sem projeto já não
    // executa em produção — PJ1, SESSAO_SEM_PROJETO).
    if (type1Res.passed && !secretGuardRes.blocked && taskDb.session.project?.path) {
      const porteiro = await promoteWithEmpiricalGate(qm, taskDb.id, targetProjectRoot, filesScopeArr, { checkOnly: true });
      TelemetryLogger.log({
        sessionId: taskDb.sessionId,
        action: porteiro.passed ? "PORTEIRO_OK" : "PORTEIRO_REPROVADO",
        details: {
          nodeId: taskDb.id,
          attempt: newAttempts,
          etapa: porteiro.failedStage,
          erro: porteiro.failureLine ?? null,
          errosNovos: (porteiro.newErrors ?? []).slice(0, 10),
          preexistente: porteiro.preexistingFailure,
        },
      });
      if (!porteiro.passed) {
        type1Res.passed = false;
        type1Res.compilationErrors.push(
          `[PORTEIRO ${empiricalStageLabel(porteiro.failedStage)}] ${porteiro.failureLine ?? "falhou"}` +
            ((porteiro.newErrors?.length ?? 0) > 1 ? ` (+${porteiro.newErrors.length - 1} erro(s) novo(s))` : "")
        );
      }
    }

    let validatedExecutorReport: MicrobriefAndReportDocument | null = null;
    if (type1Res.passed && nodeMicrobrief && nodeMicrobrief.reqsCobertos.length > 0) {
      let reportCheck = extractAndValidateExecutorReport(stepResultText, nodeMicrobrief, codeContentMap);
      const maxReportRetries = policy.tentativas.maxReenviosSoRelatorio ?? 2;
      let reportRetriesUsed = 0;

      while (!reportCheck.valid && reportCheck.reportFormatOnlyError && reportRetriesUsed < maxReportRetries) {
        TelemetryLogger.log({
          sessionId: taskDb.sessionId,
          action: "EXECUTOR_REPORT_INVALID",
          details: {
            nodeId: taskDb.id,
            attempt: newAttempts,
            retryIndex: reportRetriesUsed,
            reason: reportCheck.errors.join(" | "),
            errors: reportCheck.errors,
          },
        });
        reportRetriesUsed += 1;

        const fileLineSummary = Object.entries(codeContentMap)
          .map(([f, c]) => {
            const total = c.split(/\r?\n/).length;
            return `- ${f}: ${total} linha(s) (intervalo válido: 1-${total})`;
          })
          .join("\n");
        const retryMessages: DispatchMessage[] = [
          {
            role: "system",
            content:
              "O código desta etapa já compilou e passou na validação sintática. NÃO reescreva o código. " +
              "Responda APENAS com o bloco ```yaml relatorio_executor corrigindo os apontamentos abaixo.",
          },
          {
            role: "user",
            content: [
              `[REENVIO SÓ DO RELATÓRIO #${reportRetriesUsed}/${maxReportRetries} — NÃO REFAÇA O CÓDIGO]`,
              `Requisitos obrigatórios desta etapa: ${nodeMicrobrief.reqsCobertos.join(", ")}`,
              `Arquivos entregues na quarentena e total de linhas reais:\n${fileLineSummary}`,
              `Motivo da invalidação do relatório anterior:\n${reportCheck.errors.map((e) => `- ${e}`).join("\n")}`,
              "",
              "Retorne SOMENTE o bloco abaixo preenchido com linhas existentes nos arquivos:",
              "```yaml relatorio_executor",
              "reqs:",
              ...nodeMicrobrief.reqsCobertos.flatMap((r) => [
                `  - id: ${r}`,
                "    status: atendido",
                `    arquivo_linha: "${filesScopeArr[0] || "src/index.ts"}:1-1"`,
                '    como: "uma frase"',
              ]),
              "```",
            ].join("\n"),
          },
        ];

        try {
          const retrySignal = AbortSignal.timeout(stepTimeoutMs);
          const retryRes = await (paidGateways
            ? smartRouter.dispatchWithFallback({
                messages: retryMessages,
                sessionId: taskDb.sessionId,
                tier: "heavy",
                gateways: paidGateways,
                allowedRoutedViaPrefixes: policy.roteamentoPapeisCriticos.prefixosRotaPaga,
                maxTokens: 2048,
                stream: false,
                signal: retrySignal,
              })
            : smartRouter.dispatchWithFallback({
                messages: retryMessages,
                tier: executorTier === "rapido" ? "fast" : "heavy",
                maxTokens: 2048,
                geminiKey: readSecret(setting?.geminiKey),
                groqKey: readSecret((setting as any)?.groqKey),
                nvidiaKey: readSecret((setting as any)?.nvidiaKey),
                deepseekKey: readSecret((setting as any)?.deepseekKey),
                omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
                omniRouteKey: readSecret(setting?.omniRouteKey),
                stream: false,
                signal: retrySignal,
              }));
          if (retryRes && retryRes.providerUsed !== "none" && retryRes.tierTag !== "exhausted") {
            const retryJson = await retryRes.response.json().catch(() => ({}));
            await recordLlmCost({
              sessionId: taskDb.sessionId,
              nodeId: taskDb.id,
              papel: "executor",
              provider: String(retryRes.providerUsed),
              model: String(retryRes.modelUsed || ""),
              usage: retryJson.usage,
            });
            const retryText =
              retryJson.choices?.[0]?.message?.content ||
              retryJson.candidates?.[0]?.content?.parts?.[0]?.text ||
              "";
            if (retryText) {
              stepResultText = `${stepResultText}\n\n${retryText}`;
              reportCheck = extractAndValidateExecutorReport(retryText, nodeMicrobrief, codeContentMap);
            }
          }
        } catch {
          /* se o reenvio do relatório falhar por rede/timeout, segue sem relatório válido */
        }
      }

      if (reportCheck.valid && reportCheck.report) {
        validatedExecutorReport = reportCheck.report;
      } else {
        TelemetryLogger.log({
          sessionId: taskDb.sessionId,
          action: "EXECUTOR_REPORT_INVALID",
          details: {
            nodeId: taskDb.id,
            attempt: newAttempts,
            retryIndex: reportRetriesUsed,
            persistedInvalid: true,
            reason: reportCheck.errors.join(" | "),
            errors: reportCheck.errors,
          },
        });
        validatedExecutorReport = null;
      }
    }

    const blindAuditDispatch = makeBlindAuditDispatchFn(smartRouter, setting, taskDb.sessionId, taskDb.id, actualExecutorFamily);
    const type2Res = await DualLensAuditor.validateType2(
      type1Res,
      // O avaliador também vê o código real das dependências (só leitura), para conferir chamadas,
      // formatos de resposta e tipos entre etapas (ex.: a tela lê o campo de erro que a API devolve).
      buildBriefMarkdown(taskDb) +
        (dependencyBlock
          ? "\n\n## Contratos das dependências (somente leitura — já aprovados; NÃO são pendência desta etapa, " +
            "mas o código desta etapa deve usá-los corretamente)\n" +
            dependencyBlock.slice(0, 20000)
          : ""),
      stepResultText,
      codeContentMap,
      blindAuditDispatch,
      {
        cluster: resolvedCluster,
        expectedReqs: nodePayload.reqsCobertos,
        isPublicPage: Boolean(nodePayload.jevPlan?.aplicarTasteSkillPublico),
        includeReactPerf: nodePayload.jevPlan?.aplicarReactPerfCritico ?? true,
        nodeId: taskDb.id,
        sessionId: taskDb.sessionId,
        ...(nodeMicrobrief ? { executorReport: validatedExecutorReport } : {}),
      }
    );
    if (type2Res.skillUsed) {
      evaluatorSkillUsed = type2Res.skillUsed;
    }

    const stageReqIds = Array.from(
      new Set([
        ...(nodeMicrobrief?.reqsCobertos ?? []),
        ...(nodePayload.reqsCobertos ?? []),
        ...((type2Res.reqVerdicts ?? []).map((r) => r.id)),
      ])
    );
    const criteriosPorReq: Record<string, string> = {};
    const parsedSpecForCriteria = nodePayload.goal ? parseSpecDocument(nodePayload.goal) : null;
    for (const reqId of stageReqIds) {
      const fromMb = nodeMicrobrief?.criteriosAceitePorReq?.[reqId];
      if (Array.isArray(fromMb) && fromMb.length > 0) {
        criteriosPorReq[reqId] = fromMb.join("; ");
      } else {
        const reqSpec = parsedSpecForCriteria?.requisitos?.find((r) => r.id === reqId);
        const fromSpec = reqSpec?.criterio || reqSpec?.titulo;
        criteriosPorReq[reqId] = fromSpec || reqId;
      }
    }
    const jevEvidencia = await verifyStageEvidenceWithJev({
      sessionId: taskDb.sessionId,
      nodeId: taskDb.id,
      reqIds: stageReqIds,
      criteriosPorReq,
      codeContentMap,
      executorRows: validatedExecutorReport?.registroCumprimento ?? null,
      avaliadorVerdicts: type2Res.reqVerdicts ?? null,
      modo: policy.jevExecucao.verificacaoEvidencia,
      limiarEvidenciaContradiz: policy.jevExecucao.limiarEvidenciaContradiz,
    });

    // Falha do AVALIADOR (nenhum modelo devolveu veredito válido) não é culpa do executor: não gasta
    // tentativa, até MAX_FREE_EVALUATOR_RETRIES vezes seguidas (depois conta, para não girar para sempre).
    const evaluatorOutage = type1Res.passed && type2Res.method === "heuristic_fallback";
    if (evaluatorOutage) {
      evaluatorOutageStreak = readEvaluatorOutageStreak(taskDb.result) + 1;
      evaluatorOutageFreeRetry = evaluatorOutageStreak <= MAX_FREE_EVALUATOR_RETRIES;
      TelemetryLogger.log({
        sessionId: taskDb.sessionId,
        action: "EVALUATOR_UNAVAILABLE",
        details: {
          nodeId: taskDb.id,
          streak: evaluatorOutageStreak,
          attemptConsumed: false,
          falhas: blindAuditDispatch.lastFailures.slice(0, 6),
          descartes: (type2Res.descartes ?? []).slice(0, 6),
        },
      });

      // Mudança 24: passadas as 3 reavaliações grátis, a etapa NÃO gasta tentativa — volta para a fila e a
      // sessão pausa 5 min (o supervisor só retoma com o Claude respondendo). Chave/crédito/permissão não
      // se resolvem esperando → bloqueia na hora. Mais de MAX_PAUSAS_AVALIADOR pausas seguidas → bloqueia.
      if (!evaluatorOutageFreeRetry && !secretGuardRes.blocked) {
        qm.purgeWorkspace(taskDb.id);
        const falhas = blindAuditDispatch.lastFailures;
        const definitivo = isEvaluatorAccessFailure(falhas);
        const pausa = evaluatorOutageStreak - MAX_FREE_EVALUATOR_RETRIES;
        const ate = new Date(Date.now() + EVALUATOR_PAUSE_MS);
        const motivo = (falhas[0] ?? "sem resposta válida do avaliador").slice(0, 200);
        const pausedTask = await prisma.taskNode.update({
          where: { id: taskDb.id },
          data: {
            status: "pending",
            attempts: taskDb.attempts,
            result: JSON.stringify({ evaluatorOutageStreak, auditMethod: type2Res.method, evaluatorFailures: falhas.slice(0, 6) }),
          },
        });
        const bloqueia = definitivo || pausa > MAX_PAUSAS_AVALIADOR;
        await applyPhaseEvent(
          taskDb.sessionId,
          { type: "AVALIADOR_FORA", ate: ate.toISOString(), pausa, motivo, definitivo },
          {
            detalheAviso: [
              "**Dono:** ambiente (avaliador fora do ar).",
              `Etapa "${taskDb.title}": nenhuma tentativa do executor foi gasta (${taskDb.attempts || 0}/${taskDb.maxAttempts || 3}).`,
              "Falhas do avaliador:",
              ...falhas.slice(0, 6).map((f) => `- ${f}`),
              definitivo ? "Verifique a chave e o crédito da Anthropic em Configurações." : "",
            ]
              .filter(Boolean)
              .join("\n"),
          }
        );
        if (!bloqueia) {
          await prisma.message.create({
            data: {
              sessionId: taskDb.sessionId,
              role: "assistant",
              content:
                `⏸️ **Avaliador fora do ar — execução pausada (pausa ${pausa} de ${MAX_PAUSAS_AVALIADOR}).** ` +
                `A etapa "${taskDb.title}" voltou para a fila sem gastar tentativa. Nova tentativa a partir de ` +
                `${ate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}, quando o Claude responder. Motivo: ${motivo}`,
            },
          });
        }
        TelemetryLogger.log({
          sessionId: taskDb.sessionId,
          action: bloqueia ? "EVALUATOR_OUTAGE_BLOCKED" : "EVALUATOR_OUTAGE_PAUSED",
          details: { nodeId: taskDb.id, pausa, definitivo, ate: ate.toISOString(), falhas: falhas.slice(0, 6) },
        });
        return {
          success: false,
          claimed: true,
          executedTask: pausedTask,
          finalStatus: bloqueia ? "blocked" : "paused",
          executorSkillUsed: executorSkillName,
          evaluatorSkillUsed,
          promotionTarget: null,
        };
      }
    }

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

    const verdictAction =
      type2Res.rawVerdict === "APROVADO_COM_RESSALVA"
        ? resolveVerdictAction({
            decisao: "APROVADO_COM_RESSALVA",
            attemptNumber: newAttempts,
            maxAttempts,
            polishRoundsUsed: 0,
            policy,
          })
        : undefined;

    if (secretGuardRes.blocked) {
      finalStatus = wouldReachBlockThreshold ? "blocked" : "failed";
      qm.purgeWorkspace(taskDb.id);
    } else if (type2Res.verdict === "APPROVED") {
      finalStatus = "completed";
      const gate = await promoteWithEmpiricalGate(qm, taskDb.id, targetProjectRoot, filesScopeArr);
      empiricalBuildResult = gate.buildResult;
      promotionTarget = gate.rolledBack ? null : targetProjectRoot;
      if (gate.preexistingFailure) {
        // Mudança 35: sem nenhum `error TS` nos dois type-checks o tsc nem rodou — é ambiente.
        TelemetryLogger.log({
          sessionId: taskDb.sessionId,
          action: gate.environmentFailure ? "EMPIRICAL_BUILD_ENV_FAILURE" : "EMPIRICAL_BUILD_PREEXISTING_FAILURE",
          details: { nodeId: taskDb.id },
        });
      }
      // Mudança 43.3: reparo com testes do contrato só é aceito com todos passando (o defeito saiu).
      if (gate.passed && !gate.rolledBack && repairPayload?.testesReproducao?.length) {
        const contract = await runTestBench(targetProjectRoot, contractBenchRequest(repairPayload.testesReproducao));
        if (!contract.ok) {
          // Bancada fora (Docker parado): não trava a etapa; fica o veredito do avaliador e a verificação final.
          TelemetryLogger.log({ sessionId: taskDb.sessionId, action: "REPAIR_CONTRACT_UNAVAILABLE", details: { nodeId: taskDb.id, stage: contract.stage, error: contract.error } });
        } else {
          const falhas = [
            ...contract.files.filter((f) => f.loadError).map((f) => `${f.file} não carregou: ${f.loadError}`),
            ...contract.cases.filter((c) => c.status === "failed").map((c) => `${c.file} › ${c.name}: ${c.failure ?? ""}`),
          ];
          TelemetryLogger.log({
            sessionId: taskDb.sessionId,
            action: falhas.length ? "REPAIR_CONTRACT_FAILED" : "REPAIR_CONTRACT_PASSED",
            details: { nodeId: taskDb.id, casos: contract.cases.length, falhas: falhas.slice(0, 10).map((f) => f.slice(0, 300)) },
          });
          if (falhas.length) {
            qm.rollbackPromotion(taskDb.id);
            if (touchesPrismaSchema(filesScopeArr)) await regeneratePrismaClient(targetProjectRoot);
            promotionTarget = null;
            gate.passed = false;
            gate.failedStage = "teste";
            gate.failureLine = `teste do contrato ainda falha — ${falhas[0].slice(0, 600)}`;
            gate.newErrors = falhas.slice(1, 10).map((f) => f.slice(0, 400));
          }
        }
      }
      if (!gate.passed) {
        empiricalFailureLine = gate.failureLine || "falha na verificação empírica pós-promoção";
        empiricalFailureStage = gate.failedStage;
        empiricalGateErrors = gate.newErrors || [];
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
      finalStatus = wouldReachBlockThreshold && !evaluatorOutageFreeRetry ? "blocked" : "failed";
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

    // Todos os erros novos (até 10), não só o primeiro: com um só, o executor corrigia esse e
    // tropeçava no seguinte em cada tentativa.
    const extraErrors = empiricalGateErrors.filter((e) => e !== empiricalFailureLine).slice(0, 9);
    const empiricalFailureReason = empiricalFailureLine
      ? `Verificação empírica (${empiricalStageLabel(empiricalFailureStage)}) falhou — promoção desfeita: ${empiricalFailureLine}` +
        (extraErrors.length ? `\nOutros erros do compilador:\n${extraErrors.map((e) => `- ${e}`).join("\n")}` : "")
      : undefined;

    const rejectionReason =
      (secretGuardRes.blocked ? secretGuardRes.rejectionReasons.join("\n") : undefined) ||
      empiricalFailureReason ||
      (type2Res.verdict !== "APPROVED"
        ? type2Res.rejectionReason || "Divergência semântica."
        : undefined);

    let jevDiagnostico: JevFailureDiagnosis | null = null;
    if (finalStatus === "failed" && !evaluatorOutageFreeRetry && !secretGuardRes.blocked) {
      let prevHistory: FailureAttemptRecord[] = [];
      try {
        prevHistory = taskDb.failureHistory ? JSON.parse(taskDb.failureHistory) : [];
      } catch {
        prevHistory = [];
      }
      jevDiagnostico = await diagnoseStageFailureWithJev({
        sessionId: taskDb.sessionId,
        nodeId: taskDb.id,
        etapa: {
          titulo: taskDb.title,
          cluster: resolvedCluster,
          reqs_cobertos: nodePayload.reqsCobertos ?? nodeMicrobrief?.reqsCobertos ?? [],
        },
        arquivosEscopo: filesScopeArr,
        criteriosPorReq,
        motivoRejeicao: rejectionReason || "Falha não especificada.",
        tentativa: newAttempts,
        historicoMotivos: prevHistory.slice(-3).map((h) => h.rejectionReason),
        modo: policy.jevExecucao.diagnosticoFalha,
      });

      if (
        newAttempts >= 2 &&
        jevDiagnostico?.causa === "ambiguous_spec" &&
        jevDiagnostico.confianca >= policy.jevExecucao.limiarConfiancaDiagnostico
      ) {
        if (policy.jevExecucao.bloqueioSpecAmbigua === "sombra") {
          TelemetryLogger.log({
            sessionId: taskDb.sessionId,
            action: "JEV_WOULD_BLOCK_AMBIGUOUS_SPEC",
            details: {
              nodeId: taskDb.id,
              tentativa: newAttempts,
              causa: jevDiagnostico.causa,
              confianca: jevDiagnostico.confianca,
              probabilidades: jevDiagnostico.probabilidades,
              modo: "sombra",
            },
          });
        } else if (policy.jevExecucao.bloqueioSpecAmbigua === "ativo") {
          TelemetryLogger.log({
            sessionId: taskDb.sessionId,
            action: "JEV_WOULD_BLOCK_AMBIGUOUS_SPEC",
            details: {
              nodeId: taskDb.id,
              tentativa: newAttempts,
              causa: jevDiagnostico.causa,
              confianca: jevDiagnostico.confianca,
              probabilidades: jevDiagnostico.probabilidades,
              modo: "ativo",
            },
          });
          finalStatus = "blocked";
          blockedByAmbiguousSpec = true;
        }
      }

      const roteamentoFalha = policy.jevExecucao.roteamentoFalha;
      if (
        jevDiagnostico &&
        roteamentoFalha !== "desligado" &&
        failureRouteApplies(jevDiagnostico, policy.jevExecucao.limiarConfiancaDiagnostico)
      ) {
        const priorEvaluatorErrorRoutes = prevHistory.filter(
          (h) => h.diagnostico?.causa === "evaluator_error"
        ).length;
        const baselineWouldIncrementAttempt =
          (finalStatus === "failed" || finalStatus === "blocked") &&
          !evaluatorOutageFreeRetry &&
          !blockedByAmbiguousSpec &&
          !planErrorSkipAttempt &&
          !evaluatorErrorFreeRetry;

        const route = computeFailureRoutePersistence({
          mode: roteamentoFalha,
          diagnostico: jevDiagnostico,
          limiarConfianca: policy.jevExecucao.limiarConfiancaDiagnostico,
          priorEvaluatorErrorRoutesInHistory: priorEvaluatorErrorRoutes,
          baselineFinalStatus: finalStatus === "blocked" ? "blocked" : "failed",
          baselineWouldIncrementAttempt,
        });

        if (route) {
          if (route.emitWouldAct) {
            TelemetryLogger.log({
              sessionId: taskDb.sessionId,
              action: "FAILURE_ROUTE_WOULD_ACT",
              details: {
                nodeId: taskDb.id,
                tentativa: newAttempts,
                causa: jevDiagnostico.causa,
                fonte: jevDiagnostico.fonte ?? "jev",
                confianca: jevDiagnostico.confianca,
                acao: route.acao,
                dono: route.dono,
              },
            });
          }
          if (roteamentoFalha === "ativo") {
            failureRouteDono = route.dono;
            finalStatus = route.finalStatus;
            if (route.blockedByPlanError) blockedByPlanError = true;
            if (route.planErrorSkipAttempt) planErrorSkipAttempt = true;
            if (route.evaluatorErrorFreeRetry) evaluatorErrorFreeRetry = true;
          }
        }
      }
    }

    // TR1 (2): a mesma ação negada ≥ 2× por regra do harness não é erro do executor — outra tentativa
    // bateria na mesma regra. Bloqueia sem gastar tentativa, com "Dono: harness" e a regra no chat.
    if ((finalStatus === "failed" || finalStatus === "blocked") && loopHarnessDenials.length > 0) {
      finalStatus = "blocked";
      blockedByHarnessRule = true;
      failureRouteDono = "harness";
      TelemetryLogger.log({
        sessionId: taskDb.sessionId,
        action: "HARNESS_RULE_BLOCK",
        details: { nodeId: taskDb.id, tentativa: newAttempts, negacoes: loopHarnessDenials },
      });
    }

    let incidentReportMarkdown: string | undefined;
    if (finalStatus === "failed" || finalStatus === "blocked") {
      newFailureHistory = appendFailureAttempt(taskDb.failureHistory, {
        attemptNumber: newAttempts,
        rejectionReason: rejectionReason || "Falha não especificada.",
        filesScope: filesScopeArr,
        timestamp: new Date().toISOString(),
        ...(jevDiagnostico ? { diagnostico: jevDiagnostico } : {}),
      });
      if (finalStatus === "blocked") {
        const history: FailureAttemptRecord[] = JSON.parse(newFailureHistory);
        const planErrorScopeHint =
          blockedByPlanError && jevDiagnostico?.foraDoEscopo?.length
            ? `Erro do plano — arquivos fora do escopo desta etapa: ${jevDiagnostico.foraDoEscopo
                .map((f) => `${f.req} → ${f.arquivo}`)
                .join("; ")}. Ajuste a Spec Canônica ou o microbrief e depois clique em "Desbloquear / Re-tentar Etapa".`
            : undefined;
        incidentReportMarkdown = IncidentReporter.generateIncidentReport(taskDb.id, taskDb.title, taskDb.cluster, history, {
          maxAttempts,
          placar: await sessionScoreboardMarkdown(taskDb.sessionId),
          ...(failureRouteDono ? { dono: failureRouteDono } : {}),
          ...(blockedByAmbiguousSpec
            ? {
                unblockHint:
                  'Ajuste a Spec Canônica para eliminar a ambiguidade apontada no diagnóstico Jev e depois clique em "Desbloquear / Re-tentar Etapa" no painel da DAG.',
              }
            : {}),
          ...(planErrorScopeHint ? { unblockHint: planErrorScopeHint } : {}),
          ...(blockedByHarnessRule
            ? {
                unblockHint:
                  "Regra do harness negou a mesma ação repetidas vezes (nenhuma tentativa gasta). Corrija a regra ou o " +
                  'escopo e clique em "Desbloquear / Re-tentar Etapa".',
              }
            : {}),
        });
        if (blockedByAmbiguousSpec) {
          await prisma.message.create({
            data: {
              sessionId: taskDb.sessionId,
              role: "assistant",
              content: `🛑 **Etapa "${taskDb.title}" bloqueada por especificação ambígua (Jev) — ajuste a Spec Canônica antes de re-tentar.**\n\n${incidentReportMarkdown}`,
            },
          });
        } else if (blockedByPlanError) {
          await prisma.message.create({
            data: {
              sessionId: taskDb.sessionId,
              role: "assistant",
              content: `🛑 **Etapa "${taskDb.title}" bloqueada por erro do plano (escopo da etapa) — ajuste a Spec antes de re-tentar.**\n\n${incidentReportMarkdown}`,
            },
          });
        } else if (blockedByHarnessRule) {
          const regras = loopHarnessDenials
            .map((d) => `- \`${d.ferramenta}\` em \`${d.alvo || "(sem alvo)"}\` negada ${d.vezes}×: ${d.motivo}`)
            .join("\n");
          await prisma.message.create({
            data: {
              sessionId: taskDb.sessionId,
              role: "assistant",
              content: `🛑 **Etapa "${taskDb.title}" bloqueada por regra do harness — Dono: harness (não é erro do executor; nenhuma tentativa gasta).**\n\n${regras}\n\n${incidentReportMarkdown}`,
            },
          });
        }
      }
    }

    mcpRes = {
      success: finalStatus === "completed",
      nodeId: taskDb.id,
      title: taskDb.title,
      cluster: resolvedCluster,
      executorSkillUsed: executorSkillName,
      evaluatorSkillUsed,
      output: stepResultText,
      executorReport: validatedExecutorReport,
      auditVerdict: secretGuardRes.blocked ? "REJECTED" : type2Res.verdict,
      rawVerdict: secretGuardRes.blocked ? "REPROVADO" : type2Res.rawVerdict,
      ressalvas: type2Res.ressalvas,
      correcoesSugeridas: type2Res.correcoesSugeridas,
      fatoQueGarante: type2Res.fatoQueGarante,
      nivelProva: type2Res.nivelProva,
      verdictAction: verdictAction?.action,
      reqVerdicts: type2Res.reqVerdicts,
      reqDivergences: type2Res.reqDivergences,
      lens2ByReq: type2Res.lens2ByReq,
      auditMethod: type2Res.method,
      evaluatorOutageStreak,
      promotedPath: promotionTarget,
      empiricalBuildPassed: empiricalBuildResult ? empiricalBuildResult.success : null,
      rejectionReason,
      jevDiagnostico: jevDiagnostico ?? undefined,
      jevEvidencia: jevEvidencia ?? undefined,
      incidentReport: incidentReportMarkdown,
      codigoTentativa:
        finalStatus !== "completed" && loopCodeContentMap && !secretGuardRes.blocked
          ? pickAttemptCodeToKeep(loopCodeContentMap)
          : undefined,
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
      cluster: resolvedCluster,
      executorSkillUsed: executorSkillName,
      evaluatorSkillUsed,
      output: stepResultText,
      auditVerdict: "ERROR",
      rejectionReason: `Exceção não tratada durante auditoria/promoção: ${String(err)}`,
      incidentReport: incidentReportMarkdown,
    };
    console.error(`[DAG_NODE_CRASH] Nó "${taskDb.title}" travou após 'running':`, err);
  }

  const updatedAttempts =
    (finalStatus === "failed" || finalStatus === "blocked") &&
    !evaluatorOutageFreeRetry &&
    !blockedByAmbiguousSpec &&
    !planErrorSkipAttempt &&
    !evaluatorErrorFreeRetry &&
    !blockedByHarnessRule
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
      cluster: resolvedCluster,
      executorSkillUsed: executorSkillName,
      evaluatorSkillUsed,
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
    executorSkillUsed: executorSkillName,
    evaluatorSkillUsed,
    promotionTarget,
  };
}
