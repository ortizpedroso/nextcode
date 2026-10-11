import { PrismaClient } from "@prisma/client";
import { readSecret } from "../src/core/security/crypto.js";

const prisma = new PrismaClient();

async function main() {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  console.log("Setting:", {
    id: setting?.id,
    omniRouteUrl: setting?.omniRouteUrl,
    hasOmniKey: Boolean(setting?.omniRouteKey),
    hasDeepseekKey: Boolean(setting?.deepseekKey),
    hasAnthropicKey: Boolean(setting?.anthropicKey),
  });

  const gateways = await prisma.llmGateway.findMany();
  console.log("Gateways no banco:");
  for (const g of gateways) {
    console.log({
      id: g.id,
      enabled: g.enabled,
      priority: g.priority,
      baseUrl: g.baseUrl,
      hasKey: Boolean(g.apiKey),
      keyLen: g.apiKey ? readSecret(g.apiKey).length : 0,
      modelFast: g.modelFast,
      modelHeavy: g.modelHeavy,
    });
  }

  // Consulta lista de modelos do OmniRoute
  try {
    const omniRes = await fetch("http://localhost:20128/v1/models");
    const omniJson = await omniRes.json();
    console.log("\nModelos disponíveis no OmniRoute (total:", omniJson?.data?.length || 0, "):");
    const claudeModels = (omniJson?.data || []).filter(m => m.id.toLowerCase().includes("claude") || m.id.toLowerCase().includes("anthropic"));
    console.log("Modelos Claude no OmniRoute:", claudeModels.map(m => m.id));
  } catch (err) {
    console.log("Erro ao buscar modelos do OmniRoute:", err.message);
  }

  await prisma.$disconnect();
}

main();
