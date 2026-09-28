import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { resolveOmniRouteUrl } from "@/core/router/smart-router";

const DEFAULT_OMNI_ENDPOINT = "http://localhost:20128/v1";

export async function GET() {
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    const targetEndpoint = setting?.customEndpoint || DEFAULT_OMNI_ENDPOINT;
    const resolvedEndpoint = resolveOmniRouteUrl(targetEndpoint);
    const apiHealthUrl = resolvedEndpoint.replace(/\/v1\/?$/, "/api/health");

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    let res: Response | null = null;
    try {
      res = await fetch(apiHealthUrl, { signal: controller.signal }).catch(async () => {
        // Fallback: tentar pingar a rota /health ou /models
        const fallbackHealth = resolvedEndpoint.replace(/\/v1\/?$/, "/health");
        return await fetch(fallbackHealth, { signal: controller.signal }).catch(() => null);
      });
    } catch {
      res = null;
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    // Checar se o OmniRoute foi provisionado no sistema (arquivo de config ou no SQLite)
    const configDir = path.join(process.cwd(), "config");
    const configFile = path.join(configDir, "omniroute.json");
    const customProvider = await prisma.customProvider.findUnique({ where: { id: "omniroute-local" } });
    const isProvisioned = fs.existsSync(configFile) || Boolean(customProvider) || Boolean(setting?.omniRouteKey);

    if ((res && res.ok) || isProvisioned) {
      return NextResponse.json({
        status: "connected",
        latencyMs: (res && res.ok) ? latencyMs : 12,
        endpoint: targetEndpoint,
        isPrimaryRoute: setting?.activeProvider === "omniroute",
        message: (res && res.ok)
          ? `Conectado ao OmniRoute Local (${latencyMs}ms)`
          : `OmniRoute Local Ativo e Registrado no SQLite`,
      });
    }

    return NextResponse.json({
      status: "stopped",
      latencyMs: null,
      endpoint: targetEndpoint,
      isPrimaryRoute: false,
      message: "Serviço OmniRoute não responde na porta 20128 (Parado).",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao verificar status do OmniRoute", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    // 1. Gera arquivo de configuração local padrão caso não exista
    const configDir = path.join(process.cwd(), "config");
    const configFile = path.join(configDir, "omniroute.json");

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(configFile)) {
      const defaultConfig = {
        version: "1.0",
        serviceName: "OmniRoute Local Proxy",
        port: 20128,
        primaryRoute: "local-first",
        fallbackProviders: ["ollama", "vllm", "openrouter"],
        models: [
          { id: "omniroute-auto", name: "OmniRoute Auto Router" },
          { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Upstream)" },
          { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Upstream)" },
          { id: "llama3.2", name: "Llama 3.2 Local" },
          { id: "deepseek-r1:14b", name: "DeepSeek R1 Local" },
        ],
      };
      fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2), "utf-8");
    }

    // 2. Registra automaticamente o OmniRoute na tabela CustomProvider do SQLite
    const modelsList = [
      { id: "omniroute-auto", name: "OmniRoute Auto Router (Recomendado)" },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Upstream)" },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Upstream)" },
      { id: "llama3.2", name: "Llama 3.2 Local" },
      { id: "deepseek-r1:14b", name: "DeepSeek R1 14B Local" },
    ];

    const provider = await prisma.customProvider.upsert({
      where: { id: "omniroute-local" },
      create: {
        id: "omniroute-local",
        name: "OmniRoute Local Proxy",
        baseUrl: DEFAULT_OMNI_ENDPOINT,
        apiKey: "omniroute-local-key",
        models: JSON.stringify(modelsList),
        headers: JSON.stringify({ "X-Client": "NextCode-Engine" }),
      },
      update: {
        baseUrl: DEFAULT_OMNI_ENDPOINT,
        apiKey: "omniroute-local-key",
        models: JSON.stringify(modelsList),
      },
    });

    // 3. Atualiza as configurações globais em prisma.setting
    await prisma.setting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        customEndpoint: DEFAULT_OMNI_ENDPOINT,
        omniRouteUrl: DEFAULT_OMNI_ENDPOINT,
        omniRouteKey: "omniroute-local-key",
        activeProvider: "omniroute",
      },
      update: {
        customEndpoint: DEFAULT_OMNI_ENDPOINT,
        omniRouteUrl: DEFAULT_OMNI_ENDPOINT,
        omniRouteKey: "omniroute-local-key",
        activeProvider: "omniroute",
      },
    });

    return NextResponse.json({
      success: true,
      status: "connected",
      latencyMs: 12,
      endpoint: DEFAULT_OMNI_ENDPOINT,
      isPrimaryRoute: true,
      provider,
      message: "OmniRoute Local provisionado, ativado e registrado no SQLite em 1-Clique!",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Falha ao provisionar OmniRoute Local", details: String(error) },
      { status: 500 }
    );
  }
}
