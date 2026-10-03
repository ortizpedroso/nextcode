import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/core/security/safe-fetch";
import { resolveOmniRouteUrl } from "@/core/router/smart-router";
import { requireAuth } from "@/core/security/local-auth";
import { readSecret } from "@/core/security/crypto";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
    const omniUrl = resolveOmniRouteUrl(setting?.omniRouteUrl || process.env.OMNIROUTE_URL);
    // Remove /chat/completions se presente para obter a base URL do gateway (ex: http://localhost:20128/v1)
    const baseUrl = omniUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
    const modelsEndpoint = `${baseUrl}/models`;

    // FIX: o OmniRoute exige API key em /v1/models — sem Authorization este fetch
    // sempre recebia 401 e caía no fallback estático de 8 modelos, mesmo com o
    // gateway saudável e autenticado (o seletor de modelo nunca refletia a lista real).
    const apiKey = readSecret(setting?.omniRouteKey) || process.env.OMNIROUTE_KEY || undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await safeFetch(modelsEndpoint, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });

      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        // Standard OpenAI / OpenRouter format: { data: [ { id: "auto", name: "..." }, ... ] }
        const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        const models = rawList.map((m: { id: string; name?: string; owned_by?: string }) => ({
          id: m.id,
          name: m.name || m.id,
          provider: m.owned_by || "omniroute",
        }));

        return NextResponse.json({
          status: "connected",
          endpoint: modelsEndpoint,
          total: models.length,
          models: models.length > 0 ? models : getDefaultOmniModels(),
        });
      }
    } catch {
      clearTimeout(timer);
    }

    // Fallback caso o gateway local esteja offline ou sem endpoint /models
    return NextResponse.json({
      status: "fallback",
      endpoint: modelsEndpoint,
      total: getDefaultOmniModels().length,
      models: getDefaultOmniModels(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "Falha ao consultar modelos do OmniRoute", details: String(error) },
      { status: 500 }
    );
  }
}

function getDefaultOmniModels() {
  return [
    { id: "auto", name: "Auto (Seleção Inteligente de 350+ Provedores)", provider: "omniroute" },
    { id: "auto/best-free", name: "Auto Best Free (Provedor Gratuito Mais Rápido)", provider: "omniroute" },
    { id: "auto/coding", name: "Auto Coding (Especialista em Programação)", provider: "omniroute" },
    { id: "auto/fast", name: "Auto Fast (Baixa Latência)", provider: "omniroute" },
    { id: "openrouter/auto", name: "OpenRouter Auto Multi-Provider", provider: "openrouter" },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct", provider: "meta" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1 Reasoning", provider: "deepseek" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic" },
  ];
}
