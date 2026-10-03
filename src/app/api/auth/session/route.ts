import { NextRequest, NextResponse } from "next/server";
import { getRuntimeToken, rateLimited, canIssueBootstrapToken, markBootstrapTokenIssued } from "@/core/security/local-auth";

/**
 * Bootstrap da sessão local (Fase 4).
 * POST /api/auth/session entrega o token UMA vez para o cliente local.
 * Rate-limited agressivamente (10/min por IP) pois é a única porta pública.
 *
 * O header `Host` é fornecido pelo cliente e NÃO é um sinal de segurança válido
 * (qualquer chamador remoto pode mandar `Host: localhost`) — a exposição real
 * é controlada no binding da porta (ver docker-compose.yml / next start -H),
 * que deve escutar apenas em 127.0.0.1 a menos que você saiba o que está fazendo.
 * Aqui, a defesa em profundidade é: 1) com NEXTCODE_AUTH_TOKEN fixo, este bootstrap
 * fica permanentemente desativado; 2) sem token fixo, o token gerado em runtime só
 * é entregue UMA vez por processo.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Rate limit excedido." }, { status: 429 });
  }
  if (!canIssueBootstrapToken()) {
    return NextResponse.json(
      {
        error:
          "Bootstrap indisponível: defina NEXTCODE_AUTH_TOKEN no ambiente, ou reinicie o processo se o token de runtime já foi entregue.",
      },
      { status: 403 }
    );
  }
  markBootstrapTokenIssued();
  return NextResponse.json({ token: getRuntimeToken(), header: "X-Nextcode-Token" });
}
