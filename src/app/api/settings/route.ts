import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function ensureSettingTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Setting" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
        "geminiKey" TEXT,
        "claudeKey" TEXT,
        "openaiKey" TEXT,
        "deepseekKey" TEXT,
        "omniRouteKey" TEXT,
        "omniRouteUrl" TEXT DEFAULT 'http://localhost:20128/v1',
        "customEndpoint" TEXT DEFAULT 'http://localhost:20128/v1',
        "activeProvider" TEXT NOT NULL DEFAULT 'auto',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.warn("[SETTINGS] Bootstrap de tabela Setting:", e);
  }
}

export async function GET() {
  try {
    await ensureSettingTable();

    let setting = await prisma.setting.findFirst({
      where: { id: "default" },
    });

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

    return NextResponse.json({
      geminiKey: setting.geminiKey || "",
      claudeKey: setting.claudeKey || "",
      openaiKey: setting.openaiKey || "",
      deepseekKey: setting.deepseekKey || "",
      omniRouteKey: setting.omniRouteKey || "",
      omniRouteUrl: setting.omniRouteUrl || "http://localhost:20128/v1",
      customEndpoint: setting.customEndpoint || "http://localhost:20128/v1",
      activeProvider: setting.activeProvider || "auto",
      hasGeminiKey: Boolean(setting.geminiKey),
      hasClaudeKey: Boolean(setting.claudeKey),
      hasOpenaiKey: Boolean(setting.openaiKey),
      hasDeepseekKey: Boolean(setting.deepseekKey),
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

export async function POST(request: Request) {
  try {
    await ensureSettingTable();

    const body = await request.json();
    const {
      geminiKey,
      claudeKey,
      openaiKey,
      deepseekKey,
      omniRouteKey,
      omniRouteUrl,
      customEndpoint,
      activeProvider,
    } = body;

    let existing = null;
    try {
      existing = await prisma.setting.findFirst({
        where: { id: "default" },
      });
    } catch {
      existing = null;
    }

    const newGeminiKey =
      geminiKey !== undefined && !geminiKey.startsWith("••••")
        ? geminiKey.trim() || null
        : existing?.geminiKey || null;

    const newClaudeKey =
      claudeKey !== undefined && !claudeKey.startsWith("••••")
        ? claudeKey.trim() || null
        : existing?.claudeKey || null;

    const newOpenaiKey =
      openaiKey !== undefined && !openaiKey.startsWith("••••")
        ? openaiKey.trim() || null
        : existing?.openaiKey || null;

    const newDeepseekKey =
      deepseekKey !== undefined && !deepseekKey.startsWith("••••")
        ? deepseekKey.trim() || null
        : existing?.deepseekKey || null;

    const newOmniRouteKey =
      omniRouteKey !== undefined && !omniRouteKey.startsWith("••••")
        ? omniRouteKey.trim() || null
        : existing?.omniRouteKey || null;

    const newEndpoint = customEndpoint || omniRouteUrl || existing?.customEndpoint || "http://localhost:20128/v1";

    const updated = await prisma.setting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        geminiKey: newGeminiKey,
        claudeKey: newClaudeKey,
        openaiKey: newOpenaiKey,
        deepseekKey: newDeepseekKey,
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
        omniRouteKey: newOmniRouteKey,
        omniRouteUrl: newEndpoint,
        customEndpoint: newEndpoint,
        activeProvider: activeProvider || "auto",
      },
    });

    console.log("[SETTINGS] Chave salva com sucesso:", Boolean(updated.geminiKey));
    console.log("[SETTINGS] Estado final SQLite - Gemini:", Boolean(updated.geminiKey), "| Claude:", Boolean(updated.claudeKey));

    return NextResponse.json({
      success: true,
      message: "Configurações BYOK salvas com sucesso no SQLite!",
      setting: {
        geminiKey: updated.geminiKey || "",
        claudeKey: updated.claudeKey || "",
        openaiKey: updated.openaiKey || "",
        deepseekKey: updated.deepseekKey || "",
        omniRouteKey: updated.omniRouteKey || "",
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
