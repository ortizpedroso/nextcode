import { loadGatewayConfigs, type GatewayConfig } from "@/core/llm/gateways";

/**
 * Gateways pagos (heavyFirst) para executor/avaliador. Nunca inclui FreeLLMAPI nem OmniRoute.
 * nivel 'rapido' troca o modelo pesado pelo modelo pago barato; os demais mantêm o modelo pesado.
 */
export async function loadPaidGatewaysForTier(
  nivel: "rapido" | "medio" | "pesado",
  modeloPagoBarato: string,
  loader: () => Promise<GatewayConfig[]> = loadGatewayConfigs
): Promise<GatewayConfig[]> {
  try {
    const paid = (await loader()).filter((g) => g.heavyFirst === true);
    if (nivel === "rapido") {
      return paid.map((g) => ({ ...g, modelHeavy: modeloPagoBarato }));
    }
    return paid;
  } catch {
    return [];
  }
}
