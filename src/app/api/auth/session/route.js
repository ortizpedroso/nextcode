import { NextResponse } from "next/server";
import { getRuntimeToken, rateLimited } from "@/core/security/local-auth";
/**
 * Bootstrap da sessão local (Fase 4).
 * POST /api/auth/session entrega o token UMA vez para o cliente local.
 * Rate-limited agressivamente (10/min por IP) pois é a única porta pública.
 * Em produção local você pode fixar NEXTCODE_AUTH_TOKEN no .env e ignorar esta rota.
 */
export async function POST(req) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (rateLimited(ip)) {
        return NextResponse.json({ error: "Rate limit excedido." }, { status: 429 });
    }
    // Só entrega o token se a requisição veio de loopback (mesma máquina/rede do compose).
    const host = (req.headers.get("host") || "").toLowerCase();
    const isLocal = host.startsWith("localhost") ||
        host.startsWith("127.") ||
        host.startsWith("[::1]") ||
        host.startsWith("host.docker.internal") ||
        host.startsWith("nextcode-app");
    if (!isLocal) {
        return NextResponse.json({ error: "Sessão local só pode ser iniciada via localhost." }, { status: 403 });
    }
    return NextResponse.json({ token: getRuntimeToken(), header: "X-Nextcode-Token" });
}
