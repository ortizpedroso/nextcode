/**
 * Roteador — chave Gemini efetiva (mesma fonte que chat e diagnóstico).
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveEffectiveGeminiKey } from "../../src/core/router/smart-router";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveEffectiveGeminiKey", () => {
  it("prefere a chave armazenada em texto plano", () => {
    expect(resolveEffectiveGeminiKey("  minha-chave  ")).toBe("minha-chave");
  });

  it("cai para GEMINI_API_KEY quando o armazenamento está vazio", () => {
    process.env.GEMINI_API_KEY = "do-env";
    expect(resolveEffectiveGeminiKey(null)).toBe("do-env");
  });
});
