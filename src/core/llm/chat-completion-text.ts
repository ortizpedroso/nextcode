/**
 * Extrai texto utilizável de respostas OpenAI-compat (FreeLLMAPI, OmniRoute, BYOK).
 * Raciocínio interno (reasoning_content) não é texto do modelo para consumo externo;
 * quando message.content está vazio, devolve vazio e segue para candidates/text.
 */

type ContentPart = { type?: string; text?: string };

/** OpenAI-compat: `content` pode ser string ou array de partes `{ type, text }`. */
export function coerceAssistantContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof (part as ContentPart).text === "string" ? (part as ContentPart).text! : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof raw === "object" && "text" in raw && typeof (raw as ContentPart).text === "string") {
    return (raw as ContentPart).text!;
  }
  return "";
}

export type ChatCompletionJson = {
  choices?: Array<{
    finish_reason?: string;
    text?: string;
    message?: {
      content?: string | null | ContentPart[];
      reasoning_content?: string | null | ContentPart[];
    };
  }>;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
  usage?: unknown;
};

export function completionFinishReason(json: ChatCompletionJson | null | undefined): string {
  return String(json?.choices?.[0]?.finish_reason ?? "");
}

export function extractAssistantTextFromCompletion(json: ChatCompletionJson | null | undefined): string {
  if (!json) return "";
  const msg = json.choices?.[0]?.message;
  const content = coerceAssistantContent(msg?.content).trim();
  if (content) return content;
  const gemini = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof gemini === "string" && gemini.trim()) return gemini.trim();
  const legacy = json.choices?.[0]?.text;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return "";
}
