import prisma from "@/lib/prisma";
import type { TaskNode } from "@prisma/client";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";
import { readRepairPayload } from "@/core/orchestrator/repair-payload";

export interface ResumeResult {
  ok: boolean;
  message: string;
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
export async function resumeBlockedSession(sessionId: string, via: "painel" | "chat" | "linha_de_comando"): Promise<ResumeResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true, specVersion: true },
  });
  if (!session) return { ok: false, message: "Sessão não encontrada." };
  if (session.phase !== "BLOQUEADA") {
    return { ok: false, message: `A sessão não está bloqueada (fase atual: ${session.phase}); nada a retomar.` };
  }
  let skippedRepairs = false;
  const blocked = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: session.specVersion, status: "blocked" },
    select: { title: true },
  });
  if (blocked.length > 0) {
    const skip = await skipBlockedRepairsWhenRestComplete(sessionId, session.specVersion);
    if (!skip.skipped) {
      return {
        ok: false,
        message:
          `Há ${blocked.length} etapa(s) bloqueada(s) (ex.: "${blocked[0].title}"): use **Re-tentar** na etapa no painel da DAG, ` +
          "ou responda no chat o que ajustar na Spec.",
      };
    }
    skippedRepairs = true;
  }

  TelemetryLogger.log({ sessionId, action: "SESSION_RESUMED_BY_HUMAN", details: { via, skippedRepairs } });
  const res = await applyPhaseEvent(sessionId, { type: "DESBLOQUEIO_HUMANO" });
  if (!res.ok) return { ok: false, message: `Não foi possível retomar: ${res.reason}.` };
  if (res.effects.some((e) => e.type === "RETOMAR_EXECUCAO")) {
    await enqueueSessionQueueJob(sessionId);
    if (skippedRepairs) {
      return {
        ok: true,
        message:
          "Sessão retomada: reparo(s) bloqueado(s) encerrado(s) — a verificação final (T10) roda sobre o código no disco.",
      };
    }
    return { ok: true, message: "Sessão retomada: a execução continua de onde parou (a verificação final roda de novo)." };
  }
  return { ok: true, message: `Sessão retomada na fase ${res.ctx.phase}.` };
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


/**
 * Re-tentar uma etapa (painel "Re-tentar" ou linha de comando): zera as tentativas dela e das bloqueadas em
 * cascata, desbloqueia a sessão e põe na fila. Mudança 44: etapa de reparo tem o escopo recalculado pela
 * regra atual (arquivos de código citados nos defeitos) antes de voltar à fila.
 */
export async function retryNodeAndCascade(
  nodeId: string,
  via: "painel" | "linha_de_comando"
): Promise<ResumeResult & { escopoAmpliado?: string[] }> {
  const targetTask = await prisma.taskNode.findUnique({ where: { id: nodeId } });
  if (!targetTask) return { ok: false, message: "Nó não encontrado" };
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
        unblockedVia: cascade ? `cascata de ${nodeId}` : via === "painel" ? "retry_node" : "retry_node_cli",
      },
    });
  logHumanUnblock(targetTask, false);

  const { rescopeRepairNode } = await import("@/core/orchestrator/delivery-repair");
  const escopoAmpliado = await rescopeRepairNode(nodeId);
  await prisma.taskNode.update({ where: { id: nodeId }, data: { status: "pending", attempts: 0, failureHistory: "[]" } });

  const sessionTasks = await prisma.taskNode.findMany({
    where: { sessionId: targetTask.sessionId, specVersion: currentSpecVersion },
  });
  for (const task of sessionTasks) {
    if (task.status === "blocked") {
      logHumanUnblock(task, true);
      await prisma.taskNode.update({ where: { id: task.id }, data: { status: "pending", attempts: 0, failureHistory: "[]" } });
    }
  }
  if (sessionBeforeUnblock?.phase === "BLOQUEADA") {
    await applyPhaseEvent(targetTask.sessionId, { type: "DESBLOQUEIO_HUMANO" });
  }
  await enqueueSessionQueueJob(targetTask.sessionId);
  return {
    ok: true,
    escopoAmpliado,
    message:
      `Nó "${targetTask.title}" e nós bloqueados em cascata foram liberados para re-tentativa.` +
      (escopoAmpliado.length ? ` Escopo do reparo ampliado com ${escopoAmpliado.join(", ")} (citados nos defeitos).` : ""),
  };
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
  if (!session) return { ok: false, message: "Sessão não encontrada." };
  if (session.phase !== "BLOQUEADA") {
    return { ok: false, message: `A sessão não está bloqueada (fase atual: ${session.phase}); não há rodada a autorizar.` };
  }
  const lastBlock = await prisma.telemetryLog.findFirst({
    where: { sessionId, action: "PHASE_TRANSITION", details: { contains: '"to":"BLOQUEADA"' } },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  if (!lastBlock?.details?.includes('"type":"REPARO_ESGOTADO"')) {
    return {
      ok: false,
      message:
        "Rodada extra só vale quando a sessão parou porque as rodadas de reparo acabaram com defeitos de código. Este bloqueio tem outra causa — veja o aviso no chat (Retomar, Re-tentar ou ajuste da Spec).",
    };
  }
  // Estado lido depois (authorizedExtraRounds soma ao limite): grava esperando, não em segundo plano.
  await TelemetryLogger.logAndWait({ sessionId, action: "REPAIR_ROUND_AUTHORIZED", details: { via } });
  const res = await applyPhaseEvent(sessionId, { type: "DESBLOQUEIO_HUMANO" });
  if (!res.ok) return { ok: false, message: `Não foi possível retomar: ${res.reason}.` };
  if (res.effects.some((e) => e.type === "RETOMAR_EXECUCAO")) await enqueueSessionQueueJob(sessionId);
  return { ok: true, message: "Mais uma rodada de reparo autorizada: a verificação final roda de novo e o que ela reprovar abre a rodada." };
}
