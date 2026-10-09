/**
 * Avaliador forte (Trava T4/T5): modelo pago e, de preferência, de família diferente do executor.
 *
 * Cadeia (decisão do fundador, 07/10): Gemini Pro → Claude → DeepSeek. Um provedor que responde
 * "sem crédito" ou "chave inválida" fica de fora por 10 min, para não pagar latência a cada etapa.
 * Se nenhum pago responder, quem chama decide o que fazer (hoje: rota gratuita, marcada na trilha).
 */
import type { UsageLike } from "@/core/llm/cost";
import { loadGatewayConfigs, callGateway, type GatewayConfig } from "@/core/llm/gateways";

export type EvaluatorProvider = "nvidia" | "deepseek" | "claude";

export interface EvaluatorCandidate {
  provider: EvaluatorProvider;
  model: string;
  routedPrefixes: string[];
}

export const EVALUATOR_CHAIN: EvaluatorCandidate[] = [
  { provider: "nvidia", model: process.env.EVALUATOR_NEMOTRON_MODEL || "nemotron-3-ultra", routedPrefixes: ["ollama/nemotron", "nvidia/"] },
  { provider: "deepseek", model: process.env.EVALUATOR_DEEPSEEK_MODEL || "deepseek-v4-pro", routedPrefixes: ["custom/deepseek"] },
  { provider: "claude", model: process.env.EVALUATOR_CLAUDE_MODEL || "claude-sonnet-4-5", routedPrefixes: ["anthropic/", "custom/claude"] },
];

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

export interface EvaluatorKeys {
  geminiKey?: string | null;
  claudeKey?: string | null;
  deepseekKey?: string | null;
}

export async function dispatchStrongEvaluator(
  messages: ChatMessage[],
  opts: { timeoutMs?: number; executorFamily?: EvaluatorProvider; loader?: () => Promise<GatewayConfig[]> } & EvaluatorKeys = {}
): Promise<EvaluatorCallResult> {
  const executorFamily = opts.executorFamily ?? "deepseek";
  const failures: string[] = [];

  const gateways = await (opts.loader ?? loadGatewayConfigs)();
  const free = gateways.find((g) => g.id === "freellmapi");
  if (!free) {
    return { content: null, provider: null, model: null, independent: false, failures: ["freellmapi: não configurado"] };
  }

  for (const c of EVALUATOR_CHAIN) {
    if ((skippedUntil.get(c.provider) ?? 0) > Date.now()) {
      failures.push(`${c.provider}: fora por falta de crédito/chave (pausa de 10 min)`);
      continue;
    }

    try {
      const attempt = await callGateway(free, {
        messages,
        model: c.model,
        stream: false,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        maxTokens: 8000,
      });

      if (attempt.ok) {
        const servedBy = attempt.servedBy || "";
        const servedByLower = servedBy.toLowerCase();
        const matchesPrefix = c.routedPrefixes.some((p) => servedByLower.startsWith(p.toLowerCase()));

        if (matchesPrefix) {
          const json = (await attempt.response.json().catch(() => ({}))) as {
            choices?: { message?: { content?: string } }[];
            usage?: UsageLike;
          };
          const text = json?.choices?.[0]?.message?.content ?? "";
          if (text.trim()) {
            return {
              content: text,
              provider: c.provider,
              model: attempt.servedBy,
              independent: c.provider !== executorFamily,
              failures,
              usage: json?.usage ?? null,
            };
          }
          failures.push(`${c.provider}/${c.model}: resposta vazia`);
        } else {
          await attempt.response.body?.cancel().catch(() => {});
          failures.push(`${c.provider}/${c.model}: rota recusada ${servedBy}`);
        }
      } else {
        if (
          attempt.status === 401 ||
          attempt.status === 402 ||
          attempt.status === 403 ||
          attempt.status === 429 ||
          /credit|billing|prepayment|quota|rate.?limit/i.test(attempt.detail)
        ) {
          skippedUntil.set(c.provider, Date.now() + SKIP_MS);
        }
        failures.push(`${c.provider}/${c.model}: ${attempt.kind} ${attempt.status ?? ""} ${attempt.detail.replace(/\s+/g, " ").slice(0, 140)}`.trim());
      }
    } catch (err) {
      failures.push(`${c.provider}/${c.model}: ${String(err).slice(0, 140)}`);
    }
  }

  return { content: null, provider: null, model: null, independent: false, failures };
}
