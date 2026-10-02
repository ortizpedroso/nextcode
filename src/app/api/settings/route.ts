import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { writeSecret, readSecret, isEncrypted } from "@/core/security/crypto";

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
        "omniRouteKey" TEXT,
        "omniRouteUrl" TEXT DEFAULT 'http://localhost:20128/v1',
        "customEndpoint" TEXT DEFAULT 'http://localhost:20128/v1',
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
  } catch (e) {
    console.warn("[SETTINGS] Bootstrap de tabela Setting:", e);
  }
}

export async function GET() {
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
          omniRouteUrl: "http://localhost:20128/v1",
          customEndpoint: "http://localhost:20128/v1",
          activeProvider: "auto",
        },
      });
    }

    // FASE 4: a UI nunca recebe o segredo em claro; apenas máscara estável.
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
      omniRouteKey: mask(setting.omniRouteKey),
      omniRouteUrl: setting.omniRouteUrl || "http://localhost:20128/v1",
      customEndpoint: setting.customEndpoint || "http://localhost:20128/v1",
      activeProvider: setting.activeProvider || "auto",
      hasGeminiKey: Boolean(setting.geminiKey),
      hasClaudeKey: Boolean(setting.claudeKey),
      hasOpenaiKey: Boolean(setting.openaiKey),
      hasDeepseekKey: Boolean(setting.deepseekKey),
      hasGroqKey: Boolean(setting.groqKey),
      hasNvidiaKey: Boolean(setting.nvidiaKey),
      hasOmniRouteKey: Boolean(setting.omniRouteKey),
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
      omniRouteKey,
      omniRouteUrl,
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

    const newGeminiKey = processKeyUpdate(geminiKey, existing?.geminiKey);
    const newClaudeKey = processKeyUpdate(claudeKey, existing?.claudeKey);
    const newOpenaiKey = processKeyUpdate(openaiKey, existing?.openaiKey);
    const newDeepseekKey = processKeyUpdate(deepseekKey, existing?.deepseekKey);
    const newGroqKey = processKeyUpdate(groqKey, existing?.groqKey);
    const newNvidiaKey = processKeyUpdate(nvidiaKey, existing?.nvidiaKey);
    const newOmniRouteKey = processKeyUpdate(omniRouteKey, existing?.omniRouteKey);

    const newEndpoint = customEndpoint || omniRouteUrl || existing?.customEndpoint || "http://localhost:20128/v1";

    let updated: any = null;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Setting" ("id", "geminiKey", "claudeKey", "openaiKey", "deepseekKey", "groqKey", "nvidiaKey", "omniRouteKey", "omniRouteUrl", "customEndpoint", "activeProvider", "updatedAt")
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT("id") DO UPDATE SET
           "geminiKey" = excluded."geminiKey",
           "claudeKey" = excluded."claudeKey",
           "openaiKey" = excluded."openaiKey",
           "deepseekKey" = excluded."deepseekKey",
           "groqKey" = excluded."groqKey",
           "nvidiaKey" = excluded."nvidiaKey",
           "omniRouteKey" = excluded."omniRouteKey",
           "omniRouteUrl" = excluded."omniRouteUrl",
           "customEndpoint" = excluded."customEndpoint",
           "activeProvider" = excluded."activeProvider",
           "updatedAt" = CURRENT_TIMESTAMP;`,
        newGeminiKey,
        newClaudeKey,
        newOpenaiKey,
        newDeepseekKey,
        newGroqKey,
        newNvidiaKey,
        newOmniRouteKey,
        newEndpoint,
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
        omniRouteKey: newOmniRouteKey,
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
          omniRouteKey: newOmniRouteKey,
          omniRouteUrl: newEndpoint,
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
          omniRouteKey: newOmniRouteKey,
          omniRouteUrl: newEndpoint,
          customEndpoint: newEndpoint,
          activeProvider: activeProvider || "auto",
        },
      });
    }

    console.log("[SETTINGS] Configurações salvas (chaves cifradas): Gemini=", Boolean(updated.geminiKey), "| Groq=", Boolean(updated.groqKey), "| NVIDIA=", Boolean(updated.nvidiaKey));

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
        omniRouteKey: updated.omniRouteKey ? "••••" : "",
        customEndpoint: updated.customEndpoint,
      },
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao salvar configurações BYOK", details: String(error) },
      { status: 500 }
    );
  }
}
