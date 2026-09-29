import { NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import { readSecret } from "@/core/security/crypto";
import prisma from "@/lib/prisma";
export async function GET() {
    return handleCheck();
}
export async function POST(req) {
    const guard = requireAuth(req);
    if (guard.response)
        return guard.response;
    return handleCheck();
}
async function handleCheck() {
    let apiKey;
    let isPrimaryRoute = false;
    // 1. Busca configurações com tratamento seguro contra falhas de schema/banco
    try {
        const setting = await prisma.setting.findFirst({ where: { id: "default" } });
        if (setting) {
            apiKey = readSecret(setting.omniRouteKey) || undefined;
            isPrimaryRoute = setting.activeProvider === "omniroute";
        }
    }
    catch (err) {
        console.warn("[HEALTH] Aviso: tabela Setting inacessível no momento, prosseguindo com checagem de porta:", err.message);
    }
    // 2. URLs candidatas para cobrir ambiente Docker e ambiente Host
    // FIX: antes era injetado "http://omniroute:20128/v1" sempre que OMNIROUTE_URL não
    // continha a palavra "omniroute" — em máquina local (fora da rede do compose) esse
    // hostname não resolve (ENOTFOUND) e o health check gastava tempo/falava mesmo com
    // gateway local vivo. Agora só testamos: URL do ambiente > URL salva no SQLite > localhost.
    //
    // FIX (bug "não instalado na minha máquina"): quando o app roda FORA do Docker mas o
    // .env contém OMNIROUTE_URL=http://omniroute:20128/v1 (hostname interno da rede do
    // compose), essa URL nunca resolve no host. Antes ela era testada PRIMEIRO e o
    // candidato localhost vinha por último — com timeout estourado, o card mostrava
    // "não instalado" mesmo com o gateway saudável respondendo em localhost:20128.
    // Agora candidatos com hostname fora da allowlist local são rebaixados para o fim
    // da fila, e localhost SEMPRE é testado como fallback de proximidade.
    const envUrl = (process.env.OMNIROUTE_URL || "").trim();
    let dbUrl = "";
    try {
        const s2 = await prisma.setting.findUnique({ where: { id: "default" } });
        dbUrl = (s2?.omniRouteUrl || s2?.customEndpoint || "").trim();
    }
    catch {
        /* banco indisponível; segue com env/localhost */
    }
    const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal"];
    const isLocalish = (u) => {
        try {
            const h = new URL(u).hostname.toLowerCase();
            return LOCAL_HOSTS.includes(h) || h === "omniroute" || h === "nextcode-omniroute";
        }
        catch {
            return false;
        }
    };
    const ordered = [envUrl, dbUrl, "http://localhost:20128/v1"]
        .filter(Boolean)
        .filter((u, i, arr) => arr.indexOf(u) === i);
    // Prioriza candidatos locais/resolvidos-por-compose; empurra URLs exóticas p/ o fim.
    const candidateUrls = [
        ...ordered.filter(isLocalish),
        ...ordered.filter((u) => !isLocalish(u)),
    ];
    const startTime = Date.now();
    let isConnected = false;
    let activeEndpoint = "http://localhost:20128/v1";
    let lastHttpStatus = null;
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
            }
            catch {
                // Falha de rota ou timeout, tenta o próximo candidato
            }
        }
        if (isConnected)
            break;
    }
    const latencyMs = Date.now() - startTime;
    // FIX (card verde vs. chat quebrado): o OmniRoute responde 401 para chave
    // ausente/inválida — isso prova que o PROCESSO está vivo, mas NÃO que a chave
    // salva funciona. Antes, nesses casos o card ia de "não instalado" direto para
    // "Conectado", mascarando o problema real (chat com 'Authentication required').
    // Agora distinguimos: 200 => conectado de verdade; 401 => "porta viva, chave inválida".
    let authOk = false;
    if (isConnected && apiKey) {
        try {
            const check = await safeFetch(`${activeEndpoint.replace(/\/+$/, "")}/models`, {
                headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
                timeoutMs: 2500,
            });
            authOk = check.ok;
        }
        catch {
            authOk = false;
        }
    }
    return NextResponse.json({
        success: isConnected,
        status: isConnected ? (authOk || !lastHttpStatus || lastHttpStatus === 200 ? "connected" : "connected_unauthorized") : "stopped",
        latencyMs: isConnected ? latencyMs : null,
        endpoint: activeEndpoint,
        isPrimaryRoute,
        httpStatus: lastHttpStatus,
        keyValid: authOk,
        message: !isConnected
            ? "Status: Offline (Nenhum serviço detectado na porta 20128). Suba o gateway com 'docker compose up -d omniroute' ou desative a rota primária. O NextCode usará o Gemini direto como fallback."
            : authOk
                ? `OmniRoute Local operacional (${latencyMs}ms)!`
                : "Gateway VIVO na porta 20128, mas a API Key salva é inválida ou está faltando (respondeu 401). " +
                    "Gere uma API key no painel do OmniRoute (http://localhost:20128), cole em Configurações > Provedores e clique em Salvar.",
    });
}
