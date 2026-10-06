import { safeFetch } from "../security/safe-fetch";

// Aliases mantidos pelo Google: sempre apontam para o Flash vigente. Os nomes antigos
// (gemini-1.5-flash, gemini-2.0-flash, 2.5 para contas novas) devolvem 404 "no longer available".
const FAST_MODEL_FALLBACK = process.env.GEMINI_FAST_MODEL || "gemini-flash-latest";
const FALLBACK_MODELS = [FAST_MODEL_FALLBACK, "gemini-flash-lite-latest"];

let cachedModels: string[] | null = null;

/** Modelos que não são de texto (voz, imagem, embedding, áudio, robótica) — nunca servem ao chat. */
const NON_TEXT = /(tts|image|embedding|audio|live|robotics|aqa|imagen|veo|customtools)/i;

/** Versão numérica do nome (gemini-3.6-flash → 3.6); aliases "-latest" contam como os mais novos. */
function modelVersion(name: string): number {
  if (/-latest$/.test(name)) return 99;
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Ordena para chat/código: Flash (não lite) mais novo primeiro, depois Flash Lite, depois o
 * resto; dentro de cada grupo, versão estável antes de preview. "Pro" fica por último porque
 * a camada gratuita da maioria das contas não cobre (429).
 */
export function rankGeminiModels(names: string[]): string[] {
  const group = (n: string) =>
    /pro/.test(n) ? 3 : /flash-lite|lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2;
  return names
    .filter((n) => /^gemini-/.test(n) && !NON_TEXT.test(n))
    .sort((a, b) => {
      const g = group(a) - group(b);
      if (g !== 0) return g;
      const v = modelVersion(b) - modelVersion(a);
      if (v !== 0) return v;
      return Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b));
    });
}

/**
 * Consulta a API do Google para obter os modelos de texto disponíveis para a chave informada
 * (/v1beta/models), ordenados por rankGeminiModels.
 */
export async function getAvailableGeminiModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  if (cachedModels && cachedModels.length > 0) {
    return cachedModels;
  }

  try {
    // Anti-SSRF + timeout: mesma política de saída HTTP do SmartRouter.
    const res = await safeFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }
    );
    if (res.ok) {
      const data = await res.json();
      const models: Array<{ name: string; supportedGenerationMethods?: string[]; supportedActions?: string[] }> = data.models || [];
      const names = models
        .filter((m) => {
          const methods = m.supportedGenerationMethods || m.supportedActions || [];
          return methods.length === 0 || methods.includes("generateContent");
        })
        .map((m) => m.name.replace(/^models\//, ""));
      const sorted = rankGeminiModels(names);
      if (sorted.length > 0) {
        cachedModels = sorted;
        console.log(`[NextCode] Catálogo dinâmico resolvido para a chave Gemini: ${sorted.slice(0, 8).join(", ")}`);
        return sorted;
      }
    }
  } catch (error) {
    console.warn("[NextCode] Falha ao consultar /v1beta/models para a chave:", error);
  }

  return FALLBACK_MODELS;
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
