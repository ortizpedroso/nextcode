import { describe, it, expect } from "vitest";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { mockBlindAuditJson } from "../helpers/mock-blind-audit";

// Regressão achada no bench de 20/10 (P2 BLOQUEADA 0/13): o P4 aceitou lista de referências no
// relatório do executor, mas a Lente 2 ainda conferia uma referência só → "evidência inexistente".
const CODE = { "src/lib/soma.ts": Array.from({ length: 10 }, (_, i) => `export const l${i} = ${i};`).join("\n") };
const type1 = DualLensAuditor.validateType1(CODE, [], process.cwd(), ["src/lib/soma.ts"], []);
const blind = mockBlindAuditJson({
  reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/soma.ts:2" }],
  fatoQueGarante: "src/lib/soma.ts:2",
});

function reportWith(arquivoLinha: string) {
  return {
    registroCumprimento: [{ reqId: "REQ-001", statusDeclarado: "atendido", arquivoLinha, comoFoiImplementado: "x" }],
  } as any;
}

async function judge(arquivoLinha: string) {
  return DualLensAuditor.validateType2(type1, "# Brief\nREQ-001", "feito", CODE, async () => blind, {
    expectedReqs: ["REQ-001"],
    executorReport: reportWith(arquivoLinha),
  });
}

describe("TR1 (3) — Lente 2 aceita lista de referências do executor", () => {
  it("lista válida (várias faixas, separadas por ';' e ',') → sem divergência, APROVADO", async () => {
    const r = await judge("src/lib/soma.ts:1-3; src/lib/soma.ts:5,7-9");
    expect(r.reqDivergences ?? []).toEqual([]);
    expect(r.verdict).toBe("APPROVED");
  });

  it("uma referência da lista fora do arquivo → evidência inexistente, REPROVADO", async () => {
    const r = await judge("src/lib/soma.ts:1-3; src/lib/soma.ts:40");
    expect(r.verdict).toBe("REJECTED");
    expect(r.reqDivergences?.[0].tipoDivergencia).toBe("alucinacao_grave");
  });
});
