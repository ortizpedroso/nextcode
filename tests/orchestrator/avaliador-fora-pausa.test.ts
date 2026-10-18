import { describe, it, expect, afterAll } from "vitest";
import prisma from "@/lib/prisma";
import { transition, MAX_PAUSAS_AVALIADOR, type PhaseContext } from "@/core/orchestrator/phase-machine";
import { superviseEvaluatorPauses, supervisePausedSessions } from "@/core/orchestrator/job-worker";
import { isEvaluatorAccessFailure, MAX_FREE_EVALUATOR_RETRIES } from "@/core/orchestrator/node-executor";
import { serializeSessionPhaseContext } from "@/core/orchestrator/session-phase";

const exec: PhaseContext = { phase: "EXECUCAO", rodadasSemClareza: 0, voltasConferencia: 0 };
const ev = (pausa: number, definitivo = false) =>
  ({ type: "AVALIADOR_FORA", ate: "2026-10-18T12:05:00.000Z", pausa, motivo: "claude/x: timeout", definitivo }) as const;

describe("Mudança 24 — avaliador fora do ar: pausa de 5 min, limite e bloqueio por chave", () => {
  const ids: string[] = [];
  afterAll(async () => {
    await prisma.message.deleteMany({ where: { sessionId: { in: ids } } });
    await prisma.job.deleteMany({ where: { sessionId: { in: ids } } });
    await prisma.session.deleteMany({ where: { id: { in: ids } } });
  });

  it("3 reavaliações grátis (antes 2)", () => {
    expect(MAX_FREE_EVALUATOR_RETRIES).toBe(3);
  });

  it("EXECUCAO + AVALIADOR_FORA → PAUSADA com pausaAvaliador; LLM_VOLTOU volta a EXECUCAO e limpa", () => {
    const r = transition(exec, ev(1));
    expect(r.ok && r.ctx.phase).toBe("PAUSADA");
    if (!r.ok) return;
    expect(r.ctx.pausaAvaliador).toEqual({ ate: "2026-10-18T12:05:00.000Z", pausa: 1, motivo: "claude/x: timeout" });
    const back = transition(r.ctx, { type: "LLM_VOLTOU" });
    expect(back.ok && back.ctx.phase).toBe("EXECUCAO");
    expect(back.ok && back.ctx.pausaAvaliador).toBeUndefined();
  });

  it("acima do limite de pausas ou falha de chave → BLOQUEADA com aviso ao humano", () => {
    for (const r of [transition(exec, ev(MAX_PAUSAS_AVALIADOR + 1)), transition(exec, ev(1, true))]) {
      expect(r.ok && r.ctx.phase).toBe("BLOQUEADA");
      expect(r.ok && r.effects.some((e) => e.type === "AVISAR_HUMANO")).toBe(true);
    }
    const paused = transition(exec, ev(MAX_PAUSAS_AVALIADOR));
    expect(paused.ok && paused.ctx.phase).toBe("PAUSADA");
  });

  it("falha de acesso (401/403/sem chave/crédito) é definitiva; timeout e 5xx não", () => {
    expect(isEvaluatorAccessFailure(["claude/direct: HTTP 401 authentication_error: x", "claude/claude-opus-5-5: sem chave da Anthropic em Configurações"])).toBe(true);
    expect(isEvaluatorAccessFailure(["claude/direct: HTTP 400 invalid_request_error: Your credit balance is too low"])).toBe(true);
    expect(isEvaluatorAccessFailure(["claude/x: TimeoutError", "claude/direct: HTTP 529 overloaded_error"])).toBe(false);
    expect(isEvaluatorAccessFailure([])).toBe(false);
  });

  async function pausedSession(ate: Date, pausa = 1) {
    const ctx: PhaseContext = {
      phase: "PAUSADA",
      rodadasSemClareza: 0,
      voltasConferencia: 0,
      faseAntesDaPausa: "EXECUCAO",
      pausaAvaliador: { ate: ate.toISOString(), pausa, motivo: "timeout" },
    };
    const s = await prisma.session.create({
      data: { title: "M24", phase: "PAUSADA", phaseContext: serializeSessionPhaseContext(ctx) },
    });
    ids.push(s.id);
    return s;
  }

  it("supervisor: antes do horário não sonda; depois, Claude responde → EXECUCAO", async () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    const s = await pausedSession(new Date("2026-10-18T12:05:00.000Z"));
    let probes = 0;
    const probe = async () => {
      probes++;
      return { ok: true, motivo: "", definitivo: false };
    };
    await superviseEvaluatorPauses(probe, now);
    expect(probes).toBe(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).phase).toBe("PAUSADA");
    const resumed = await superviseEvaluatorPauses(probe, new Date("2026-10-18T12:06:00.000Z"));
    expect(probes).toBe(1);
    expect(resumed).toBeGreaterThanOrEqual(1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).phase).toBe("EXECUCAO");
  });

  it("supervisor: Claude continua fora → nova pausa (pausa+1) com aviso; na última, BLOQUEADA", async () => {
    const after = new Date("2026-10-18T12:06:00.000Z");
    const s = await pausedSession(new Date("2026-10-18T12:05:00.000Z"), 2);
    const fora = async () => ({ ok: false, motivo: "claude/x: TimeoutError", definitivo: false });
    await superviseEvaluatorPauses(fora, after);
    const s1 = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(s1.phase).toBe("PAUSADA");
    expect(JSON.parse(s1.phaseContext || "{}").pausaAvaliador.pausa).toBe(3);
    const msgs = await prisma.message.findMany({ where: { sessionId: s.id } });
    expect(msgs.some((m) => m.content.includes("Avaliador ainda fora do ar (pausa 3)"))).toBe(true);

    const last = await pausedSession(new Date("2026-10-18T12:05:00.000Z"), MAX_PAUSAS_AVALIADOR);
    await superviseEvaluatorPauses(fora, after);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: last.id } })).phase).toBe("BLOQUEADA");
  });

  it("a pausa genérica (algum gateway responde) NÃO retoma sessão pausada pelo avaliador", async () => {
    const s = await pausedSession(new Date("2099-01-01T00:00:00.000Z"));
    await supervisePausedSessions(async () => true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).phase).toBe("PAUSADA");
  });
});
