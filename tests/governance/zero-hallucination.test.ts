import { describe, it, expect } from "vitest";
import { ZeroHallucinationEngine } from "@/core/governance/zero-hallucination-loop";

describe("ZeroHallucinationEngine — Empirical Verification & Grounding", () => {
  it("deve rejeitar respostas com erros de sintaxe CSS e interceptar falsas alegações da IA", () => {
    const taskId = "test-zero-1";
    const rawAiResponse = `Corrigi com sucesso o arquivo globals.css no seu disco!
\`\`\`css
// file: src/app/globals.css
@tailwind base;
\`\`\``;

    const res = ZeroHallucinationEngine.processAndVerifyResponse(
      taskId,
      rawAiResponse,
      "corrija o globals.css",
      process.cwd()
    );

    expect(res.passed).toBe(false);
    expect(res.promotedFiles.length).toBe(0);
    expect(res.groundedMessage).toContain("Anti-Hallucination Guard");
    expect(res.groundedMessage).toContain("[CSS SYNTAX ERROR]");
    expect(res.groundedMessage).not.toContain("Corrigi com sucesso");
  });

  it("deve aprovar e promover patches limpos com 0 erros sintáticos", () => {
    const taskId = "test-zero-2";
    const rawAiResponse = `Aqui está o ajuste limpo do componente.
\`\`\`typescript
// file: src/utils/math.ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\``;

    const res = ZeroHallucinationEngine.processAndVerifyResponse(
      taskId,
      rawAiResponse,
      "crie a funcao add",
      process.cwd()
    );

    expect(res.passed).toBe(true);
    expect(res.promotedFiles).toContain("src/utils/math.ts");
    expect(res.groundedMessage).toContain("Anti-Hallucination Guard");
    expect(res.groundedMessage).toContain("0 Erros");
  });
});
