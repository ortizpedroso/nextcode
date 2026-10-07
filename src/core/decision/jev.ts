/**
 * Adaptador do motor de decisão Jev (TypeSafe AI) — princípio P9: "Jev decide, LLM escreve".
 * Ver docs/ARQUITETURA-ORQUESTRACAO.md (motor de decisão, D6) e docs/rascunhos/JEV-DECISOES.md.
 * Formato conferido contra a API real em 06/10/2026:
 * POST /v1/systemone { model: "jev-1.13.0", state, questions: { <id>: <question> } }
 * → answers.<id>.{ type, choice|score|noul, confidence?, probabilities? }.
 *
 * Nunca é obrigatório: sem chave, timeout ou erro, devolve null e quem chamou usa a reserva.
 * Cada decisão vai para a trilha (JEV_DECISION) com as probabilidades completas.
 */
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { safeFetch } from "@/core/security/safe-fetch";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

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
}): Promise<JevChoice<T> | null> {
  const key = await readJevKey();
  if (!key) return null;

  const started = Date.now();
  const timeout = AbortSignal.timeout(jevTimeoutMs());
  try {
    const res = await safeFetch(jevUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: params.state.slice(0, 8000),
        questions: { q: { type: "choice", instructions: params.instructions, criteria: params.criteria } },
      }),
      signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
    });
    const data = (await res.json().catch(() => ({}))) as {
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
        latencyMs: Date.now() - started,
      },
    });
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
}): Promise<Record<string, JevBatchAnswer> | null> {
  const key = await readJevKey();
  if (!key) return null;

  const started = Date.now();
  const timeout = AbortSignal.timeout(jevTimeoutMs());
  const maxChars = params.maxStateChars ?? 24000;

  try {
    const res = await safeFetch(jevUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: params.state.slice(0, maxChars),
        questions: params.questions,
      }),
      signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
    });

    const data = (await res.json().catch(() => ({}))) as {
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
        parsedAnswers[qId] = {
          type: "score",
          score: rawAns.score,
          confidence: typeof rawAns.confidence === "number" ? rawAns.confidence : 0,
          probabilities: Array.isArray(rawAns.probabilities) ? rawAns.probabilities : [],
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
        latencyMs: Date.now() - started,
      },
    });

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
