import prisma from "@/lib/prisma";
import {
  transition,
  type Phase,
  type PhaseContext,
  type PhaseEvent,
  type TransitionResult,
} from "@/core/orchestrator/phase-machine";

export type PersistedPhaseContextData = Omit<PhaseContext, "phase">;

/**
 * Reconstrói o PhaseContext completo a partir de Session.phase e Session.phaseContext (JSON sem o campo phase).
 */
export function parseSessionPhaseContext(
  phase: string | null | undefined,
  phaseContextRaw: string | null | undefined
): PhaseContext {
  let parsed: Partial<PersistedPhaseContextData> = {};
  if (phaseContextRaw) {
    try {
      const obj = JSON.parse(phaseContextRaw);
      if (obj && typeof obj === "object") {
        parsed = obj as Partial<PersistedPhaseContextData>;
      }
    } catch {
      parsed = {};
    }
  }

  const ctx: PhaseContext = {
    phase: ((phase as Phase) || "ENTRADA"),
    rodadasSemClareza:
      typeof parsed.rodadasSemClareza === "number" ? parsed.rodadasSemClareza : 0,
    voltasConferencia:
      typeof parsed.voltasConferencia === "number" ? parsed.voltasConferencia : 0,
  };

  if (parsed.faseAntesDaPausa) {
    ctx.faseAntesDaPausa = parsed.faseAntesDaPausa;
  }
  if (parsed.faseAntesDoBloqueio) {
    ctx.faseAntesDoBloqueio = parsed.faseAntesDoBloqueio;
  }

  return ctx;
}

/**
 * Serializa PhaseContext sem o campo phase para persistir em Session.phaseContext.
 */
export function serializeSessionPhaseContext(ctx: PhaseContext): string {
  const data: PersistedPhaseContextData = {
    rodadasSemClareza: ctx.rodadasSemClareza,
    voltasConferencia: ctx.voltasConferencia,
    ...(ctx.faseAntesDaPausa ? { faseAntesDaPausa: ctx.faseAntesDaPausa } : {}),
    ...(ctx.faseAntesDoBloqueio ? { faseAntesDoBloqueio: ctx.faseAntesDoBloqueio } : {}),
  };
  return JSON.stringify(data);
}

export interface ApplyPhaseEventOptions {
  /** Metadados extras gravados em PHASE_TRANSITION (ex.: specCompleteness em VERIFICACAO_OK). */
  extraDetails?: Record<string, unknown>;
  /**
   * Em caso de conflito otimista (count === 0), se a nova fase lida estiver nesta lista,
   * interrompe a re-tentativa sem gerar PHASE_TRANSITION_REFUSED (usado em chamadas concorrentes
   * idempotentes de approveSpecAndStart).
   */
  stopRetryIfPhaseIn?: Phase[];
}

/**
 * Aplica um evento de fase na sessão persistida com controle otimista e trilha append-only:
 * - lê a fase atual e chama transition(ctx, event, { etapa1Ativa: false });
 * - grava com controle otimista: updateMany where { id, phase: <fase lida> } (e phaseContext lido);
 * - se count === 0, relê e tenta UMA vez; se falhar de novo, retorna recusado;
 * - grava com await um TelemetryLog "PHASE_TRANSITION" { from, to, event, effects } ou
 *   "PHASE_TRANSITION_REFUSED" { phase, event, reason }.
 */
export async function applyPhaseEvent(
  sessionId: string,
  event: PhaseEvent,
  options?: ApplyPhaseEventOptions
): Promise<TransitionResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, phase: true, phaseContext: true },
    });

    if (!session) {
      const reason = `Sessão ${sessionId} não encontrada`;
      await prisma.telemetryLog.create({
        data: {
          sessionId,
          action: "PHASE_TRANSITION_REFUSED",
          details: JSON.stringify({ phase: "ENTRADA", event, reason }),
          durationMs: 0,
        },
      });
      return {
        ok: false,
        reason,
        allowedEvents: [],
      };
    }

    const ctx = parseSessionPhaseContext(session.phase, session.phaseContext);

    if (options?.stopRetryIfPhaseIn?.includes(ctx.phase)) {
      return {
        ok: false,
        reason: "CONCURRENT_PHASE_CHANGED",
        allowedEvents: [],
      };
    }

    const result = transition(ctx, event, { etapa1Ativa: false });

    if (!result.ok) {
      await prisma.telemetryLog.create({
        data: {
          sessionId,
          action: "PHASE_TRANSITION_REFUSED",
          details: JSON.stringify({
            phase: ctx.phase,
            event,
            reason: result.reason,
          }),
          durationMs: 0,
        },
      });
      return result;
    }

    const nextPhaseContext = serializeSessionPhaseContext(result.ctx);
    const updated = await prisma.session.updateMany({
      where: {
        id: sessionId,
        phase: session.phase,
        phaseContext: session.phaseContext,
      },
      data: {
        phase: result.ctx.phase,
        phaseContext: nextPhaseContext,
      },
    });

    if (updated.count === 1) {
      await prisma.telemetryLog.create({
        data: {
          sessionId,
          action: "PHASE_TRANSITION",
          details: JSON.stringify({
            from: ctx.phase,
            to: result.ctx.phase,
            event,
            effects: result.effects,
            ...(options?.extraDetails ?? {}),
          }),
          durationMs: 0,
        },
      });
      return result;
    }
  }

  // Se o controle otimista falhou nas duas tentativas (count === 0 nas duas), registra recusa e retorna
  const finalSession = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true },
  });
  const currentPhase = (finalSession?.phase as Phase) || "ENTRADA";
  const reason = `Conflito de concorrência otimista ao aplicar evento "${event.type}" na fase ${currentPhase}`;
  await prisma.telemetryLog.create({
    data: {
      sessionId,
      action: "PHASE_TRANSITION_REFUSED",
      details: JSON.stringify({
        phase: currentPhase,
        event,
        reason,
      }),
      durationMs: 0,
    },
  });

  return {
    ok: false,
    reason,
    allowedEvents: [],
  };
}
