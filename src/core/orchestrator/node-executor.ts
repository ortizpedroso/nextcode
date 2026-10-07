import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { SmartRouter, DispatchMessage } from "@/core/router/smart-router";
import { readSecret } from "@/core/security/crypto";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";
import { dispatchStrongEvaluator } from "@/core/llm/evaluator-models";
import {
  resolveVerdictAction,
  resolveExecutorTierForAttempt,
  loadOrchestrationPolicy,
  type ClusterKind,
} from "@/core/config/orchestration-policy";
import {
  inferClusterFromFilePath,
  renderMicrobriefMarkdown,
  type MicrobriefAndReportDocument,
} from "@/core/templates/artifact-templates";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor, LLMDispatchFn } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { buildErrorSignature } from "@/core/telemetry/error-signature";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { IncidentReporter, FailureAttemptRecord } from "@/core/governance/incident-reporter";
import { promoteWithEmpiricalGate, empiricalStageLabel, type EmpiricalStage } from "@/core/governance/empirical-gate";
import { ensureProjectBase, npmInstaller, type Installer, type ProjectBaseResult } from "@/core/execution/project-base";
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

  for (const t of opts.tasks) {
    if (t.role === "scaffold") continue;
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

/** Quedas seguidas do avaliador que não gastam tentativa do executor. */
export const MAX_FREE_EVALUATOR_RETRIES = 2;

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
  sessionId?: string
): LLMDispatchFn {
  return async (messages) => {
    // Avaliador forte e pago (Gemini → Claude → DeepSeek). Só cai na rota gratuita se nenhum responder.
    const strong = await dispatchStrongEvaluator(messages, {
      geminiKey: setting?.geminiKey,
      claudeKey: (setting as { claudeKey?: string | null } | null)?.claudeKey,
      deepseekKey: (setting as { deepseekKey?: string | null } | null)?.deepseekKey,
    }).catch(() => null);
    TelemetryLogger.log({
      sessionId,
      action: "EVALUATOR_MODEL",
      details: {
        provider: strong?.provider ?? "freellmapi-fallback",
        model: strong?.model ?? null,
        independentFromExecutor: strong?.independent ?? false,
        failures: strong?.failures ?? [],
      },
    });
    if (strong?.content) return strong.content;
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
    if (used + content.length > MAX_TOTAL) break;
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

/** Instalador usado pela etapa de base; trocado nos testes para não acessar a rede. */
let scaffoldInstaller: Installer = npmInstaller;
export function setScaffoldInstallerForTests(installer: Installer | null): void {
  scaffoldInstaller = installer ?? npmInstaller;
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
    base = await ensureProjectBase(projectRoot, stack, scaffoldInstaller);
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
  let executorSkillInstructions = "";
  try {
    const loadedExecutorSkill = loadRoleSkill(executorSkillName);
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

  const autonomousWorkerPrompt = `Você é um Engenheiro de Software Sênior (${taskDb.role} / cluster ${resolvedCluster}) responsável pela etapa "${taskDb.title}".
DIRETRIZES DE EXECUÇÃO:
1. Execute a tarefa de forma 100% autônoma e completa. NUNCA faça perguntas ou solicite confirmações.
2. Para cada arquivo no escopo (${taskDb.filesScope || "[]"}), você DEVE OBRIGATORIAMENTE retornar o código-fonte completo em blocos de código formatados com a indicação do arquivo no topo:
\`\`\`typescript
// file: caminho/relativo/do/arquivo.ts
<código completo aqui>
\`\`\`
3. Não inclua discursos sobre governança, desculpas ou cabeçalhos robóticos. Retorne apenas o código funcional e explicações técnicas diretas.${executorSkillInstructions}`;

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

  // O worker precisa da Spec aprovada: antes recebia só título, papel e lista de arquivos, e
  // inventava o conteúdo (rotas com Math.random, dados fixos, testes expect(true)).
  const nodePayload = readNodePayload(taskDb.payload);
  const nodeMicrobrief = readNodeMicrobrief(taskDb.payload);
  if (nodeMicrobrief) {
    dispatchMessages.push({
      role: "system",
      content:
        "MICROBRIEF DESTA ETAPA (contrato: o Avaliador julga cada REQ abaixo contra estes critérios):\n\n" +
        renderMicrobriefMarkdown(nodeMicrobrief, { titulo: taskDb.title, spec: nodePayload.goal }),
    });
  }
  if (nodePayload.goal) {
    dispatchMessages.push({
      role: "system",
      content:
        "SPEC CANÔNICA APROVADA (fonte da verdade — implemente exatamente o que ela define para os arquivos desta etapa; " +
        "os demais arquivos são feitos por outras etapas). O código é COMPILADO com tsc strict depois da entrega: importe " +
        "apenas arquivos que já existem no projeto ou estão no seu escopo; pacotes npm que você importar são instalados " +
        "automaticamente; não use o tipo `any`.\n\n" +
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

  dispatchMessages.push({
    role: "user",
    content: `[EXECUÇÃO DA ETAPA DA DAG: ${taskDb.title}]\nPapel/Função: ${taskDb.role}\nEscopo de Arquivos: ${taskDb.filesScope || "[]"}\nObjetivo: Execute esta etapa de forma 100% autônoma e retorne os códigos de todos os arquivos no escopo.`,
  });

  const plannedTier = readPlannedTier(taskDb.payload);
  const executorTier = resolveExecutorTierForAttempt(plannedTier, (taskDb.attempts || 0) + 1);
  TelemetryLogger.log({
    sessionId: taskDb.sessionId,
    action: "EXECUTOR_TIER",
    details: { nodeId: taskDb.id, plannedTier, attempt: (taskDb.attempts || 0) + 1, executorTier },
  });

  let stepResultText = "";
  let noLlmAvailable = false;
  try {
    const stepSignal = AbortSignal.timeout(stepTimeoutMs);
    const dispatchPromise = smartRouter.dispatchWithFallback({
      messages: dispatchMessages,
      // Nível escolhido pelo Jev no planejamento, com escalada a cada nova tentativa
      // (rápido → médio → pesado). rápido = FreeLLMAPI gratuito; médio/pesado = DeepSeek.
      tier: executorTier === "rapido" ? "fast" : "heavy",
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

  const policy = loadOrchestrationPolicy();

  // Item 1 (Fila nunca para): se todos os provedores de LLM estiverem fora do ar (providerUsed === "none"),
  // falha de provedor NÃO conta como tentativa da etapa (policy.tentativas.falhaProvedorContaComoTentativa === false).
  // Reverte o nó para "pending" sem incrementar attempts e pausa a sessão (SEM_LLM).
  if (noLlmAvailable && !policy.tentativas.falhaProvedorContaComoTentativa) {
    const revertedTask = await prisma.taskNode.update({
      where: { id: taskDb.id },
      data: {
        status: "pending",
        attempts: taskDb.attempts,
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
          content: `⚠️ **${pauseMarker}.** A etapa "${taskDb.title}" voltou para a fila sem consumir nenhuma tentativa (${taskDb.attempts || 0}/${taskDb.maxAttempts || 3}). O supervisor retomará a execução automaticamente assim que um gateway responder.`,
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
  let newFailureHistory: string | undefined;
  let evaluatorSkillUsed = `avaliador-${resolvedCluster}`;

  const maxAttempts = taskDb.maxAttempts || policy.tentativas.maxTentativasPorExecutor || 3;
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
      makeBlindAuditDispatchFn(smartRouter, setting, taskDb.sessionId),
      {
        cluster: resolvedCluster,
        expectedReqs: nodePayload.reqsCobertos,
      }
    );
    if (type2Res.skillUsed) {
      evaluatorSkillUsed = type2Res.skillUsed;
    }

    // Falha do AVALIADOR (nenhum modelo devolveu veredito válido) não é culpa do executor: não gasta
    // tentativa, até MAX_FREE_EVALUATOR_RETRIES vezes seguidas (depois conta, para não girar para sempre).
    const evaluatorOutage = type1Res.passed && type2Res.method === "heuristic_fallback";
    if (evaluatorOutage) {
      evaluatorOutageStreak = readEvaluatorOutageStreak(taskDb.result) + 1;
      evaluatorOutageFreeRetry = evaluatorOutageStreak <= MAX_FREE_EVALUATOR_RETRIES;
      TelemetryLogger.log({
        sessionId: taskDb.sessionId,
        action: "EVALUATOR_UNAVAILABLE",
        details: { nodeId: taskDb.id, streak: evaluatorOutageStreak, attemptConsumed: !evaluatorOutageFreeRetry },
      });
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
      cluster: resolvedCluster,
      executorSkillUsed: executorSkillName,
      evaluatorSkillUsed,
      output: stepResultText,
      auditVerdict: type2Res.verdict,
      rawVerdict: type2Res.rawVerdict,
      ressalvas: type2Res.ressalvas,
      verdictAction: verdictAction?.action,
      reqVerdicts: type2Res.reqVerdicts,
      reqDivergences: type2Res.reqDivergences,
      auditMethod: type2Res.method,
      evaluatorOutageStreak,
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
    (finalStatus === "failed" || finalStatus === "blocked") && !evaluatorOutageFreeRetry
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
