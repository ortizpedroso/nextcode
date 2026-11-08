import { spawn } from "node:child_process";

/** `freellmapi-` + 24 bytes em hex, o formato que o próprio gateway gera. */
const UNIFIED_KEY = /^freellmapi-[a-f0-9]{48}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const CACHE_MS = 60_000;

const READ_JS =
  "const Database=require('better-sqlite3');" +
  "const db=new Database('/app/server/data/freeapi.db',{readonly:true});" +
  "const row=db.prepare(\"SELECT value FROM settings WHERE key = 'unified_api_key'\").get();" +
  "if(row&&row.value)process.stdout.write(String(row.value));";

let cached: { at: number; key: string | null } | null = null;

export function isFreellmapiUnifiedKey(value: string): boolean {
  return UNIFIED_KEY.test(value.trim());
}

/** Só o FreeLLMAPI desta máquina, na porta publicada pelo docker-compose. */
export function isLocalFreellmapiBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) return false;
    return url.port === "3100";
  } catch {
    return false;
  }
}

export function shouldSyncLocalFreellmapiKey(baseUrl: string): boolean {
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.NEXTCODE_FREELLMAPI_KEY_SYNC === "0") return false;
  return isLocalFreellmapiBaseUrl(baseUrl);
}

export function resetLocalUnifiedKeyCache(): void {
  cached = null;
}

/** Lê a chave unificada no container local. Não registra o valor. */
export function readUnifiedKeyFromDocker(timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (key: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(key);
    };
    const child = spawn(
      "docker",
      ["exec", "-w", "/app/server", "nextcode-freellmapi", "node", "-e", READ_JS],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.length > 200) child.kill();
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      const key = out.trim();
      finish(isFreellmapiUnifiedKey(key) ? key : null);
    });
  });
}

export async function localUnifiedKey(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.key;
  const key = await readUnifiedKeyFromDocker();
  cached = { at: Date.now(), key };
  return key;
}
