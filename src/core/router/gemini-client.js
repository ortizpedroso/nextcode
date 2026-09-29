// FIX: único ID garantidamente válido na v1beta hoje; sobrescrevível por env.
const FAST_MODEL_FALLBACK = process.env.GEMINI_FAST_MODEL || "gemini-3.6-flash";
let cachedModelName = null;
/**
 * Resolve dinamicamente o modelo do Gemini suportado e ativo para a chave informada
 * via chamada oficial ao endpoint ListModels (https://generativelanguage.googleapis.com/v1beta/models)
 */
export async function resolveAvailableGeminiModel(apiKey) {
    if (cachedModelName) {
        return cachedModelName;
    }
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (res.ok) {
            const data = await res.json();
            const models = data.models || [];
            // Filtra apenas modelos que suportam generateContent
            const generateModels = models
                .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
                .map((m) => m.name.replace(/^models\//, ""));
            const preferred = generateModels.find((m) => m === "gemini-3.6-flash") ||
                generateModels.find((m) => m === "gemini-3.1-pro-preview") ||
                generateModels.find((m) => m.includes("3.6-flash")) ||
                generateModels.find((m) => m.includes("3.5-flash-lite")) ||
                generateModels.find((m) => m.includes("flash"));
            if (!preferred) {
                console.warn("[NextCode] ListModels não expõe nenhum modelo *-flash para esta chave.");
                return "";
            }
            cachedModelName = preferred.replace(/^models\//, "");
            console.log(`[NextCode] Modelo Gemini resolvido dinamicamente: ${cachedModelName}`);
            return cachedModelName;
        }
    }
    catch (error) {
        console.warn("[NextCode] Falha ao listar modelos via ListModels, utilizando fallback seguro:", error);
    }
    // Fallback padrão seguro: único ID garantidamente válido na v1beta hoje.
    return FAST_MODEL_FALLBACK;
}
/**
 * Invalida o cache de modelo para forçar re-descoberta na próxima requisição
 */
export function invalidateGeminiModelCache() {
    cachedModelName = null;
}
