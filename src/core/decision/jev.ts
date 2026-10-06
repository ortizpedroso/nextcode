/**
 * Adaptador do motor de decisão Jev (TypeSafe AI) — princípio P9: "Jev decide, LLM escreve".
 * Ver docs/ARQUITETURA-ORQUESTRACAO.md (motor de decisão, D6). Formato conferido contra a API
 * real em 06/10/2026: POST /v1/systemone { model, state, questions: { <id>: { type, instructions,
 * criteria: { <opção>: <descrição> } } } } → answers.<id>.{ choice, confidence, probabilities }.
 *
 * Nunca é obrigatório: sem chave, timeout ou erro, devolve null e quem chamou usa a reserva.
 * Cada decisão vai para a trilha (JEV_DECISION) com as probabilidades completas.
 */
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { safeFetch } from "@/core/security/safe-fetch";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export const JEV_MODEL = "jev-1.13.0"; // versão fixa (arquitetura: nunca jev-latest)
// Lidos a cada chamada (não no import) para respeitar a configuração atual do processo.
const jevUrl = () => process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const jevTimeoutMs = () => Number(process.env.JEV_TIMEOUT_MS) || 3000;

export interface JevChoice<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<string, number>;
}

async function readJevKey(): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
  return readSecret(setting?.typesafeKey);
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
