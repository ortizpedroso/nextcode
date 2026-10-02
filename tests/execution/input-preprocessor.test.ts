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
    expect(res.yamlFrontmatter).toContain("target_files:");
    expect(res.yamlFrontmatter).toContain("src/app/globals.css");
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

  it("deve agrupar stack traces e logs de erro em blocos ```log e purgar ruídos do Windows", () => {
    const rawInput = `
Watchpack Error (initial scan): Error: EINVAL: invalid argument, lstat 'C:\\DumpStack.log.tmp'
Watchpack Error (initial scan): Error: EINVAL: invalid argument, lstat 'C:\\pagefile.sys'
TypeError: Failed to fetch at DashboardOrchestrator (webpack-internal:///(app-pages-browser)/./src/app/page.tsx:123:35)
    `;

    const res = InputPreprocessorEngine.preprocess(rawInput);

    expect(res.hasErrorLog).toBe(true);
    expect(res.yamlFrontmatter).toContain("has_error_log: true");
    expect(res.markdownBody).toContain("```log");
    expect(res.markdownBody).not.toContain("DumpStack.log.tmp");
  });

  it("deve classificar links de vídeos e documentação e normalizar anexos multimodais", () => {
    const rawInput = `
Veja a aula em https://www.youtube.com/watch?v=123456 e a doc em https://nextjs.org/docs.
[ANEXO MULTIMODAL: 2 imagem(ns) enviada(s) como contexto visual]
    `;

    const res = InputPreprocessorEngine.preprocess(rawInput);

    expect(res.videoUrls).toContain("https://www.youtube.com/watch?v=123456");
    expect(res.docUrls).toContain("https://nextjs.org/docs");
    expect(res.hasMultimodalAttachments).toBe(true);
    expect(res.yamlFrontmatter).toContain("video_links:");
    expect(res.yamlFrontmatter).toContain("documentation_links:");
    expect(res.yamlFrontmatter).toContain("multimodal_attachments_count: 2");
  });
});
