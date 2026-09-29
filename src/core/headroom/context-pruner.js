export class ContextPruner {
    /**
     * Sanitiza e trunca mensagens de contexto antes de enviar para a LLM
     */
    static pruneContextWithHeadroom(messages, options = {}) {
        const enabled = options.enabled !== false;
        const maxLogLines = options.maxLogLines || 50;
        let originalTokensAcc = 0;
        let prunedTokensAcc = 0;
        const prunedMessages = messages.map((msg) => {
            const originalMsgTokens = Math.ceil(msg.content.length / 4);
            originalTokensAcc += originalMsgTokens;
            if (!enabled) {
                prunedTokensAcc += originalMsgTokens;
                return msg;
            }
            const sanitizedContent = ContextPruner.sanitizeContent(msg.content, maxLogLines);
            const prunedMsgTokens = Math.ceil(sanitizedContent.length / 4);
            prunedTokensAcc += prunedMsgTokens;
            return {
                ...msg,
                content: sanitizedContent,
            };
        });
        const tokensSaved = Math.max(0, originalTokensAcc - prunedTokensAcc);
        return {
            messages: prunedMessages,
            originalTokens: originalTokensAcc,
            prunedTokens: prunedTokensAcc,
            tokensSaved,
        };
    }
    /**
     * Trunca saídas de terminal brutas para salvar tokens (usado pelo SandboxedTerminal)
     */
    static prune(text, options = {}) {
        const maxLines = options.maxLines || 50;
        return ContextPruner.sanitizeContent(text, maxLines);
    }
    static sanitizeContent(content, maxLogLines) {
        const lines = content.split("\n");
        if (lines.length <= maxLogLines + 10) {
            return content;
        }
        const headLinesCount = Math.floor(maxLogLines / 2);
        const tailLinesCount = Math.ceil(maxLogLines / 2);
        const head = lines.slice(0, headLinesCount).join("\n");
        const tail = lines.slice(-tailLinesCount).join("\n");
        const removedCount = lines.length - maxLogLines;
        return `${head}\n\n[... Headroom Token Guard: ${removedCount} linhas repetitivas truncadas para economizar tokens ...]\n\n${tail}`;
    }
}
export function pruneContextWithHeadroom(messages, options) {
    return ContextPruner.pruneContextWithHeadroom(messages, options);
}
