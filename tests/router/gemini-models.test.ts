import { describe, it, expect } from "vitest";
import { rankGeminiModels } from "@/core/router/gemini-client";

describe("Escolha de modelos Gemini (chave nativa)", () => {
  // Lista real devolvida pelo /v1beta/models em 05/10/2026 para a chave do usuário (amostra).
  const catalog = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-preview-tts",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-pro-latest",
    "gemini-2.5-flash-image",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-robotics-er-2-preview",
    "text-embedding-004",
  ];

  it("põe o Flash vigente primeiro (alias -latest, depois a versão mais nova) e Pro por último", () => {
    const ranked = rankGeminiModels(catalog);
    expect(ranked.slice(0, 3)).toEqual(["gemini-flash-latest", "gemini-3.8-flash", "gemini-3-flash-preview"]);
    expect(ranked[ranked.length - 1]).toMatch(/pro/);
  });

  it("descarta modelos que não são de texto (voz, imagem, embedding, robótica, customtools)", () => {
    const ranked = rankGeminiModels(catalog);
    for (const bad of ["tts", "image", "embedding", "robotics", "customtools"]) {
      expect(ranked.some((m) => m.includes(bad))).toBe(false);
    }
  });

  it("não depende mais dos nomes descontinuados 1.5/2.0", () => {
    expect(rankGeminiModels(["gemini-1.5-flash", "gemini-flash-latest"])[0]).toBe("gemini-flash-latest");
  });
});
