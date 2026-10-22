import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { transition, initialContext } from "../../src/core/orchestrator/phase-machine.js";
import { reopenDeliveredSession } from "../../src/core/orchestrator/session-resume.js";

// Mudança 40: o Gateway 4d019f00 foi entregue antes de a revisão final funcionar; reabrir sem mudar a Spec.
const created: string[] = [];
afterAll(async () => {
  await prisma.job.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.message.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.telemetryLog.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { id: { in: created } } }).catch(() => {});
});

describe("mudança 40 — reabrir a entrega para a verificação final rodar de novo", () => {
  it("máquina de fases: REABRIR_ENTREGA só vale em ENTREGUE e leva a EXECUCAO com RETOMAR_EXECUCAO", () => {
    const ok = transition({ ...initialContext(), phase: "ENTREGUE" }, { type: "REABRIR_ENTREGA" }, { etapa1Ativa: false });
    expect(ok.ok && ok.ctx.phase).toBe("EXECUCAO");
    expect(ok.ok && ok.effects).toEqual([{ type: "RETOMAR_EXECUCAO" }]);
    const recusado = transition({ ...initialContext(), phase: "BLOQUEADA" }, { type: "REABRIR_ENTREGA" }, { etapa1Ativa: false });
    expect(recusado.ok).toBe(false);
  });

  it("sessão ENTREGUE: volta a EXECUCAO, avisa no chat, registra quem reabriu e põe 1 job na fila", async () => {
    const s = await prisma.session.create({ data: { title: "Reabrir", phase: "ENTREGUE" } });
    created.push(s.id);
    const r = await reopenDeliveredSession(s.id, "linha_de_comando", "teste");
    expect(r.ok).toBe(true);
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("EXECUCAO");
    expect((await prisma.message.findMany({ where: { sessionId: s.id } }))[0].content).toContain("Entrega reaberta");
    expect(await prisma.telemetryLog.count({ where: { sessionId: s.id, action: "DELIVERY_REOPENED_BY_HUMAN" } })).toBe(1);
    expect(await prisma.job.count({ where: { sessionId: s.id, status: "queued" } })).toBe(1);
  });

  it("sessão que não está ENTREGUE é recusada sem mexer em nada", async () => {
    const s = await prisma.session.create({ data: { title: "Reabrir não", phase: "EXECUCAO" } });
    created.push(s.id);
    const r = await reopenDeliveredSession(s.id, "painel", "teste");
    expect(r.ok).toBe(false);
    expect(await prisma.job.count({ where: { sessionId: s.id } })).toBe(0);
  });
});
