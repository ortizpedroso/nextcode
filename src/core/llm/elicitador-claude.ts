/**
 * Elicitador Claude direto (P5c, decisão do fundador 15/10 — medicoes.md).
 *
 * Claude Opus 5.5 é o primeiro modelo do elicitador com teto expandido (48.000 tokens)
 * e prazo próprio (540 s). O gateway de LLM fica de reserva.
 * P5c.3: resposta por streaming — o fetch do Node encerra se os cabeçalhos demoram >300 s
 * sem stream; a Anthropic só envia cabeçalhos HTTP após o corpo completo em modo não-stream.
 */
import type { UsageLike } from "@/core/llm/cost";
import { safeFetch } from "@/core/security/safe-fetch";

export const ELICITADOR_CLAUDE_MAX_TOKENS = 48000;
export const ELICITADOR_CLAUDE_TIMEOUT_MS = 540_000;

export type ElicitadorClaudeResult =
  | { ok: true; text: string; model: string; usage: UsageLike | null; stopReason: string | null; ms: number }
  | { ok: false; detail: string };

function mergeUsage(base: UsageLike | null, patch: UsageLike | null): UsageLike | null {
  if (!patch) return base;
  if (!base) return { ...patch };
  return { ...base, ...patch };
}

function parseSseEvents(buffer: string): { events: Array<{ event?: string; data: string }>; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: Array<{ event?: string; data: string }> = [];
  for (const block of parts) {
    if (!block.trim()) continue;
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join("\n") });
    }
  }
  return { events, rest };
}

async function readAnthropicMessageStream(
  body: ReadableStream<Uint8Array>,
  key: string
): Promise<
  | { ok: true; text: string; usage: UsageLike | null; stopReason: string | null }
  | { ok: false; detail: string }
> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: UsageLike | null = null;
  let stopReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const { events, rest } = parseSseEvents(buffer);
    buffer = rest;

    for (const ev of events) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = parsed.type as string | undefined;
      if (type === "error") {
        const errObj = parsed.error as { message?: string } | undefined;
        const msg = errObj?.message ?? "erro";
        const detail = `stream ${msg}`.slice(0, 140);
        const safeDetail = key ? detail.split(key).join("••••") : detail;
        return { ok: false, detail: safeDetail };
      }
      if (type === "message_start") {
        const message = parsed.message as { usage?: UsageLike } | undefined;
        if (message?.usage) usage = mergeUsage(usage, message.usage);
      }
      if (type === "content_block_delta") {
        const delta = parsed.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
        }
      }
      if (type === "message_delta") {
        const delta = parsed.delta as { stop_reason?: string } | undefined;
        if (delta?.stop_reason) stopReason = delta.stop_reason;
        const patch = parsed.usage as UsageLike | undefined;
        if (patch) usage = mergeUsage(usage, patch);
      }
    }
  }

  if (buffer.trim()) {
    const { events } = parseSseEvents(`${buffer}\n\n`);
    for (const ev of events) {
      try {
        const parsed = JSON.parse(ev.data) as Record<string, unknown>;
        const type = parsed.type as string | undefined;
        if (type === "content_block_delta") {
          const delta = parsed.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") text += delta.text;
        }
      } catch {
        /* ignore trailing partial */
      }
    }
  }

  if (!text.trim()) {
    return { ok: false, detail: "resposta sem texto" };
  }
  return { ok: true, text, usage, stopReason };
}

export async function callElicitadorClaude(opts: {
  messages: ReadonlyArray<{ role: string; content: string }>;
  claudeKey: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ElicitadorClaudeResult> {
  const key = (opts.claudeKey || "").trim();

  if (!key || key.startsWith("••••") || key.startsWith("****")) {
    return { ok: false, detail: "sem chave Claude" };
  }

  try {
    const model = process.env.ELICITADOR_CLAUDE_MODEL || "claude-opus-5-5";

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

    const bodyObj: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? ELICITADOR_CLAUDE_MAX_TOKENS,
      stream: true,
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
          /* ignora */
        }
      }
      const rawDetail = errText ? `HTTP ${res.status} ${errText.trim()}` : `HTTP ${res.status}`;
      const safeDetail = key ? rawDetail.split(key).join("••••") : rawDetail;
      return { ok: false, detail: safeDetail.slice(0, 140) };
    }

    if (!res.body) {
      return { ok: false, detail: "stream sem corpo" };
    }

    const streamResult = await readAnthropicMessageStream(res.body, key);
    const ms = Date.now() - startMs;

    if (!streamResult.ok) {
      return streamResult;
    }

    return {
      ok: true,
      text: streamResult.text,
      model,
      usage: streamResult.usage,
      stopReason: streamResult.stopReason,
      ms,
    };
  } catch (err) {
    const errStr = String(err);
    const safeStr = key ? errStr.split(key).join("••••") : errStr;
    return { ok: false, detail: safeStr.slice(0, 140) };
  }
}
