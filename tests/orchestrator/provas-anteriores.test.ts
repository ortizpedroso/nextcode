import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { loadPriorProofs } from "../../src/core/orchestrator/job-queue.js";

// Mudança 44 — o que já foi provado na sessão volta a rodar em toda verificação final.
const created: string[] = [];
afterAll(async () => {
  await prisma.telemetryLog.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.taskNode.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { id: { in: created } } }).catch(() => {});
});

describe("44 — provas anteriores da sessão", () => {
  it("junta provas da revisão final e contratos dos reparos, sem repetir conteúdo e sem testes do próprio projeto", async () => {
    const s = await prisma.session.create({ data: { title: "Provas", phase: "VERIFICACAO" } });
    created.push(s.id);
    await prisma.telemetryLog.create({
      data: {
        sessionId: s.id,
        action: "FINAL_REVIEW_PROOFS",
        details: JSON.stringify({ provas: [{ caminho: "D1-webhook.test.ts", conteudo: "c1", req: "REQ-018", arquivo: "src/app/api/webhooks/asaas/route.ts", defeito: "REQ-018" }] }),
      },
    });
    await prisma.taskNode.create({
      data: {
        id: `${s.id}-r`,
        sessionId: s.id,
        title: "Reparo 4/4 — Etapa 4/40",
        status: "completed",
        filesScope: JSON.stringify(["tests/auth.test.ts", "src/lib/auth.ts"]),
        payload: JSON.stringify({
          reparoEntrega: {
            rodada: 4,
            origemId: "o",
            etapaAnterior: "o",
            defeitos: ["segredo fixo"],
            microbriefReparo: {},
            testesReproducao: [
              { caminho: "D8-segredo.test.ts", conteudo: "c2" },
              { caminho: "D1-webhook.test.ts", conteudo: "c1" },
              { caminho: "tests/auth.test.ts", conteudo: "c3", existente: true },
            ],
          },
        }),
      },
    });
    const provas = await loadPriorProofs(s.id);
    expect(provas.map((p) => p.conteudo)).toEqual(["c1", "c2"]);
    expect(provas[1]).toMatchObject({ arquivo: "src/lib/auth.ts" });
    expect(provas[1].defeito).toContain("segredo fixo");
  });
});
