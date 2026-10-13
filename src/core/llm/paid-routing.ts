import { loadGatewayConfigs, type GatewayConfig } from "@/core/llm/gateways";

export interface PaidRoutingConfig {
  modeloPagoForte: string;
  modeloPagoBarato: string;
  perfilFreellmapiForte: string;
  perfilFreellmapiBarato: string;
}

export interface PaidRoutingOptions {
  /** Família usada pelo avaliador — o executor é estritamente proibido de coincidir */
  evaluatorFamily?: string;
  /** Se deve incluir modelos de contingência técnica aprovados */
  enableContingencyFallback?: boolean;
}

/**
 * Modelos de contingência técnica para o executor quando a rota primária sofre 402/429.
 * Ordem hierárquica por força técnica em código:
 * 1. qwen-2.5-coder-32b-instruct (família qwen)
 * 2. deepseek-v4-flash (família deepseek)
 */
export const CONTINGENCY_EXECUTOR_MODELS: { model: string; family: string }[] = [
  { model: "codestral-latest", family: "mistral" },
  { model: "deepseek-v4-flash", family: "deepseek" },
  { model: "qwen3-coder-30-a3b-instruct", family: "qwen" },
  { model: "qwen-2.5-coder-32b-instruct", family: "qwen" },
];

/**
 * Rota dos papéis críticos: SOMENTE FreeLLMAPI (DeepSeek direto fora e OmniRoute pausado — decisões de 08/10).
 * 1º perfil pago (auto:<perfil>); 2º modelo pago fixo; 3º modelos de contingência (se ativos e independentes do avaliador).
 * Nunca auto / auto:smart / auto:fast.
 * Quem garante que a resposta veio de provedor pago é a trava X-Routed-Via no SmartRouter.
 */
export async function loadPaidGatewaysForTier(
  nivel: "rapido" | "medio" | "pesado",
  cfg: PaidRoutingConfig,
  loader: () => Promise<GatewayConfig[]> = loadGatewayConfigs,
  options?: PaidRoutingOptions
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
    const primaryModel = barato ? cfg.modeloPagoBarato : cfg.modeloPagoForte;
    list.push({
      ...free,
      heavyFirst: true,
      modelFast: null,
      modelHeavy: primaryModel,
    });

    // Cascata Governada: Se habilitado fallback de contingência, adiciona modelos alternativos
    // respeitando a Trava de Independência (executor NÃO pode ser da mesma família do avaliador).
    if (options?.enableContingencyFallback) {
      const evalFamily = (options.evaluatorFamily || "").toLowerCase();
      for (const item of CONTINGENCY_EXECUTOR_MODELS) {
        if (item.model !== primaryModel && item.family.toLowerCase() !== evalFamily) {
          list.push({
            ...free,
            heavyFirst: true,
            modelFast: null,
            modelHeavy: item.model,
          });
        }
      }
    }

    return list;
  } catch {
    return [];
  }
}
