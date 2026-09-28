/**
 * Fase 2 — Criptografia de chaves em repouso (AES-256-GCM).
 *
 * As API keys (Gemini/OpenAI/Claude/DeepSeek/OmniRoute) deixam de ser gravadas
 * em texto plano no SQLite. Formato armazenado:
 *   enc:v1:<iv_b64>:<tag_b64>:<cipher_b64>
 *
 * A chave mestra vem do ambiente (NEXTCODE_MASTER_KEY), NUNCA do banco.
 * Valores sem prefixo "enc:v1:" são lidos como legado (texto plano) com aviso,
 * e são criptografados automaticamente na próxima escrita — migração suave.
 */
import crypto from "crypto";

const PREFIX = "enc:v1:";
const KEY_LEN = 32; // AES-256

let cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer | null {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = (process.env.NEXTCODE_MASTER_KEY || "").trim();
  if (!raw) return null;
  // Aceita base64 de 32 bytes ou qualquer segredo (derivado via PBKDF2)
  let key: Buffer | null = null;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === KEY_LEN) key = decoded;
  } catch {
    /* não é base64 válido; segue para derivação */
  }
  if (!key) {
    key = crypto.pbkdf2Sync(raw, "nextcode-master-key-salt-v1", 100000, KEY_LEN, "sha256");
  }
  cachedMasterKey = key;
  return key;
}

export function isEncrypted(value?: string | null): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const master = getMasterKey();
  if (!master) {
    // Sem chave mestra configurada: mantém comportamento legado (não quebra o app),
    // mas loga advertência clara.
    console.warn(
      "[SECURITY] NEXTCODE_MASTER_KEY ausente — chave gravada em TEXTO PLANO. Defina a variável no .env."
    );
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored?: string | null): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) {
    // Legado texto-plano: devolve como está e avisa (será criptografado na próxima escrita).
    console.warn("[SECURITY] Chave legada em texto plano detectada — será criptografada na próxima gravação.");
    return stored;
  }
  const master = getMasterKey();
  if (!master) {
    throw new Error(
      "Chave criptografada encontrada, mas NEXTCODE_MASTER_KEY não está definida. Restaure a chave mestra original."
    );
  }
  const body = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Formato de chave criptografada inválido (esperado enc:v1:iv:tag:cipher).");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", master, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Wrapper de leitura usado por setup/health/smart-router/settings:
 * aceita valor cifrado OU legado texto-plano.
 */
export function readSecret(stored?: string | null): string {
  try {
    return decryptSecret(stored);
  } catch (err) {
    console.error("[SECURITY] Falha ao descriptografar chave (NEXTCODE_MASTER_KEY incorreta?):", String(err));
    return "";
  }
}

/** Wrapper de escrita: nunca grava texto plano quando a chave mestra existe. */
export function writeSecret(plaintext?: string | null): string | null {
  if (plaintext === undefined || plaintext === null) return null;
  const trimmed = String(plaintext).trim();
  if (!trimmed) return null;
  if (isEncrypted(trimmed)) return trimmed; // já cifrado (ex.: re-gravação idempotente)
  return encryptSecret(trimmed);
}

/** Máscara segura para logs/respostas: ****abcd */
export function maskSecret(value?: string | null): string {
  if (!value) return "";
  const plain = isEncrypted(value) ? "" : value;
  const tail = plain.length >= 4 ? plain.slice(-4) : "";
  return `****${tail}`;
}
