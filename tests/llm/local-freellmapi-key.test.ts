import { describe, expect, it } from "vitest";
import { isFreellmapiUnifiedKey, isLocalFreellmapiBaseUrl, shouldSyncLocalFreellmapiKey } from "@/core/llm/local-freellmapi-key";

const REAL = `freellmapi-${"ab".repeat(24)}`;

describe("chave unificada do FreeLLMAPI local", () => {
  it("aceita só o formato que o gateway gera", () => {
    expect(isFreellmapiUnifiedKey(REAL)).toBe(true);
    expect(isFreellmapiUnifiedKey("freellmapi-curta")).toBe(false);
    expect(isFreellmapiUnifiedKey("sk-provider-key-com-outro-formato-1234567890")).toBe(false);
  });

  it("sincroniza apenas o gateway publicado em localhost:3100", () => {
    expect(isLocalFreellmapiBaseUrl("http://localhost:3100/v1")).toBe(true);
    expect(isLocalFreellmapiBaseUrl("http://127.0.0.1:3100/v1")).toBe(true);
    expect(isLocalFreellmapiBaseUrl("http://localhost:3001/v1")).toBe(false);
    expect(isLocalFreellmapiBaseUrl("https://api.deepseek.com/v1")).toBe(false);
  });

  it("não corre durante os testes, para não trocar a chave do banco de teste", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(shouldSyncLocalFreellmapiKey("http://localhost:3100/v1")).toBe(false);
  });
});
