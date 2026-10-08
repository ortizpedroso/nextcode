import { describe, it, expect } from "vitest";
import { loadPaidGatewaysForTier } from "@/core/llm/paid-routing";
import type { GatewayConfig } from "@/core/llm/gateways";

const fakeGateways: GatewayConfig[] = [
  {
    id: "freellmapi",
    enabled: true,
    priority: 1,
    baseUrl: "http://localhost:3100/v1",
    apiKey: "",
    modelFast: "auto:fast",
    modelHeavy: "auto:smart",
  },
  {
    id: "omniroute",
    enabled: true,
    priority: 2,
    baseUrl: "http://localhost:20128/v1",
    apiKey: "",
    modelFast: "auto/fast",
    modelHeavy: "auto/best-free",
  },
  {
    id: "deepseek",
    enabled: true,
    priority: 3,
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "test-ds-key",
    modelFast: null,
    modelHeavy: "deepseek-v4-pro",
    heavyFirst: true,
  },
];

describe("R1.2 — loadPaidGatewaysForTier", () => {
  it("devolve só gateways heavyFirst (exclui freellmapi e omniroute)", async () => {
    const res = await loadPaidGatewaysForTier("medio", "deepseek-flash", async () => fakeGateways);
    expect(res.map((g) => g.id)).toEqual(["deepseek"]);
    expect(res.every((g) => g.heavyFirst === true)).toBe(true);
  });

  it("rapido troca o modelo para o pago barato", async () => {
    const res = await loadPaidGatewaysForTier("rapido", "deepseek-flash", async () => fakeGateways);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("deepseek");
    expect(res[0].modelHeavy).toBe("deepseek-flash");
  });

  it("medio e pesado mantêm deepseek-v4-pro", async () => {
    const resMedio = await loadPaidGatewaysForTier("medio", "deepseek-flash", async () => fakeGateways);
    const resPesado = await loadPaidGatewaysForTier("pesado", "deepseek-flash", async () => fakeGateways);
    expect(resMedio).toHaveLength(1);
    expect(resMedio[0].modelHeavy).toBe("deepseek-v4-pro");
    expect(resPesado).toHaveLength(1);
    expect(resPesado[0].modelHeavy).toBe("deepseek-v4-pro");
  });

  it("loader com erro → lista vazia", async () => {
    const res = await loadPaidGatewaysForTier("pesado", "deepseek-flash", async () => {
      throw new Error("falha simulada no loader");
    });
    expect(res).toEqual([]);
  });
});
