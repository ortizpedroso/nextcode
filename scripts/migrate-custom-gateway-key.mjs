import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "customGatewayKey" TEXT;`);
    console.log("Added customGatewayKey column");
  } catch {
    console.log("customGatewayKey column already exists or create skipped");
  }
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "Setting" SET "customGatewayKey" = "omniRouteKey" WHERE ("customGatewayKey" IS NULL OR "customGatewayKey" = '') AND "omniRouteKey" IS NOT NULL AND "omniRouteKey" != '';`
    );
    console.log("Migrated omniRouteKey -> customGatewayKey");
  } catch (e) {
    console.warn("Migration copy skipped:", e.message);
  }
}

main()
  .finally(() => prisma.$disconnect());
