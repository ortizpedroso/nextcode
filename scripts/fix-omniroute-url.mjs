/**
 * fix-omniroute-url.mjs — corrige registros legados do SQLite.
 *
 * O schema antigo tinha default "http://localhost:8080/v1" para omniRouteUrl e
 * customEndpoint, mas o OmniRoute real roda em 20128 (docker-compose.yml).
 * Linhas que nunca foram editadas pelo usuario carregam a porta morta 8080 e
 * fazem o router apontar para uma porta fechada -> erro "Cotas e Servicos
 * Indisponiveis". Este script so reescreve valores que ainda contem ":8080",
 * preservando qualquer URL personalizada ja configurada. Idempotente.
 *
 * Uso: node scripts/fix-omniroute-url.mjs [caminho-do-dev.db]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dbPath = process.argv[2] || "./prisma/dev.db";
const NEW_URL = "http://localhost:20128/v1";

// Carrega better-sqlite3 via Node.js >=22 (node:sqlite) ou fallback ao driver do projeto.
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  try {
    DatabaseSync = require("better-sqlite3");
  } catch {
    console.error("ERRO: nem 'node:sqlite' (Node >=22) nem 'better-sqlite3' disponiveis.");
    console.error("Rode com Node 22+ (sua maquina tem v24) ou instale better-sqlite3.");
    process.exit(1);
  }
}

if (!fs.existsSync(dbPath)) {
  console.error(`ERRO: banco nao encontrado em "${path.resolve(dbPath)}".`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT id, omniRouteUrl, customEndpoint FROM Setting").all();
if (!rows.length) {
  console.log("Nenhum registro em Setting - nada a corrigir.");
  process.exit(0);
}

let fixed = 0;
for (const r of rows) {
  const newOmni = r.omniRouteUrl && String(r.omniRouteUrl).includes(":8080") ? NEW_URL : r.omniRouteUrl;
  const newCustom = r.customEndpoint && String(r.customEndpoint).includes(":8080") ? NEW_URL : r.customEndpoint;
  if (newOmni !== r.omniRouteUrl || newCustom !== r.customEndpoint) {
    db.prepare("UPDATE Setting SET omniRouteUrl = ?, customEndpoint = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .run(newOmni, newCustom, r.id);
    fixed++;
    console.log(`Corrigido [${r.id}]: omniRouteUrl="${r.omniRouteUrl}" -> "${newOmni}" | customEndpoint="${r.customEndpoint}" -> "${newCustom}"`);
  }
}
console.log(fixed ? `Concluido. ${fixed} registro(s) corrigido(s).` : "Nada corrigido - nenhuma URL legado na porta 8080.");
