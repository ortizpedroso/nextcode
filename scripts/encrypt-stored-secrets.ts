/**
 * Cifra com a NEXTCODE_MASTER_KEY ativa todo segredo guardado em texto plano no SQLite
 * (Setting, LlmGateway, CustomProvider). Idempotente: valores já cifrados com a chave ativa
 * ficam como estão. Confere que cada valor decifra igual ao original antes de gravar.
 * Uso: npx tsx scripts/encrypt-stored-secrets.ts   (pare o npm run dev antes)
 */
import prisma from "../src/lib/prisma";
import { isEncryptedWithActiveKey, isSecretEncryptionEnabled, readSecret, writeSecret } from "../src/core/security/crypto";

const SETTING_FIELDS = ["geminiKey", "claudeKey", "openaiKey", "deepseekKey", "groqKey", "nvidiaKey", "omniRouteKey", "typesafeKey"] as const;

function convert(value: string | null | undefined, label: string): string | null | undefined {
  if (!value || isEncryptedWithActiveKey(value)) return undefined;
  const plain = readSecret(value);
  if (!plain) throw new Error(`${label}: valor não pôde ser lido — abortando sem gravar nada.`);
  const encrypted = writeSecret(plain);
  if (!encrypted || readSecret(encrypted) !== plain) throw new Error(`${label}: verificação pós-cifra falhou.`);
  return encrypted;
}

async function main() {
  if (!isSecretEncryptionEnabled()) throw new Error("NEXTCODE_MASTER_KEY não está definida no ambiente.");
  let count = 0;

  for (const s of await prisma.setting.findMany()) {
    const data: Record<string, string> = {};
    for (const f of SETTING_FIELDS) {
      const enc = convert((s as Record<string, any>)[f], `Setting.${f}`);
      if (enc) data[f] = enc;
    }
    if (Object.keys(data).length) {
      await prisma.setting.update({ where: { id: s.id }, data });
      count += Object.keys(data).length;
    }
  }
  for (const g of await prisma.llmGateway.findMany()) {
    const enc = convert(g.apiKey, `LlmGateway.${g.id}`);
    if (enc) {
      await prisma.llmGateway.update({ where: { id: g.id }, data: { apiKey: enc } });
      count++;
    }
  }
  for (const c of await prisma.customProvider.findMany()) {
    const enc = convert((c as any).apiKey, `CustomProvider.${c.id}`);
    if (enc) {
      await prisma.customProvider.update({ where: { id: c.id }, data: { apiKey: enc } as any });
      count++;
    }
  }
  for (const m of await prisma.mcpServer.findMany()) {
    if (!m.env || !m.env.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.env);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const envObj = { ...(parsed as Record<string, unknown>) };
    let changed = 0;
    for (const [k, v] of Object.entries(envObj)) {
      if (v === undefined || v === null) continue;
      const enc = convert(String(v), `McpServer.${m.id}.${k}`);
      if (enc) {
        envObj[k] = enc;
        changed++;
      }
    }
    if (changed > 0) {
      await prisma.mcpServer.update({
        where: { id: m.id },
        data: { env: JSON.stringify(envObj) },
      });
      count += changed;
    }
  }
  console.log(`Concluído: ${count} segredo(s) cifrado(s).`);
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
