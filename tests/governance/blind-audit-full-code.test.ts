import { describe, it, expect } from "vitest";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";

describe("Auditor Cego lê o arquivo inteiro", () => {
  it("arquivo de ~6.000 caracteres chega completo ao auditor (antes era cortado em 2.500)", async () => {
    const body = Array.from({ length: 150 }, (_, i) => `export const linha${i} = ${i}; // conteúdo real`).join("\n");
    const content = `${body}\nexport function ultimaFuncao() { return "FIM-DO-ARQUIVO"; }\n`;
    expect(content.length).toBeGreaterThan(6000);
    let seen = "";
    const type1 = DualLensAuditor.validateType1({ "src/lib/x.ts": content }, [], process.cwd(), ["src/lib/x.ts"], []);
    await DualLensAuditor.validateType2(type1, "# Brief\nImplementar x", "feito", { "src/lib/x.ts": content }, async (messages) => {
      seen = messages.map((m) => m.content).join("\n");
      return '{"implemented":true,"missingRequirements":[],"justification":"ok"}';
    });
    expect(seen).toContain("FIM-DO-ARQUIVO");
    expect(seen).not.toContain("OMITIDOS");
  });

  it("AV1.2: arquivo acima do limite → reprovado sem chamar o avaliador, com o motivo (nunca aprovado sem leitura)", async () => {
    process.env.BLIND_AUDIT_MAX_FILE_CHARS = "100";
    try {
      let called = false;
      const content = "x".repeat(500);
      const type1 = DualLensAuditor.validateType1({ "src/a.ts": "export const a = 1;" }, [], process.cwd(), ["src/a.ts"], []);
      const res = await DualLensAuditor.validateType2(type1, "# Brief", "feito", { "src/a.ts": content }, async () => {
        called = true;
        return '{"implemented":true,"missingRequirements":[],"justification":"ok"}';
      });
      expect(called).toBe(false);
      expect(res.verdict).toBe("REJECTED");
      expect(res.method).toBe("limite_tamanho");
      expect(res.rejectionReason).toContain("src/a.ts tem 500 caracteres (máximo 100 por arquivo)");
    } finally {
      delete process.env.BLIND_AUDIT_MAX_FILE_CHARS;
    }
  });

  it("AV1.2: soma da etapa acima do limite total → reprovado", async () => {
    process.env.BLIND_AUDIT_MAX_TOTAL_CHARS = "300";
    try {
      const files = { "src/a.ts": "a".repeat(200), "src/b.ts": "b".repeat(200) };
      const type1 = DualLensAuditor.validateType1({ "src/a.ts": "export const a = 1;" }, [], process.cwd(), ["src/a.ts"], []);
      const res = await DualLensAuditor.validateType2(type1, "# Brief", "feito", files, async () => '{"implemented":true}');
      expect(res.verdict).toBe("REJECTED");
      expect(res.rejectionReason).toContain("a etapa soma 400 caracteres (máximo 300 no total)");
    } finally {
      delete process.env.BLIND_AUDIT_MAX_TOTAL_CHARS;
    }
  });
});
