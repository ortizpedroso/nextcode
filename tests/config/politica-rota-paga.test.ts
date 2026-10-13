import { describe, it, expect } from "vitest";
import { loadOrchestrationPolicy } from "@/core/config/orchestration-policy";

describe("C1.1 — rota paga da política real", () => {
  it("política real aceita só custom/", () => {
    const policy = loadOrchestrationPolicy();
    expect(policy.roteamentoPapeisCriticos.prefixosRotaPaga).toEqual(["custom/"]);
  });

  it("nenhum prefixo de revendedor gratuito ou contingência", () => {
    const policy = loadOrchestrationPolicy();
    for (const prefixo of policy.roteamentoPapeisCriticos.prefixosRotaPaga) {
      expect(prefixo.startsWith("electronhub/")).toBe(false);
      expect(prefixo.startsWith("groq/")).toBe(false);
      expect(prefixo.startsWith("mistral/")).toBe(false);
    }
  });
});
