/**
 * Fase 7 — Testes unitários da criptografia AES-256-GCM (crypto.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MODULE = "../../src/core/security/crypto";

async function loadCrypto() {
  vi.resetModules();
  return import(MODULE);
}

describe("crypto.ts — AES-256-GCM em repouso", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXTCODE_MASTER_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("round-trip com chave mestra base64 de 32 bytes", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
    const c = await loadCrypto();
    const secret = "sk-test-ABC123xyz";
    const enc = c.encryptSecret(secret);

    expect(enc).not.toContain(secret); // texto plano NUNCA aparece no cifrado
    expect(c.isEncrypted(enc)).toBe(true); // Fase 8: novo envelope v2 (v1 continua legível)
    expect(c.decryptSecret(enc)).toBe(secret);
    expect(c.readSecret(enc)).toBe(secret);
  });

  it("round-trip com segredo arbitrário derivado via PBKDF2", async () => {
    process.env.NEXTCODE_MASTER_KEY = "uma-frase-passada-nao-base64";
    const c = await loadCrypto();
    const enc = c.encryptSecret("chave-de-api-super-secreta");
    expect(c.decryptSecret(enc)).toBe("chave-de-api-super-secreta");
  });

  it("IV aleatório: duas cifras do mesmo texto são diferentes (e ambas decodificam)", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 1).toString("base64");
    const c = await loadCrypto();
    const a = c.encryptSecret("mesma-chave");
    const b = c.encryptSecret("mesma-chave");
    expect(a).not.toBe(b);
    expect(c.decryptSecret(a)).toBe("mesma-chave");
    expect(c.decryptSecret(b)).toBe("mesma-chave");
  });

  it("GCM detecta adulteração do ciphertext (auth tag) e lança erro", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 2).toString("base64");
    const c = await loadCrypto();
    const enc = c.encryptSecret("integridade-importa");
    const parts = enc.split(":");
    // altera 1 caractere do bloco cifrado mantendo base64 válido
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    const tampered = parts.join(":");

    expect(() => c.decryptSecret(tampered)).toThrow();
    // readSecret degrada com segurança: retorna vazio em vez de vazar/quebrar o app
    expect(c.readSecret(tampered)).toBe("");
  });

  it("chave mestra errada não descriptografa (readSecret retorna vazio)", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 3).toString("base64");
    const c1 = await loadCrypto();
    const enc = c1.encryptSecret("segredo");

    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 99).toString("base64");
    const c2 = await loadCrypto();
    expect(() => c2.decryptSecret(enc)).toThrow();
    expect(c2.readSecret(enc)).toBe("");
  });

  it("sem NEXTCODE_MASTER_KEY: encryptSecret mantém legado texto-plano com aviso", async () => {
    delete process.env.NEXTCODE_MASTER_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = await loadCrypto();
    const out = c.encryptSecret("legado-sem-master-key");
    expect(out).toBe("legado-sem-master-key");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TEXTO PLANO"));
    warn.mockRestore();
  });

  it("valores legados texto-plano passam por decryptSecret/readSecret sem erro", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 4).toString("base64");
    const c = await loadCrypto();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(c.readSecret("sk-plain-old-key")).toBe("sk-plain-old-key");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("writeSecret cifra na escrita, é idempotente e descarta vazios", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 5).toString("base64");
    const c = await loadCrypto();
    const w = c.writeSecret("sk-nova")!;
    expect(c.isEncrypted(w)).toBe(true);
    expect(c.writeSecret(w)).toBe(w); // re-gravação não dupla-cifra
    expect(c.writeSecret("   ")).toBe(null);
    expect(c.writeSecret(null)).toBe(null);
  });

  it("maskSecret nunca expõe o corpo da chave (nem a cifra)", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 6).toString("base64");
    const c = await loadCrypto();
    expect(c.maskSecret("sk-abcdefgh1234")).toBe("****1234");
    const enc = c.encryptSecret("sk-abcdefgh1234");
    const masked = c.maskSecret(enc);
    expect(masked).toBe("****"); // cifrado: sem tail algum
    expect(masked).not.toContain("1234");
  });

  it("formato inválido 'enc:v1:' incompleto lança erro claro", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 8).toString("base64");
    const c = await loadCrypto();
    expect(() => c.decryptSecret("enc:v1:somente-um-campo")).toThrow(/Formato/);
  });

  // ================= FASE 8 — Rotação de chaves (envelope v2) =================

  it("v2: encryptSecret usa envelope enc:v2:<keyId>. com a chave ativa", async () => {
    process.env.NEXTCODE_MASTER_KEY = Buffer.alloc(32, 11).toString("base64");
    const c = await loadCrypto();
    const enc = c.encryptSecret("sk-v2-teste");
    expect(enc.startsWith("enc:v2:")).toBe(true);
    const kid = enc.slice("enc:v2:".length).split(".")[0];
    expect(kid).toMatch(/^[0-9a-f]{8}$/);
    expect(kid).toBe(c.masterKeyId());
    expect(c.decryptSecret(enc)).toBe("sk-v2-teste");
    expect(c.isEncryptedWithActiveKey(enc)).toBe(true);
  });

  it("rotação sem downtime: NEXTCODE_MASTER_KEYS decifra dados da chave ANTIGA e escreve com a NOVA", async () => {
    const oldKey = Buffer.alloc(32, 21).toString("base64");
    const newKey = Buffer.alloc(32, 22).toString("base64");

    // 1) dado criado sob a chave antiga (v2 do keyId antigo)
    process.env.NEXTCODE_MASTER_KEY = oldKey;
    let c = await loadCrypto();
    const legacy = c.encryptSecret("sk-original");
    expect(legacy.startsWith("enc:v2:")).toBe(true);

    // 2) ambiente rotacionado: nova ativa + antiga ainda aceita para leitura
    process.env.NEXTCODE_MASTER_KEYS = `${newKey},${oldKey}`;
    c = await loadCrypto();
    expect(c.readSecret(legacy)).toBe("sk-original"); // não quebrou nada
    expect(c.isEncryptedWithActiveKey(legacy)).toBe(false); // precisa re-wrap

    // 3) rewrap promove para a chave ativa
    const promoted = c.rewrapSecret(legacy)!;
    expect(c.isEncryptedWithActiveKey(promoted)).toBe(true);
    expect(c.decryptSecret(promoted)).toBe("sk-original");
    expect(c.masterKeyId()!.slice(0, 8)).not.toBe(legacy.slice("enc:v2:".length, "enc:v2:".length + 8));

    // 4) writeSecret também faz lazy rewrap ao receber cifra antiga
    const rew = c.writeSecret(legacy)!;
    expect(c.isEncryptedWithActiveKey(rew)).toBe(true);
  });

  it("após remover a chave antiga, segredos não re-cifrados falham com mensagem clara (leia antes de remover!)", async () => {
    const oldKey = Buffer.alloc(32, 31).toString("base64");
    const newKey = Buffer.alloc(32, 32).toString("base64");
    process.env.NEXTCODE_MASTER_KEY = oldKey;
    let c = await loadCrypto();
    const legacy = c.encryptSecret("sk-a-perder");
    process.env.NEXTCODE_MASTER_KEYS = newKey; // antiga removida cedo demais
    c = await loadCrypto();
    expect(() => c.decryptSecret(legacy)).toThrow(/Nenhuma chave mestra atual\/antiga/);
    expect(c.readSecret(legacy)).toBe(""); // readSecret degrada em vez de lançar
  });

  it("retrocompatibilidade total: v1 legado continua legível e é promovido a v2 no rewrap", async () => {
    const key = Buffer.alloc(32, 41).toString("base64");
    process.env.NEXTCODE_MASTER_KEY = key;
    const c = await loadCrypto();
    // constrói um envelope v1 manualmente (como o script da Fase 2 gerava)
    const cryptoNode = await import("crypto");
    const iv = cryptoNode.default.randomBytes(12);
    const cipher = cryptoNode.default.createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
    const data = Buffer.concat([cipher.update("sk-v1-legada", "utf8"), cipher.final()]);
    const v1 = `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;

    expect(c.isEncrypted(v1)).toBe(true);
    expect(c.readSecret(v1)).toBe("sk-v1-legada");
    expect(c.isEncryptedWithActiveKey(v1)).toBe(false);
    const promoted = c.rewrapSecret(v1)!;
    expect(promoted.startsWith("enc:v2:")).toBe(true);
    expect(c.decryptSecret(promoted)).toBe("sk-v1-legada");
  });

  it("rewrapSecret retorna null para valores vazios ou indecifráveis (nunca destrói dados)", async () => {
    process.env.NEXTCODE_MASTER_KEYS = Buffer.alloc(32, 51).toString("base64");
    const c = await loadCrypto();
    expect(c.rewrapSecret(null)).toBe(null);
    expect(c.rewrapSecret("")).toBe(null);
    expect(c.rewrapSecret(c.encryptSecret("ja-ativa"))).toBe(null); // já usa chave ativa
    expect(c.rewrapSecret("enc:v2:deadbeef.aaa:bbb:ccc")).toBe(null); // keyId desconhecido → preservado
  });
});
