import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import {
  writeSecret,
  readSecret,
  isEncrypted,
  isSecretEncryptionEnabled,
  MasterKeyMissingError,
} from "@/core/security/crypto";

function legacyGatewayKey(row: Record<string, unknown>): string | null {
  const custom = row.customGatewayKey;
  if (typeof custom === "string" && custom) return custom;
  const legacy = row.omniRouteKey;
  if (typeof legacy === "string" && legacy) return legacy;
  return null;
}

async function ensureSettingTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Setting" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
        "geminiKey" TEXT,
        "claudeKey" TEXT,
        "openaiKey" TEXT,
        "deepseekKey" TEXT,
        "groqKey" TEXT,
        "nvidiaKey" TEXT,
        "customGatewayKey" TEXT,
        "typesafeKey" TEXT,
        "customEndpoint" TEXT,
        "activeProvider" TEXT NOT NULL DEFAULT 'auto',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const tableInfo = await prisma.$queryRawUnsafe<any[]>(`PRAGMA table_info("Setting")`).catch(() => []);
    const existingCols = new Set((tableInfo || []).map((c: any) => c.name));

    if (!existingCols.has("groqKey")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "groqKey" TEXT;`).catch(() => {});
    }
    if (!existingCols.has("nvidiaKey")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "nvidiaKey" TEXT;`).catch(() => {});
    }
    if (!existingCols.has("typesafeKey")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "typesafeKey" TEXT;`).catch(() => {});
    }
    if (!existingCols.has("customGatewayKey")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "customGatewayKey" TEXT;`).catch(() => {});
    }
    if (existingCols.has("omniRouteKey")) {
      await prisma
        .$executeRawUnsafe(
          `UPDATE "Setting" SET "customGatewayKey" = "omniRouteKey" WHERE ("customGatewayKey" IS NULL OR "customGatewayKey" = '') AND "omniRouteKey" IS NOT NULL AND "omniRouteKey" != '';`
        )
        .catch(() => {});
    }
    if (!existingCols.has("customEndpoint") && existingCols.has("omniRouteUrl")) {
      await prisma
        .$executeRawUnsafe(
          `UPDATE "Setting" SET "customEndpoint" = "omniRouteUrl" WHERE ("customEndpoint" IS NULL OR "customEndpoint" = '') AND "omniRouteUrl" IS NOT NULL AND "omniRouteUrl" != '';`
        )
        .catch(() => {});
    }
  } catch (e) {
    console.warn("[SETTINGS] Bootstrap de tabela Setting:", e);
  }
}

export async function GET(request: Request) {
  const readGuard = requireReadAuth(request);
  if (readGuard.response) return readGuard.response;
  try {
    await ensureSettingTable();

    let setting: any = null;
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "Setting" WHERE "id" = 'default' LIMIT 1`);
      if (rows && rows.length > 0) setting = rows[0];
    } catch {
      setting = null;
    }

    if (!setting) {
      setting = await prisma.setting.findFirst({
        where: { id: "default" },
      });
    }

    if (!setting) {
      setting = await prisma.setting.create({
        data: {
          id: "default",
          activeProvider: "auto",
        },
      });
    }

    const gatewayKeyEnc = legacyGatewayKey(setting);

    const mask = (v?: string | null) => {
      if (!v) return "";
      const plain = readSecret(v);
      if (!plain) return "";
      const shown = plain.length >= 4 ? plain.slice(-4) : "";
      return `••••${shown}`;
    };
    return NextResponse.json({
      geminiKey: mask(setting.geminiKey),
      claudeKey: mask(setting.claudeKey),
      openaiKey: mask(setting.openaiKey),
      deepseekKey: mask(setting.deepseekKey),
      groqKey: mask(setting.groqKey),
      nvidiaKey: mask(setting.nvidiaKey),
      customGatewayKey: mask(gatewayKeyEnc),
      typesafeKey: mask(setting.typesafeKey),
      customEndpoint: setting.customEndpoint || "",
      activeProvider: setting.activeProvider || "auto",
      hasGeminiKey: Boolean(setting.geminiKey),
      hasClaudeKey: Boolean(setting.claudeKey),
      hasOpenaiKey: Boolean(setting.openaiKey),
      hasDeepseekKey: Boolean(setting.deepseekKey),
      hasGroqKey: Boolean(setting.groqKey),
      hasNvidiaKey: Boolean(setting.nvidiaKey),
      hasCustomGatewayKey: Boolean(gatewayKeyEnc),
      hasTypesafeKey: Boolean(setting.typesafeKey),
      secretsEncryptionEnabled: isSecretEncryptionEnabled(),
      updatedAt: setting.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao buscar configurações BYOK", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    await ensureSettingTable();

    const body = await request.json();
    const {
      geminiKey,
      claudeKey,
      openaiKey,
      deepseekKey,
      groqKey,
      nvidiaKey,
      customGatewayKey,
      typesafeKey,
      customEndpoint,
      activeProvider,
    } = body;

    let existing: any = null;
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "Setting" WHERE "id" = 'default' LIMIT 1`);
      if (rows && rows.length > 0) existing = rows[0];
    } catch {
      existing = null;
    }

    const processKeyUpdate = (val: any, existingVal?: string | null) => {
      if (val === undefined || val === null) return existingVal || null;
      const str = String(val).trim();
      if (str === "__REMOVE__" || str === "REMOVE") return null;
      if (!str) return existingVal || null;
      if (str.startsWith("••••") || str.startsWith("****")) return existingVal || null;
      return writeSecret(str);
    };

    const existingGatewayKey = legacyGatewayKey(existing ?? {});

    const newGeminiKey = processKeyUpdate(geminiKey, existing?.geminiKey);
    const newClaudeKey = processKeyUpdate(claudeKey, existing?.claudeKey);
    const newOpenaiKey = processKeyUpdate(openaiKey, existing?.openaiKey);
    const newDeepseekKey = processKeyUpdate(deepseekKey, existing?.deepseekKey);
    const newGroqKey = processKeyUpdate(groqKey, existing?.groqKey);
    const newNvidiaKey = processKeyUpdate(nvidiaKey, existing?.nvidiaKey);
    const newTypesafeKey = processKeyUpdate(typesafeKey, existing?.typesafeKey);
    const newCustomGatewayKey = processKeyUpdate(customGatewayKey, existingGatewayKey);

    const newEndpoint =
      customEndpoint !== undefined && customEndpoint !== null
        ? String(customEndpoint).trim() || null
        : existing?.customEndpoint || null;

    let updated: any = null;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Setting" ("id", "geminiKey", "claudeKey", "openaiKey", "deepseekKey", "groqKey", "nvidiaKey", "customGatewayKey", "typesafeKey", "customEndpoint", "activeProvider", "updatedAt")
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT("id") DO UPDATE SET
           "geminiKey" = excluded."geminiKey",
           "claudeKey" = excluded."claudeKey",
           "openaiKey" = excluded."openaiKey",
           "deepseekKey" = excluded."deepseekKey",
           "groqKey" = excluded."groqKey",
           "nvidiaKey" = excluded."nvidiaKey",
           "customGatewayKey" = excluded."customGatewayKey",
           "typesafeKey" = excluded."typesafeKey",
           "customEndpoint" = excluded."customEndpoint",
           "activeProvider" = excluded."activeProvider",
           "updatedAt" = CURRENT_TIMESTAMP;`,
        newGeminiKey,
        newClaudeKey,
        newOpenaiKey,
        newDeepseekKey,
        newGroqKey,
        newNvidiaKey,
        newCustomGatewayKey,
        newTypesafeKey,
        newEndpoint,
        activeProvider || "auto"
      );
      updated = {
        geminiKey: newGeminiKey,
        claudeKey: newClaudeKey,
        openaiKey: newOpenaiKey,
        deepseekKey: newDeepseekKey,
        groqKey: newGroqKey,
        nvidiaKey: newNvidiaKey,
        customGatewayKey: newCustomGatewayKey,
        typesafeKey: newTypesafeKey,
        customEndpoint: newEndpoint,
      };
    } catch (sqlErr) {
      console.warn("[SETTINGS] Direct SQL upsert fallback:", sqlErr);
      updated = await prisma.setting.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          geminiKey: newGeminiKey,
          claudeKey: newClaudeKey,
          openaiKey: newOpenaiKey,
          deepseekKey: newDeepseekKey,
          groqKey: newGroqKey,
          nvidiaKey: newNvidiaKey,
          customGatewayKey: newCustomGatewayKey,
          typesafeKey: newTypesafeKey,
          customEndpoint: newEndpoint,
          activeProvider: activeProvider || "auto",
        },
        update: {
          geminiKey: newGeminiKey,
          claudeKey: newClaudeKey,
          openaiKey: newOpenaiKey,
          deepseekKey: newDeepseekKey,
          groqKey: newGroqKey,
          nvidiaKey: newNvidiaKey,
          customGatewayKey: newCustomGatewayKey,
          typesafeKey: newTypesafeKey,
          customEndpoint: newEndpoint,
          activeProvider: activeProvider || "auto",
        },
      });
    }

    console.log(
      "[SETTINGS] Configurações salvas (chaves cifradas): Gemini=",
      Boolean(updated.geminiKey),
      "| Groq=",
      Boolean(updated.groqKey),
      "| NVIDIA=",
      Boolean(updated.nvidiaKey)
    );

    return NextResponse.json({
      success: true,
      message: "Configurações BYOK salvas com sucesso no SQLite!",
      setting: {
        geminiKey: updated.geminiKey ? "••••" : "",
        claudeKey: updated.claudeKey ? "••••" : "",
        openaiKey: updated.openaiKey ? "••••" : "",
        deepseekKey: updated.deepseekKey ? "••••" : "",
        groqKey: (updated as any).groqKey ? "••••" : "",
        nvidiaKey: (updated as any).nvidiaKey ? "••••" : "",
        customGatewayKey: updated.customGatewayKey ? "••••" : "",
        typesafeKey: (updated as any).typesafeKey ? "••••" : "",
        customEndpoint: updated.customEndpoint ?? "",
      },
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    if (error instanceof MasterKeyMissingError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Falha ao salvar configurações BYOK", details: String(error) },
      { status: 500 }
    );
  }
}
