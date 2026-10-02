import { describe, it, expect } from "vitest";
import { InputPreprocessorEngine } from "@/core/intake/input-preprocessor";

describe("InputPreprocessorEngine — YAML Frontmatter & Markdown Sanitization", () => {
  it("deve sanitizar HTML e gerar YAML Frontmatter estruturado", () => {
    const rawInput = `
      <script>console.log("bad script");</script>
      <style>body { color: red; }</style>
      <h1>Erro no projeto</h1>
      <p>O arquivo <code>src/app/globals.css</code> falhou ao carregar em https://localhost:3000/docs.</p>
    `;

    const res = InputPreprocessorEngine.preprocess(rawInput, { projectName: "gateway" });

    expect(res.intentType).toBe("BUG_FIX");
    expect(res.yamlFrontmatter).toContain('intent_type: "BUG_FIX"');
    expect(res.yamlFrontmatter).toContain('project_name: "gateway"');
    expect(res.yamlFrontmatter).toContain('target_files:');
    expect(res.yamlFrontmatter).toContain('src/app/globals.css');
    expect(res.markdownBody).not.toContain("<script>");
    expect(res.markdownBody).not.toContain("<style>");
    expect(res.tokenReductionPercent).toBeGreaterThan(0);
  });

  it("deve identificar intenções de execução de código e comandos", () => {
    const rawInput = "Execute no terminal o comando npm run dev na pasta C:\\projetos\\gateway";
    const res = InputPreprocessorEngine.preprocess(rawInput);

    expect(res.intentType).toBe("CODE_EXECUTION_REQUEST");
    expect(res.yamlFrontmatter).toContain('intent_type: "CODE_EXECUTION_REQUEST"');
  });
});
