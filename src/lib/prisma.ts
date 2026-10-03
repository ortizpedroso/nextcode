import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

  // Trava T3 (WAL Audit Trail): o README/Spec prometem SQLite em modo WAL, mas o banco rodava
  // em journal_mode=delete. O modo WAL é persistido no próprio arquivo do banco, então basta
  // ativá-lo uma vez por processo. PRAGMA devolve linhas, por isso $queryRawUnsafe.
  if ((process.env.DATABASE_URL || "").startsWith("file:")) {
    client.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((err) => {
      console.error("[Prisma] Falha ao ativar SQLite WAL (Trava T3):", err);
    });
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
