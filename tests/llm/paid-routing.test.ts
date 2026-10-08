import { describe, it, expect } from "vitest";
import { loadPaidGatewaysForTier, type PaidRoutingConfig } from "@/core/llm/paid-routing";
import type { GatewayConfig } from "@/core/llm/gateways";

const defaultCfg: PaidRoutingConfig = {
  modeloPagoForte: "deepseek-v4-pro",
  modeloPagoBarato: "deepseek-flash",
  perfilFreellmapiForte: "",
  perfilFreellmapiBarato: "",
};

const fakeGateways: GatewayConfig[] = [
  {
    id: "freellmapi",
    enabled: true,
    priority: 1,
    baseUrl: "http://localhost:3100/v1",
    apiKey: "free-test-key",
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

describe("R1.3b — loadPaidGatewaysForTier", () => {
  it("perfis vazios (padrão): só deepseek-v4-pro no freellmapi (medio/pesado)", async () => {
    const resMedio = await loadPaidGatewaysForTier("medio", defaultCfg, async () => fakeGateways);
    const resPesado = await loadPaidGatewaysForTier("pesado", defaultCfg, async () => fakeGateways);
    expect(resMedio).toEqual([
      {
        ...fakeGateways[0],
        heavyFirst: true,
        modelFast: null,
        modelHeavy: "deepseek-v4-pro",
      },
    ]);
    expect(resPesado).toEqual(resMedio);
  });

  it("perfis vazios: rapido usa deepseek-flash", async () => {
    const res = await loadPaidGatewaysForTier("rapido", defaultCfg, async () => fakeGateways);
    expect(res).toEqual([
      {
        ...fakeGateways[0],
        heavyFirst: true,
        modelFast: null,
        modelHeavy: "deepseek-flash",
      },
    ]);
  });

  it("com perfil configurado: auto:<perfil> primeiro e depois o modelo fixo", async () => {
    const cfgWithProfiles: PaidRoutingConfig = {
      modeloPagoForte: "deepseek-v4-pro",
      modeloPagoBarato: "deepseek-flash",
      perfilFreellmapiForte: " paid-strong ",
      perfilFreellmapiBarato: " paid-fast ",
    };
    const resPesado = await loadPaidGatewaysForTier("pesado", cfgWithProfiles, async () => fakeGateways);
    expect(resPesado.map((g) => ({ id: g.id, modelHeavy: g.modelHeavy, modelFast: g.modelFast, heavyFirst: g.heavyFirst }))).toEqual([
      { id: "freellmapi", modelHeavy: "auto:paid-strong", modelFast: null, heavyFirst: true },
      { id: "freellmapi", modelHeavy: "deepseek-v4-pro", modelFast: null, heavyFirst: true },
    ]);

    const resRapido = await loadPaidGatewaysForTier("rapido", cfgWithProfiles, async () => fakeGateways);
    expect(resRapido.map((g) => ({ id: g.id, modelHeavy: g.modelHeavy, modelFast: g.modelFast, heavyFirst: g.heavyFirst }))).toEqual([
      { id: "freellmapi", modelHeavy: "auto:paid-fast", modelFast: null, heavyFirst: true },
      { id: "freellmapi", modelHeavy: "deepseek-flash", modelFast: null, heavyFirst: true },
    ]);
  });

  it("deepseek direto e omniroute nunca entram", async () => {
    const res = await loadPaidGatewaysForTier("pesado", defaultCfg, async () => fakeGateways);
    expect(res.every((g) => g.id === "freellmapi")).toBe(true);
    expect(res.some((g) => g.id === "deepseek" || g.id === "omniroute")).toBe(false);
  });

  it("sem freellmapi → lista vazia", async () => {
    const withoutFree = fakeGateways.filter((g) => g.id !== "freellmapi");
    const res = await loadPaidGatewaysForTier("pesado", defaultCfg, async () => withoutFree);
    expect(res).toEqual([]);
  });

  it("nenhum item usa auto, auto:smart ou auto:fast", async () => {
    for (const nivel of ["rapido", "medio", "pesado"] as const) {
      const res = await loadPaidGatewaysForTier(nivel, defaultCfg, async () => fakeGateways);
      for (const g of res) {
        expect(g.modelFast).toBeNull();
        expect(["auto", "auto:smart", "auto:fast"]).not.toContain(g.modelHeavy);
      }
    }
  });

  it("loader com erro → lista vazia", async () => {
    const res = await loadPaidGatewaysForTier("pesado", defaultCfg, async () => {
      throw new Error("falha simulada no loader");
    });
    expect(res).toEqual([]);
  });
});
