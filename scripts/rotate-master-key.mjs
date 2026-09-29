#!/usr/bin/env node
/**
 * Fase 8 — Rotação da chave mestra de criptografia (envelope v2).
 *
 * Procedimento seguro (sem downtime):
 *   1. Gere a NOVA chave:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. Aponte o app para as DUAS chaves, nova primeiro:
 *        NEXTCODE_MASTER_KEYS="<nova>,<antiga>"     (a antiga ainda decifra dados v1/v2 velhos)
 *      e reinicie o NextCode. O app já escreve segredos novos com a chave ativa.
 *   3. Rode este script COM AS DUAS CHAVES no ambiente — ele re-cifra TODOS os
 *      segredos do SQLite com a chave ATIVA (índice 0 de NEXTCODE_MASTER_KEYS).
 *        node scripts/rotate-master-key.mjs
 *   4. Depois de "Nada a re-cifrar", remova a chave antiga do .env
 *      (NEXTCODE_MASTER_KEYS=<nova> ou apenas NEXTCODE_MASTER_KEY=<nova>) e reinicie.
 *
 * Idempotente e conservador: segredos indecifráveis são PULADOS (nunca destruídos).
 */
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";
const KEY_LEN = 32;

function deriveKey(raw) {
  try {
    const d = Buffer.from(raw, "base64");
    if (d.length === KEY_LEN) return d;
  } catch {}
  return crypto.pbkdf2Sync(raw, "nextcode-master-key-salt-v1", 100000, KEY_LEN, "sha256");
}

function keyId(k) {
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 8);
}

const multi = (process.env.NEXTCODE_MASTER_KEYS || "").trim();
const single = (process.env.NEXTCODE_MASTER_KEY || "").trim();
const sources = multi ? multi.split(",").map((s) => s.trim()).filter(Boolean) : single ? [single] : [];
if (sources.length === 0) {
  console.error("ERRO: defina NEXTCODE_MASTER_KEYS=\"<nova>,<antiga>\" (ou NEXTCODE_MASTER_KEY) antes de rotacionar.");
  process.exit(1);
}
const keys = sources.map(deriveKey);
const active = keys[0];
const activeKid = keyId(active);

function encryptV2(plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", active, iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return `${V2_PREFIX}${activeKid}.${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

function decryptAny(stored) {
  let body;
  let preferredId = null;
  if (stored.startsWith(V2_PREFIX)) {
    body = stored.slice(V2_PREFIX.length);
    const dot = body.indexOf(".");
    if (dot < 0) return null;
    preferredId = body.slice(0, dot);
    body = body.slice(dot + 1);
  } else if (stored.startsWith(V1_PREFIX)) {
    body = stored.slice(V1_PREFIX.length);
  } else {
    return { plain: stored }; // texto plano legado → precisa cifrar
  }
  const parts = body.split(":");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [ivB64, tagB64, dataB64] = parts;
  const ordered = [...keys].sort((a, b) => {
    const am = preferredId && keyId(a) === preferredId ? 0 : 1;
    const bm = preferredId && keyId(b) === preferredId ? 0 : 1;
    return am - bm;
  });
  for (const m of ordered) {
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", m, Buffer.from(ivB64, "base64"));
      d.setAuthTag(Buffer.from(tagB64, "base64"));
      return { plain: Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8") };
    } catch {}
  }
  return null; // indecifrável com as chaves fornecidas
}

function needsRewrap(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith(V2_PREFIX)) return true; // v1 ou texto plano
  const kid = value.slice(V2_PREFIX.length).split(".")[0];
  return kid !== activeKid; // v2 de chave antiga
}

const dbFile = process.argv[2] || process.env.DATABASE_URL?.replace(/^file:/, "") || path.join("prisma", "dev.db");
console.log(`Banco: ${dbFile}`);
console.log(`Chave ativa: id=${activeKid} | lista de chaves candidatas: ${keys.length}`);

const db = new DatabaseSync(dbFile);
let rewrote = 0;
let skipped = 0;

// --- Tabela Setting (colunas de chave) ---
const settingCols = ["geminiKey", "claudeKey", "openaiKey", "deepseekKey", "omniRouteKey"];
for (const row of db.prepare(`SELECT id, ${settingCols.join(", ")} FROM Setting`).all()) {
  const sets = [];
  const params = [];
  for (const col of settingCols) {
    const v = row[col];
    if (!needsRewrap(v)) continue;
    const out = decryptAny(String(v));
    if (!out) {
      console.warn(`  PULADO ${col} (id=${row.id}): não decifrável com as chaves atuais/antigas fornecidas.`);
      skipped++;
      continue;
    }
    sets.push(`${col} = ?`);
    params.push(encryptV2(out.plain));
    rewrote++;
  }
  if (sets.length) db.prepare(`UPDATE Setting SET ${sets.join(", ")} WHERE id = ?`).run(...params, row.id);
}

// --- CustomProvider.apiKey / headers ---
try {
  for (const cp of db.prepare("SELECT id, apiKey, headers FROM CustomProvider").all()) {
    const sets = [];
    const params = [];
    if (needsRewrap(cp.apiKey)) {
      const out = decryptAny(String(cp.apiKey));
      if (out) {
        sets.push("apiKey = ?");
        params.push(encryptV2(out.plain));
        rewrote++;
      } else {
        console.warn(`  PULADO CustomProvider ${cp.id}.apiKey: indecifrável.`);
        skipped++;
      }
    }
    if (sets.length) db.prepare(`UPDATE CustomProvider SET ${sets.join(", ")} WHERE id = ?`).run(...params, cp.id);
  }
} catch {
  /* tabela pode não existir ainda */
}

db.close();
if (rewrote === 0 && skipped === 0) {
  console.log("Nada a re-cifrar — todos os segredos já usam a chave ativa. Pode remover a chave antiga do .env.");
} else {
  console.log(`Concluído: ${rewrote} segredo(s) re-cifrado(s) com a chave ativa (${activeKid}); ${skipped} pulado(s).`);
  if (skipped > 0) console.warn("ATENÇÃO: revise os pulados acima ANTES de remover a chave antiga do ambiente.");
}
