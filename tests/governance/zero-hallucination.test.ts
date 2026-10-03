import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
    expect(res.groundedMessage).not.toContain("```");
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

  it("nunca repete o conteúdo do código gerado no chat — só prosa curta + checklist de arquivos", () => {
    const tmpProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), "zero-halluc-test-"));
    try {
      const taskId = "test-zero-3";
      const rawAiResponse = `Implementei o módulo financeiro conforme a Spec.
\`\`\`typescript
// file: src/app/dashboard/finance/page.tsx
export default function FinancialPage() {
  return <div>{"linha 1"}{"linha 2"}{"linha 3"}</div>;
}
\`\`\``;

      const res = ZeroHallucinationEngine.processAndVerifyResponse(
        taskId,
        rawAiResponse,
        "implemente o modulo financeiro",
        tmpProjectPath
      );

      expect(res.passed).toBe(true);
      expect(res.groundedMessage).not.toContain("```");
      expect(res.groundedMessage).not.toContain("linha 1");
      expect(res.groundedMessage).toContain("- ✅ `src/app/dashboard/finance/page.tsx`");
    } finally {
      fs.rmSync(tmpProjectPath, { recursive: true, force: true });
    }
  });
});
