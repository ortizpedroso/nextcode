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

describe("44 — regressão: a etapa de reparo leva as provas anteriores do seu escopo que já passam", () => {
  it("prova do mesmo arquivo e fechada → vai como regressão; prova aberta nesta rodada → não (já é defeito)", async () => {
    const { attachRegressionProofs } = await import("../../src/core/orchestrator/delivery-repair.js");
    const s = await prisma.session.create({ data: { title: "Regressao", phase: "VERIFICACAO" } });
    created.push(s.id);
    await prisma.telemetryLog.create({
      data: {
        sessionId: s.id,
        action: "FINAL_REVIEW_PROOFS",
        details: JSON.stringify({
          provas: [
            { caminho: "D1-webhook-reprocessa.test.ts", conteudo: "fechada", arquivo: "src/app/api/webhooks/asaas/route.ts", defeito: "REQ-018 reprocessa" },
            { caminho: "D2-webhook-header.test.ts", conteudo: "aberta", arquivo: "src/app/api/webhooks/asaas/route.ts", defeito: "REQ-018 header" },
            { caminho: "D3-outro.test.ts", conteudo: "outro arquivo", arquivo: "src/lib/taxas.ts", defeito: "REQ-055" },
          ],
        }),
      },
    });
    const dona = { id: "n14", title: "Etapa 14/40", role: "worker", status: "completed", filesScope: JSON.stringify(["src/app/api/webhooks/asaas/route.ts"]), payload: "{}", createdAt: new Date() };
    const itens = [{ dona: dona as never, origemId: "n14", defeitos: ["REQ-018 header"], reqs: [], testes: [{ caminho: "I1-header.test.ts", conteudo: "aberta" }], escopoExtra: [] }];
    await attachRegressionProofs(s.id, itens);
    expect(itens[0].testes.map((t) => [t.caminho, Boolean((t as { regressao?: boolean }).regressao)])).toEqual([
      ["I1-header.test.ts", false],
      ["regressao-1-D1-webhook-reprocessa.test.ts", true],
    ]);
  });
});
