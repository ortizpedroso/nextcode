import { NextRequest, NextResponse } from "next/server";
import { getQuotaStatus, clearQuotaCooldowns } from "@/core/router/quota-tracker";
import { requireAuth } from "@/core/security/local-auth";

export async function GET() {
  try {
    const status = getQuotaStatus();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      activeCooldowns: status,
      totalTracked: status.length,
    });
  } catch (error: unknown) {
    console.error("Erro ao consultar status de cotas:", error);
    return NextResponse.json(
      { error: "Falha interna ao obter status de cotas", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "clear_cooldowns") {
      clearQuotaCooldowns();
      return NextResponse.json({
        success: true,
        message: "Todos os cooldowns de cota de provedores foram zerados com sucesso!",
      });
    }

    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Erro ao resetar cooldowns de cota:", error);
    return NextResponse.json(
      { error: "Falha no reset de cooldowns de cota", details: String(error) },
      { status: 500 }
    );
  }
}
