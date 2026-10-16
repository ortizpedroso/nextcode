/**
 * Elicitador Claude direto (P5c, decisão do fundador 15/10 — medicoes.md).
 *
 * Chamada direta à API da Anthropic para a fase de Spec:
 * Claude Opus 5.5 é o primeiro modelo do elicitador com teto expandido (48.000 tokens)
 * e prazo próprio (540 s). O gateway de LLM fica de reserva.
 */
import type { UsageLike } from "@/core/llm/cost";
import { safeFetch } from "@/core/security/safe-fetch";

export const ELICITADOR_CLAUDE_MAX_TOKENS = 48000;
export const ELICITADOR_CLAUDE_TIMEOUT_MS = 540_000;

export type ElicitadorClaudeResult =
  | { ok: true; text: string; model: string; usage: UsageLike | null; stopReason: string | null; ms: number }
  | { ok: false; detail: string };

export async function callElicitadorClaude(opts: {
  messages: ReadonlyArray<{ role: string; content: string }>;
  claudeKey: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ElicitadorClaudeResult> {
  const key = (opts.claudeKey || "").trim();

  // 1. Chave vazia (após trim) ou começando com "••••" ou "****"
  if (!key || key.startsWith("••••") || key.startsWith("****")) {
    return { ok: false, detail: "sem chave Claude" };
  }

  try {
    // 2. Modelo configurável via ambiente ou padrão claude-opus-5-5
    const model = process.env.ELICITADOR_CLAUDE_MODEL || "claude-opus-5-5";

    // 3. system = conteúdos das mensagens com role === "system", unidos por "\n\n"
    const systemParts: string[] = [];
    const nonSystemMsgs: Array<{ role: string; content: string }> = [];
    for (const m of opts.messages) {
      if (m.role === "system") {
        if (m.content) systemParts.push(m.content);
      } else {
        nonSystemMsgs.push(m);
      }
    }
    const system = systemParts.join("\n\n");

    // 4. Demais mensagens: role === "assistant" fica assistant; qualquer outro vira user.
    // Descarte assistant antes do primeiro user. Una mensagens seguidas do mesmo papel com "\n\n".
    const mapped = nonSystemMsgs.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    let firstUserIndex = -1;
    for (let i = 0; i < mapped.length; i++) {
      if (mapped[i].role === "user") {
        firstUserIndex = i;
        break;
      }
    }
    if (firstUserIndex === -1) {
      return { ok: false, detail: "sem mensagem do usuário" };
    }

    const afterLeadingAssistant = mapped.slice(firstUserIndex);
    const coalesced: Array<{ role: string; content: string }> = [];
    for (const msg of afterLeadingAssistant) {
      const last = coalesced[coalesced.length - 1];
      if (last && last.role === msg.role) {
        last.content = `${last.content}\n\n${msg.content}`;
      } else {
        coalesced.push({ role: msg.role, content: msg.content });
      }
    }

    if (coalesced.length === 0) {
      return { ok: false, detail: "sem mensagem do usuário" };
    }

    // 5. Chamada via safeFetch
    const bodyObj: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? ELICITADOR_CLAUDE_MAX_TOKENS,
      messages: coalesced,
    };
    if (system) {
      bodyObj.system = system;
    }

    const startMs = Date.now();
    const timeoutMs =
      opts.timeoutMs ?? (Number(process.env.ELICITADOR_TIMEOUT_MS) || ELICITADOR_CLAUDE_TIMEOUT_MS);

    const res = await safeFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyObj),
      timeoutMs,
    });
    const ms = Date.now() - startMs;

    // 6. Status diferente de 200
    if (res.status !== 200) {
      let errText = "";
      try {
        const errJson = await res.json();
        if (errJson?.error?.message) {
          errText = String(errJson.error.message);
        } else if (typeof errJson === "string") {
          errText = errJson;
        } else {
          errText = JSON.stringify(errJson);
        }
      } catch {
        try {
          errText = await res.text();
        } catch {
          // ignora
        }
      }
      const rawDetail = errText ? `HTTP ${res.status} ${errText.trim()}` : `HTTP ${res.status}`;
      const safeDetail = key ? rawDetail.split(key).join("••••") : rawDetail;
      return { ok: false, detail: safeDetail.slice(0, 140) };
    }

    // 7. text = junção dos blocos content com type === "text"
    const json = await res.json();
    const contentBlocks = Array.isArray(json?.content) ? json.content : [];
    const textBlocks = contentBlocks
      .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text);
    const text = textBlocks.join("");

    if (!text.trim()) {
      return { ok: false, detail: "resposta sem texto" };
    }

    // 8. Sucesso
    return {
      ok: true,
      text,
      model,
      usage: json.usage ?? null,
      stopReason: json.stop_reason ?? null,
      ms,
    };
  } catch (err) {
    // 9. Qualquer exceção
    const errStr = String(err);
    const safeStr = key ? errStr.split(key).join("••••") : errStr;
    return { ok: false, detail: safeStr.slice(0, 140) };
  }
}
