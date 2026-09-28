import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  return handleCheck();
}

export async function POST() {
  return handleCheck();
}

async function handleCheck() {
  let apiKey: string | undefined;
  let isPrimaryRoute = false;

  // 1. Busca configurações com tratamento seguro contra falhas de schema/banco
  try {
    const setting = await prisma.setting.findFirst({ where: { id: "default" } });
    if (setting) {
      apiKey = setting.omniRouteKey || undefined;
      isPrimaryRoute = setting.activeProvider === "omniroute";
    }
  } catch (err: any) {
    console.warn("[HEALTH] Aviso: tabela Setting inacessível no momento, prosseguindo com checagem de porta:", err.message);
  }

  // 2. URLs candidatas para cobrir ambiente Docker e ambiente Host
  const candidateUrls = [
    process.env.OMNIROUTE_URL,
    "http://omniroute:20128/v1",
    "http://localhost:20128/v1",
  ].filter(Boolean) as string[];

  const startTime = Date.now();
  let isConnected = false;
  let activeEndpoint = "http://localhost:20128/v1";

  // 3. Checagem em cascata na porta 20128
  for (const baseUrl of candidateUrls) {
    const cleanUrl = baseUrl.replace(/\/$/, "");
    const targetUrl = cleanUrl.endsWith("/v1") ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;

    try {
      const res = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(2000),
      });

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

  const latencyMs = Date.now() - startTime;

  return NextResponse.json({
    success: isConnected,
    status: isConnected ? "connected" : "stopped",
    latencyMs: isConnected ? latencyMs : null,
    endpoint: activeEndpoint,
    isPrimaryRoute,
    message: isConnected
      ? `OmniRoute Local operacional na porta 20128 (${latencyMs}ms)!`
      : "Status: Offline (Nenhum serviço detectado na porta 20128). O NextCode está usando o Gemini direto como rota ativa.",
  });
}
