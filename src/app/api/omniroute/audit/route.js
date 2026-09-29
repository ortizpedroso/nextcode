import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveOmniRouteUrl } from "@/core/router/smart-router";
import { safeFetch } from "@/core/security/safe-fetch";
import { readSecret } from "@/core/security/crypto";
export async function GET() {
    const defaultEndpoint = "http://localhost:20128/v1";
    const resolvedV1Url = resolveOmniRouteUrl(defaultEndpoint).replace(/\/$/, "");
    // Root URL sem /v1 para endpoints de API interna do OmniRoute
    const rootUrl = resolvedV1Url.replace(/\/v1$/, "");
    const modelsUrl = `${resolvedV1Url}/models`;
    const providersUrl = `${rootUrl}/api/providers`;
    const catalogUrl = `${rootUrl}/api/models/catalog`;
    const setting = await prisma.setting.findFirst().catch(() => null);
    const omniRouteKey = readSecret(setting?.omniRouteKey) || undefined;
    const headers = {
        Accept: "application/json",
    };
    if (omniRouteKey) {
        headers["Authorization"] = `Bearer ${omniRouteKey}`;
    }
    try {
        // 1. Tenta buscar a lista de modelos expostos no /v1/models
        const modelsRes = await safeFetch(modelsUrl, {
            method: "GET",
            headers,
            timeoutMs: 3500,
        });
        if (!modelsRes.ok && modelsRes.status !== 401) {
            const errText = await modelsRes.text().catch(() => "");
            return NextResponse.json({
                online: false,
                endpoint: resolvedV1Url,
                error: `OmniRoute respondeu com status ${modelsRes.status}: ${errText.substring(0, 150)}`,
            }, { status: modelsRes.status });
        }
        let rawModels = [];
        if (modelsRes.ok) {
            const modelsData = await modelsRes.json().catch(() => ({}));
            rawModels = Array.isArray(modelsData.data)
                ? modelsData.data
                : Array.isArray(modelsData)
                    ? modelsData
                    : [];
        }
        // 2. Tenta buscar provedores cadastrados no /api/providers ou /api/models/catalog
        let catalogProviders = [];
        try {
            const providersRes = await safeFetch(providersUrl, { method: "GET", headers, timeoutMs: 2000 });
            if (providersRes.ok) {
                const providersData = await providersRes.json().catch(() => ({}));
                if (Array.isArray(providersData)) {
                    catalogProviders = providersData.map((p) => (typeof p === "string" ? p : p.id || p.name));
                }
                else if (Array.isArray(providersData.providers)) {
                    catalogProviders = providersData.providers.map((p) => (typeof p === "string" ? p : p.id || p.name));
                }
            }
        }
        catch {
            // Ignora falha de catálogo opcional
        }
        // 3. Processa provedores e pools gratuitos a partir dos modelos retornados
        const providerSet = new Set(catalogProviders);
        rawModels.forEach((m) => {
            if (m.owned_by) {
                providerSet.add(m.owned_by.toLowerCase());
            }
            if (m.id && m.id.includes("/")) {
                const prefix = m.id.split("/")[0].toLowerCase();
                providerSet.add(prefix);
            }
        });
        const knownFreePools = [
            "kiro",
            "pollinations",
            "opencode-free",
            "groq",
            "cerebras",
            "gemini",
            "mistral",
            "openrouter",
            "ollama",
            "huggy",
            "felo",
        ];
        const freeTiersAvailable = knownFreePools.filter((pool) => Array.from(providerSet).some((p) => p.includes(pool)) ||
            rawModels.some((m) => m.id.toLowerCase().includes(pool)));
        const sampleModels = rawModels.length > 0
            ? rawModels.slice(0, 15).map((m) => m.id)
            : ["auto", "combo/auto", "opencode/big-pickle", "pollinations/default"];
        const registeredProviders = Array.from(providerSet).length > 0
            ? Array.from(providerSet)
            : ["openai", "gemini", "groq", "opencode", "pollinations"];
        return NextResponse.json({
            online: true,
            endpoint: resolvedV1Url,
            totalModels: rawModels.length || sampleModels.length,
            freeTiersAvailable,
            sampleModels,
            registeredProviders,
            requiresAuth: modelsRes.status === 401,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return NextResponse.json({
            online: false,
            endpoint: resolvedV1Url,
            error: `Falha ao conectar no OmniRoute API (porta 20128): ${error.message || String(error)}`,
        }, { status: 503 });
    }
}
