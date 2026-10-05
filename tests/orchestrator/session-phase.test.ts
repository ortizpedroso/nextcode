import { describe, it, expect, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  applyPhaseEvent,
  parseSessionPhaseContext,
} from "@/core/orchestrator/session-phase";
import { backfillSessionPhases } from "../../scripts/backfill-session-phase";

const createdSessionIds: string[] = [];

async function createSession(data: {
  title: string;
  phase?: string;
  phaseContext?: string;
  specApproved?: boolean;
  canonicalSpec?: string | null;
}) {
  const s = await prisma.session.create({
    data: {
      title: data.title,
      phase: data.phase ?? "ENTRADA",
      phaseContext: data.phaseContext ?? "{}",
      specApproved: data.specApproved ?? false,
      canonicalSpec: data.canonicalSpec ?? null,
    },
  });
  createdSessionIds.push(s.id);
  return s;
}

afterEach(async () => {
  if (createdSessionIds.length > 0) {
    await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    createdSessionIds.length = 0;
  }
});

describe("Fase persistida na sessão e trilha de transições (Passo 4a - 4.1)", () => {
  it("persiste phase e phaseContext (sem o campo phase) e grava PHASE_TRANSITION com await", async () => {
    const session = await createSession({ title: "fase persistida basica" });

    const res1 = await applyPhaseEvent(session.id, {
      type: "MENSAGEM_CLASSIFICADA",
      intencao: "incerto",
    });
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.ctx.phase).toBe("CONVERSA");
      expect(res1.ctx.rodadasSemClareza).toBe(1);
    }

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.phase).toBe("CONVERSA");
    const rawCtx = JSON.parse(dbSession.phaseContext);
    expect(rawCtx.phase).toBeUndefined();
    expect(rawCtx.rodadasSemClareza).toBe(1);
    expect(rawCtx.voltasConferencia).toBe(0);

    // Sem sleep: como a gravação do TelemetryLog é com await, o registro já deve estar disponível imediatamente
    const logs = await prisma.telemetryLog.findMany({
      where: { sessionId: session.id, action: "PHASE_TRANSITION" },
    });
    expect(logs).toHaveLength(1);
    const details = JSON.parse(logs[0].details!);
    expect(details).toEqual({
      from: "ENTRADA",
      to: "CONVERSA",
      event: { type: "MENSAGEM_CLASSIFICADA", intencao: "incerto" },
      effects: [],
    });
  });

  it("transição recusada não altera a fase e grava PHASE_TRANSITION_REFUSED com await", async () => {
    const session = await createSession({ title: "transicao recusada" });

    const res = await applyPhaseEvent(session.id, { type: "SPEC_APROVADA" });
    expect(res.ok).toBe(false);

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.phase).toBe("ENTRADA");

    const refusedLogs = await prisma.telemetryLog.findMany({
      where: { sessionId: session.id, action: "PHASE_TRANSITION_REFUSED" },
    });
    expect(refusedLogs).toHaveLength(1);
    const details = JSON.parse(refusedLogs[0].details!);
    expect(details.phase).toBe("ENTRADA");
    expect(details.event).toEqual({ type: "SPEC_APROVADA" });
    expect(details.reason).toContain("SPEC_APROVADA");
  });

  it("8. applyPhaseEvent concorrente na mesma sessão → as duas transições ficam serializadas, sem perder evento nem gravar fase inválida", async () => {
    const session = await createSession({ title: "concorrencia applyPhaseEvent" });

    // Dispara duas transições concorrentes na mesma sessão a partir de ENTRADA:
    // 1) MENSAGEM_CLASSIFICADA incerto (ENTRADA -> CONVERSA ou, se rodar em 2º lugar em ELICITACAO, ELICITACAO -> ELICITACAO)
    // 2) MENSAGEM_CLASSIFICADA criar_novo (ENTRADA -> ELICITACAO ou, se rodar em 2º lugar em CONVERSA, CONVERSA -> ELICITACAO)
    const [r1, r2] = await Promise.all([
      applyPhaseEvent(session.id, { type: "MENSAGEM_CLASSIFICADA", intencao: "incerto" }),
      applyPhaseEvent(session.id, { type: "MENSAGEM_CLASSIFICADA", intencao: "criar_novo" }),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.phase).toBe("ELICITACAO");
    const parsedCtx = parseSessionPhaseContext(dbSession.phase, dbSession.phaseContext);
    expect(parsedCtx.rodadasSemClareza).toBe(0);

    const transitionLogs = await prisma.telemetryLog.findMany({
      where: { sessionId: session.id, action: "PHASE_TRANSITION" },
      orderBy: { createdAt: "asc" },
    });
    expect(transitionLogs).toHaveLength(2);

    const refusedLogs = await prisma.telemetryLog.findMany({
      where: { sessionId: session.id, action: "PHASE_TRANSITION_REFUSED" },
    });
    expect(refusedLogs).toHaveLength(0);

    const transitions = transitionLogs.map((l) => JSON.parse(l.details!));
    // A 2ª transição deve partir exatamente da fase de destino da 1ª transição (serializadas)
    expect(transitions[0].from).toBe("ENTRADA");
    expect(transitions[1].from).toBe(transitions[0].to);
    expect(transitions[1].to).toBe("ELICITACAO");
  });

  it("backfillSessionPhases classifica sessões existentes de forma idempotente", async () => {
    const sEntregue = await createSession({ title: "bf entregue", specApproved: true });
    await prisma.taskNode.create({
      data: { sessionId: sEntregue.id, title: "T1", status: "completed" },
    });

    const sBloqueada = await createSession({ title: "bf bloqueada", specApproved: true });
    await prisma.taskNode.create({
      data: { sessionId: sBloqueada.id, title: "T1", status: "blocked" },
    });

    const sExecucao = await createSession({ title: "bf execucao", specApproved: true });
    await prisma.taskNode.create({
      data: { sessionId: sExecucao.id, title: "T1", status: "pending" },
    });

    const sSpecRevisao = await createSession({
      title: "bf spec revisao",
      specApproved: false,
      canonicalSpec: "# Spec Canônica",
    });

    const sEntrada = await createSession({
      title: "bf entrada",
      specApproved: false,
      canonicalSpec: null,
    });

    await backfillSessionPhases();
    // Segunda execução para provar idempotência
    await backfillSessionPhases();

    const [dbEntregue, dbBloqueada, dbExecucao, dbSpecRevisao, dbEntrada] = await Promise.all([
      prisma.session.findUniqueOrThrow({ where: { id: sEntregue.id } }),
      prisma.session.findUniqueOrThrow({ where: { id: sBloqueada.id } }),
      prisma.session.findUniqueOrThrow({ where: { id: sExecucao.id } }),
      prisma.session.findUniqueOrThrow({ where: { id: sSpecRevisao.id } }),
      prisma.session.findUniqueOrThrow({ where: { id: sEntrada.id } }),
    ]);

    expect(dbEntregue.phase).toBe("ENTREGUE");
    expect(dbBloqueada.phase).toBe("BLOQUEADA");
    expect(JSON.parse(dbBloqueada.phaseContext).faseAntesDoBloqueio).toBe("EXECUCAO");
    expect(dbExecucao.phase).toBe("EXECUCAO");
    expect(dbSpecRevisao.phase).toBe("SPEC_REVISAO");
    expect(dbEntrada.phase).toBe("ENTRADA");
  });
});
