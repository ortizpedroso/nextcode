import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";

export interface ResumeResult {
  ok: boolean;
  message: string;
}

/** Mudança 36: "retomar" digitado sozinho no chat (com ou sem pontuação). */
export function isResumeCommand(text: string): boolean {
  return /^\s*retomar\s*[.!]?\s*$/i.test(text);
}

/**
 * Mudança 36: retoma uma sessão BLOQUEADA sem mexer na Spec nem nas etapas — para bloqueios cuja causa
 * não está no pedido (ambiente, erro interno, silêncio, avaliador fora). Etapa bloqueada usa Re-tentar
 * (zera as tentativas dela); aqui não se apaga histórico de ninguém.
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
  const blocked = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: session.specVersion, status: "blocked" },
    select: { title: true },
  });
  if (blocked.length > 0) {
    return {
      ok: false,
      message:
        `Há ${blocked.length} etapa(s) bloqueada(s) (ex.: "${blocked[0].title}"): use **Re-tentar** na etapa no painel da DAG, ` +
        "ou responda no chat o que ajustar na Spec.",
    };
  }

  TelemetryLogger.log({ sessionId, action: "SESSION_RESUMED_BY_HUMAN", details: { via } });
  const res = await applyPhaseEvent(sessionId, { type: "DESBLOQUEIO_HUMANO" });
  if (!res.ok) return { ok: false, message: `Não foi possível retomar: ${res.reason}.` };
  if (res.effects.some((e) => e.type === "RETOMAR_EXECUCAO")) {
    await enqueueSessionQueueJob(sessionId);
    return { ok: true, message: "Sessão retomada: a execução continua de onde parou (a verificação final roda de novo)." };
  }
  return { ok: true, message: `Sessão retomada na fase ${res.ctx.phase}.` };
}
