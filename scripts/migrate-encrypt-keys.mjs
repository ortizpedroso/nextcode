#!/usr/bin/env node
/**
 * Fase 2 — Migração idempotente: criptografa chaves em texto plano no SQLite.
 * Uso: NEXTCODE_MASTER_KEY=... node scripts/migrate-encrypt-keys.mjs
 */
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const PREFIX = "enc:v1:";
const KEY_LEN = 32;

const raw = (process.env.NEXTCODE_MASTER_KEY || "").trim();
if (!raw) {
  console.error("ERRO: defina NEXTCODE_MASTER_KEY antes de migrar.");
  process.exit(1);
}
let master;
try {
  const d = Buffer.from(raw, "base64");
  master = d.length === KEY_LEN ? d : null;
} catch { master = null; }
if (!master) master = crypto.pbkdf2Sync(raw, "nextcode-master-key-salt-v1", 100000, KEY_LEN, "sha256");

function encrypt(p) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", master, iv);
  const enc = Buffer.concat([c.update(p, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

const dbFile = process.argv[2] || process.env.DATABASE_URL?.replace(/^file:/, "") || path.join("prisma", "dev.db");
console.log(`Migrando banco: ${dbFile}`);
const db = new DatabaseSync(dbFile);
const cols = ["geminiKey", "claudeKey", "openaiKey", "deepseekKey", "omniRouteKey"];
const rows = db.prepare("SELECT id, " + cols.join(", ") + " FROM Setting").all();
let migrated = 0;
for (const row of rows) {
  const sets = [];
  const params = [];
  for (const col of cols) {
    const v = row[col];
    if (typeof v === "string" && v.length > 0 && !v.startsWith(PREFIX)) {
      sets.push(`${col} = ?`);
      params.push(encrypt(v));
      migrated++;
    }
  }
  if (sets.length) {
    params.push(row.id);
    db.prepare(`UPDATE Setting SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}
// CustomProvider.apiKey
try {
  const cps = db.prepare("SELECT id, apiKey FROM CustomProvider").all();
  for (const cp of cps) {
    if (cp.apiKey && !String(cp.apiKey).startsWith(PREFIX)) {
      db.prepare("UPDATE CustomProvider SET apiKey = ? WHERE id = ?").run(encrypt(String(cp.apiKey)), cp.id);
      migrated++;
    }
  }
} catch { /* tabela pode não existir ainda */ }
db.close();
console.log(`Concluído. ${migrated} segredo(s) criptografado(s). O script é idempotente.`);
