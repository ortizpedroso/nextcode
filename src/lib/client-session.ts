/**
 * Sessão local do navegador (Fase 4, lado cliente).
 * Componentes "use client" importam daqui — nunca o módulo server-side
 * local-auth.ts (que depende de node:crypto e só roda no servidor).
 */
let sessionPromise: Promise<string | null> | null = null;

async function bootstrapSessionToken(): Promise<string | null> {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const res = await fetch(`${base}/api/auth/session`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.token === "string" ? data.token : null;
  } catch {
    return null;
  }
}

/** Retorna o token de sessão local, obtendo-o uma única vez via /api/auth/session. */
export async function getSessionToken(): Promise<string | null> {
  if (!sessionPromise) sessionPromise = bootstrapSessionToken();
  return sessionPromise;
}

/** Invalida a sessão em cache (ex.: após 401, força novo bootstrap). */
export function resetSessionToken(): void {
  sessionPromise = null;
}

/**
 * Fetch autenticado para rotas locais: injeta X-Nextcode-Token automaticamente.
 * Uso em componentes: `await authFetch("/api/omniroute/setup", { method: "POST" })`.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set("X-Nextcode-Token", token);
  let res = await fetch(input, { ...init, headers });
  // Token runtime pode ter mudado (restart do servidor): tenta renovar uma vez.
  if (res.status === 401) {
    resetSessionToken();
    const fresh = await getSessionToken();
    if (fresh) {
      headers.set("X-Nextcode-Token", fresh);
      res = await fetch(input, { ...init, headers });
    }
  }
  return res;
}
