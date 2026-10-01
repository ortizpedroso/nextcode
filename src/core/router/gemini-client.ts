const FAST_MODEL_FALLBACK = process.env.GEMINI_FAST_MODEL || "gemini-1.5-flash";

let cachedModels: string[] | null = null;

/**
 * Consulta dinamicamente a API do Google para obter TODOS os modelos ativos
 * e suportados especificamente para a chave informada via /v1beta/models.
 */
export async function getAvailableGeminiModels(apiKey: string): Promise<string[]> {
  if (cachedModels && cachedModels.length > 0) {
    return cachedModels;
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
    if (res.ok) {
      const data = await res.json();
      const models: Array<{ name: string; supportedGenerationMethods?: string[]; supportedActions?: string[] }> = data.models || [];

      // Filtra modelos que suportam geração de conteúdo e remove obsoletos (2.5)
      const valid = models
        .filter((m) => {
          const methods = m.supportedGenerationMethods || m.supportedActions || [];
          return methods.length === 0 || methods.includes("generateContent");
        })
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((name) => name && !name.includes("2.5"));

      if (valid.length > 0) {
        // Ordena com preferências de estabilidade/velocidade: 1.5-flash -> 2.0-flash -> 1.5-pro
        const sorted = valid.sort((a, b) => {
          const rank = (name: string) => {
            if (name === "gemini-1.5-flash") return 1;
            if (name === "gemini-2.0-flash") return 2;
            if (name.includes("1.5-flash")) return 3;
            if (name.includes("2.0-flash")) return 4;
            if (name === "gemini-1.5-pro") return 5;
            if (name.includes("pro")) return 6;
            if (name.includes("flash")) return 7;
            return 10;
          };
          return rank(a) - rank(b);
        });

        cachedModels = sorted;
        console.log(`[NextCode] Catálogo dinâmico resolvido para a chave Gemini: ${sorted.join(", ")}`);
        return sorted;
      }
    }
  } catch (error) {
    console.warn("[NextCode] Falha ao consultar /v1beta/models para a chave:", error);
  }

  return [FAST_MODEL_FALLBACK, "gemini-2.0-flash", "gemini-1.5-pro"];
}

export async function resolveAvailableGeminiModel(apiKey: string): Promise<string> {
  const models = await getAvailableGeminiModels(apiKey);
  return models[0] || FAST_MODEL_FALLBACK;
}

/**
 * Invalida o cache de modelos para forçar re-descoberta na próxima requisição
 */
export function invalidateGeminiModelCache() {
  cachedModels = null;
}
