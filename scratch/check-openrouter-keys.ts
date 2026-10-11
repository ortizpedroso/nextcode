import { PrismaClient } from "@prisma/client";
import { readSecret } from "../src/core/security/crypto.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Variáveis de ambiente:");
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase().includes("openrouter") || k.toLowerCase().includes("anthropic") || k.toLowerCase().includes("claude")) {
      console.log(`ENV: ${k} = ${v ? v.slice(0, 15) + "..." : "vazio"}`);
    }
  }

  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  console.log("\nSetting Keys:");
  for (const [k, v] of Object.entries(setting || {})) {
    if (typeof v === "string" && (k.endsWith("Key") || k.endsWith("Url"))) {
      const decrypted = readSecret(v);
      console.log(`${k}: len=${decrypted.length}, prefix=${decrypted.slice(0, 15)}...`);
    }
  }

  const customProviders = await prisma.customProvider.findMany();
  console.log("\nCustomProviders:", customProviders);

  await prisma.$disconnect();
}

main().catch(console.error);
