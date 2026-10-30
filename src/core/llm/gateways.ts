/**
 * Gateways de LLM compatíveis com OpenAI (FreeLLMAPI e OmniRoute). O desenho está em docs/NEXTCODE-REFERENCIA.md.
 *
 * Os dois gateways JÁ fazem roteamento entre provedores, cooldown e controle de cota. O NextCode
 * não reimplementa nada disso: escolhe o gateway pela ordem configurada, classifica a falha
 * (mesma taxonomia do opencode: rede/autenticação/esgotado/requisição inválida) e passa ao
 * próximo. O modelo que de fato respondeu vem do gateway (X-Routed-Via) e vai para a telemetria.
 */
import prisma from "@/lib/prisma";
import { readSecret, writeSecret } from "@/core/security/crypto";
import { safeFetch } from "@/core/security/safe-fetch";
import { ensureVerifiedOmniModels } from "@/core/router/omni-model-discovery";
import { extractAssistantTextFromCompletion } from "@/core/llm/chat-completion-text";

export type GatewayId = "freellmapi" | "omniroute" | "deepseek";
export const GATEWAY_IDS: GatewayId[] = ["freellmapi", "omniroute", "deepseek"];

export interface GatewayConfig {
  id: GatewayId;
  enabled: boolean;
  priority: number;
  baseUrl: string;
  apiKey: string;
  modelFast: string | null;
  modelHeavy: string | null;
  /** Gateway pago/forte: no tier pesado vem antes dos gratuitos (código dos nós). */
  heavyFirst?: boolean;
}

export const GATEWAY_DEFAULTS: Record<GatewayId, { label: string; baseUrl: string; priority: number; modelFast: string | null; modelHeavy: string | null; pingPath: string; dashboardUrl: string; heavyFirst?: boolean }> = {
  freellmapi: {
    label: "FreeLLMAPI",
    baseUrl: "http://localhost:3100/v1",
    priority: 0,
    // auto:fast = menor latência medida (chat, Auditor Cego); auto:smart = mais capaz (código dos nós).
    // "auto" (balanced) chegou a escolher um modelo de 61s para uma resposta de uma linha.
    modelFast: "auto:fast",
    modelHeavy: "auto:smart",
    pingPath: "/api/ping",
    dashboardUrl: "http://localhost:3100",
  },
  omniroute: {
    label: "OmniRoute",
    baseUrl: "http://localhost:20128/v1",
    priority: 1,
    // null = cascata própria do router (OMNIROUTE_MODEL > modelos verificados > combos auto/*).
    modelFast: null,
    modelHeavy: null,
    pingPath: "/api/health",
    dashboardUrl: "http://localhost:20128",
  },
  deepseek: {
    // API paga e direta (chave em Configurações > chaves nativas). Só no tier pesado: o código
    // dos nós vai para ela primeiro; chat e Auditor Cego seguem no gratuito (modelo diferente
    // do executor, como a arquitetura pede para o avaliador).
    label: "DeepSeek (pago)",
    baseUrl: "https://api.deepseek.com/v1",
    priority: 2,
    modelFast: null,
    modelHeavy: "deepseek-v4-pro",
    pingPath: "/models",
    dashboardUrl: "https://platform.deepseek.com",
    heavyFirst: true,
  },
};

const CACHE_MS = 3000;
let cache: { at: number; value: GatewayConfig[] } | null = null;

export function invalidateGatewayCache(): void {
  cache = null;
}

/**
 * Gateways ativos e utilizáveis, em ordem de prioridade. FreeLLMAPI só entra com chave
 * unificada (ele recusa chamadas sem ela). OmniRoute lê URL/chave do Setting legado.
 */
export async function loadGatewayConfigs(): Promise<GatewayConfig[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const [rows, setting] = await Promise.all([
    prisma.llmGateway.findMany().catch(() => []),
    prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const configs: GatewayConfig[] = [];
  for (const id of GATEWAY_IDS) {
    const row = byId.get(id);
    const def = GATEWAY_DEFAULTS[id];
    const base: GatewayConfig = {
      id,
      enabled: row?.enabled ?? true,
      priority: row?.priority ?? def.priority,
      baseUrl: row?.baseUrl || def.baseUrl,
      apiKey: readSecret(row?.apiKey),
      modelFast: row?.modelFast ?? def.modelFast,
      modelHeavy: row?.modelHeavy ?? def.modelHeavy,
    };
    if (id === "omniroute") {
      base.baseUrl = setting?.omniRouteUrl || setting?.customEndpoint || process.env.OMNIROUTE_URL || def.baseUrl;
      base.apiKey = readSecret(setting?.omniRouteKey);
    }
    if (id === "deepseek") {
      base.apiKey = readSecret((setting as { deepseekKey?: string | null } | null)?.deepseekKey);
      base.heavyFirst = true;
    }
    if ((id === "freellmapi" || id === "deepseek") && !base.apiKey) continue;
    if (!base.enabled) continue;
    configs.push(base);
  }

  configs.sort((a, b) => a.priority - b.priority);
  cache = { at: Date.now(), value: configs };
  return configs;
}

export interface GatewayUpdate {
  enabled?: boolean;
  priority?: number;
  baseUrl?: string | null;
  apiKey?: string | null; // undefined = mantém; "" = apaga
  modelFast?: string | null;
  modelHeavy?: string | null;
}

export async function saveGatewayConfig(id: GatewayId, update: GatewayUpdate): Promise<void> {
  const data: Record<string, unknown> = {};
  if (update.enabled !== undefined) data.enabled = update.enabled;
  if (update.priority !== undefined) data.priority = update.priority;
  if (update.baseUrl !== undefined) data.baseUrl = update.baseUrl?.trim() || null;
  if (update.apiKey !== undefined) data.apiKey = update.apiKey ? writeSecret(update.apiKey) : null;
  if (update.modelFast !== undefined) data.modelFast = update.modelFast?.trim() || null;
  if (update.modelHeavy !== undefined) data.modelHeavy = update.modelHeavy?.trim() || null;
  await prisma.llmGateway.upsert({
    where: { id },
    update: data,
    create: { id, priority: GATEWAY_DEFAULTS[id].priority, ...data },
  });
  invalidateGatewayCache();
}

export function modelForTier(gw: GatewayConfig, tier: "fast" | "heavy" | "custom"): string | null {
  return tier === "heavy" ? gw.modelHeavy || gw.modelFast : gw.modelFast;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  return `${/\/v1$/i.test(clean) ? clean : `${clean}/v1`}/chat/completions`;
}

function rootUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

// ---------------------------------------------------------------------------
// Chamada e classificação de falha
// ---------------------------------------------------------------------------

export type GatewayFailureKind = "network" | "timeout" | "auth" | "exhausted" | "bad_request";

export type GatewayAttempt =
  | { ok: true; response: Response; servedBy: string; latencyMs: number }
  | { ok: false; kind: GatewayFailureKind; status?: number; detail: string };

const downUntil = new Map<GatewayId, number>();
const DOWN_COOLDOWN_MS = 15000;

export function isGatewayDown(id: GatewayId): boolean {
  return (downUntil.get(id) ?? 0) > Date.now();
}

export function resetGatewayState(): void {
  downUntil.clear();
  invalidateGatewayCache();
}

/** Mensagem de erro no formato OpenAI ({error:{message}}) ou o texto cru, truncado. */
export function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 240);
  } catch {
    /* texto cru */
  }
  return body.trim().slice(0, 240) || "sem detalhe";
}

export function classifyStatus(status: number): GatewayFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 404 || status === 413 || status === 422) return "bad_request";
  return "exhausted"; // 402, 429, 5xx: o gateway já esgotou o próprio fallback
}

export interface GatewayCallOptions {
  messages: { role: string; content: string }[];
  model: string;
  stream: boolean;
  signal?: AbortSignal;
  maxTokens?: number;
  /** Tempo máximo desta chamada; sem ele vale LLM_GATEWAY_TIMEOUT_MS ou 30 s (stream) / 120 s. */
  timeoutMs?: number;
}

export async function callGateway(gw: GatewayConfig, opts: GatewayCallOptions): Promise<GatewayAttempt> {
  const timeoutMs =
    opts.timeoutMs || Number(process.env.LLM_GATEWAY_TIMEOUT_MS) || (opts.stream ? 30000 : 120000);
  const attemptTimeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, attemptTimeout]) : attemptTimeout;
  const started = Date.now();

  let res: Response;
  try {
    res = await safeFetch(chatCompletionsUrl(gw.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(gw.apiKey ? { Authorization: `Bearer ${gw.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: opts.stream,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) return { ok: false, kind: "timeout", detail: "requisição abortada pelo chamador" };
    if (attemptTimeout.aborted) {
      return { ok: false, kind: "timeout", detail: `sem resposta em ${Math.round(timeoutMs / 1000)}s` };
    }
    downUntil.set(gw.id, Date.now() + DOWN_COOLDOWN_MS);
    return { ok: false, kind: "network", detail: `inacessível em ${gw.baseUrl}: ${String(err).slice(0, 160)}` };
  }

  if (res.ok) {
    downUntil.delete(gw.id);
    const routed = res.headers.get("x-routed-via");
    return { ok: true, response: res, servedBy: routed || opts.model, latencyMs: Date.now() - started };
  }

  const body = await res.text().catch(() => "");
  return { ok: false, kind: classifyStatus(res.status), status: res.status, detail: extractErrorMessage(body) };
}

// ---------------------------------------------------------------------------
// Diagnóstico real: ping → autenticação → uma conversa de verdade com o modelo configurado
// ---------------------------------------------------------------------------

export interface GatewayHealth {
  id: GatewayId;
  label: string;
  baseUrl: string;
  configured: boolean;
  enabled: boolean;
  priority: number;
  model: string | null;
  reachable: boolean;
  authOk: boolean | null;
  chatOk: boolean;
  servedBy: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
  action: string | null;
}

async function quickGet(url: string, apiKey: string | undefined, timeoutMs: number): Promise<Response | null> {
  try {
    return await safeFetch(url, {
      headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/**
 * Teste barato de disponibilidade (sem gastar tokens): GET /v1/models com a chave do gateway.
 * Só conta como disponível com HTTP 200 — chave inválida (401/403) ou servidor caído não contam.
 */
export async function isGatewayAnswering(gw: GatewayConfig, timeoutMs = 3000): Promise<boolean> {
  const res = await quickGet(`${rootUrl(gw.baseUrl)}/v1/models`, gw.apiKey || undefined, timeoutMs);
  return Boolean(res && res.ok);
}

export async function probeGateway(id: GatewayId): Promise<GatewayHealth> {
  const def = GATEWAY_DEFAULTS[id];
  const [row, setting] = await Promise.all([
    prisma.llmGateway.findUnique({ where: { id } }).catch(() => null),
    prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null),
  ]);
  const baseUrl =
    id === "omniroute"
      ? setting?.omniRouteUrl || setting?.customEndpoint || process.env.OMNIROUTE_URL || def.baseUrl
      : row?.baseUrl || def.baseUrl;
  const apiKey =
    id === "omniroute"
      ? readSecret(setting?.omniRouteKey)
      : id === "deepseek"
        ? readSecret((setting as { deepseekKey?: string | null } | null)?.deepseekKey)
        : readSecret(row?.apiKey);
  const configuredModel = row?.modelFast ?? def.modelFast ?? def.modelHeavy;
  // O diagnóstico testa o MESMO modelo que o roteador vai usar. No OmniRoute sem modelo fixo, o
  // roteador usa OMNIROUTE_MODEL ou os modelos verificados pela descoberta (não o combo auto/*).
  let model = configuredModel || process.env.OMNIROUTE_MODEL?.split(",")[0]?.trim() || "";
  if (!model && id === "omniroute" && apiKey) {
    const root = rootUrl(baseUrl);
    const verified = await ensureVerifiedOmniModels(
      { rootUrl: root, chatUrl: chatCompletionsUrl(baseUrl), apiKey },
      AbortSignal.timeout(90000)
    ).catch(() => []);
    model = verified[0]?.id || "";
  }
  if (!model) model = "auto/best-free";

  const health: GatewayHealth = {
    id,
    label: def.label,
    baseUrl,
    configured: Boolean(apiKey),
    enabled: row?.enabled ?? true,
    priority: row?.priority ?? def.priority,
    model,
    reachable: false,
    authOk: null,
    chatOk: false,
    servedBy: null,
    latencyMs: null,
    httpStatus: null,
    error: null,
    action: null,
  };

  const ping = await quickGet(`${rootUrl(baseUrl)}${def.pingPath}`, id === "deepseek" ? apiKey : undefined, 3000);
  health.reachable = Boolean(ping && ping.status < 500);
  if (!health.reachable) {
    const models = await quickGet(`${rootUrl(baseUrl)}/v1/models`, apiKey, 3000);
    health.reachable = Boolean(models);
  }
  if (!health.reachable) {
    health.error = `Nada respondendo em ${rootUrl(baseUrl)}.`;
    health.action =
      id === "freellmapi"
        ? "Suba o gateway: docker compose up -d freellmapi"
        : "Suba o gateway: docker compose up -d omniroute";
    return health;
  }

  if (!apiKey) {
    health.authOk = false;
    health.error = "Sem chave configurada.";
    health.action =
      id === "freellmapi"
        ? `Abra ${def.dashboardUrl}, crie a conta, cadastre as chaves dos provedores e copie a chave unificada (página Keys) para cá.`
        : `Gere uma API key no painel do OmniRoute (${def.dashboardUrl}) e salve aqui.`;
    return health;
  }

  const modelsRes = await quickGet(`${rootUrl(baseUrl)}/v1/models`, apiKey, 5000);
  health.authOk = modelsRes ? !(modelsRes.status === 401 || modelsRes.status === 403) : null;
  if (health.authOk === false) {
    health.httpStatus = modelsRes!.status;
    health.error = `Chave recusada pelo gateway (HTTP ${modelsRes!.status}).`;
    health.action =
      id === "freellmapi"
        ? `Copie de novo a chave unificada em ${def.dashboardUrl} (página Keys).`
        : `A chave salva não vale neste OmniRoute: gere outra em ${def.dashboardUrl} e salve aqui.`;
    return health;
  }

  const gw: GatewayConfig = {
    id,
    enabled: true,
    priority: health.priority,
    baseUrl,
    apiKey,
    modelFast: model,
    modelHeavy: model,
  };
  const attempt = await callGateway(gw, {
    messages: [{ role: "user", content: "Responda apenas: ok" }],
    model,
    stream: false,
    // Modelos com raciocínio gastam os primeiros tokens pensando; 16 devolvia content: null.
    maxTokens: 512,
    signal: AbortSignal.timeout(60000),
  });

  if (attempt.ok) {
    const json = await attempt.response.json().catch(() => ({}));
    const content = extractAssistantTextFromCompletion(json);
    health.latencyMs = attempt.latencyMs;
    health.servedBy = attempt.servedBy;
    health.httpStatus = 200;
    health.chatOk = content.length > 0;
    if (!health.chatOk) {
      health.error = "O gateway respondeu 200, mas sem texto de resposta.";
      health.action = "Verifique o modelo configurado.";
    }
    return health;
  }

  health.httpStatus = attempt.status ?? null;
  health.error = attempt.detail;
  // OmniRoute: a chave do gateway já passou no /v1/models (authOk). Qualquer 4xx/5xx daqui em
  // diante vem dos PROVEDORES por trás do modelo — trocar a chave do OmniRoute não resolve.
  if (id === "omniroute" && attempt.kind !== "timeout" && attempt.kind !== "network") {
    health.action =
      `A chave do OmniRoute está correta (o gateway aceitou). Quem recusou foi o provedor por trás do modelo "${model}"` +
      (/opencode/i.test(attempt.detail)
        ? " (o OpenCode Zen bloqueia o plano gratuito fora do app OpenCode)"
        : "") +
      `. Para o OmniRoute servir modelos bons, conecte um provedor com chave própria em ${def.dashboardUrl} → Providers e fixe o modelo dele aqui (ex.: groq/llama-3.3-70b-versatile). Enquanto isso, o FreeLLMAPI é a rota principal.`;
    return health;
  }
  health.action =
    attempt.kind === "auth"
      ? `Chave recusada: copie de novo a chave unificada em ${def.dashboardUrl}.`
      : attempt.kind === "exhausted"
        ? id === "freellmapi"
          ? `Nenhum provedor do FreeLLMAPI respondeu. Cadastre chaves gratuitas (Groq, Google, Cerebras, OpenRouter...) em ${def.dashboardUrl} → Keys.`
          : `O modelo "${model}" não tem provedor disponível agora (cota ou credencial). Ajuste os provedores/combos em ${def.dashboardUrl}.`
        : attempt.kind === "bad_request"
          ? `O gateway recusou o modelo "${model}". Defina um modelo válido.`
          : "O gateway não respondeu a tempo.";
  return health;
}

export async function probeAllGateways(): Promise<GatewayHealth[]> {
  const results = await Promise.all(GATEWAY_IDS.map((id) => probeGateway(id)));
  return results.sort((a, b) => a.priority - b.priority);
}
