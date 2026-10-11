import { PrismaClient } from "@prisma/client";
import { readSecret } from "../src/core/security/crypto.js";

const prisma = new PrismaClient();

async function main() {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  console.log("Setting Keys Status:");
  console.log({
    claudeKeyPresent: Boolean(setting?.claudeKey),
    claudeKeyLength: setting?.claudeKey ? readSecret(setting.claudeKey).length : 0,
    claudeKeyPrefix: setting?.claudeKey ? readSecret(setting.claudeKey).slice(0, 10) : "n/a",
    deepseekKeyPresent: Boolean(setting?.deepseekKey),
    omniRouteKeyPresent: Boolean(setting?.omniRouteKey),
    typesafeKeyPresent: Boolean(setting?.typesafeKey),
  });
  await prisma.$disconnect();
}

main().catch(console.error);
