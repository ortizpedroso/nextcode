import { describe, it, expect } from "vitest";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { mockBlindAuditJson } from "../helpers/mock-blind-audit";

// G2 (mudança 38): teste real 4d019f00 — EVALUATOR_UNAVAILABLE com `falhas: []`; o motivo do descarte sumia.
const CODE = { "src/lib/soma.ts": "export function soma(a: number, b: number) {\n  return a + b;\n}\n" };
const type1 = DualLensAuditor.validateType1(CODE, [], process.cwd(), ["src/lib/soma.ts"], []);
const ok = { id: "REQ-001", status: "implementado", evidencia: "src/lib/soma.ts:2" };

describe("G2 — descarte da resposta do avaliador com motivo", () => {
  it("REQ faltando: descarte com motivo, 2ª chamada recebe o motivo e pode acertar", async () => {
    const prompts: string[] = [];
    let n = 0;
    const r = await DualLensAuditor.validateType2(type1, "# Brief", "feito", CODE, async (m) => {
      prompts.push(m.map((x) => x.content).join("\n"));
      n++;
      if (n === 1) {
        return JSON.stringify({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [] });
      }
      return mockBlindAuditJson({ reqVerdicts: [ok], fatoQueGarante: "src/lib/soma.ts:2" });
    }, { expectedReqs: ["REQ-001"] });
    expect(r.verdict).toBe("APPROVED");
    expect(prompts[0]).not.toContain("[SUA RESPOSTA ANTERIOR FOI DESCARTADA]");
    expect(prompts[1]).toContain("[SUA RESPOSTA ANTERIOR FOI DESCARTADA] Motivo: faltou o veredito de REQ-001");
  });

  it("as 2 descartadas: resultado traz os motivos (vão para a trilha e para o feedback)", async () => {
    const r = await DualLensAuditor.validateType2(type1, "# Brief", "feito", CODE, async () =>
      mockBlindAuditJson({ reqVerdicts: [{ ...ok, evidencia: "src/lib/soma.ts:99" }], fatoQueGarante: "src/lib/soma.ts:99" }),
    { expectedReqs: ["REQ-001"] });
    expect(r.method).toBe("heuristic_fallback");
    expect(r.descartes).toHaveLength(2);
    expect(r.descartes?.[0]).toMatch(/REQ-001 "implementado" cita "src\/lib\/soma.ts:99"/);
    expect(r.rejectionReason).toContain("Descartes:");
  });
});
