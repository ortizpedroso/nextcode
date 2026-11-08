/** Parse do laudo JSON da skill conferente-macrobrief (contrato do harness). */

import type { ChatCompletionJson } from "@/core/llm/chat-completion-text";
import { coerceAssistantContent, extractAssistantTextFromCompletion } from "@/core/llm/chat-completion-text";

export type ConferenteLaudo = {
  aprovado: boolean;
  falhas: Array<{ req: string; tipo: string; descricao: string; correcao: string }>;
  incertos: Array<{ req: string; pergunta: string }>;
};

/** Remove ruído comum antes de extrair JSON (think tags, preâmbulo). */
export function stripConferenteNoise(content: string): string {
  return content
    .replace(/[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

/** Primeiro objeto `{…}` com chaves balanceadas (strings com `}` não quebram). */
export function extractBalancedJsonSlice(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonObjectLoose(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = slice.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired);
  }
}

export function extractJsonObject(content: string): unknown {
  const cleaned = stripConferenteNoise(content);
  const trimmed = cleaned.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = (fenced ? fenced[1] : trimmed).trim();
  const balanced = extractBalancedJsonSlice(unfenced);
  if (balanced) return parseJsonObjectLoose(balanced);
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("sem objeto JSON");
  return parseJsonObjectLoose(unfenced.slice(start, end + 1));
}

function coerceAprovado(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "sim" || v === "yes") return true;
    if (v === "false" || v === "nao" || v === "não" || v === "no") return false;
  }
  return false;
}

export function parseConferenteLaudoFromText(content: string): { ok: true; laudo: ConferenteLaudo } | { ok: false } {
  if (!content.trim()) return { ok: false };
  try {
    const parsedLaudo = extractJsonObject(content) as {
      aprovado?: unknown;
      falhas?: unknown;
      incertos?: unknown;
    };
    return {
      ok: true,
      laudo: {
        aprovado: coerceAprovado(parsedLaudo.aprovado),
        falhas: Array.isArray(parsedLaudo.falhas) ? (parsedLaudo.falhas as ConferenteLaudo["falhas"]) : [],
        incertos: Array.isArray(parsedLaudo.incertos) ? (parsedLaudo.incertos as ConferenteLaudo["incertos"]) : [],
      },
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Texto bruto para parse do laudo: `message.content` e, se vazio ou ilegível,
 * `reasoning_content` (modelos que raciocinam fora do content).
 */
export function extractConferenteLaudoCandidates(json: ChatCompletionJson | null | undefined): string[] {
  if (!json) return [];
  const out: string[] = [];
  const primary = extractAssistantTextFromCompletion(json).trim();
  if (primary) out.push(primary);
  const msg = json.choices?.[0]?.message;
  const reasoning = coerceAssistantContent(msg?.reasoning_content).trim();
  if (reasoning && reasoning !== primary) out.push(reasoning);
  return out;
}

export function parseConferenteLaudoFromCompletion(
  json: ChatCompletionJson | null | undefined
): { ok: true; laudo: ConferenteLaudo } | { ok: false; candidates: number } {
  const candidates = extractConferenteLaudoCandidates(json);
  for (const text of candidates) {
    const parsed = parseConferenteLaudoFromText(text);
    if (parsed.ok) return parsed;
  }
  return { ok: false, candidates: candidates.length };
}
