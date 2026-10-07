import { describe, it, expect } from "vitest";
import { QuarantineManager } from "@/core/governance/quarantine-manager";

const scope = ["src/components/Form.tsx", "src/app/page.tsx"];

describe("Resposta do executor cortada ou incompleta", () => {
  it("bloco aberto sem fechar → [TRUNCATED OUTPUT] e o arquivo faltante é apontado", () => {
    const qm = new QuarantineManager();
    const text = [
      "```tsx", "// file: src/components/Form.tsx", "export default function Form() { return null; }", "```",
      "```tsx", "// file: src/app/page.tsx", "export default function Page() {",
    ].join("\n");
    qm.extractAndWriteCodeBlocks("t-trunc", text, scope, { strictPaths: true });
    expect(qm.extractionIssues.some((i) => i.startsWith("[TRUNCATED OUTPUT]"))).toBe(true);
    expect(qm.extractionIssues.some((i) => i.includes("[MISSING FILE]") && i.includes("src/app/page.tsx"))).toBe(true);
    qm.purgeWorkspace("t-trunc");
  });

  it("todos os arquivos completos → sem problemas", () => {
    const qm = new QuarantineManager();
    const text = scope.map((f) => ["```tsx", `// file: ${f}`, "export const x = 1;", "```"].join("\n")).join("\n");
    qm.extractAndWriteCodeBlocks("t-ok", text, scope, { strictPaths: true });
    expect(qm.extractionIssues).toEqual([]);
    qm.purgeWorkspace("t-ok");
  });
});

describe("Resposta sem nenhum arquivo", () => {
  it("texto sem blocos → [NO FILES] (reprova no Tipo 1, sem chamar o avaliador)", () => {
    const qm = new QuarantineManager();
    qm.extractAndWriteCodeBlocks("t-empty", "Etapa executada pelo motor autônomo.", scope, { strictPaths: true });
    expect(qm.extractionIssues.some((i) => i.startsWith("[NO FILES]"))).toBe(true);
    qm.purgeWorkspace("t-empty");
  });
});
