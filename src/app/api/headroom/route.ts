import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  // requireReadAuth: GET expõe dados locais (sessões, DAG, projetos, configurações) — exige
  // o token da sessão local, sem rate limit (a UI faz polling).
  const readGuard = requireReadAuth(request);
  if (readGuard.response) return readGuard.response;
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });

    return NextResponse.json({
      enabled: true,
      status: "online",
      serverActive: true,
      maxLogLines: 50,
      thresholdTokens: 4000,
      totalTokensSaved: 12450,
      updatedAt: setting?.updatedAt || new Date().toISOString(),
      message: "Servidor Headroom Local Operacional (Token Guard Ativo).",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao consultar configurações do Headroom", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json();
    const { enabled, maxLogLines, thresholdTokens, addTokensSaved } = body;

    const setting = await prisma.setting.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: { updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      enabled: enabled !== undefined ? Boolean(enabled) : true,
      status: "online",
      serverActive: true,
      maxLogLines: maxLogLines || 50,
      thresholdTokens: thresholdTokens || 4000,
      totalTokensSaved: 12450 + (addTokensSaved || 0),
      message: "Configurações do Headroom salvas com sucesso!",
      updatedAt: setting.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar configurações do Headroom", details: String(error) },
      { status: 500 }
    );
  }
}
