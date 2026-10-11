import { PrismaClient } from "@prisma/client";
import { readSecret } from "../src/core/security/crypto.js";

const prisma = new PrismaClient();

async function testModel(rawKey: string, model: string) {
  console.log(`\n--- Testando modelo: ${model} ---`);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": rawKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{ role: "user", content: "Diga apenas: 'ANTHROPIC OK'" }],
    }),
  });

  const json = await res.json().catch(() => null);
  console.log(`Status HTTP: ${res.status}`);
  if (res.ok) {
    console.log("Sucesso! Resposta:", json?.content?.[0]?.text);
    console.log("Uso de tokens:", json?.usage);
    return true;
  } else {
    console.log("Erro:", json?.error?.message || json);
    return false;
  }
}

async function main() {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  if (!setting?.claudeKey) return;
  const rawKey = readSecret(setting.claudeKey);

  const models = [
    "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-haiku-20240307",
    "claude-3-sonnet-20240229",
    "claude-3-5-haiku-20241022",
  ];

  for (const m of models) {
    const ok = await testModel(rawKey, m);
    if (ok) break;
  }

  await prisma.$disconnect();
}

main().catch(console.error);
