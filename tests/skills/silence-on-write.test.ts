import { describe, expect, it } from "vitest";
import { recusaDeSilencioNaGravacao } from "@/core/skills/executor-tool-loop";

describe("silêncio na hora de gravar", () => {
  it("devolve a linha do cast e não trata arquivo limpo como silêncio", () => {
    const recusa = recusaDeSilencioNaGravacao(
      "src/lib/cobrancas-service.ts",
      "const valor = entrada as any;\n"
    );
    expect(recusa).toContain("[SILENCIO]");
    expect(recusa).toContain("src/lib/cobrancas-service.ts:1");
    expect(recusaDeSilencioNaGravacao("src/lib/cobrancas-service.ts", "export const valor = 1;\n")).toBeNull();
  });
});
