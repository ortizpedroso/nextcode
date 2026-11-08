import { beforeAll } from "vitest";
import path from "path";

// Banco de teste ISOLADO (nunca toca no dev.db real do usuário).
// Prisma resolve caminhos relativos `file:` em relação ao diretório do
// schema.prisma, então usamos caminho absoluto para evitar ambiguidade.
const TEST_DB = path.resolve(__dirname, "prisma", "test.db");

// Specs de teste anteriores à conferência bloqueante. Os testes da conferência
// substituem loadOrchestrationPolicy; o teste do YAML apaga esta variável.
process.env.NEXTCODE_CONFERENCIA_ENTRADA ??= "desligado";

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${TEST_DB}`;
  if (!process.env.NEXTCODE_AUTH_TOKEN) {
    process.env.NEXTCODE_AUTH_TOKEN = "test-token-secret-123";
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "customGatewayKey" TEXT;`).catch(() => {});
    await prisma
      .$executeRawUnsafe(
        `UPDATE "Setting" SET "customGatewayKey" = "omniRouteKey" WHERE ("customGatewayKey" IS NULL OR "customGatewayKey" = '') AND "omniRouteKey" IS NOT NULL AND "omniRouteKey" != '';`
      )
      .catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});
