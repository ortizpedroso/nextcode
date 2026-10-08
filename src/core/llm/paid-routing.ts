import { loadGatewayConfigs, type GatewayConfig } from "@/core/llm/gateways";

export interface PaidRoutingConfig {
  modeloPagoForte: string;
  modeloPagoBarato: string;
  perfilFreellmapiForte: string;
  perfilFreellmapiBarato: string;
}

/**
 * Rota dos papéis críticos: SOMENTE FreeLLMAPI (DeepSeek direto fora e OmniRoute pausado — decisões de 08/10).
 * 1º perfil pago (auto:<perfil>); 2º modelo pago fixo. Nunca auto / auto:smart / auto:fast.
 * Quem garante que a resposta veio de provedor pago é a trava X-Routed-Via no SmartRouter.
 */
export async function loadPaidGatewaysForTier(
  nivel: "rapido" | "medio" | "pesado",
  cfg: PaidRoutingConfig,
  loader: () => Promise<GatewayConfig[]> = loadGatewayConfigs
): Promise<GatewayConfig[]> {
  try {
    const free = (await loader()).find((g) => g.id === "freellmapi");
    if (!free) return [];
    const barato = nivel === "rapido";
    const perfil = (barato ? cfg.perfilFreellmapiBarato : cfg.perfilFreellmapiForte).trim();
    const list: GatewayConfig[] = [];
    if (perfil) {
      list.push({
        ...free,
        heavyFirst: true,
        modelFast: null,
        modelHeavy: `auto:${perfil}`,
      });
    }
    list.push({
      ...free,
      heavyFirst: true,
      modelFast: null,
      modelHeavy: barato ? cfg.modeloPagoBarato : cfg.modeloPagoForte,
    });
    return list;
  } catch {
    return [];
  }
}
