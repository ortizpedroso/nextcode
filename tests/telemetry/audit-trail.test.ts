import { describe, it, expect, beforeAll } from "vitest";
import prisma, { ensureAuditTrailGuards } from "@/lib/prisma";

describe("Trava T3 — trilha de auditoria append-only (SQLite)", () => {
  beforeAll(async () => {
    await ensureAuditTrailGuards();
  });

  it("banco em modo WAL", async () => {
    const rows = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode;");
    expect(rows[0].journal_mode).toBe("wal");
  });

  it("aceita INSERT, mas recusa UPDATE e DELETE em TelemetryLog — inclusive em massa", async () => {
    const log = await prisma.telemetryLog.create({
      data: { action: "AUDIT_TRAIL_TEST", details: JSON.stringify({ marker: "original" }) },
    });

    // Pelo client tipado o Prisma traduz o RAISE(ABORT) do trigger como "Foreign key
    // constraint violated" (mensagem dele, não nossa) — o que importa é a operação ser abortada.
    await expect(
      prisma.telemetryLog.update({ where: { id: log.id }, data: { details: "adulterado" } })
    ).rejects.toThrow();
    await expect(prisma.telemetryLog.delete({ where: { id: log.id } })).rejects.toThrow();
    await expect(prisma.telemetryLog.deleteMany({})).rejects.toThrow();
    // Por SQL cru a mensagem do trigger chega intacta.
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "TelemetryLog" WHERE "id" = '${log.id}'`)
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "TelemetryLog" SET "details" = 'x' WHERE "id" = '${log.id}'`)
    ).rejects.toThrow(/append-only/);

    const intact = await prisma.telemetryLog.findUnique({ where: { id: log.id } });
    expect(intact?.details).toBe(JSON.stringify({ marker: "original" }));
  });
});
