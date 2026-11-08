import prisma from "@/lib/prisma";
import {
  applyPhaseEvent,
  parseSessionPhaseContext,
  serializeSessionPhaseContext,
} from "@/core/orchestrator/session-phase";

/**
 * Após T8b reprovar o plano: revoga Trava T1 no DB e leva a sessão a BLOQUEADA
 * (mesmo se a transição otimista de fase falhar).
 */
export async function finalizePlanoReprovadoSession(sessionId: string, detalheAviso: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { specApproved: false },
  });

  const res = await applyPhaseEvent(
    sessionId,
    { type: "PLANO_REPROVADO" },
    { detalheAviso, acaoHumano: "reaprovar_trava_t1" }
  );
  if (res.ok) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true, phaseContext: true },
  });
  if (!session || session.phase === "BLOQUEADA" || session.phase === "SPEC_REVISAO") return;

  const ctx = parseSessionPhaseContext(session.phase, session.phaseContext);
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      phase: "BLOQUEADA",
      phaseContext: serializeSessionPhaseContext({
        ...ctx,
        phase: "BLOQUEADA",
        faseAntesDoBloqueio: "SPEC_REVISAO",
      }),
      specApproved: false,
    },
  });

  await prisma.telemetryLog.create({
    data: {
      sessionId,
      action: "PHASE_TRANSITION",
      details: JSON.stringify({
        from: session.phase,
        to: "BLOQUEADA",
        event: { type: "PLANO_REPROVADO" },
        effects: [],
        forcedAfterRefused: true,
        priorReason: res.ok ? undefined : res.reason,
      }),
      durationMs: 0,
    },
  });
}
