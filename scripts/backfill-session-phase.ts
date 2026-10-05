import prisma from "../src/lib/prisma";
import type { Phase } from "../src/core/orchestrator/phase-machine";
import { serializeSessionPhaseContext } from "../src/core/orchestrator/session-phase";

export async function backfillSessionPhases(
  sessionIds?: string[]
): Promise<Record<Phase, number>> {
  const sessions = await prisma.session.findMany({
    ...(sessionIds && sessionIds.length > 0
      ? { where: { id: { in: sessionIds } } }
      : {}),
    include: {
      tasks: {
        select: { status: true },
      },
    },
  });

  const counts: Record<Phase, number> = {
    ENTRADA: 0,
    CONVERSA: 0,
    INTERVENCAO: 0,
    ELICITACAO: 0,
    ELICITACAO_CORRECAO: 0,
    SPEC_REVISAO: 0,
    MACROBRIEF: 0,
    CONFERENCIA: 0,
    PLANEJAMENTO: 0,
    EXECUCAO: 0,
    PAUSADA: 0,
    BLOQUEADA: 0,
    VERIFICACAO: 0,
    ENTREGUE: 0,
  };

  for (const session of sessions) {
    const tasks = session.tasks;
    let targetPhase: Phase = "ENTRADA";
    let faseAntesDoBloqueio: Phase | undefined = undefined;

    if (session.specApproved && tasks.length > 0 && tasks.every((t) => t.status === "completed")) {
      targetPhase = "ENTREGUE";
    } else if (session.specApproved && tasks.some((t) => t.status === "blocked")) {
      targetPhase = "BLOQUEADA";
      faseAntesDoBloqueio = "EXECUCAO";
    } else if (
      session.specApproved &&
      tasks.some((t) => t.status === "pending" || t.status === "failed" || t.status === "running")
    ) {
      targetPhase = "EXECUCAO";
    } else if (Boolean(session.canonicalSpec && session.canonicalSpec.trim()) && !session.specApproved) {
      targetPhase = "SPEC_REVISAO";
    } else {
      targetPhase = "ENTRADA";
    }

    const phaseContext = serializeSessionPhaseContext({
      phase: targetPhase,
      rodadasSemClareza: 0,
      voltasConferencia: 0,
      ...(faseAntesDoBloqueio ? { faseAntesDoBloqueio } : {}),
    });

    const updated = await prisma.session.updateMany({
      where: { id: session.id },
      data: {
        phase: targetPhase,
        phaseContext,
      },
    });

    if (updated.count > 0) {
      counts[targetPhase] += 1;
    }
  }

  return counts;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/backfill-session-phase.ts");
if (isMain) {
  backfillSessionPhases()
    .then((counts) => {
      console.log("=== Backfill de Session.phase concluído ===");
      for (const [phase, count] of Object.entries(counts)) {
        if (count > 0 || ["ENTRADA", "SPEC_REVISAO", "EXECUCAO", "BLOQUEADA", "ENTREGUE"].includes(phase)) {
          console.log(`${phase}: ${count}`);
        }
      }
      console.log("Total de sessões:", Object.values(counts).reduce((a, b) => a + b, 0));
    })
    .catch((err) => {
      console.error("Erro no backfill de Session.phase:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
