/**
 * Fase 4 — Autenticação local + rate-limit + mascaramento.
 *
 * Modelo: o app NextCode roda em máquina local (dev/uso pessoal). Em vez de um
 * sistema completo de login, usamos um token compartilhado gerado no primeiro
 * acesso ("login local") e exigido em todas as rotas MUTÁVEIS (POST/PUT/DELETE)
 * de /api/* (requireAuth, com rate limit) e também nos GETs que expõem sessões,
 * mensagens, DAG, projetos ou configurações (requireReadAuth, sem rate limit).
 * Respostas nunca retornam segredos em claro (apenas máscaras ****abcd).
 *
 * - NEXTCODE_AUTH_TOKEN: token fixo opcional via env (para scripts/CI).
 * - Sem env: gera token aleatório em memória e expõe POST /api/auth/session
 *   (rota pública bootstrap, rate-limited) que entrega o token UMA vez.
 * - Rate-limit in-memory: 30 req/min nas rotas sensíveis (balde único local; por IP só
 *   atrás de proxy confiável, NEXTCODE_TRUST_PROXY=1 — ver rateLimitKey).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Token da sessão local
// ---------------------------------------------------------------------------
// No `next dev`, cada rota compilada pela primeira vez reavalia este módulo: o token era
// regerado e a trava do bootstrap zerada a cada compilação, invalidando o token já entregue
// ao navegador. Em desenvolvimento o estado fica em globalThis (mesmo padrão do lib/prisma.ts)
// e sobrevive às reavaliações; em produção o módulo é avaliado uma vez só.
interface LocalAuthState {
  runtimeToken: string | null;
  bootstrapTokenIssued: boolean;
}
const globalForAuth = globalThis as unknown as { nextcodeLocalAuth?: LocalAuthState };
const authState: LocalAuthState =
  process.env.NODE_ENV === "development"
    ? (globalForAuth.nextcodeLocalAuth ??= { runtimeToken: null, bootstrapTokenIssued: false })
    : { runtimeToken: null, bootstrapTokenIssued: false };

export function getRuntimeToken(): string {
  const envToken = (process.env.NEXTCODE_AUTH_TOKEN || "").trim();
  if (envToken) return envToken;
  if (!authState.runtimeToken) {
    authState.runtimeToken = crypto.randomBytes(24).toString("hex");
    console.log("[AUTH] Token de sessão local gerado. Rotas mutativas exigem header X-Nextcode-Token.");
  }
  return authState.runtimeToken;
}

/**
 * O token gerado em runtime (sem NEXTCODE_AUTH_TOKEN fixo) só pode ser entregue
 * UMA vez pelo bootstrap público (POST /api/auth/session) — o Host header do
 * request é forjável pelo cliente e não deve ser a única barreira. Depois do
 * primeiro uso, a rota de bootstrap passa a recusar novas entregas.
 */
export function canIssueBootstrapToken(): boolean {
  if ((process.env.NEXTCODE_AUTH_TOKEN || "").trim()) return false; // token fixo: bootstrap desativado
  return !authState.bootstrapTokenIssued;
}

export function markBootstrapTokenIssued(): void {
  authState.bootstrapTokenIssued = true;
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
// Mesmo motivo do authState acima: em `next dev` cada rota tinha o próprio Map de baldes.
const globalForBuckets = globalThis as unknown as { nextcodeRateBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> =
  process.env.NODE_ENV === "development"
    ? (globalForBuckets.nextcodeRateBuckets ??= new Map<string, Bucket>())
    : new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = Number(process.env.NEXTCODE_RATE_LIMIT || 30);

/**
 * Chave do rate limit. `X-Forwarded-For`/`X-Real-IP` são enviados pelo PRÓPRIO cliente — o
 * Next só preenche X-Forwarded-For com o IP real quando o header vem ausente (`??=` em
 * base-server.js), então trocar o valor a cada requisição furava qualquer limite, inclusive
 * o do bootstrap. Sem proxy confiável na frente (padrão: servidor só em 127.0.0.1), todos os
 * clientes são locais e dividem um único balde. Com NEXTCODE_TRUST_PROXY=1 (proxy reverso
 * que ACRESCENTA o IP do cliente), usa o último salto da lista — o único que o proxy garante.
 */
export function rateLimitKey(req: Request): string {
  if (process.env.NEXTCODE_TRUST_PROXY !== "1") return "local";
  const forwarded = req.headers.get("x-forwarded-for");
  const lastHop = forwarded?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return lastHop || "local";
}

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
  if (rateLimited(rateLimitKey(req))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit excedido (máx. " + MAX_REQ_PER_WINDOW + " req/min). Tente novamente em instantes." },
        { status: 429 }
      ),
    };
  }

  return checkToken(req);
}

function checkToken(req: Request): AuthGuardResult {
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

/**
 * Protege uma rota de LEITURA (GET) que expõe dados de sessões, projetos, DAG ou
 * configurações: exige o mesmo X-Nextcode-Token das rotas mutativas, mas sem o rate
 * limit — a UI faz polling desses GETs e estouraria o limite de 30 req/min.
 * Ficam abertos só GETs de status operacional sem dado de usuário (ex.: /api/metrics).
 */
export function requireReadAuth(req: Request): AuthGuardResult {
  return checkToken(req);
}

/** Máscara padrão para respostas GET de configurações (nunca ecoar segredo). */
export function maskKey(value?: string | null): string {
  if (!value) return "";
  const tail = value.length >= 4 ? value.slice(-4) : "";
  return `••••${tail}`;
}
