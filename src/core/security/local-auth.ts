/**
 * Fase 4 — Autenticação local + rate-limit + mascaramento.
 *
 * Modelo: o app NextCode roda em máquina local (dev/uso pessoal). Em vez de um
 * sistema completo de login, usamos um token compartilhado gerado no primeiro
 * acesso ("login local") e exigido em todas as rotas MUTÁVEIS (POST/PUT/DELETE)
 * de /api/*. Leituras simples (GET) continuam liberadas para a UI local, mas
 * NUNCA retornam segredos em claro (apenas máscaras ****abcd).
 *
 * - NEXTCODE_AUTH_TOKEN: token fixo opcional via env (para scripts/CI).
 * - Sem env: gera token aleatório em memória e expõe POST /api/auth/session
 *   (rota pública bootstrap, rate-limited) que entrega o token UMA vez.
 * - Rate-limit in-memory: 30 req/min por IP nas rotas sensíveis.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Token da sessão local
// ---------------------------------------------------------------------------
let runtimeToken: string | null = null;

export function getRuntimeToken(): string {
  const envToken = (process.env.NEXTCODE_AUTH_TOKEN || "").trim();
  if (envToken) return envToken;
  if (!runtimeToken) {
    runtimeToken = crypto.randomBytes(24).toString("hex");
    console.log("[AUTH] Token de sessão local gerado. Rotas mutativas exigem header X-Nextcode-Token.");
  }
  return runtimeToken;
}

export function verifyToken(candidate?: string | null): boolean {
  const expected = getRuntimeToken();
  if (!candidate) return false;
  // comparação em tempo constante
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rate limit in-memory (token bucket simples por IP)
// ---------------------------------------------------------------------------
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = Number(process.env.NEXTCODE_RATE_LIMIT || 30);

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_REQ_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// Guard para handlers de API Route
// ---------------------------------------------------------------------------
export interface AuthGuardResult {
  ok: boolean;
  response?: NextResponse;
}

/**
 * Protege uma rota mutativa: exige X-Nextcode-Token válido + aplica rate limit.
 * Uso:
 *   export async function POST(req: NextRequest) {
 *     const guard = requireAuth(req);
 *     if (guard.response) return guard.response;
 *     ...
 *   }
 */
export function requireAuth(req: NextRequest): AuthGuardResult {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  if (rateLimited(ip)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit excedido (máx. " + MAX_REQ_PER_WINDOW + " req/min). Tente novamente em instantes." },
        { status: 429 }
      ),
    };
  }

  const token = req.headers.get("x-nextcode-token");
  if (!verifyToken(token)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Não autorizado. Obtenha o token local via POST /api/auth/session e envie no header X-Nextcode-Token.",
        },
        { status: 401 }
      ),
    };
  }
  return { ok: true };
}

/** Máscara padrão para respostas GET de configurações (nunca ecoar segredo). */
export function maskKey(value?: string | null): string {
  if (!value) return "";
  const tail = value.length >= 4 ? value.slice(-4) : "";
  return `••••${tail}`;
}
