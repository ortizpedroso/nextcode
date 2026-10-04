/**
 * Sessão local do navegador (Fase 4, lado cliente).
 * Componentes "use client" importam daqui — nunca o módulo server-side
 * local-auth.ts (que depende de node:crypto e só roda no servidor).
 */
let sessionPromise: Promise<string | null> | null = null;

// O servidor entrega o token de runtime UMA vez por processo (POST /api/auth/session).
// Guardado só em memória, um F5 ou uma segunda aba perdia o token e o bootstrap seguinte
// recebia 403 — toda chamada autenticada passava a falhar até reiniciar o servidor. O
// localStorage mantém o token entre reloads e abas; um 401 (servidor reiniciado = token
// novo) descarta o valor salvo e refaz o bootstrap.
const TOKEN_STORAGE_KEY = "nextcode:session-token";

function readStoredToken(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // localStorage indisponível (modo privado/bloqueado): segue só com o token em memória.
  }
}

async function bootstrapSessionToken(): Promise<string | null> {
  const stored = readStoredToken();
  if (stored) return stored;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const res = await fetch(`${base}/api/auth/session`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const token = typeof data?.token === "string" ? data.token : null;
    storeToken(token);
    return token;
  } catch {
    return null;
  }
}

/** Retorna o token de sessão local, obtendo-o uma única vez via /api/auth/session. */
export async function getSessionToken(): Promise<string | null> {
  if (!sessionPromise) sessionPromise = bootstrapSessionToken();
  return sessionPromise;
}

/**
 * Invalida a sessão em cache (ex.: após 401, força novo bootstrap). Com `rejectedToken`,
 * só apaga o valor salvo se ele for o próprio token rejeitado — se outra aba já salvou o
 * token novo (servidor reiniciado), ele é reaproveitado em vez de apagado.
 */
export function resetSessionToken(rejectedToken?: string | null): void {
  sessionPromise = null;
  if (rejectedToken === undefined || readStoredToken() === rejectedToken) storeToken(null);
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
    resetSessionToken(token);
    const fresh = await getSessionToken();
    if (fresh && fresh !== token) {
      headers.set("X-Nextcode-Token", fresh);
      res = await fetch(input, { ...init, headers });
    }
  }
  return res;
}

/**
 * Download autenticado. `window.open(url)` e `<a href>` não conseguem enviar o header
 * X-Nextcode-Token, então rotas protegidas (exportações) respondiam 401 na aba nova.
 * Baixa via authFetch e entrega o arquivo ao navegador como Blob.
 */
export async function authDownload(input: string, fallbackFileName: string): Promise<void> {
  const res = await authFetch(input);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Falha no download (HTTP ${res.status})`);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || fallbackFileName;
  const blobUrl = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Consome um endpoint Server-Sent Events autenticado. `EventSource` não envia headers
 * customizados, então rotas SSE protegidas (ex.: /api/terminal/stream) respondiam 401.
 * Lê o stream via authFetch e entrega cada evento (`event:` + `data:` JSON) ao callback.
 * Retorna quando o stream termina; `signal` permite cancelar.
 */
export async function authEventStream(
  input: string,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await authFetch(input, { signal, headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Falha ao abrir o stream (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      const rawData = dataLines.join("\n");
      let data: unknown = rawData;
      try {
        data = JSON.parse(rawData);
      } catch {
        // payload não-JSON: entrega o texto cru
      }
      onEvent(eventName, data);
    }
  }
}
