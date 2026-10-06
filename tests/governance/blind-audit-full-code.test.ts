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

  it("quando um corte de segurança acontece, ele é declarado ao auditor", async () => {
    process.env.BLIND_AUDIT_MAX_FILE_CHARS = "100";
    try {
      let seen = "";
      const content = "x".repeat(500);
      const type1 = DualLensAuditor.validateType1({ "src/a.ts": "export const a = 1;" }, [], process.cwd(), ["src/a.ts"], []);
      await DualLensAuditor.validateType2(type1, "# Brief", "feito", { "src/a.ts": content }, async (messages) => {
        seen = messages.map((m) => m.content).join("\n");
        return '{"implemented":true,"missingRequirements":[],"justification":"ok"}';
      });
      expect(seen).toContain("OMITIDOS PELO NEXTCODE");
      expect(seen).toContain("NÃO reprove por isso");
    } finally {
      delete process.env.BLIND_AUDIT_MAX_FILE_CHARS;
    }
  });
});
