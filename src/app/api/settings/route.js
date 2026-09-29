import { NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { writeSecret, isEncrypted } from "@/core/security/crypto";
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
    }
    catch (e) {
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
        // FASE 4: a UI nunca recebe o segredo em claro; apenas máscara estável.
        const mask = (v) => {
            if (!v)
                return "";
            const plain = isEncrypted(v) ? "" : v; // cifrado: sem tail visível
            const shown = plain.length >= 4 ? plain.slice(-4) : "";
            return `••••${shown}`;
        };
        return NextResponse.json({
            geminiKey: mask(setting.geminiKey),
            claudeKey: mask(setting.claudeKey),
            openaiKey: mask(setting.openaiKey),
            deepseekKey: mask(setting.deepseekKey),
            omniRouteKey: mask(setting.omniRouteKey),
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
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao buscar configurações BYOK", details: String(error) }, { status: 500 });
    }
}
export async function POST(request) {
    const guard = requireAuth(request);
    if (guard.response)
        return guard.response;
    try {
        await ensureSettingTable();
        const body = await request.json();
        const { geminiKey, claudeKey, openaiKey, deepseekKey, omniRouteKey, omniRouteUrl, customEndpoint, activeProvider, } = body;
        let existing = null;
        try {
            existing = await prisma.setting.findFirst({
                where: { id: "default" },
            });
        }
        catch {
            existing = null;
        }
        const newGeminiKey = geminiKey !== undefined && !String(geminiKey).startsWith("••••")
            ? writeSecret(String(geminiKey).trim())
            : existing?.geminiKey || null; // mantém valor já armazenado (cifrado ou legado)
        const newClaudeKey = claudeKey !== undefined && !String(claudeKey).startsWith("••••")
            ? writeSecret(String(claudeKey).trim())
            : existing?.claudeKey || null; // mantém valor já armazenado (cifrado ou legado)
        const newOpenaiKey = openaiKey !== undefined && !String(openaiKey).startsWith("••••")
            ? writeSecret(String(openaiKey).trim())
            : existing?.openaiKey || null; // mantém valor já armazenado (cifrado ou legado)
        const newDeepseekKey = deepseekKey !== undefined && !String(deepseekKey).startsWith("••••")
            ? writeSecret(String(deepseekKey).trim())
            : existing?.deepseekKey || null; // mantém valor já armazenado (cifrado ou legado)
        const newOmniRouteKey = omniRouteKey !== undefined && !String(omniRouteKey).startsWith("••••")
            ? writeSecret(String(omniRouteKey).trim())
            : existing?.omniRouteKey || null; // mantém valor já armazenado (cifrado ou legado)
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
        console.log("[SETTINGS] Configurações salvas (chaves cifradas):", Boolean(updated.geminiKey));
        console.log("[SETTINGS] Estado final SQLite - Gemini:", Boolean(updated.geminiKey), "| Claude:", Boolean(updated.claudeKey));
        return NextResponse.json({
            success: true,
            message: "Configurações BYOK salvas com sucesso no SQLite!",
            setting: {
                geminiKey: updated.geminiKey ? "••••" : "",
                claudeKey: updated.claudeKey ? "••••" : "",
                openaiKey: updated.openaiKey ? "••••" : "",
                deepseekKey: updated.deepseekKey ? "••••" : "",
                omniRouteKey: updated.omniRouteKey ? "••••" : "",
                customEndpoint: updated.customEndpoint,
            },
            updatedAt: updated.updatedAt,
        });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao salvar configurações BYOK", details: String(error) }, { status: 500 });
    }
}
