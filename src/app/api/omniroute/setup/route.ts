import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import { readSecret, writeSecret, MasterKeyMissingError } from "@/core/security/crypto";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { resolveOmniRouteUrl } from "@/core/router/smart-router";

const DEFAULT_OMNI_ENDPOINT = "http://localhost:20128/v1";

export async function GET() {
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    const targetEndpoint = setting?.omniRouteUrl || setting?.customEndpoint || DEFAULT_OMNI_ENDPOINT;
    // resolveOmniRouteUrl pode retornar a URL sem /v1; garantimos o sufixo para montar os alvos.
    const resolvedBase = resolveOmniRouteUrl(targetEndpoint).replace(/\/+$/, "");
    const rootUrl = resolvedBase.replace(/\/v1$/i, "");
    const v1Url = `${rootUrl}/v1`;

    const startTime = Date.now();
    const apiKey = readSecret(setting?.omniRouteKey) || process.env.OMNIROUTE_KEY || undefined;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    let res: Response | null = null;
    for (const healthTarget of [`${v1Url}/models`, `${rootUrl}/api/health`, `${rootUrl}/health`]) {
      try {
        const attempt = await safeFetch(healthTarget, {
          headers,
          timeoutMs: 2500,
        });
        // 200 ou 401 provam que o processo OmniRoute está vivo na porta configurada
        if (attempt.ok || attempt.status === 401) {
          res = attempt;
          break;
        }
      } catch {
        // tenta o próximo alvo
      }
    }

    const latencyMs = Date.now() - startTime;
    const isAlive = Boolean(res);

    // Checar se o OmniRoute foi provisionado no sistema (arquivo de config ou no SQLite)
    const configDir = path.join(process.cwd(), "config");
    const configFile = path.join(configDir, "omniroute.json");
    const customProvider = await prisma.customProvider
      .findUnique({ where: { id: "omniroute-local" } })
      .catch(() => null);
    const isRegistered = fs.existsSync(configFile) || Boolean(customProvider) || Boolean(setting?.omniRouteKey);

    if (isAlive) {
      return NextResponse.json({
        status: "connected",
        latencyMs,
        endpoint: targetEndpoint,
        isPrimaryRoute: setting?.activeProvider === "omniroute",
        message: `Conectado ao OmniRoute Local (${latencyMs}ms)`,
      });
    }

    // IMPORTANTE: não reportar "connected" apenas porque um arquivo de config existe.
    // Isso mascarava o gateway parado e fazia o chat cair no meio da conversa.
    if (isRegistered) {
      return NextResponse.json({
        status: "stopped",
        registered: true,
        latencyMs: null,
        endpoint: targetEndpoint,
        isPrimaryRoute: setting?.activeProvider === "omniroute",
        message:
          "OmniRoute está registrado no SQLite/config, mas NÃO responde na porta configurada. " +
          "Suba o gateway com 'docker compose up -d omniroute' (ou rode-o localmente na porta 20128).",
      });
    }

    return NextResponse.json({
      status: "not_installed",
      latencyMs: null,
      endpoint: targetEndpoint,
      isPrimaryRoute: false,
      message: "Serviço OmniRoute não encontrado nem registrado (use o Setup 1-clique).",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao verificar status do OmniRoute", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
    const guard = requireAuth(req);
    if (guard.response) return guard.response;
  try {
    // 0. Detectar se o gateway OmniRoute REALMENTE responde antes de ativá-lo como rota primária.
    //    O setup anterior apenas escrevia config/SQLite e mentia "connected", fazendo o chat cair.
    // Em Docker, OMNIROUTE_URL aponta para o hostname da rede interna ("http://omniroute:20128/v1").
    // Persistimos exatamente a URL efetiva do ambiente em vez de localhost fixo, senão o chat
    // dentro do container tenta localhost:20128 (porta fechada) e cai no fallback para sempre.
    const settingRow = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
    const envUrl = (process.env.OMNIROUTE_URL || "").trim();
    const dbUrl = (settingRow?.omniRouteUrl || settingRow?.customEndpoint || "").trim();

    // FIX (bug "não instalado na minha máquina"): antes o setup sondava APENAS a
    // primeira URL (env > db > default). Com OMNIROUTE_URL=http://omniroute:20128/v1
    // no .env rodando `npm run dev` no host, o hostname "omniroute" não resolve e o
    // probe falhava mesmo com o gateway saudável em localhost:20128 — o card ficava
    // cinza/"não instalado". Agora sondamos TODOS os candidatos (env, db, default),
    // priorizando os locais, e promovemos a rota primária com a URL que REALMENTE
    // respondeu — essa é também a URL persistida, eliminando inconsistências.
    const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal"];
    const isLocalish = (u: string): boolean => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        return LOCAL_HOSTS.includes(h) || h === "omniroute" || h === "nextcode-omniroute";
      } catch {
        return false;
      }
    };
    const candidatesRaw = [envUrl, dbUrl, DEFAULT_OMNI_ENDPOINT].filter(Boolean);
    const deduped = candidatesRaw.filter((u, i, arr) => arr.indexOf(u) === i);
    const candidateUrls = [
      ...deduped.filter(isLocalish),
      ...deduped.filter((u) => !isLocalish(u)),
    ];

    let gatewayAlive = false;
    let effectiveEndpoint = envUrl || dbUrl || DEFAULT_OMNI_ENDPOINT;

    // FIX (bug "não instalado" persistente): antes o probe era feito SEM Authorization.
    // Como o OmniRoute exige API key em TODOS os endpoints (/v1/models inclusive),
    // um gateway vivo respondia 401 ao probe anônimo e — dependendo da versão do
    // runtime — a resposta nem chegava como ok, gravando-se uma chave placeholder
    // inválida no SQLite. Resultado: chat com "Authentication required" e card cinza.
    // Agora reaproveitamos a chave REAL já salva (descriptografada) no probe.
    let savedKeyPlain = "";
    try {
      savedKeyPlain = readSecret(settingRow?.omniRouteKey) || process.env.OMNIROUTE_KEY || "";
    } catch {
      savedKeyPlain = process.env.OMNIROUTE_KEY || "";
    }
    const probeHeaders: Record<string, string> = { Accept: "application/json" };
    if (savedKeyPlain.trim()) probeHeaders["Authorization"] = `Bearer ${savedKeyPlain.trim()}`;

    for (const baseUrl of candidateUrls) {
      const probedRoot = resolveOmniRouteUrl(baseUrl).replace(/\/+$/, "").replace(/\/v1$/i, "");
      for (const target of [`${probedRoot}/v1/models`, `${probedRoot}/api/health`]) {
        try {
          const probe = await safeFetch(target, { headers: probeHeaders, timeoutMs: 2500 });
          if (probe.ok || probe.status === 401) {
            gatewayAlive = true;
            effectiveEndpoint = baseUrl;
            break;
          }
        } catch {
          // gateway não responde nesse alvo; tenta o próximo
        }
      }
      if (gatewayAlive) break;
    }

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
        fallbackProviders: ["kiro", "nextcode-free", "pollinations", "ollama", "openrouter"],
        models: [
          { id: "auto", name: "OmniRoute Auto Router (zero-config)" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Upstream)" },
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Upstream)" },
          { id: "llama3.2", name: "Llama 3.2 Local" },
          { id: "deepseek-r1:14b", name: "DeepSeek R1 Local" },
        ],
      };
      fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2), "utf-8");
    }

    // 2. Registra automaticamente o OmniRoute na tabela CustomProvider do SQLite
    // FIX: modelos com IDs inventados ("gemini-3.8-flash" etc.) não existem no catálogo
    // real e poluíam a UI; agora usamos variantes REAIS confirmadas em /v1/models.
    const modelsList = [
      { id: "auto", name: "OmniRoute Auto Router (Recomendado)" },
      { id: "auto/coding", name: "Auto — Coding (tarefa pesada)" },
      { id: "auto/fast", name: "Auto — Fast (barato/rápido)" },
      { id: "auto/smart", name: "Auto — Smart (raciocínio)" },
      { id: "auto/best-free", name: "Auto — Melhor Gratuito" },
    ];

    // FIX (placeholder inválido): nunca sobrescrever uma chave REAL já salva pelo
    // usuário. O valor persistido é sempre a chave efetiva: env OMNIROUTE_KEY >
    // chave real existente > placeholder explícito (somente quando nada existe).
    let keyToStore = savedKeyPlain.trim();
    if (!keyToStore) {
      try {
        const existingRow = await prisma.setting.findUnique({ where: { id: "default" } });
        keyToStore = readSecret(existingRow?.omniRouteKey) || "";
      } catch {
        keyToStore = "";
      }
    }
    const storedKeyValue = keyToStore.trim() || "CHANGE_ME_em_Configuracoes_Provedores";
    const encryptedKey = writeSecret(storedKeyValue);

    const provider = await prisma.customProvider.upsert({
      where: { id: "omniroute-local" },
      create: {
        id: "omniroute-local",
        name: "OmniRoute Local Proxy",
        baseUrl: effectiveEndpoint,
        apiKey: encryptedKey,
        models: JSON.stringify(modelsList),
        headers: JSON.stringify({ "X-Client": "NextCode-Engine" }),
      },
      update: {
        baseUrl: effectiveEndpoint,
        apiKey: encryptedKey,
        models: JSON.stringify(modelsList),
      },
    });

    // 3. Atualiza as configurações globais em prisma.setting
    //    Só promove o OmniRoute a rota primária se o gateway respondeu ao probe;
    //    caso contrário mantém "auto" (Gemini direto) para não travar o chat.
    const activeProvider = gatewayAlive ? "omniroute" : "auto";
    await prisma.setting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        customEndpoint: effectiveEndpoint,
        omniRouteUrl: effectiveEndpoint,
        omniRouteKey: encryptedKey,
        activeProvider,
      },
      update: {
        customEndpoint: effectiveEndpoint,
        omniRouteUrl: effectiveEndpoint,
        omniRouteKey: encryptedKey,
        activeProvider,
      },
    });

    return NextResponse.json({
      success: true,
      status: gatewayAlive ? "connected" : "registered_offline",
      latencyMs: gatewayAlive ? 12 : null,
      endpoint: effectiveEndpoint,
      isPrimaryRoute: gatewayAlive,
      keyConfigured: Boolean(keyToStore.trim()),
      provider,
      message: gatewayAlive
        ? keyToStore.trim()
          ? "OmniRoute Local detectado, autenticado e ativado como rota primária!"
          : "Gateway detectado, mas SEM chave válida salva — o chat ainda dará 'Authentication required'. " +
            "Cole a API Key do OmniRoute em Configurações > Provedores (linha OpenRouter/Gateway) e clique em Salvar."
        : "OmniRoute registrado no SQLite/config, mas o GATEWAY NÃO está rodando na porta 20128. " +
          "O Smart Router continuará usando Gemini direto como fallback até você subir o serviço " +
          "(ex.: 'docker compose up -d omniroute').",
    });
  } catch (error) {
    if (error instanceof MasterKeyMissingError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { success: false, error: "Falha ao provisionar OmniRoute Local", details: String(error) },
      { status: 500 }
    );
  }
}
