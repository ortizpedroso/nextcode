import { describe, it, expect } from "vitest";
import { extractFilePathsFromText } from "@/core/shared/file-path-extractor";

describe("extractFilePathsFromText (extrator canônico compartilhado)", () => {
  it("extrai caminhos de arquivo explicitamente citados com fronteira de palavra/aspas", () => {
    const files = extractFilePathsFromText("altere o `src/app/globals.css` e o prisma/schema.prisma");
    expect(files).toContain("src/app/globals.css");
    expect(files).toContain("prisma/schema.prisma");
  });

  it("REGRESSÃO: não extrai caminho embutido em stacktrace de build do webpack como arquivo-alvo", () => {
    const text = "TypeError: Failed to fetch at DashboardOrchestrator (webpack-internal:///(app-pages-browser)/./src/app/page.tsx:123:35)";
    const files = extractFilePathsFromText(text);
    expect(files).not.toContain("/./src/app/page.tsx");
    expect(files).not.toContain("src/app/page.tsx");
  });

  it("ignora URLs http(s) e caminhos com '..'", () => {
    const files = extractFilePathsFromText("veja https://exemplo.com/arquivo.md e ../../etc/config.yml");
    expect(files).not.toContain("https://exemplo.com/arquivo.md");
    expect(files.some((f) => f.includes(".."))).toBe(false);
  });
});
