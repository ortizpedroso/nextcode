/**
 * Fase 2 — Criptografia de chaves em repouso (AES-256-GCM).
 * Fase 8 — Rotação de chaves-mestras com formato envelope:
 *   enc:v1:<iv_b64>:<tag_b64>:<cipher_b64>                      (chave atual / legada)
 *   enc:v2:<keyId>.<iv_b64>:<tag_b64>:<cipher_b64>              (rotacionada)
 *
 * Suporte a múltiplas chaves simultâneas via NEXTCODE_MASTER_KEYS (lista separada
 * por vírgula, ex.: "newKey,oldKey"). A PRIMEIRA é usada para novas escritas;
 * TODAS são tentadas na leitura — o que permite rotacionar SEM downtime e
 * re-cifrar sob demanda (lazy rewrap). NEXTCODE_MASTER_KEY continua suportada.
 *
 * A chave mestra vem do ambiente, NUNCA do banco.
 * Valores sem prefixo "enc:" são lidos como legado texto-plano com aviso.
 */
import crypto from "crypto";

const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";
const KEY_LEN = 32; // AES-256

// Cache por valor-bruto da env var (testes alteram process.env e esperam novo comportamento).
const keyCache = new Map<string, Buffer[]>();

function deriveKey(raw: string): Buffer {
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === KEY_LEN) return decoded;
  } catch {
    /* não é base64 válido; segue para derivação */
  }
  return crypto.pbkdf2Sync(raw, "nextcode-master-key-salt-v1", 100000, KEY_LEN, "sha256");
}

/** Lista ordenada de chaves-mestras CONFIGURADAS via ambiente. Índice 0 = ativa para escrita. */
function getConfiguredMasterKeys(): Buffer[] {
  const multi = (process.env.NEXTCODE_MASTER_KEYS || "").trim();
  const single = (process.env.NEXTCODE_MASTER_KEY || "").trim();
  const sources = multi
    ? multi.split(",").map((s) => s.trim()).filter(Boolean)
    : single
      ? [single]
      : [];
  const cacheKey = `cfg:${sources.join("|")}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const keys = sources.map(deriveKey);
  keyCache.set(cacheKey, keys);
  return keys;
}

/**
 * SEGURANÇA: esta chave era usada como fallback silencioso de ESCRITA quando
 * nenhuma NEXTCODE_MASTER_KEY estava configurada — como está hardcoded no
 * código-fonte, qualquer leitor do repositório podia decifrar os segredos
 * "cifrados" com ela (confidencialidade falsa). Mantida AQUI apenas como
 * último recurso de LEITURA, para não travar a decifragem de segredos já
 * gravados sob essa chave antes desta correção. Nunca é usada para cifrar
 * dados novos — ver getMasterKey()/encryptSecret().
 */
const LEGACY_DEFAULT_KEY = "nextcode-master-key-v5-stable-local-32b";

function getAllMasterKeys(): Buffer[] {
  const configured = getConfiguredMasterKeys();
  if (configured.length > 0) return configured;
  if (process.env.VITEST || process.env.NODE_ENV === "test") return [];
  const cacheKey = "legacy-fallback";
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const keys = [deriveKey(LEGACY_DEFAULT_KEY)];
  keyCache.set(cacheKey, keys);
  return keys;
}

/** Segredo não pode ser gravado: produção sem NEXTCODE_MASTER_KEY(S) configurada. */
export class MasterKeyMissingError extends Error {
  constructor() {
    super(
      "NEXTCODE_MASTER_KEY não está configurada — em produção nenhuma chave de API é gravada em texto plano. " +
        "Defina NEXTCODE_MASTER_KEY (ou NEXTCODE_MASTER_KEYS) no .env e reinicie o servidor."
    );
    this.name = "MasterKeyMissingError";
  }
}

/** true quando há chave mestra ativa, ou seja, segredos novos serão gravados cifrados. */
export function isSecretEncryptionEnabled(): boolean {
  return getMasterKey() !== null;
}

/** Chave ATIVA para cifrar dados novos. null = sem NEXTCODE_MASTER_KEY configurada (falha fechada: ver encryptSecret). */
function getMasterKey(): Buffer | null {
  const keys = getConfiguredMasterKeys();
  return keys.length > 0 ? keys[0] : null;
}

/** Identificador estável (8 hex) de uma chave mestra, p/ envelope v2. */
export function masterKeyId(key?: Buffer | null): string | null {
  const k = key ?? getMasterKey();
  if (!k) return null;
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 8);
}

/** true se `value` já foi cifrada com a chave ATIVA (não precisa de re-wrap). */
export function isEncryptedWithActiveKey(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  const activeId = masterKeyId();
  if (!activeId) return isEncrypted(value); // sem env: aceita v1 como "ok" (modo legado)
  if (value.startsWith(V1_PREFIX)) return false; // v1 será promovido a v2 na próxima escrita
  if (value.startsWith(V2_PREFIX)) {
    const kid = value.slice(V2_PREFIX.length).split(".")[0];
    return kid === activeId;
  }
  return false; // texto plano
}

export function isEncrypted(value?: string | null): boolean {
  return typeof value === "string" && (value.startsWith(V1_PREFIX) || value.startsWith(V2_PREFIX));
}

/**
 * Cifra com a chave ATIVA (índice 0 da lista) usando envelope v2 com keyId.
 * Assim cada segredo carrega a impressão digital da chave que o protegeu,
 * permitindo rotação sem perder a capacidade de leitura das chaves antigas.
 */
export function encryptSecret(plaintext: string): string {
  const master = getMasterKey();
  if (!master) {
    // Em produção a ausência da chave mestra é falha fechada: nenhum segredo vai para o
    // banco em texto plano. Fora de produção mantém o legado (não quebra o dev local),
    // com advertência no console e na UI (GET /api/settings → secretsEncryptionEnabled).
    if (process.env.NODE_ENV === "production") {
      throw new MasterKeyMissingError();
    }
    console.warn(
      "[SECURITY] NEXTCODE_MASTER_KEY ausente — chave gravada em TEXTO PLANO. Defina a variável no .env."
    );
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const kid = masterKeyId(master)!;
  return `${V2_PREFIX}${kid}.${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Tenta decifrar um payload (iv:tag:cipher) com uma chave específica. */
function tryDecryptWith(master: Buffer, ivB64: string, tagB64: string, dataB64: string): string | null {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", master, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null; // GCM auth fail → chave errada
  }
}

export function decryptSecret(stored?: string | null): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) {
    // Legado texto-plano: devolve como está e avisa (será criptografado na próxima escrita).
    console.warn("[SECURITY] Chave legada em texto plano detectada — será criptografada na próxima gravação.");
    return stored;
  }
  const masters = getAllMasterKeys();
  if (masters.length === 0) {
    throw new Error(
      "Chave criptografada encontrada, mas NEXTCODE_MASTER_KEY não está definida. Restaure a chave mestra original."
    );
  }

  let body: string;
  let preferredId: string | null = null;
  if (stored.startsWith(V2_PREFIX)) {
    body = stored.slice(V2_PREFIX.length);
    const dot = body.indexOf(".");
    if (dot < 0) throw new Error("Formato de envelope v2 inválido (esperado enc:v2:keyId.iv:tag:cipher).");
    preferredId = body.slice(0, dot);
    body = body.slice(dot + 1);
  } else {
    body = stored.slice(V1_PREFIX.length);
  }

  const parts = body.split(":");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new Error("Formato de chave criptografada inválido (esperado iv:tag:cipher).");
  }
  const [ivB64, tagB64, dataB64] = parts;

  // Ordem de tentativa: se houver keyId (v2), testa a chave correspondente primeiro;
  // depois todas as demais (cobre v1 legado e rotacões já removidas parcialmente).
  const ordered = [...masters];
  if (preferredId) {
    ordered.sort((a, b) => {
      const am = masterKeyId(a) === preferredId ? 0 : 1;
      const bm = masterKeyId(b) === preferredId ? 0 : 1;
      return am - bm;
    });
  }
  for (const m of ordered) {
    const out = tryDecryptWith(m, ivB64, tagB64, dataB64);
    if (out !== null) return out;
  }
  throw new Error(
    "Nenhuma chave mestra atual/antiga conseguiu decifrar este segredo (rotação incompleta ou NEXTCODE_MASTER_KEYS desatualizada)."
  );
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
  // Re-gravação idempotente: se já está cifrado COM A CHAVE ATIVA, mantém.
  // Se está cifrado com chave antiga (v1 ou v2 de keyId diferente), promove para a ativa.
  if (isEncryptedWithActiveKey(trimmed)) return trimmed;
  if (isEncrypted(trimmed)) {
    const plain = readSecret(trimmed);
    if (plain) return encryptSecret(plain); // lazy rewrap pós-rotação
  }
  return encryptSecret(trimmed);
}

/**
 * Fase 8 — Promove um segredo legado (texto-plano ou v1/v2 de chave antiga)
 * para o envelope v2 cifrado com a chave ATIVA. Retorna null se nada precisa
 * mudar (já usa a chave ativa) ou se o segredo não pôde ser lido.
 */
export function rewrapSecret(stored?: string | null): string | null {
  if (!stored) return null;
  if (isEncryptedWithActiveKey(stored)) return null; // nada a fazer
  const plain = readSecret(stored);
  if (!plain) return null; // indecifrável — não sobrescrever (evita destruir dados)
  return encryptSecret(plain);
}

/** Máscara segura para logs/respostas: ****abcd */
export function maskSecret(value?: string | null): string {
  if (!value) return "";
  const plain = isEncrypted(value) ? "" : value;
  const tail = plain.length >= 4 ? plain.slice(-4) : "";
  return `****${tail}`;
}
