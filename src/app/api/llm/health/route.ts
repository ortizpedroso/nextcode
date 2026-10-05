import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { probeAllGateways, probeGateway, GATEWAY_IDS, type GatewayId } from "@/core/llm/gateways";

/**
 * Diagnóstico real dos gateways: ping → chave → uma conversa curta com o modelo configurado.
 * "Pronto" só quando a conversa responde; cada falha vem com a ação para resolver.
 * POST (não GET): cada diagnóstico gasta uma chamada de LLM.
 */
export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  const body = await request.json().catch(() => ({}));
  const id = body?.id as GatewayId | undefined;
  if (id && !GATEWAY_IDS.includes(id)) {
    return NextResponse.json({ error: `Gateway desconhecido: ${id}` }, { status: 400 });
  }

  const gateways = id ? [await probeGateway(id)] : await probeAllGateways();
  const ready = gateways.filter((g) => g.enabled && g.chatOk);
  return NextResponse.json({
    ready: ready.length > 0,
    primary: ready[0]?.id ?? null,
    gateways,
  });
}
