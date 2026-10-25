/**
 * Adaptador do motor de decisão Jev (TypeSafe AI) — princípio P9: "Jev decide, LLM escreve".
 * Ver docs/NEXTCODE-REFERENCIA.md §4 (Arquitetura) e §5 (Uso do Jev).
 * Formato conferido contra a API real em 06/10/2026:
 * POST /v1/systemone { model: "jev-1.13.0", state, questions: { <id>: <question> } }
 * → answers.<id>.{ type, choice|score|noul, confidence?, probabilities? }.
 *
 * Nunca é obrigatório: sem chave, timeout ou erro, devolve null e quem chamou usa a reserva.
 * Cada decisão vai para a trilha (JEV_DECISION) com as probabilidades completas.
 */
import prisma from "@/lib/prisma";
import { recordLlmCost } from "@/core/llm/cost";
import { readSecret } from "@/core/security/crypto";
import { safeFetch } from "@/core/security/safe-fetch";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { globalJevCache } from "@/core/decision/jev-cache";
import { maskSecretsForJev } from "@/core/governance/secret-guard";

export const JEV_MODEL = "jev-1.13.0"; // versão fixa (arquitetura: nunca jev-latest)
export const JEV_INPUT_PRICE_PER_MILLION_USD = 0.042; // US$ 0,042 por 1M tokens de entrada (saída grátis)
export const JEV_MAX_REQUEST_TOKENS = 64000;

// Lidos a cada chamada (não no import) para respeitar a configuração atual do processo.
const jevUrl = () => process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const jevTimeoutMs = () => Number(process.env.JEV_TIMEOUT_MS) || 3000;

export interface JevChoice<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreResult {
  score: number;
  confidence: number;
  probabilities: number[];
}

export interface JevNoulResult {
  /** Probabilidade p in [0, 1] de a resposta ser true. */
  noul: number;
  /** Certeza simétrica calculada em código: |2p - 1|. */
  symmetricConfidence: number;
}

export type JevQuestionSpec =
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    }
  | {
      type: "noul";
      instructions: string;
      criteria?: { true: string; false: string };
    };

export type JevBatchAnswer =
  | ({ type: "choice" } & JevChoice<string>)
  | ({ type: "score" } & JevScoreResult)
  | ({ type: "noul" } & JevNoulResult);

async function readJevKey(): Promise<string> {
  // E5-auditoria rec-1: permite desligar o Jev sem tocar no banco (útil em testes e ambientes sem rede).
  if (process.env.NEXTCODE_DISABLE_JEV === "1") return "";
  const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
  return readSecret(setting?.typesafeKey);
}

/**
 * Calcula o custo estimado em dólares (USD) para uma quantidade de tokens de entrada no Jev.
 * Saída no Jev tem custo US$ 0,00.
 */
export function estimateJevCostUsd(inputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0;
  return Number(((inputTokens / 1_000_000) * JEV_INPUT_PRICE_PER_MILLION_USD).toFixed(8));
}

async function postJev(
  body: unknown,
  key: string,
  signal?: AbortSignal,
  purpose?: string,
  sessionId?: string | null,
  timeoutMs?: number
): Promise<Response> {
  let effectiveBody = body;
  if (
    typeof body === "object" &&
    body !== null &&
    "state" in body &&
    typeof (body as { state?: unknown }).state === "string"
  ) {
    const rawState = (body as { state: string }).state;
    const masked = maskSecretsForJev(rawState);
    if (masked.count > 0) {
      effectiveBody = {
        ...(body as Record<string, unknown>),
        state: masked.text,
      };
      TelemetryLogger.log({
        sessionId: sessionId ?? undefined,
        action: "JEV_STATE_MASKED",
        details: { purpose, count: masked.count },
      });
    }
  }

  let lastRes!: Response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs ?? jevTimeoutMs());
    const res = await safeFetch(jevUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(effectiveBody),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    lastRes = res;

    if ((res.status === 429 || res.status === 529) && attempt < 3) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader !== null && retryAfterHeader.trim() !== "" ? Number(retryAfterHeader) : NaN;
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec >= 0
          ? Math.min(retryAfterSec * 1000, 2000)
          : 300 * 2 ** (attempt - 1);

      const aborted = await new Promise<boolean>((resolve) => {
        if (signal?.aborted) {
          resolve(true);
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          resolve(true);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(false);
        }, waitMs);
        signal?.addEventListener("abort", onAbort, { once: true });
      });

      if (aborted) {
        return lastRes;
      }

      TelemetryLogger.log({
        sessionId: sessionId ?? undefined,
        action: "JEV_RETRY",
        details: { purpose, status: res.status, attempt },
      });
      continue;
    }

    return res;
  }
  return lastRes;
}

/**
 * Uma pergunta de escolha ao Jev. `criteria` mapeia cada opção para a descrição do que ela
 * significa. Retorna null quando o Jev não está configurado ou não respondeu a tempo.
 */
export async function askJevChoice<T extends string>(params: {
  purpose: string;
  state: string;
  instructions: string;
  criteria: Record<T, string>;
  sessionId?: string | null;
  signal?: AbortSignal;
  useCache?: boolean;
}): Promise<JevChoice<T> | null> {
  const key = await readJevKey();
  if (!key) return null;

  const started = Date.now();
  const shouldCache = Boolean(params.useCache);
  const cacheKey = shouldCache
    ? globalJevCache.computeKey(params.purpose, params.state, {
        q: { instructions: params.instructions, criteria: params.criteria },
      })
    : null;

  if (shouldCache && cacheKey) {
    const cached = globalJevCache.get<JevChoice<T>>(cacheKey);
    if (cached) {
      TelemetryLogger.log({
        sessionId: params.sessionId ?? undefined,
        action: "JEV_CACHE_HIT",
        details: { purpose: params.purpose, choice: cached.choice, latencyMs: Date.now() - started },
      });
      return cached;
    }
  }

  try {
    const res = await postJev(
      {
        model: JEV_MODEL,
        state: params.state.slice(0, 8000),
        questions: { q: { type: "choice", instructions: params.instructions, criteria: params.criteria } },
      },
      key,
      params.signal,
      params.purpose,
      params.sessionId
    );
    if (res.status === 422) {
      const bodyText = await res.text().catch(() => "");
      TelemetryLogger.log({
        sessionId: params.sessionId ?? undefined,
        action: "JEV_REQUEST_INVALID",
        details: { purpose: params.purpose, detail: bodyText.slice(0, 300) },
      });
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as {
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      answers?: { q?: { choice?: string; confidence?: number; probabilities?: Record<string, number> } };
    };
    const answer = data.answers?.q;
    if (!res.ok || !answer?.choice || !(answer.choice in params.criteria)) {
      TelemetryLogger.log({
        sessionId: params.sessionId ?? undefined,
        action: "JEV_FAILURE",
        details: { purpose: params.purpose, status: res.status, latencyMs: Date.now() - started },
      });
      return null;
    }
    const result: JevChoice<T> = {
      choice: answer.choice as T,
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      probabilities: answer.probabilities ?? {},
    };
    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "JEV_DECISION",
      details: {
        purpose: params.purpose,
        model: JEV_MODEL,
        choice: result.choice,
        confidence: result.confidence,
        probabilities: result.probabilities,
        usage: data.usage ?? null,
        latencyMs: Date.now() - started,
      },
    });
    if (params.sessionId) {
      await recordLlmCost({
        sessionId: params.sessionId,
        papel: "jev",
        provider: "typesafe",
        model: data.model || JEV_MODEL,
        usage: data.usage ?? null,
      });
    }
    if (shouldCache && cacheKey) {
      globalJevCache.set(cacheKey, result);
    }
    return result;
  } catch (err) {
    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "JEV_FAILURE",
      details: { purpose: params.purpose, error: String(err).slice(0, 160), latencyMs: Date.now() - started },
    });
    return null;
  }
}

/**
 * Avalia múltiplas perguntas (`choice`, `score`, `noul`) em paralelo numa única chamada HTTP
 * ao Jev (`POST /v1/systemone`), compartilhando o mesmo `state`.
 */
export async function askJevBatch(params: {
  purpose: string;
  state: string;
  questions: Record<string, JevQuestionSpec>;
  sessionId?: string | null;
  signal?: AbortSignal;
  maxStateChars?: number;
  useCache?: boolean;
  timeoutMs?: number;
}): Promise<Record<string, JevBatchAnswer> | null> {
  const key = await readJevKey();
  if (!key) return null;

  const started = Date.now();
  const maxChars = params.maxStateChars ?? 24000;

  if (params.state.length > maxChars) {
    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "JEV_STATE_TOO_LARGE",
      details: { purpose: params.purpose, length: params.state.length, max: maxChars },
    });
    return null;
  }

  const shouldCache = Boolean(params.useCache);
  const cacheKey = shouldCache
    ? globalJevCache.computeKey(params.purpose, params.state, params.questions)
    : null;

  if (shouldCache && cacheKey) {
    const cached = globalJevCache.get<Record<string, JevBatchAnswer>>(cacheKey);
    if (cached) {
      TelemetryLogger.log({
        sessionId: params.sessionId ?? undefined,
        action: "JEV_CACHE_HIT",
        details: {
          purpose: params.purpose,
          questionIds: Object.keys(params.questions),
          latencyMs: Date.now() - started,
        },
      });
      return cached;
    }
  }

  try {
    const res = await postJev(
      {
        model: JEV_MODEL,
        state: params.state,
        questions: params.questions,
      },
      key,
      params.signal,
      params.purpose,
      params.sessionId,
      params.timeoutMs
    );

    if (res.status === 422) {
      const bodyText = await res.text().catch(() => "");
      TelemetryLogger.log({
        sessionId: params.sessionId ?? undefined,
        action: "JEV_REQUEST_INVALID",
        details: { purpose: params.purpose, detail: bodyText.slice(0, 300) },
      });
      return null;
    }

    const data = (await res.json().catch(() => ({}))) as {
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      answers?: Record<
        string,
        {
          type?: string;
          choice?: string;
          score?: number;
          noul?: number;
          confidence?: number;
          probabilities?: Record<string, number> | number[];
        }
      >;
    };

    if (!res.ok || !data.answers || typeof data.answers !== "object") {
      TelemetryLogger.log({
        sessionId: params.sessionId ?? undefined,
        action: "JEV_FAILURE",
        details: { purpose: params.purpose, status: res.status, latencyMs: Date.now() - started },
      });
      return null;
    }

    const parsedAnswers: Record<string, JevBatchAnswer> = {};
    for (const [qId, qSpec] of Object.entries(params.questions)) {
      const rawAns = data.answers[qId];
      if (!rawAns) return null;

      if (qSpec.type === "choice") {
        if (!rawAns.choice || !(rawAns.choice in qSpec.criteria)) return null;
        parsedAnswers[qId] = {
          type: "choice",
          choice: rawAns.choice,
          confidence: typeof rawAns.confidence === "number" ? rawAns.confidence : 0,
          probabilities:
            rawAns.probabilities && !Array.isArray(rawAns.probabilities) ? rawAns.probabilities : {},
        };
      } else if (qSpec.type === "score") {
        if (typeof rawAns.score !== "number") return null;
        const probs = Array.isArray(rawAns.probabilities)
          ? rawAns.probabilities
          : rawAns.probabilities && typeof rawAns.probabilities === "object"
            ? Object.entries(rawAns.probabilities)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, v]) => Number(v))
            : [];
        parsedAnswers[qId] = {
          type: "score",
          score: rawAns.score,
          confidence: typeof rawAns.confidence === "number" ? rawAns.confidence : 0,
          probabilities: probs,
        };
      } else if (qSpec.type === "noul") {
        if (typeof rawAns.noul !== "number") return null;
        const p = Math.max(0, Math.min(1, rawAns.noul));
        parsedAnswers[qId] = {
          type: "noul",
          noul: p,
          symmetricConfidence: Math.abs(2 * p - 1),
        };
      }
    }

    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "JEV_DECISION",
      details: {
        purpose: params.purpose,
        model: JEV_MODEL,
        questionIds: Object.keys(params.questions),
        answers: parsedAnswers,
        usage: data.usage ?? null,
        latencyMs: Date.now() - started,
      },
    });

    if (params.sessionId) {
      await recordLlmCost({
        sessionId: params.sessionId,
        papel: "jev",
        provider: "typesafe",
        model: data.model || JEV_MODEL,
        usage: data.usage ?? null,
      });
    }

    if (shouldCache && cacheKey) {
      globalJevCache.set(cacheKey, parsedAnswers);
    }
    return parsedAnswers;
  } catch (err) {
    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "JEV_FAILURE",
      details: { purpose: params.purpose, error: String(err).slice(0, 160), latencyMs: Date.now() - started },
    });
    return null;
  }
}
