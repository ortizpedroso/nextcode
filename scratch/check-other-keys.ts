import { PrismaClient } from "@prisma/client";
import { readSecret } from "../src/core/security/crypto.js";

const prisma = new PrismaClient();

async function main() {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  console.log("OmniRoute Key:", {
    present: Boolean(setting?.omniRouteKey),
    prefix: setting?.omniRouteKey ? readSecret(setting.omniRouteKey).slice(0, 10) : "n/a",
    length: setting?.omniRouteKey ? readSecret(setting.omniRouteKey).length : 0,
  });
  console.log("DeepSeek Key:", {
    present: Boolean(setting?.deepseekKey),
    prefix: setting?.deepseekKey ? readSecret(setting.deepseekKey).slice(0, 10) : "n/a",
    length: setting?.deepseekKey ? readSecret(setting.deepseekKey).length : 0,
  });
  await prisma.$disconnect();
}

main().catch(console.error);
