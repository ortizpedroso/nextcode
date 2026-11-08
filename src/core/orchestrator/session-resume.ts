import prisma from "@/lib/prisma";
import type { TaskNode } from "@prisma/client";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";
import { readRepairPayload } from "@/core/orchestrator/repair-payload";
import { contractStagesForNode, validateContract, type ContratoProjeto } from "@/core/orchestrator/project-contract";
import { phaseInExecucaoFamilia, restoreSpecApprovalIfExecutionContinues } from "@/core/orchestrator/spec-trava-t1";
import { pickBlockedCulprit } from "@/core/orchestrator/blocked-culprit";
import type { Phase } from "@/core/orchestrator/phase-machine";
import {
  appendOwnerDependency,
  decideCitedOwnerReopen,
  parseStageFiles,
  priorReopensFromPayload,
  withOwnerReopenHold,
  withOwnerReopenRequest,
  type OwnerReopenDecision,
} from "@/core/orchestrator/owner-reopen";
import {
  alargarContratoDaSessaoAposEscolha,
  etapaBloqueadaPorPedidoUnicoSemResolucao,
  lerEstadoPedidoUnico,
  normalizarDecisaoPedidoUnico,
  persistirReconciliacaoPedidoUnicoObsoleto,
  registrarEscolhaPedidoUnico,
  type MotivoRecusaRetry,
} from "@/core/governance/pedido-unico";
import { escopoMicrobriefAindaImpede, etapaBloqueadaPorEscopoMicrobrief } from "@/core/governance/microbrief-escopo";

export interface ResumeResult {
  ok: boolean;
  message: string;
  phase?: Phase;
  motivo?: MotivoRecusaRetry;
}

/** Feedback no thread do chat (painel DAG) — o operador não deve depender do console recolhido. */
export async function postSessionActionFeedback(sessionId: string, content: string): Promise<void> {
  await prisma.message.create({
    data: { sessionId, role: "assistant", content },
  });
}

function resumeSuccessMessage(phase: Phase, skippedRepairs: boolean): string {
  if (phase === "SPEC_REVISAO") {
    return (
      "▶️ **Desbloqueio concluído.** Fase atual: `SPEC_REVISAO`.\n\n" +
      "Próximo passo: abrir a **Spec Canônica** e **aprovar de novo** para o analista gerar um plano novo (T8b). " +
      "Nenhuma etapa de execução foi criada; nada mudou no disco do projeto."
    );
  }
  if (skippedRepairs) {
    return (
      "▶️ Sessão retomada: reparo(s) bloqueado(s) encerrado(s) — a verificação final (T10) roda sobre o código no disco."
    );
  }
  if (phase === "EXECUCAO" || phase === "VERIFICACAO" || phase === "PLANEJAMENTO") {
    return `▶️ Sessão retomada na fase \`${phase}\`. A orquestração continua de onde parou.`;
  }
  return `▶️ Sessão retomada na fase \`${phase}\`.`;
}

/** Mudança 36: "retomar" digitado sozinho no chat (com ou sem pontuação). */
export function isResumeCommand(text: string): boolean {
  return /^\s*retomar\s*[.!]?\s*$/i.test(text);
}

/** Re-roda a verificação final (T10) com o código no disco — mesmo efeito prático que Retomar sem etapas pendentes. */
export function isRecheckDeliveryCommand(text: string): boolean {
  return /^\s*reverificar\s+(a\s+)?entrega\s*[.!]?\s*$/i.test(text);
}

function isRepairTaskNode(task: Pick<TaskNode, "id" | "title" | "payload">): boolean {
  if (readRepairPayload(task.payload)) return true;
  return /reparo/i.test(task.id) || /reparo/i.test(task.title);
}

function rejectionReasons(failureHistory: string | null): string[] {
  try {
    const history = JSON.parse(failureHistory || "[]");
    if (!Array.isArray(history)) return [];
    return history
      .map((item) => (item && typeof item.rejectionReason === "string" ? item.rejectionReason : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function lastRejectionReason(failureHistory: string | null): string {
  const reasons = rejectionReasons(failureHistory);
  return reasons.length > 0 ? reasons[reasons.length - 1] : "";
}

/** A última tentativa pode esconder o campo ausente. A decisão olha o ciclo inteiro. */
function allRejectionReasons(failureHistory: string | null): string {
  return rejectionReasons(failureHistory).join("\n");
}

/**
 * Etapa bloqueada sem ter rodado (cascata), ou parada num [CONTRATO] que o harness
 * atual já não reproduz. Nesse caso a Spec está certa: Retomar devolve a fila.
 * Contrato que ainda falha não libera. Falha de código: o Retomar zera a etapa e a cascata.
 */
export function blockedTaskReleaseKind(task: {
  payload: string | null;
  failureHistory: string | null;
  result?: string | null;
}): "cascade" | "stale-contract" | "keep" {
  if (etapaBloqueadaPorPedidoUnicoSemResolucao(task)) return "keep";
  if (etapaBloqueadaPorEscopoMicrobrief(task) && escopoMicrobriefAindaImpede(task)) return "keep";
  const reason = lastRejectionReason(task.failureHistory);
  if (!reason) return "cascade";
  if (!reason.includes("[CONTRATO]")) return "keep";
  let payload: { contrato?: ContratoProjeto; etapaId?: string; planoStages?: unknown };
  try {
    payload = JSON.parse(task.payload || "{}");
  } catch {
    return "keep";
  }
  if (!payload.contrato) return "keep";
  const stages = contractStagesForNode(
    payload.contrato,
    typeof payload.etapaId === "string" ? payload.etapaId : "",
    [],
    payload.planoStages
  );
  return validateContract(payload.contrato, stages).length === 0 ? "stale-contract" : "keep";
}

export function canReleaseStaleContractBlocks(
  tasks: Array<{ payload: string | null; failureHistory: string | null }>
): boolean {
  if (tasks.length === 0) return false;
  let stale = false;
  for (const task of tasks) {
    const kind = blockedTaskReleaseKind(task);
    if (kind === "keep") return false;
    if (kind === "stale-contract") stale = true;
  }
  return stale;
}

/**
 * O humano já clicou Retomar. Há ao menos uma etapa com falha de código.
 * O clique trata essa etapa e quem só caiu em cascata. Outra etapa com falha própria fica bloqueada.
 * Contrato que ainda falha não entra aqui.
 */
export function canRetryExhaustedCodeOnResume(
  tasks: Array<{ payload: string | null; failureHistory: string | null }>
): boolean {
  if (tasks.length === 0) return false;
  let code = false;
  for (const task of tasks) {
    if (etapaBloqueadaPorPedidoUnicoSemResolucao(task)) return false;
    if (escopoMicrobriefAindaImpede(task)) return false;
    const kind = blockedTaskReleaseKind(task);
    if (kind === "stale-contract") return false;
    if (kind === "cascade") continue;
    if (lastRejectionReason(task.failureHistory).includes("[CONTRATO]")) return false;
    code = true;
  }
  return code;
}

export type ResumeTaskView = {
  id: string;
  title: string;
  status: string;
  filesScope: string[];
  dependencies: string[];
  payload: string | null;
  failureHistory: string | null;
};

/**
 * Libera a etapa pedida e as bloqueadas que só dependem dela.
 * Etapa com falha própria fora desse conjunto continua bloqueada.
 * Se a última rejeição crítica já aponta o arquivo de uma etapa concluída, essa dona volta à fila.
 */
export function planBlockedRetryRelease(
  culpritId: string,
  tasks: ResumeTaskView[]
): {
  releaseIds: string[];
  keptBlockedIds: string[];
  reopen: Extract<OwnerReopenDecision, { kind: "reopen" }> | null;
} {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const released = new Set<string>([culpritId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (released.has(task.id)) continue;
      if (task.status !== "blocked") continue;
      if (blockedTaskReleaseKind(task) !== "cascade") continue;
      const dependsOnReleased = task.dependencies.some((id) => released.has(id));
      const blockedOutside = task.dependencies.some((id) => {
        const dep = byId.get(id);
        return Boolean(dep && dep.status === "blocked" && !released.has(id));
      });
      if (dependsOnReleased && !blockedOutside) {
        released.add(task.id);
        changed = true;
      }
    }
  }

  const culprit = byId.get(culpritId);
  let reopen: Extract<OwnerReopenDecision, { kind: "reopen" }> | null = null;
  if (culprit) {
    const decision = decideCitedOwnerReopen({
      rejection: allRejectionReasons(culprit.failureHistory),
      thisStageId: culprit.id,
      thisFiles: culprit.filesScope,
      stages: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        files: task.filesScope,
      })),
      priorReopens: priorReopensFromPayload(culprit.payload),
    });
    if (decision.kind === "reopen") reopen = decision;
  }

  const keptBlockedIds = tasks
    .filter((task) => task.status === "blocked" && !released.has(task.id))
    .map((task) => task.id);

  return { releaseIds: Array.from(released), keptBlockedIds, reopen };
}

/** O aviso não chama de falha própria a etapa que nunca rodou e só espera outra bloqueada. */
export function keptBlockedNote(
  tasks: Array<{ id: string; payload: string | null; failureHistory: string | null }>,
  keptIds: string[]
): string {
  if (keptIds.length === 0) return "";
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let own = 0;
  let waiting = 0;
  for (const id of keptIds) {
    const task = byId.get(id);
    if (!task) continue;
    if (blockedTaskReleaseKind(task) === "cascade") waiting += 1;
    else own += 1;
  }
  const parts: string[] = [];
  if (own > 0) parts.push(`${own} etapa(s) com falha própria seguem bloqueadas`);
  if (waiting > 0) {
    parts.push(
      own > 0
        ? `${waiting} etapa(s) que ainda dependem delas também`
        : `${waiting} etapa(s) seguem bloqueadas porque ainda dependem de outra etapa bloqueada`
    );
  }
  return parts.length > 0 ? ` ${parts.join(". ")}.` : "";
}

/** Bloqueio em que Retomar continua a fila. Não reabre etapa que esgotou o código. */
const QUEUE_RESUME_EVENTS = new Set([
  "SEM_LLM_PERSISTENTE",
  "FALHA_AMBIENTE",
  "FALHA_REPETIDA",
  "SILENCIO_DETECTADO",
]);

export function blockEventFromTransition(details: string | null): string | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { event?: { type?: string } };
    return typeof parsed.event?.type === "string" ? parsed.event.type : null;
  } catch {
    return null;
  }
}

/**
 * O provedor caiu, ou o ambiente, com etapas ainda pendentes.
 * Retomar devolve a fila. A etapa que já esgotou o código fica bloqueada.
 */
export function resumeContinuesPendingQueue(blockEvent: string | null, pendingCount: number): boolean {
  return pendingCount > 0 && blockEvent != null && QUEUE_RESUME_EVENTS.has(blockEvent);
}

/** Só reparo bloqueado com todo o resto já concluído — Retomar pula o executor e vai para T10 no disco. */
export function canSkipBlockedRepairsToVerify(
  tasks: Array<Pick<TaskNode, "id" | "title" | "payload" | "status">>
): boolean {
  const blocked = tasks.filter((t) => t.status === "blocked");
  if (blocked.length === 0) return false;
  if (!tasks.every((t) => t.status === "completed" || t.status === "blocked")) return false;
  return blocked.every(isRepairTaskNode);
}

async function skipBlockedRepairsWhenRestComplete(
  sessionId: string,
  specVersion: number
): Promise<{ skipped: boolean; nodeIds: string[] }> {
  const tasks = await prisma.taskNode.findMany({
    where: { sessionId, specVersion },
    select: { id: true, status: true, title: true, payload: true },
  });
  if (!canSkipBlockedRepairsToVerify(tasks)) return { skipped: false, nodeIds: [] };

  const blocked = tasks.filter((t) => t.status === "blocked");
  for (const t of blocked) {
    await prisma.taskNode.update({
      where: { id: t.id },
      data: {
        status: "completed",
        result: JSON.stringify({
          success: true,
          auditVerdict: "HUMAN_RESUME_SKIP",
          skippedRepair: true,
        }),
      },
    });
  }
  await TelemetryLogger.logAndWait({
    sessionId,
    action: "REPAIR_SKIPPED_RESUME_TO_VERIFY",
    details: { nodeIds: blocked.map((b) => b.id) },
  });
  return { skipped: true, nodeIds: blocked.map((b) => b.id) };
}

/**
 * Mudança 36: retoma uma sessão BLOQUEADA sem mexer na Spec nem nas etapas — para bloqueios cuja causa
 * não está no pedido (ambiente, erro interno, silêncio, avaliador fora). Etapa bloqueada usa Re-tentar
 * (zera as tentativas dela); aqui não se apaga histórico de ninguém.
 * Se só restam etapas de **reparo** bloqueadas e o resto da DAG já concluiu, Retomar encerra o reparo e
 * enfileira a verificação final sobre o código no disco (ex.: correção manual no projeto).
 */
async function finishResumeFeedback(
  sessionId: string,
  via: "painel" | "chat" | "linha_de_comando",
  result: ResumeResult
): Promise<ResumeResult> {
  if (via === "painel") {
    await postSessionActionFeedback(sessionId, result.ok ? result.message : `⚠️ ${result.message}`);
  }
  return result;
}

export function textoDeRetomarComBloqueio(
  blocked: Array<{ title: string; payload: string | null; result?: string | null }>
): string {
  const porMicrobrief = blocked.filter((task) => escopoMicrobriefAindaImpede(task));
  if (porMicrobrief.length > 0 && porMicrobrief.length === blocked.length) {
    return (
      `Há ${blocked.length} etapa(s) bloqueada(s) (ex.: "${blocked[0].title}") porque o critério nomeia arquivo ou símbolo que o microbrief não lista. ` +
      "Re-tentar a etapa segue quando essa checagem passar. A Spec não precisa ser aprovada de novo."
    );
  }
  return (
    `Há ${blocked.length} etapa(s) bloqueada(s) (ex.: "${blocked[0].title}") por um contrato que ainda não fecha. ` +
    "A Spec precisa ser aprovada de novo. Re-tentar a etapa não corrige isso."
  );
}

export async function resumeBlockedSession(sessionId: string, via: "painel" | "chat" | "linha_de_comando"): Promise<ResumeResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true, specVersion: true },
  });
  if (!session) {
    return finishResumeFeedback(sessionId, via, { ok: false, message: "Sessão não encontrada." });
  }
  if (session.phase === "SPEC_REVISAO") {
    return finishResumeFeedback(sessionId, via, {
      ok: true,
      phase: "SPEC_REVISAO",
      message:
        "A sessão já está em **revisão da Spec** (SPEC_REVISAO). Não é preciso retomar de novo — abra **Spec T1** no topo, confira o texto e **aprove** para replanejar (ex.: após reprovação T8b).",
    });
  }
  if (session.phase !== "BLOQUEADA") {
    return finishResumeFeedback(sessionId, via, {
      ok: false,
      message: `A sessão não está bloqueada (fase atual: ${session.phase}); nada a retomar.`,
      phase: session.phase as Phase,
    });
  }
  let skippedRepairs = false;
  let releasedStaleContract = false;
  let continuedQueue = false;
  const blocked = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: session.specVersion, status: "blocked" },
    select: { id: true, title: true, payload: true, result: true, failureHistory: true },
  });
  const pendingCount = await prisma.taskNode.count({
    where: { sessionId, specVersion: session.specVersion, status: "pending" },
  });
  const lastBlock = await prisma.telemetryLog.findFirst({
    where: { sessionId, action: "PHASE_TRANSITION", details: { contains: '"to":"BLOQUEADA"' } },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  continuedQueue = resumeContinuesPendingQueue(blockEventFromTransition(lastBlock?.details ?? null), pendingCount);
  if (blocked.length > 0 && !continuedQueue) {
    const skip = await skipBlockedRepairsWhenRestComplete(sessionId, session.specVersion);
    if (skip.skipped) {
      skippedRepairs = true;
    } else if (canReleaseStaleContractBlocks(blocked)) {
      for (const task of blocked) {
        await prisma.taskNode.update({
          where: { id: task.id },
          data: { status: "pending", attempts: 0, failureHistory: "[]" },
        });
      }
      releasedStaleContract = true;
      TelemetryLogger.log({
        sessionId,
        action: "STALE_CONTRACT_BLOCKS_RELEASED",
        details: { via, count: blocked.length, titles: blocked.map((t) => t.title).slice(0, 5) },
      });
    } else if (canRetryExhaustedCodeOnResume(blocked)) {
      const culprit = pickBlockedCulprit(blocked);
      if (!culprit) {
        return finishResumeFeedback(sessionId, via, {
          ok: false,
          message: "Não há etapa com falha própria para re-tentar.",
        });
      }
      const retried = await retryNodeAndCascade(culprit.id, via === "linha_de_comando" ? "linha_de_comando" : "painel");
      return finishResumeFeedback(sessionId, via, retried);
    } else {
      return finishResumeFeedback(sessionId, via, {
        ok: false,
        message: textoDeRetomarComBloqueio(blocked),
      });
    }
  }

  TelemetryLogger.log({ sessionId, action: "SESSION_RESUMED_BY_HUMAN", details: { via, skippedRepairs } });
  const res = await applyPhaseEvent(sessionId, { type: "DESBLOQUEIO_HUMANO" });
  if (!res.ok) {
    return finishResumeFeedback(sessionId, via, { ok: false, message: `Não foi possível retomar: ${res.reason}.` });
  }
  const phase = res.ctx.phase;
  if (phaseInExecucaoFamilia(phase)) {
    await restoreSpecApprovalIfExecutionContinues(sessionId, session.specVersion);
  }
  if (res.effects.some((e) => e.type === "RETOMAR_EXECUCAO")) {
    await enqueueSessionQueueJob(sessionId);
  }
  return finishResumeFeedback(sessionId, via, {
    ok: true,
    phase,
    message: continuedQueue
      ? `▶️ Sessão retomada. A fila segue nas etapas pendentes.${keptBlockedNote(blocked, blocked.map((task) => task.id))} A Spec não mudou.`
      : releasedStaleContract
      ? `▶️ Sessão retomada. ${blocked.length} etapa(s) tinham parado num cheque de contrato que o harness já não reproduz. A fila segue. A Spec não mudou.`
      : resumeSuccessMessage(phase, skippedRepairs),
  });
}

/**
 * Mudança 40: reabre uma sessão ENTREGUE para a verificação final rodar de novo, sem mudar a Spec nem as
 * etapas — uso: entrega feita antes de a revisão final (J3) funcionar, ou projeto mexido fora do NextCode.
 * As rodadas de reparo continuam contando (máx. 3 por versão da Spec, regra das 3 tentativas).
 */
export async function reopenDeliveredSession(
  sessionId: string,
  via: "painel" | "chat" | "linha_de_comando",
  motivo: string
): Promise<ResumeResult> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { phase: true } });
  if (!session) return { ok: false, message: "Sessão não encontrada." };
  if (session.phase !== "ENTREGUE") {
    return { ok: false, message: `Só uma sessão ENTREGUE pode ser reaberta (fase atual: ${session.phase}).` };
  }
  TelemetryLogger.log({ sessionId, action: "DELIVERY_REOPENED_BY_HUMAN", details: { via, motivo } });
  const res = await applyPhaseEvent(sessionId, { type: "REABRIR_ENTREGA" }, { extraDetails: { via, motivo } });
  if (!res.ok) return { ok: false, message: `Não foi possível reabrir: ${res.reason}.` };
  await prisma.message.create({
    data: {
      sessionId,
      role: "assistant",
      content:
        `🔁 **Entrega reaberta para nova verificação final** (${motivo}).\n\n` +
        "Nada muda na Spec. A verificação roda de novo (arquivos, requisitos, type-check e revisão final cega); " +
        "o que ela reprovar vira reparo automático das etapas donas, dentro do limite de 3 rodadas.",
    },
  });
  await enqueueSessionQueueJob(sessionId);
  return { ok: true, message: "Entrega reaberta: a verificação final roda de novo." };
}


function parseDependencyIds(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Porta da fatia 1: grava "vale o contrato" ou "vale o critério" e, se a etapa pode voltar,
 * destrava só a fase da sessão e põe a fila para pegar essa etapa.
 * Não zera tentativas de outras etapas e não libera quem tem falha própria.
 */
export async function aplicarEscolhaHumanaPedidoUnico(
  nodeId: string,
  escolha: string
): Promise<ResumeResult & { statusEtapa?: string; decisao?: string }> {
  const dec = normalizarDecisaoPedidoUnico(escolha);
  if (!dec) {
    return {
      ok: false,
      message: 'Escolha inválida. Use "vale o contrato" ou "vale o critério".',
    };
  }

  const task = await prisma.taskNode.findUnique({
    where: { id: nodeId },
    include: { session: true },
  });
  if (!task) return { ok: false, message: "Etapa não encontrada." };

  let resultObj: { erro?: string } | null = null;
  try {
    resultObj = task.result ? (JSON.parse(task.result) as { erro?: string }) : null;
  } catch {
    resultObj = null;
  }
  if (resultObj?.erro === "SKILL_PEDIDO_UNICO_INVALIDA") {
    return {
      ok: false,
      message:
        "A etapa não executa porque a skill pedido-unico não carregou. Essa escolha não libera a etapa.",
    };
  }

  if (!etapaBloqueadaPorPedidoUnicoSemResolucao(task, task.session?.canonicalSpec)) {
    return {
      ok: false,
      message: `A etapa "${task.title}" não está parada por conflito de pedido único.`,
    };
  }

  if (dec.normalizada === "vale_contrato") {
    const registrado = await registrarEscolhaPedidoUnico(nodeId, dec.rotulo);
    if (!registrado.ok) return { ok: false, message: registrado.message };
  } else {
    const estado = lerEstadoPedidoUnico(task.payload);
    if (estado?.decisaoNormalizada !== "vale_criterio") {
      const registrado = await registrarEscolhaPedidoUnico(nodeId, dec.rotulo, {
        alargarContratoNaSessao: false,
      });
      if (!registrado.ok) return { ok: false, message: registrado.message };
    }
    const alargado = await alargarContratoDaSessaoAposEscolha(nodeId);
    if (!alargado.ok) return { ok: false, message: alargado.message };
  }

  const after = await prisma.taskNode.findUnique({ where: { id: nodeId }, select: { status: true } });
  const session = await prisma.session.findUnique({
    where: { id: task.sessionId },
    select: { phase: true },
  });
  let statusEtapa = after?.status ?? "blocked";

  const tentativasJaUsadas = task.attempts || 0;
  const teto = task.maxAttempts || 3;
  if (statusEtapa === "pending" && tentativasJaUsadas >= teto) {
    await prisma.taskNode.update({
      where: { id: task.id },
      data: { status: "blocked" },
    });
    statusEtapa = "blocked";
    const message =
      dec.normalizada === "vale_contrato"
        ? `Decisão registrada: vale o contrato. O critério continua no registro e saiu do pedido desta etapa. A etapa "${task.title}" já usou as ${tentativasJaUsadas} tentativas e não volta à fila por esta escolha. Re-tentar só esta etapa. Etapas com falha própria continuam bloqueadas.`
        : `Decisão registrada: vale o critério. O contrato guardado na sessão passou a exigir o campo na função do critério. A etapa "${task.title}" já usou as ${tentativasJaUsadas} tentativas e não volta à fila por esta escolha. Re-tentar só esta etapa. Nenhum arquivo do projeto alvo foi editado. Etapas com falha própria continuam bloqueadas.`;
    await postSessionActionFeedback(task.sessionId, message);
    return { ok: true, message, statusEtapa, decisao: dec.rotulo, phase: session?.phase as Phase | undefined };
  }

  if (statusEtapa !== "pending") {
    const message =
      `Decisão registrada: ${dec.rotulo}. A etapa "${task.title}" continua sem executor ` +
      "até o texto do contrato guardado na sessão nomear os campos.";
    await postSessionActionFeedback(task.sessionId, message);
    return { ok: true, message, statusEtapa, decisao: dec.rotulo, phase: session?.phase as Phase | undefined };
  }

  if (session?.phase === "BLOQUEADA") {
    const unlock = await applyPhaseEvent(task.sessionId, { type: "DESBLOQUEIO_HUMANO" });
    if (!unlock.ok) {
      const message = `A escolha foi gravada e a etapa voltou a pending, mas a sessão não saiu de BLOQUEADA (${unlock.reason ?? "recusa da fase"}).`;
      await postSessionActionFeedback(task.sessionId, message);
      return { ok: false, message, statusEtapa, decisao: dec.rotulo };
    }
  }

  await enqueueSessionQueueJob(task.sessionId);
  const message =
    dec.normalizada === "vale_contrato"
      ? `Decisão registrada: vale o contrato. A etapa "${task.title}" voltou à fila. O critério continua no registro e saiu do pedido desta etapa. Etapas com falha própria continuam bloqueadas.`
      : `Decisão registrada: vale o critério. O contrato guardado na sessão passou a nomear os campos. A etapa "${task.title}" voltou à fila. Nenhum arquivo do projeto alvo foi editado. Etapas com falha própria continuam bloqueadas.`;
  await postSessionActionFeedback(task.sessionId, message);
  const afterSession = await prisma.session.findUnique({
    where: { id: task.sessionId },
    select: { phase: true },
  });
  return {
    ok: true,
    message,
    statusEtapa,
    decisao: dec.rotulo,
    phase: afterSession?.phase as Phase | undefined,
  };
}

/**
 * Re-tentar uma etapa: zera as tentativas dela e das que só caíram em cascata.
 * Etapa com falha própria fora desse conjunto continua bloqueada.
 * Se a última rejeição crítica já aponta arquivo de outra etapa concluída, essa dona volta à fila
 * e esta espera — sem nova tentativa antes disso.
 * Mudança 44: etapa de reparo tem o escopo recalculado pela regra atual antes de voltar à fila.
 */
export async function retryNodeAndCascade(
  nodeId: string,
  via: "painel" | "linha_de_comando"
): Promise<ResumeResult & { escopoAmpliado?: string[] }> {
  const sessionRow = await prisma.taskNode.findUnique({
    where: { id: nodeId },
    select: { sessionId: true },
  });
  const sessionBeforeUnblock = sessionRow
    ? await prisma.session.findUnique({
        where: { id: sessionRow.sessionId },
        select: { phase: true, specVersion: true, canonicalSpec: true },
      })
    : null;
  if (sessionBeforeUnblock?.canonicalSpec != null) {
    await persistirReconciliacaoPedidoUnicoObsoleto(nodeId, sessionBeforeUnblock.canonicalSpec);
  } else if (sessionRow) {
    await persistirReconciliacaoPedidoUnicoObsoleto(nodeId, null);
  }

  const targetTask = await prisma.taskNode.findUnique({ where: { id: nodeId } });
  if (!targetTask) {
    return { ok: false, message: "Nó não encontrado", motivo: "no_nao_encontrado" };
  }
  if (escopoMicrobriefAindaImpede(targetTask)) {
    return {
      ok: false,
      motivo: "escopo_microbrief",
      message:
        `A etapa "${targetTask.title}" não volta à fila: o critério nomeia arquivo ou símbolo produzido que o microbrief não lista.`,
    };
  }
  if (etapaBloqueadaPorPedidoUnicoSemResolucao(targetTask, sessionBeforeUnblock?.canonicalSpec)) {
    const estadoPu = lerEstadoPedidoUnico(targetTask.payload);
    if (estadoPu?.decisaoNormalizada === "vale_criterio") {
      return {
        ok: false,
        motivo: "vale_criterio_contrato_incompleto",
        message:
          `A etapa "${targetTask.title}" escolheu "vale o critério" e continua sem executor até o texto do contrato guardado na sessão nomear os campos (${estadoPu.camposFaltantes.join(", ")}).`,
      };
    }
    return {
      ok: false,
      motivo: "pedido_unico_aberto",
      message:
        `A etapa "${targetTask.title}" tem conflito de pedido único e não volta à fila sem a escolha explícita entre "vale o contrato" ou "vale o critério".`,
    };
  }
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
        unblockedVia: cascade ? `cascata de ${nodeId}` : via === "painel" ? "retry_node" : "retry_node_cli",
      },
    });
  logHumanUnblock(targetTask, false);

  const { rescopeRepairNode } = await import("@/core/orchestrator/delivery-repair");
  const escopoAmpliado = await rescopeRepairNode(nodeId);

  const sessionTasks = await prisma.taskNode.findMany({
    where: { sessionId: targetTask.sessionId, specVersion: currentSpecVersion },
  });
  const views = sessionTasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    filesScope: parseStageFiles(task.filesScope),
    dependencies: parseDependencyIds(task.dependencies),
    payload: task.payload,
    failureHistory: task.failureHistory,
  }));
  const plan = planBlockedRetryRelease(nodeId, views);
  const scopeNote = escopoAmpliado.length
    ? ` Escopo do reparo ampliado com ${escopoAmpliado.join(", ")} (citados nos defeitos).`
    : "";
  const keptNote = keptBlockedNote(views, plan.keptBlockedIds);

  const finish = async (message: string) => {
    if (sessionBeforeUnblock?.phase === "BLOQUEADA") {
      await applyPhaseEvent(targetTask.sessionId, { type: "DESBLOQUEIO_HUMANO" });
    }
    await enqueueSessionQueueJob(targetTask.sessionId);
    return { ok: true as const, escopoAmpliado, message };
  };

  if (plan.reopen) {
    const owner = sessionTasks.find((task) => task.id === plan.reopen!.ownerId);
    const culprit = sessionTasks.find((task) => task.id === nodeId);
    const ownerPayload = owner
      ? withOwnerReopenRequest(owner.payload, {
          fromStageId: nodeId,
          fromStageTitle: culprit?.title ?? targetTask.title,
          citedFiles: plan.reopen.citedFiles,
          defectKey: plan.reopen.defectKey,
          defectText: plan.reopen.defectText,
        })
      : null;
    const waiterPayload = culprit ? withOwnerReopenHold(culprit.payload, plan.reopen) : null;
    if (owner && culprit && ownerPayload && waiterPayload) {
      await prisma.taskNode.update({
        where: { id: owner.id },
        data: { status: "pending", attempts: 0, payload: ownerPayload },
      });
      await prisma.taskNode.update({
        where: { id: nodeId },
        data: {
          status: "pending",
          attempts: 0,
          failureHistory: "[]",
          payload: waiterPayload,
          dependencies: appendOwnerDependency(culprit.dependencies, owner.id),
        },
      });
      for (const id of plan.releaseIds) {
        if (id === nodeId) continue;
        const task = sessionTasks.find((item) => item.id === id);
        if (!task || task.status !== "blocked") continue;
        logHumanUnblock(task, true);
        await prisma.taskNode.update({
          where: { id },
          data: { status: "pending", attempts: 0, failureHistory: "[]" },
        });
      }
      TelemetryLogger.log({
        sessionId: targetTask.sessionId,
        action: "OWNER_STAGE_REOPENED",
        details: {
          nodeId,
          ownerId: owner.id,
          citedFiles: plan.reopen.citedFiles,
          defectKey: plan.reopen.defectKey,
          via: "retomada",
        },
      });
      return finish(
        `Etapa "${targetTask.title}" espera "${owner.title}". ` +
          `O defeito crítico cita ${plan.reopen.citedFiles.join(", ")}, arquivo dessa etapa. ` +
          `Ela voltou à fila uma vez. Nenhuma tentativa nova foi gasta aqui.` +
          keptNote +
          scopeNote
      );
    }
  }

  for (const id of plan.releaseIds) {
    const task = sessionTasks.find((item) => item.id === id);
    if (!task) continue;
    if (id !== nodeId && task.status !== "blocked") continue;
    if (id !== nodeId) logHumanUnblock(task, true);
    await prisma.taskNode.update({
      where: { id },
      data: { status: "pending", attempts: 0, failureHistory: "[]" },
    });
  }
  const cascadeCount = plan.releaseIds.filter((id) => id !== nodeId).length;
  const cascadeNote =
    cascadeCount > 0 ? ` ${cascadeCount} etapa(s) que só dependiam dela também voltaram à fila.` : "";
  return finish(`Etapa "${targetTask.title}" voltou à fila.${cascadeNote}${keptNote}${scopeNote}`);
}

/** Mudança 43.4: "autorizar rodada" digitado sozinho no chat. */
export function isAuthorizeRoundCommand(text: string): boolean {
  return /^\s*autorizar\s+(mais\s+uma\s+)?rodada\s*[.!]?\s*$/i.test(text);
}

/**
 * Mudança 43.4: o fundador autoriza mais UMA rodada de reparo depois das 3 automáticas — só quando a
 * sessão parou por `REPARO_ESGOTADO` (defeitos de código com dona; a Spec está certa). Cada autorização
 * fica na trilha (`REPAIR_ROUND_AUTHORIZED`) e soma 1 ao limite; a verificação final roda de novo e o
 * que ela reprovar abre a rodada nova.
 */
export async function authorizeRepairRound(sessionId: string, via: "painel" | "chat" | "linha_de_comando"): Promise<ResumeResult> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { phase: true } });
  if (!session) return finishResumeFeedback(sessionId, via, { ok: false, message: "Sessão não encontrada." });
  if (session.phase !== "BLOQUEADA") {
    return finishResumeFeedback(sessionId, via, {
      ok: false,
      message: `A sessão não está bloqueada (fase atual: ${session.phase}); não há rodada a autorizar.`,
    });
  }
  const lastBlock = await prisma.telemetryLog.findFirst({
    where: { sessionId, action: "PHASE_TRANSITION", details: { contains: '"to":"BLOQUEADA"' } },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  if (!lastBlock?.details?.includes('"type":"REPARO_ESGOTADO"')) {
    return finishResumeFeedback(sessionId, via, {
      ok: false,
      message:
        "Rodada extra só vale quando a sessão parou porque as rodadas de reparo acabaram com defeitos de código. Este bloqueio tem outra causa — use **Retomar** (ou escreva `retomar` no chat), não autorizar rodada.",
    });
  }
  await TelemetryLogger.logAndWait({ sessionId, action: "REPAIR_ROUND_AUTHORIZED", details: { via } });
  const res = await applyPhaseEvent(sessionId, { type: "DESBLOQUEIO_HUMANO" });
  if (!res.ok) {
    return finishResumeFeedback(sessionId, via, { ok: false, message: `Não foi possível retomar: ${res.reason}.` });
  }
  if (res.effects.some((e) => e.type === "RETOMAR_EXECUCAO")) await enqueueSessionQueueJob(sessionId);
  return finishResumeFeedback(sessionId, via, {
    ok: true,
    phase: res.ctx.phase,
    message: "▶️ Mais uma rodada de reparo autorizada: a verificação final roda de novo e o que ela reprovar abre a rodada.",
  });
}
