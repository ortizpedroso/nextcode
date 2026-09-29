export class IntentRouter {
    static HEAVY_KEYWORDS = [
        "refactor",
        "architecture",
        "architectural",
        "security",
        "audit",
        "complex",
        "optimize",
        "database schema",
        "migration",
        "dag",
        "mcp server",
        "decompor",
        "recriar",
    ];
    static FAST_KEYWORDS = [
        "format",
        "fix typo",
        "explain",
        "summarize",
        "quick",
        "rename",
        "simple",
        "status",
        "list",
    ];
    /**
     * Classifica a tarefa entre as camadas 'fast' (Gemini Flash) e 'heavy' (Claude Sonnet / Gemini Pro)
     */
    route(task) {
        const text = (task.prompt + " " + (task.context || "")).toLowerCase();
        const tokenEstimate = Math.ceil(text.length / 4);
        let heavyScore = 0;
        let fastScore = 0;
        for (const keyword of IntentRouter.HEAVY_KEYWORDS) {
            if (text.includes(keyword)) {
                heavyScore += 2;
            }
        }
        for (const keyword of IntentRouter.FAST_KEYWORDS) {
            if (text.includes(keyword)) {
                fastScore += 1;
            }
        }
        // Se o texto for excessivamente grande (> 2000 tokens estimados), favorece a camada 'heavy'
        if (tokenEstimate > 2000) {
            heavyScore += 3;
        }
        // Se a role exigir planejamento ou arquitetura
        if (task.role === "architect" || task.role === "decomposer") {
            heavyScore += 4;
        }
        const isHeavy = heavyScore >= fastScore && heavyScore > 0;
        const tier = isHeavy ? "heavy" : "fast";
        const targetModel = isHeavy ? "claude-3-7-sonnet / gemini-3.1-pro-preview" : "gemini-3.8-flash";
        const confidence = Math.min(1.0, 0.6 + Math.abs(heavyScore - fastScore) * 0.1);
        const reasoning = isHeavy
            ? `Identificados requisitos complexos (score heavy: ${heavyScore}). Roteado para camada HEAVY (${targetModel}).`
            : `Instrução direta ou de baixa complexidade (score fast: ${fastScore}). Roteado para camada FAST (${targetModel}).`;
        return {
            tier,
            targetModel,
            confidence: parseFloat(confidence.toFixed(2)),
            reasoning,
            estimatedTokens: tokenEstimate,
        };
    }
}
