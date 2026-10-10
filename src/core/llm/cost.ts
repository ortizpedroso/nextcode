/**
 * Custo real das chamadas pagas (teto de custo por projeto — decisão do fundador, 07/10).
 *
 * Preços oficiais em US$ por milhão de tokens, conferidos em 07/10/2026:
 * - DeepSeek v4-pro: https://api-docs.deepseek.com/quick_start/pricing — usa o preço de PICO
 *   (o fora de pico é metade): conservador, o teto nunca é estourado por conta de horário.
 * - Gemini 3.1 Pro (≤200k tokens): https://ai.google.dev/gemini-api/docs/pricing
 * - Claude Sonnet 5.5: https://platform.claude.com/docs/en/about-claude/pricing
 * FreeLLMAPI e modelos sem preço conhecido custam 0 aqui (gratuitos); um modelo pago novo precisa
 * entrar nesta tabela, senão o teto não o enxerga.
 */
import prisma from "@/lib/prisma";

interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

const PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /deepseek-v4-pro/i, price: { input: 1.32, cachedInput: 0.044, output: 3.96 } },
  // Nomes antigos da rota BYOK nativa: sem preço próprio na página atual → preço do v4-pro (conservador).
  { match: /deepseek-(chat|reasoner)/i, price: { input: 1.32, cachedInput: 0.044, output: 3.96 } },
  { match: /deepseek-(v4-)?flash/i, price: { input: 0.3, cachedInput: 0.006, output: 1.2 } },
  { match: /gemini-3\.1-pro/i, price: { input: 2, cachedInput: 0.2, output: 12 } },
  { match: /claude-sonnet-5/i, price: { input: 2, cachedInput: 0.2, output: 10 } },
  { match: /claude-sonnet-4/i, price: { input: 3, cachedInput: 0.3, output: 15 } },
  { match: /claude-opus-5-5/i, price: { input: 4, cachedInput: 0.2, output: 20 } },
  { match: /^jev-/i, price: { input: 0.042, cachedInput: 0.042, output: 0 } },
];

export function priceFor(model: string): ModelPrice | null {
  return PRICES.find((p) => p.match.test(model))?.price ?? null;
}

/** Aceita o formato OpenAI (prompt_tokens/completion_tokens, cache da DeepSeek) e o da Anthropic. */
export interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

export function costFromUsage(model: string, usage: UsageLike | null | undefined): number {
  const price = priceFor(model);
  if (!price || !usage) return 0;
  const cached = usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens ?? 0;
  const input = (usage.prompt_tokens ?? (usage.input_tokens ?? 0) + cached) - cached;
  const output = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return (Math.max(0, input) * price.input + cached * price.cachedInput + output * price.output) / 1_000_000;
}

export const LLM_COST_ACTION = "LLM_COST";

/** Grava o custo de uma chamada na trilha da sessão (append-only). Aguarda a gravação: o teto lê em seguida. */
export async function recordLlmCost(params: {
  sessionId?: string | null;
  nodeId?: string;
  papel: "executor" | "avaliador" | "jev" | "outro";
  provider: string;
  model: string;
  usage: UsageLike | null | undefined;
}): Promise<number> {
  const usd = costFromUsage(params.model, params.usage);
  if (params.sessionId) {
    await prisma.telemetryLog
      .create({
        data: {
          sessionId: params.sessionId,
          action: LLM_COST_ACTION,
          details: JSON.stringify({
            papel: params.papel,
            provider: params.provider,
            model: params.model,
            usd,
            usage: params.usage ?? null,
            ...(params.nodeId ? { nodeId: params.nodeId } : {}),
          }),
        },
      })
      .catch((err) => console.error("[COST] Falha ao registrar custo:", err));
  }
  return usd;
}

/** Soma o custo registrado da sessão. */
export async function sessionCostUsd(sessionId: string): Promise<number> {
  const rows = await prisma.telemetryLog.findMany({
    where: { sessionId, action: LLM_COST_ACTION },
    select: { details: true },
  });
  let total = 0;
  for (const r of rows) {
    try {
      const usd = Number(JSON.parse(r.details || "{}").usd);
      if (Number.isFinite(usd)) total += usd;
    } catch {
      /* linha ilegível não soma */
    }
  }
  return total;
}
