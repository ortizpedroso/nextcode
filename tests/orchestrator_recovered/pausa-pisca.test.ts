import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { supervisePausedSessions, PAUSE_FLAP_LIMIT } from "../../src/core/orchestrator/job-worker.js";

// Mudança 42: Gateway 22/10 — DeepSeek sem crédito; o FreeLLMAPI respondia à sonda e a sessão piscava
// PAUSADA ↔ EXECUCAO a cada 25 s. Na 3ª pausa por SEM_LLM em 10 min, o supervisor bloqueia e diz o porquê.
const created: string[] = [];
afterAll(async () => {
  await prisma.job.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.message.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.telemetryLog.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { id: { in: created } } }).catch(() => {});
});

async function pausedWith(pauses: number) {
  const s = await prisma.session.create({
    data: {
      title: "Pisca",
      phase: "PAUSADA",
      phaseContext: JSON.stringify({ rodadasSemClareza: 0, voltasConferencia: 0, faseAntesDaPausa: "EXECUCAO" }),
    },
  });
  created.push(s.id);
  for (let i = 0; i < pauses; i++) {
    await prisma.telemetryLog.create({
      data: {
        sessionId: s.id,
        action: "PHASE_TRANSITION",
        details: JSON.stringify({ from: "EXECUCAO", to: "PAUSADA", event: { type: "SEM_LLM" }, effects: [] }),
      },
    });
  }
  return s;
}

describe("mudança 42 — pausa que pisca vira bloqueio com aviso", () => {
  it(`${PAUSE_FLAP_LIMIT} pausas por SEM_LLM em 10 min com o gateway de pé → BLOQUEADA, aviso com Retomar`, async () => {
    const s = await pausedWith(PAUSE_FLAP_LIMIT);
    await supervisePausedSessions(async () => true, new Date(), { onlySessionIds: [s.id] });
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("BLOQUEADA");
    const msg = (await prisma.message.findMany({ where: { sessionId: s.id } })).map((m) => m.content).join("\n");
    expect(msg).toContain("responde mas não atende");
    expect(msg).toContain("Confira crédito, cota e chaves");
    expect(msg).toContain("**Retomar**");
    expect(await prisma.job.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it("menos pausas → retoma como antes (LLM_VOLTOU + fila)", async () => {
    const s = await pausedWith(PAUSE_FLAP_LIMIT - 1);
    await supervisePausedSessions(async () => true, new Date(), { onlySessionIds: [s.id] });
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("EXECUCAO");
    expect(await prisma.job.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it("F10: o aviso traz o erro do gateway da própria sessão, não o de outra", async () => {
    const outra = await prisma.session.create({ data: { title: "Outra", phase: "EXECUCAO" } });
    created.push(outra.id);
    const s = await pausedWith(PAUSE_FLAP_LIMIT);
    await prisma.telemetryLog.create({
      data: { sessionId: s.id, action: "llm.gateway_failure", details: JSON.stringify({ gateway: "freellmapi", kind: "quota", status: 402, detail: "out_of_credits da minha sessao" }) },
    });
    await prisma.telemetryLog.create({
      data: { sessionId: outra.id, action: "llm.gateway_failure", details: JSON.stringify({ gateway: "freellmapi", kind: "timeout", detail: "erro da outra sessao" }) },
    });
    await supervisePausedSessions(async () => true, new Date(), { onlySessionIds: [s.id] });
    const msg = (await prisma.message.findMany({ where: { sessionId: s.id } })).map((m) => m.content).join("\n");
    expect(msg).toContain("out_of_credits da minha sessao");
    expect(msg).not.toContain("erro da outra sessao");
  });
});
