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
  { provider: "claude", model: process.env.EVALUATOR_CLAUDE_MODEL || "claude-sonnet-4-5-20250929", routedPrefixes: ["anthropic/", "custom/claude"] },
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
let activeClaudeModel: string | null = null;

export function resetEvaluatorState(): void {
  skippedUntil.clear();
  activeClaudeModel = null;
}

type AnthropicMessageJson = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function parseAnthropicDirectMessageResponse(
  antRes: Response,
  anthropicModel: string,
  executorFamily: EvaluatorProvider,
  failures: string[]
): Promise<EvaluatorCallResult | null> {
  if (!antRes.ok) {
    const errJson = (await antRes.json().catch(() => ({}))) as {
      error?: { type?: string; message?: string };
    };
    const errType = errJson?.error?.type ?? "?";
    const errMsg = String(errJson?.error?.message ?? "").slice(0, 200);
    failures.push(`claude/direct: HTTP ${antRes.status} ${errType}: ${errMsg}`);
    return null;
  }

  const antJson = (await antRes.json().catch(() => ({}))) as AnthropicMessageJson;
  const blocks = antJson.content ?? [];
  const blockTypes = blocks.map((b) => b.type);
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  if (text.trim()) {
    return {
      content: text,
      provider: "claude",
      model: anthropicModel,
      independent: executorFamily !== "claude",
      failures,
      usage: antJson.usage
        ? {
            input_tokens: antJson.usage.input_tokens,
            output_tokens: antJson.usage.output_tokens,
          }
        : null,
    };
  }

  failures.push(
    `claude/direct: sem texto (stop_reason=${antJson.stop_reason ?? "?"}; blocos=${blockTypes.join(",") || "nenhum"})`
  );
  return null;
}

export interface StrongEvaluatorOptions {
  timeoutMs?: number;
  executorFamily?: EvaluatorProvider;
  loader?: () => Promise<GatewayConfig[]>;
  chain?: EvaluatorCandidate[];
  preferIndependentFirst?: boolean;
  directClaudeKey?: string | null;
}

export async function dispatchStrongEvaluator(
  messages: ChatMessage[],
  opts: StrongEvaluatorOptions = {}
): Promise<EvaluatorCallResult> {
  const executorFamily = opts.executorFamily ?? "deepseek";
  const failures: string[] = [];

  const gateways = await (opts.loader ?? loadGatewayConfigs)();
  const free = gateways.find((g) => g.id === "freellmapi");
  if (!free) {
    return { content: null, provider: null, model: null, independent: false, failures: ["freellmapi: não configurado"] };
  }

  const baseChain = opts.chain ?? EVALUATOR_CHAIN;
  const effectiveChain = opts.preferIndependentFirst
    ? [...baseChain].sort((a, b) => {
        const aIndep = a.provider !== executorFamily ? 0 : 1;
        const bIndep = b.provider !== executorFamily ? 0 : 1;
        return aIndep - bIndep;
      })
    : baseChain;

  for (const c of effectiveChain) {
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

  // Fallback transparente: se o provedor Claude foi solicitado e falhou no FreeLLMAPI,
  // mas o usuário possui claudeKey salva diretamente no banco (Setting), consulta a API oficial da Anthropic.
  if (effectiveChain.some((c) => c.provider === "claude") && (skippedUntil.get("claude") ?? 0) <= Date.now()) {
    try {
      let directKey = opts.directClaudeKey;
      if (directKey === undefined) {
        const prisma = (await import("@/lib/prisma")).default;
        const { readSecret } = await import("@/core/security/crypto");
        const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
        directKey = readSecret(setting?.claudeKey);
      }
      if (directKey && directKey.trim() && !directKey.startsWith("••••") && !directKey.startsWith("****")) {
        const { safeFetch } = await import("@/core/security/safe-fetch");
        const sysMsg = messages.find((m) => m.role === "system")?.content || "";
        const userMessages = messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));
        let anthropicModel = activeClaudeModel || process.env.EVALUATOR_CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

        let antRes = await safeFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": directKey.trim(),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: anthropicModel,
            max_tokens: 8000,
            ...(sysMsg ? { system: sysMsg } : {}),
            messages: userMessages.length > 0 ? userMessages : [{ role: "user", content: "ok" }],
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });

        // Auto-recuperação sob demanda (Lazy Self-Healing):
        // Se a Anthropic responder 404 (not_found_error / modelo descontinuado),
        // consulta silenciosamente o catálogo em GET /v1/models, seleciona o Sonnet ativo mais recente
        // e refaz a chamada sem interromper o fluxo do usuário.
        if (antRes.status === 404) {
          try {
            const catalogRes = await safeFetch("https://api.anthropic.com/v1/models", {
              headers: {
                "x-api-key": directKey.trim(),
                "anthropic-version": "2023-06-01",
              },
              signal: AbortSignal.timeout(10_000),
            });
            if (catalogRes.ok) {
              const catalogJson = (await catalogRes.json().catch(() => ({}))) as {
                data?: { id: string; display_name?: string }[];
              };
              const modelsList = catalogJson.data || [];
              // Procura Sonnet mais recente ou alias flutuante
              const candidates = modelsList.map((m) => m.id);
              const bestCandidate =
                candidates.find((id) => /claude-.*sonnet.*latest/i.test(id)) ||
                candidates.filter((id) => /sonnet/i.test(id)).sort().reverse()[0] ||
                candidates.filter((id) => /claude/i.test(id)).sort().reverse()[0];

              if (bestCandidate && bestCandidate !== anthropicModel) {
                anthropicModel = bestCandidate;
                activeClaudeModel = bestCandidate;

                // Nova tentativa silenciosa com o modelo ativo descoberto
                antRes = await safeFetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "x-api-key": directKey.trim(),
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    model: anthropicModel,
                    max_tokens: 8000,
                    ...(sysMsg ? { system: sysMsg } : {}),
                    messages: userMessages.length > 0 ? userMessages : [{ role: "user", content: "ok" }],
                  }),
                  signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
                });
              }
            }
          } catch {
            // Falha na descoberta silenciosa: preserva o tratamento de erro original abaixo
          }
        }

        const directResult = await parseAnthropicDirectMessageResponse(
          antRes,
          anthropicModel,
          executorFamily,
          failures
        );
        if (directResult) {
          return directResult;
        }
      }
    } catch (errDirect) {
      failures.push(`claude/direct: ${String(errDirect).slice(0, 140)}`);
    }
  }

  return { content: null, provider: null, model: null, independent: false, failures };
}

