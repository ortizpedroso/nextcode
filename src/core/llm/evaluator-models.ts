/**
 * Avaliador forte (Trava T4/T5): modelo pago e, de preferência, de família diferente do executor.
 *
 * Cadeia (decisão do fundador, 07/10): Gemini Pro → Claude → DeepSeek. Um provedor que responde
 * "sem crédito" ou "chave inválida" fica de fora por 10 min, para não pagar latência a cada etapa.
 * Se nenhum pago responder, quem chama decide o que fazer (hoje: rota gratuita, marcada na trilha).
 */
import { readSecret } from "@/core/security/crypto";
import type { UsageLike } from "@/core/llm/cost";

export type EvaluatorProvider = "gemini" | "claude" | "deepseek";

export interface EvaluatorCandidate {
  provider: EvaluatorProvider;
  model: string;
}

export const EVALUATOR_CHAIN: EvaluatorCandidate[] = [
  { provider: "gemini", model: process.env.EVALUATOR_GEMINI_MODEL || "gemini-3.1-pro-preview" },
  { provider: "claude", model: process.env.EVALUATOR_CLAUDE_MODEL || "claude-sonnet-5-5" },
  { provider: "deepseek", model: process.env.EVALUATOR_DEEPSEEK_MODEL || "deepseek-v4-pro" },
];

export interface EvaluatorKeys {
  geminiKey?: string | null;
  claudeKey?: string | null;
  deepseekKey?: string | null;
}

export interface EvaluatorCallResult {
  content: string | null;
  provider: EvaluatorProvider | null;
  model: string | null;
  /** Família diferente do executor (o executor hoje é DeepSeek). */
  independent: boolean;
  /** Uso de tokens informado pelo provedor (para o custo). */
  usage?: UsageLike | null;
  failures: string[];
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const SKIP_MS = 10 * 60_000;
const skippedUntil = new Map<EvaluatorProvider, number>();

export function resetEvaluatorState(): void {
  skippedUntil.clear();
}

function keyFor(provider: EvaluatorProvider, keys: EvaluatorKeys): string {
  const raw = provider === "gemini" ? keys.geminiKey : provider === "claude" ? keys.claudeKey : keys.deepseekKey;
  return readSecret(raw).trim();
}

/** 401/402/403 e "credit" no corpo = problema de conta: não adianta tentar de novo agora. */
function isAccountProblem(status: number, body: string): boolean {
  return status === 401 || status === 402 || status === 403 || /credit|billing|prepayment/i.test(body);
}

async function callOne(
  c: EvaluatorCandidate,
  apiKey: string,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<{ ok: true; content: string; usage: UsageLike | null } | { ok: false; status: number; body: string }> {
  if (c.provider === "claude") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        max_tokens: 4000,
        system,
        messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      }),
      signal,
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body };
    const json = JSON.parse(body);
    const text = (json.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    return { ok: true, content: text, usage: json.usage ?? null };
  }

  const url =
    c.provider === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      : "https://api.deepseek.com/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: c.model, messages, max_tokens: 8000 }),
    signal,
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  const json = JSON.parse(body);
  return { ok: true, content: json?.choices?.[0]?.message?.content ?? "", usage: json?.usage ?? null };
}

export async function dispatchStrongEvaluator(
  messages: ChatMessage[],
  keys: EvaluatorKeys,
  opts: { timeoutMs?: number; executorFamily?: EvaluatorProvider } = {}
): Promise<EvaluatorCallResult> {
  const executorFamily = opts.executorFamily ?? "deepseek";
  const failures: string[] = [];
  for (const c of EVALUATOR_CHAIN) {
    const apiKey = keyFor(c.provider, keys);
    if (!apiKey) {
      failures.push(`${c.provider}: sem chave`);
      continue;
    }
    if ((skippedUntil.get(c.provider) ?? 0) > Date.now()) {
      failures.push(`${c.provider}: fora por falta de crédito/chave (pausa de 10 min)`);
      continue;
    }
    try {
      const r = await callOne(c, apiKey, messages, AbortSignal.timeout(opts.timeoutMs ?? 120_000));
      if (r.ok && r.content.trim()) {
        return {
          content: r.content,
          provider: c.provider,
          model: c.model,
          independent: c.provider !== executorFamily,
          failures,
          usage: r.usage,
        };
      }
      if (!r.ok) {
        if (isAccountProblem(r.status, r.body)) skippedUntil.set(c.provider, Date.now() + SKIP_MS);
        failures.push(`${c.provider}/${c.model}: HTTP ${r.status} ${r.body.replace(/\s+/g, " ").slice(0, 140)}`);
      } else {
        failures.push(`${c.provider}/${c.model}: resposta vazia`);
      }
    } catch (err) {
      failures.push(`${c.provider}/${c.model}: ${String(err).slice(0, 140)}`);
    }
  }
  return { content: null, provider: null, model: null, independent: false, failures };
}
