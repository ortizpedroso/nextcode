let cachedModelName: string | null = null;

/**
 * Resolve dinamicamente o modelo do Gemini suportado e ativo para a chave informada
 * via chamada oficial ao endpoint ListModels (https://generativelanguage.googleapis.com/v1beta/models)
 */
export async function resolveAvailableGeminiModel(apiKey: string): Promise<string> {
  if (cachedModelName) {
    return cachedModelName;
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const models: Array<{ name: string; supportedGenerationMethods?: string[] }> = data.models || [];

      // Filtra apenas modelos que suportam generateContent
      const generateModels = models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));

      // Prioridade: 3.5-flash > 3.7-flash > 3.8-flash > qualquer variante flash
      const preferred =
        generateModels.find((m) => m === "gemini-3.5-flash") ||
        generateModels.find((m) => m === "gemini-3.7-flash") ||
        generateModels.find((m) => m.includes("3.5-flash")) ||
        generateModels.find((m) => m.includes("3.7-flash")) ||
        generateModels.find((m) => m.includes("3.8-flash")) ||
        generateModels.find((m) => m.includes("flash")) ||
        "gemini-3.5-flash";

      cachedModelName = preferred.replace(/^models\//, "");
      console.log(`[NextCode] Modelo Gemini resolvido dinamicamente: ${cachedModelName}`);
      return cachedModelName;
    }
  } catch (error) {
    console.warn("[NextCode] Falha ao listar modelos via ListModels, utilizando fallback seguro:", error);
  }

  // Fallback padrão seguro
  return "gemini-3.5-flash";
}

/**
 * Invalida o cache de modelo para forçar re-descoberta na próxima requisição
 */
export function invalidateGeminiModelCache() {
  cachedModelName = null;
}
