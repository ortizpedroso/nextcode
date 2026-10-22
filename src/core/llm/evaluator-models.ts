/**
 * Avaliador forte (Trava T4/T5): modelo pago e SEMPRE de família diferente do executor.
 *
 * Cadeia (mudança 23, fundador 17/10: "avaliador claude, pois não pode ser da mesma família"):
 * Claude Sonnet 5.5 → Claude Opus 5.5, pela API oficial da Anthropic (o FreeLLMAPI não serve Claude,
 * mudança 15). Candidato da mesma família do executor é recusado e registrado. Um provedor que responde
 * "sem crédito" ou "chave inválida" fica de fora por 10 min. Modelo inexistente (404) é falha registrada
 * — o avaliador nunca troca de modelo calado. Se ninguém responder, quem chama trata como avaliador fora.
 */
import type { UsageLike } from "@/core/llm/cost";
import { loadGatewayConfigs, callGateway, type GatewayConfig } from "@/core/llm/gateways";

export type EvaluatorProvider = "nvidia" | "deepseek" | "claude";

export interface EvaluatorCandidate {
  provider: EvaluatorProvider;
  model: string;
  routedPrefixes: string[];
  /**
   * TR1 (10): esforço da Anthropic (`output_config.effort`). Omitido = padrão do modelo (Sonnet 5.5 `high`,
   * Opus 5.5 `medium`). Só muda com medição nos controles (scripts/controles-avaliador-*.ts).
   */
  effort?: AnthropicEffort;
}

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";
export const ANTHROPIC_EFFORTS: readonly AnthropicEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** "claude-sonnet-5-5@medium" → candidato Claude com esforço (usado pelos scripts de controle). */
export function claudeCandidate(spec: string): EvaluatorCandidate {
  const [model, effort] = spec.split("@");
  if (effort && !ANTHROPIC_EFFORTS.includes(effort as AnthropicEffort)) throw new Error(`esforço inválido: ${effort}`);
  return { provider: "claude", model, routedPrefixes: ["anthropic/"], ...(effort ? { effort: effort as AnthropicEffort } : {}) };
}

/** Lida a cada chamada (o bench troca o modelo por variável de ambiente antes de rodar). */
export function defaultEvaluatorChain(): EvaluatorCandidate[] {
  return [
    { provider: "claude", model: process.env.EVALUATOR_CLAUDE_MODEL || "claude-sonnet-5-5", routedPrefixes: ["anthropic/"] },
    { provider: "claude", model: process.env.EVALUATOR_CLAUDE_RESERVE_MODEL || "claude-opus-5-5", routedPrefixes: ["anthropic/"] },
  ];
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
  /** Respostas que vieram sem texto (ex.: só thinking até o max_tokens): a Anthropic cobra; o custo é registrado. */
  wastedUsage?: Array<{ model: string; usage: UsageLike }>;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const SKIP_MS = 10 * 60_000;
const skippedUntil = new Map<EvaluatorProvider, number>();

export function resetEvaluatorState(): void {
  skippedUntil.clear();
}

type AnthropicMessageJson = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

/** Divisa entre o que se repete nas chamadas da mesma etapa (Brief) e o que muda (código). */
export const EVALUATOR_CACHE_SPLIT_MARKER = "[ARQUIVOS GERADOS]";

/**
 * TR1 (9): monta system e mensagens com `cache_control` (5 min). Corte 1 = system (skill + regras,
 * igual em todas as etapas do cluster); corte 2 = Brief da etapa, antes do código — reaproveitado
 * nas chamadas repetidas da Lente Cega e nas retentativas da mesma etapa.
 */
export function buildAnthropicCachedBody(messages: { role: string; content: string }[]): {
  system?: { type: "text"; text: string; cache_control: { type: "ephemeral" } }[];
  messages: { role: string; content: string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] }[];
} {
  const sysMsg = messages.find((m) => m.role === "system")?.content || "";
  const rest = messages.filter((m) => m.role !== "system");
  const out = rest.map((m) => {
    const idx = m.role === "user" ? m.content.indexOf(EVALUATOR_CACHE_SPLIT_MARKER) : -1;
    if (idx <= 0) return { role: m.role, content: m.content as string };
    return {
      role: m.role,
      content: [
        { type: "text" as const, text: m.content.slice(0, idx), cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: m.content.slice(idx) },
      ],
    };
  });
  return {
    ...(sysMsg ? { system: [{ type: "text" as const, text: sysMsg, cache_control: { type: "ephemeral" as const } }] } : {}),
    messages: out.length > 0 ? out : [{ role: "user", content: "ok" }],
  };
}

async function parseAnthropicDirectMessageResponse(
  antRes: Response,
  anthropicModel: string,
  executorFamily: EvaluatorProvider,
  failures: string[],
  wasted: Array<{ model: string; usage: UsageLike }> = []
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
            cache_read_input_tokens: antJson.usage.cache_read_input_tokens,
            cache_creation_input_tokens: antJson.usage.cache_creation_input_tokens,
          }
        : null,
    };
  }

  failures.push(
    `claude/direct: sem texto (stop_reason=${antJson.stop_reason ?? "?"}; blocos=${blockTypes.join(",") || "nenhum"})`
  );
  if (antJson.usage) {
    wasted.push({
      model: anthropicModel,
      usage: {
        input_tokens: antJson.usage.input_tokens,
        output_tokens: antJson.usage.output_tokens,
        cache_read_input_tokens: antJson.usage.cache_read_input_tokens,
        cache_creation_input_tokens: antJson.usage.cache_creation_input_tokens,
      },
    });
  }
  return null;
}

export interface StrongEvaluatorOptions {
  timeoutMs?: number;
  executorFamily?: EvaluatorProvider;
  loader?: () => Promise<GatewayConfig[]>;
  chain?: EvaluatorCandidate[];
  preferIndependentFirst?: boolean;
  directClaudeKey?: string | null;
  /** Teto da resposta (thinking + texto). Padrão 8000; a revisão final (J3) usa mais. */
  maxTokens?: number;
}

export async function dispatchStrongEvaluator(
  messages: ChatMessage[],
  opts: StrongEvaluatorOptions = {}
): Promise<EvaluatorCallResult> {
  const executorFamily = opts.executorFamily ?? "deepseek";
  const failures: string[] = [];
  const chain = opts.chain ?? defaultEvaluatorChain();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxTokens = opts.maxTokens ?? 8000;
  const wasted: Array<{ model: string; usage: UsageLike }> = [];

  let gateways: GatewayConfig[] | null = null;
  let claudeKey: string | null | undefined = opts.directClaudeKey;

  for (const c of chain) {
    if (c.provider === executorFamily) {
      failures.push(`${c.provider}/${c.model}: mesma família do executor — recusado (T4)`);
      continue;
    }
    if ((skippedUntil.get(c.provider) ?? 0) > Date.now()) {
      failures.push(`${c.provider}/${c.model}: fora por falta de crédito/chave (pausa de 10 min)`);
      continue;
    }

    if (c.provider === "claude") {
      try {
        if (claudeKey === undefined) {
          const prisma = (await import("@/lib/prisma")).default;
          const { readSecret } = await import("@/core/security/crypto");
          const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
          claudeKey = readSecret(setting?.claudeKey);
        }
        if (!claudeKey || !claudeKey.trim() || claudeKey.startsWith("••••") || claudeKey.startsWith("****")) {
          failures.push(`claude/${c.model}: sem chave da Anthropic em Configurações`);
          continue;
        }
        const { safeFetch } = await import("@/core/security/safe-fetch");
        const antRes = await safeFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": claudeKey.trim(),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: c.model,
            max_tokens: maxTokens,
            ...(c.effort ? { output_config: { effort: c.effort } } : {}),
            ...buildAnthropicCachedBody(messages),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if ([401, 402, 403, 429].includes(antRes.status)) {
          skippedUntil.set("claude", Date.now() + SKIP_MS);
        }
        const directResult = await parseAnthropicDirectMessageResponse(antRes, c.model, executorFamily, failures, wasted);
        if (directResult) return wasted.length > 0 ? { ...directResult, wastedUsage: wasted } : directResult;
      } catch (errDirect) {
        failures.push(`claude/${c.model}: ${String(errDirect).slice(0, 140)}`);
      }
      continue;
    }

    // Outras famílias (só se a cadeia for trocada, ex.: bench) vão pelo FreeLLMAPI com a trava X-Routed-Via.
    gateways = gateways ?? (await (opts.loader ?? loadGatewayConfigs)());
    const free = gateways.find((g) => g.id === "freellmapi");
    if (!free) {
      failures.push(`${c.provider}/${c.model}: freellmapi não configurado`);
      continue;
    }
    try {
      const attempt = await callGateway(free, {
        messages,
        model: c.model,
        stream: false,
        signal: AbortSignal.timeout(timeoutMs),
        maxTokens: 8000,
      });
      if (attempt.ok) {
        const servedBy = attempt.servedBy || "";
        if (c.routedPrefixes.some((p) => servedBy.toLowerCase().startsWith(p.toLowerCase()))) {
          const json = (await attempt.response.json().catch(() => ({}))) as {
            choices?: { message?: { content?: string } }[];
            usage?: UsageLike;
          };
          const text = json?.choices?.[0]?.message?.content ?? "";
          if (text.trim()) {
            return { content: text, provider: c.provider, model: servedBy, independent: true, failures, usage: json?.usage ?? null };
          }
          failures.push(`${c.provider}/${c.model}: resposta vazia`);
        } else {
          await attempt.response.body?.cancel().catch(() => {});
          failures.push(`${c.provider}/${c.model}: rota recusada ${servedBy}`);
        }
      } else {
        if ([401, 402, 403, 429].includes(attempt.status ?? 0) || /credit|billing|prepayment|quota|rate.?limit/i.test(attempt.detail)) {
          skippedUntil.set(c.provider, Date.now() + SKIP_MS);
        }
        failures.push(`${c.provider}/${c.model}: ${attempt.kind} ${attempt.status ?? ""} ${attempt.detail.replace(/\s+/g, " ").slice(0, 140)}`.trim());
      }
    } catch (err) {
      failures.push(`${c.provider}/${c.model}: ${String(err).slice(0, 140)}`);
    }
  }

  return { content: null, provider: null, model: null, independent: false, failures, ...(wasted.length > 0 ? { wastedUsage: wasted } : {}) };
}
