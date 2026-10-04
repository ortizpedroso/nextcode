import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  auditTrailGuards: Promise<void> | undefined;
};

/**
 * Trava T3 (WAL Audit Trail): a trilha de auditoria (TelemetryLog) é append-only no próprio
 * banco. Os triggers recusam UPDATE e DELETE vindos de qualquer código da aplicação — antes a
 * imutabilidade era só uma convenção. O modo WAL (README/Spec) fica persistido no arquivo do
 * banco. `CREATE TRIGGER IF NOT EXISTS` é idempotente e recria os triggers se um `prisma db
 * push` tiver recriado a tabela.
 *
 * Memoizado por processo; se falhar (ex.: DATABASE_URL ainda não definida no import), a
 * próxima chamada tenta de novo.
 */
export function ensureAuditTrailGuards(client: PrismaClient = prisma): Promise<void> {
  if (!globalForPrisma.auditTrailGuards) {
    globalForPrisma.auditTrailGuards = (async () => {
      // PRAGMA devolve linhas, por isso $queryRawUnsafe.
      await client.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
      await client.$executeRawUnsafe(
        `CREATE TRIGGER IF NOT EXISTS "TelemetryLog_append_only_no_update" BEFORE UPDATE ON "TelemetryLog" ` +
          `BEGIN SELECT RAISE(ABORT, 'TelemetryLog e append-only (Trava T3): registros de auditoria nao podem ser alterados'); END;`
      );
      await client.$executeRawUnsafe(
        `CREATE TRIGGER IF NOT EXISTS "TelemetryLog_append_only_no_delete" BEFORE DELETE ON "TelemetryLog" ` +
          `BEGIN SELECT RAISE(ABORT, 'TelemetryLog e append-only (Trava T3): registros de auditoria nao podem ser apagados'); END;`
      );
    })().catch((err) => {
      globalForPrisma.auditTrailGuards = undefined;
      console.error("[Prisma] Falha ao ativar WAL/triggers append-only da trilha de auditoria (Trava T3):", err);
    });
  }
  return globalForPrisma.auditTrailGuards;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

if ((process.env.DATABASE_URL || "").startsWith("file:")) {
  void ensureAuditTrailGuards();
}

export default prisma;
