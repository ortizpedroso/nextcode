import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import { readSecret } from "@/core/security/crypto";
import prisma from "@/lib/prisma";

export async function GET() {
  return handleCheck();
}

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  return handleCheck();
}

async function handleCheck() {
  let apiKey: string | undefined;
  let isPrimaryRoute = false;

  // 1. Busca configurações com tratamento seguro contra falhas de schema/banco
  try {
    const setting = await prisma.setting.findFirst({ where: { id: "default" } });
    if (setting) {
      apiKey = readSecret(setting.omniRouteKey) || undefined;
      isPrimaryRoute = setting.activeProvider === "omniroute";
    }
  } catch (err: any) {
    console.warn("[HEALTH] Aviso: tabela Setting inacessível no momento, prosseguindo com checagem de porta:", err.message);
  }

  // 2. URLs candidatas para cobrir ambiente Docker e ambiente Host
  // FIX: antes era injetado "http://omniroute:20128/v1" sempre que OMNIROUTE_URL não
  // continha a palavra "omniroute" — em máquina local (fora da rede do compose) esse
  // hostname não resolve (ENOTFOUND) e o health check gastava tempo/falava mesmo com
  // gateway local vivo. Agora só testamos: URL do ambiente > URL salva no SQLite > localhost.
  const envUrl = (process.env.OMNIROUTE_URL || "").trim();
  let dbUrl = "";
  try {
    const s2 = await prisma.setting.findUnique({ where: { id: "default" } });
    dbUrl = (s2?.omniRouteUrl || s2?.customEndpoint || "").trim();
  } catch {
    /* banco indisponível; segue com env/localhost */
  }
  const candidateUrls = Array.from(
    new Set([envUrl, dbUrl, "http://localhost:20128/v1"].filter(Boolean))
  );

  const startTime = Date.now();
  let isConnected = false;
  let activeEndpoint = "http://localhost:20128/v1";
  let lastHttpStatus: number | null = null;

  // 3. Checagem em cascata na porta 20128
  for (const baseUrl of candidateUrls) {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    const root = cleanUrl.replace(/\/v1$/i, "");
    // Tenta os caminhos conhecidos do OmniRoute: /v1/models (OpenAI-compat) e /api/health
    const targets = [
      `${cleanUrl.endsWith("/v1") ? cleanUrl : `${cleanUrl}/v1`}/models`,
      `${root}/api/health`,
    ];

    for (const targetUrl of targets) {
      try {
        const res = await safeFetch(targetUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          timeoutMs: 2500,
        });

        lastHttpStatus = res.status;

        // 200 OK ou 401 Unauthorized confirmam que o serviço está ativo e respondendo na porta 20128
        if (res.ok || res.status === 401) {
          isConnected = true;
          activeEndpoint = cleanUrl;
          break;
        }
      } catch {
        // Falha de rota ou timeout, tenta o próximo candidato
      }
    }
    if (isConnected) break;
  }

  const latencyMs = Date.now() - startTime;

  return NextResponse.json({
    success: isConnected,
    status: isConnected ? "connected" : "stopped",
    latencyMs: isConnected ? latencyMs : null,
    endpoint: activeEndpoint,
    isPrimaryRoute,
    httpStatus: lastHttpStatus,
    message: isConnected
      ? `OmniRoute Local operacional (${latencyMs}ms)!`
      : "Status: Offline (Nenhum serviço detectado na porta 20128). Suba o gateway com 'docker compose up -d omniroute' ou desative a rota primária. O NextCode usará o Gemini direto como fallback.",
  });
}
