export type ModelTier = "fast" | "heavy" | "custom";

export interface IntentAnalysis {
  tier: ModelTier;
  targetModel: string;
  actualModelUsed: string;
  confidence: number;
  reasoning: string;
  estimatedTokens: number;
  fallbackTriggered: boolean;
  fallbackNotice?: string;
}

export interface TaskPayload {
  prompt: string;
  context?: string;
  mcpScope?: string;
  role?: string;
}

export interface AvailableKeys {
  hasGeminiKey: boolean;
  hasClaudeKey: boolean;
  hasOpenaiKey: boolean;
  hasGroqKey?: boolean;
  hasNvidiaKey?: boolean;
  hasOmniRouteKey: boolean;
  customEndpoint?: string | null;
}

export interface PruneResult {
  prunedText: string;
  originalTokens: number;
  prunedTokens: number;
  tokensSaved: number;
}

import { safeFetch } from "../security/safe-fetch";
import { isComboOnCooldown, markComboExhausted } from "./quota-tracker";

export function resolveOmniRouteUrl(rawUrl?: string): string {
  // FIX DEFINITIVO (porta morta): normaliza qualquer URL apontando para a porta 8080
  // (default legado do schema Prisma — porta em que NADA roda) para a porta real do
  // gateway, derivada de OMNIROUTE_URL do .env/compose (fallback 20128). Sem isso,
  // registros legados no SQLite faziam o dispatcher bater em porta fechada enquanto a
  // UI (que sonda localhost:20128 por cascata) mostrava o card verde — o paradoxo
  // "verde mas quebrado".
  const envUrl = (process.env.OMNIROUTE_URL || "").trim();
  let base = (rawUrl || envUrl || "http://localhost:20128/v1").trim();
  if (/:8080(\/|$)/.test(base)) {
    let port = "20128";
    try {
      port = new URL(envUrl).port || "20128";
    } catch {
      /* env ausente/inválido: usa a porta padrão documentada */
    }
    base = base.replace(/:8080(?=\/|$)/, `:${port}`);
    console.warn(`[ROUTER] omniRouteUrl legado na porta 8080 detectado — reescrito para :${port} (${base}).`);
  }

  // IMPORTANTE: a detecção de Docker serve apenas para converter "localhost" -> "host.docker.internal".
  // Reescrever para o hostname "omniroute" fora da rede do docker-compose causa ENOTFOUND indevido
  // Otimização decisiva (Fase 7): localhost/127.0.0.1 SEMPRE aponta para o próprio
  // namespace de rede — dentro OU fora de um container. Logo, NÃO há motivo para
  // reescrevê-lo quando o alvo é loopback. host.docker.internal só é necessário
  // quando o processo roda em container e precisa alcançar o LOOPBACK DO HOST.
  // Como não temos como distinguir isso no runtime, tratamos assim:
  //   - IS_DOCKER=true (injetado pelo compose) => conversão explícita pedida pelo operador;
  //   - /.dockerenv presente sem flag => ambiente genérico de container (CI/k8s): mantém localhost,
  //     que é o comportamento correto para gateways publicados via port-mapping interno ou hostNetwork.
  // A conversão automática por /.dockerenv era a fonte de falsos ENOTFOUND em CI e testes.
  if (isDockerExplicit() && (base.includes("localhost") || base.includes("127.0.0.1"))) {
    // host.docker.internal funciona em Docker Desktop (Mac/Windows) e no Linux com --add-host.
    return base
      .replace("localhost", "host.docker.internal")
      .replace("127.0.0.1", "host.docker.internal");
  }
  return base;
}

/** Apenas flags EXPLÍCITAS do operador/compose autorizam a reescrita de loopback. */
function isDockerExplicit(): boolean {
  return (
    process.env.IS_DOCKER === "true" ||
    process.env.DOCKER_CONTAINER === "1" ||
    process.env.DOCKER === "true"
  );
}
/**
 * Constrói a URL do gateway OmniRoute aceitando qualquer forma configurada pelo usuário:
 * "http://host:porta", ".../v1", ".../v1/chat/completions" etc. Retorna sempre o endpoint
 * completo de chat completions e a raiz correspondente.
 */
export function buildOmniEndpoints(rawUrl?: string): { chatUrl: string; rootUrl: string } {
  const resolved = resolveOmniRouteUrl(rawUrl).replace(/\/+$/, "");
  const withoutSuffix = resolved.replace(/\/v1(\/chat\/completions)?$/i, "");
  return {
    chatUrl: `${withoutSuffix}/v1/chat/completions`,
    rootUrl: withoutSuffix,
  };
}

// ---------------------------------------------------------------------------
// Fase 6 — Circuit-breaker do OmniRoute: após N falhas consecutivas, pula o
// gateway por X ms (evita pagar timeout de conexão em TODA mensagem quando o
// container está morto/entrando em OOM-restart).
// ---------------------------------------------------------------------------
const CB_FAILURE_THRESHOLD = Number(process.env.OMNIROUTE_CB_FAILURES) || 3;
const CB_OPEN_MS = Number(process.env.OMNIROUTE_CB_COOLDOWN_MS) || 30000;
let omniCbFailures = 0;
let omniCbOpenedAt = 0;

function omniCircuitOpen(): boolean {
  if (omniCbFailures < CB_FAILURE_THRESHOLD) return false;
  if (Date.now() - omniCbOpenedAt > CB_OPEN_MS) {
    // meio-aberto: permite UMA tentativa de sondagem
    omniCbFailures = CB_FAILURE_THRESHOLD - 1;
    console.log("[ROUTER] Circuit-breaker OmniRoute meio-aberto: tentando sondar o gateway.");
    return false;
  }
  return true;
}
function omniRecordFailure() {
  omniCbFailures += 1;
  if (omniCbFailures === CB_FAILURE_THRESHOLD) {
    omniCbOpenedAt = Date.now();
    console.warn(`[ROUTER] Circuit-breaker OmniRoute ABERTO por ${CB_OPEN_MS}ms apos ${CB_FAILURE_THRESHOLD} falhas consecutivas.`);
  }
}
function omniRecordSuccess() {
  if (omniCbFailures > 0) console.log("[ROUTER] Circuit-breaker OmniRoute FECHADO (gateway recuperado).");
  omniCbFailures = 0;
}

// FIX (chave Gemini válida dando erro 404): os IDs "gemini-3.5-flash"/"gemini-3.7-flash"
// NÃO existem na API v1beta do Google — qualquer requisição com eles retorna
// "404 NOT_FOUND: Model not found", o que parecia erro de chave. Agora usamos IDs
// reais da API, e a cascata de candidatos abaixo cobre variantes oficiais em ordem
// de preferência; um 404/400 avança para o próximo candidato em vez de derrubar tudo.
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-1.5-flash";
export const HEAVY_MODEL = process.env.GEMINI_HEAVY_MODEL || "gemini-1.5-pro";

// FIX (diagnóstico): guarda a última razão de falha de cada rota para embutir no
// alerta de esgotamento — sem isso, UI verde + chat quebrado ficava indepurável.
let lastOmniFailure = "";
let lastGroqFailure = "";
let lastNvidiaFailure = "";
let lastDeepseekFailure = "";
let lastGeminiFailure = "";

function buildDispatchDiagnostics(): string {
  const parts: string[] = [];
  if (lastOmniFailure) parts.push(`OmniRoute Local: ${lastOmniFailure}`);
  if (lastGroqFailure) parts.push(`Groq Cloud: ${lastGroqFailure}`);
  if (lastNvidiaFailure) parts.push(`NVIDIA NIM: ${lastNvidiaFailure}`);
  if (lastDeepseekFailure) parts.push(`DeepSeek API: ${lastDeepseekFailure}`);
  if (lastGeminiFailure) parts.push(`Gemini Direto: ${lastGeminiFailure}`);
  if (!parts.length) parts.push("nenhuma tentativa registrada");
  return `\n\n🔎 _Diagnóstico dos Provedores — ${parts.join(" | ")}_`;
}

/**
 * FIX DEFINITIVO (single source of truth): resolve a chave Gemini REAL que sera usada
 * pelo dispatcher, na MESMA ordem de precedencia (DB decifrado -> envs). Qualquer
 * endpoint de teste (UI de provedores/BYOK) DEVE usar esta funcao — antes, a UI validava
 * a chave digitada no form enquanto o chat lia o SQLite com outra master key/valor,
 * gerando o paradoxo "chave verde mas erro". Agora teste e chat usam exatamente a mesma
 * fonte; se o teste passa, o chat passa.
 */
export function resolveEffectiveGeminiKey(storedGeminiKey?: string | null): string {
  try {
    // readSecret aceita cifrado (enc:v1:) e legado texto-plano.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plain = require("../security/crypto").readSecret(storedGeminiKey) as string;
    if (plain && plain.trim() && !/^enc:v\d:/i.test(plain.trim())) return plain.trim();
  } catch {
    /* master key ausente/incorreta: segue para envs */
  }
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GEMINI_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    ""
  );
}


export interface DispatchMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface DispatchOptions {
  messages: DispatchMessage[];
  tier?: ModelTier;
  modelOverride?: string | null;
  geminiKey?: string | null;
  groqKey?: string | null;
  nvidiaKey?: string | null;
  deepseekKey?: string | null;
  omniRouteUrl?: string | null;
  omniRouteKey?: string | null;
  stream?: boolean;
}

export interface DispatchResult {
  response: Response;
  providerUsed: "omniroute" | "groq-fallback" | "nvidia-fallback" | "deepseek-fallback" | "gemini-fallback" | "none";
  badge: string;
  tierTag: "omniroute" | "groq-fallback" | "nvidia-fallback" | "deepseek-fallback" | "fast-fallback" | "fast" | "heavy" | "exhausted";
  modelUsed: string;
}


// ---------------------------------------------------------------------------
// Fase 6 — Métricas leves do dispatcher (in-memory, expostas via GET /api/metrics)
// ---------------------------------------------------------------------------
export interface RouterMetrics {
  omnirouteAttempts: number;
  omnirouteSuccesses: number;
  geminiFallbacks: number;
  exhausted: number;
  omniLatenciesMs: number[];
}
const metrics: RouterMetrics = {
  omnirouteAttempts: 0,
  omnirouteSuccesses: 0,
  geminiFallbacks: 0,
  exhausted: 0,
  omniLatenciesMs: [],
};
export function getRouterMetrics(): RouterMetrics & { p50?: number; p95?: number } {
  const sorted = [...metrics.omniLatenciesMs].sort((a, b) => a - b);
  const pct = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : undefined);
  return { ...metrics, p50: pct(0.5), p95: pct(0.95) };
}
function recordOmniAttempt() { metrics.omnirouteAttempts += 1; }
function recordOmniSuccess(latencyMs: number) {
  metrics.omnirouteSuccesses += 1;
  metrics.omniLatenciesMs.push(latencyMs);
  if (metrics.omniLatenciesMs.length > 200) metrics.omniLatenciesMs.shift();
}
function recordGeminiFallback() { metrics.geminiFallbacks += 1; }
function recordExhausted() { metrics.exhausted += 1; }

export class SmartRouter {
  private static HEAVY_KEYWORDS = [
    "refactor",
    "architecture",
    "architectural",
    "security",
    "audit",
    "complex",
    "optimize",
    "database schema",
    "migration",
    "dag",
    "mcp server",
    "decompor",
    "recriar",
    "diff",
    "testes unitarios",
    "jwt",
    "backend",
  ];

  private static FAST_KEYWORDS = [
    "format",
    "fix typo",
    "explain",
    "summarize",
    "quick",
    "rename",
    "simple",
    "status",
    "list",
    "ajustar texto",
    "docs",
    "comentario",
  ];

  /**
   * Classifica semanticamente a instrução entre as camadas FAST e HEAVY
   */
  public routeTask(task: TaskPayload): IntentAnalysis {
    const text = (task.prompt + " " + (task.context || "")).toLowerCase();
    const tokenEstimate = Math.ceil(text.length / 4);

    let heavyScore = 0;
    let fastScore = 0;

    for (const keyword of SmartRouter.HEAVY_KEYWORDS) {
      if (text.includes(keyword)) {
        heavyScore += 2;
      }
    }

    for (const keyword of SmartRouter.FAST_KEYWORDS) {
      if (text.includes(keyword)) {
        fastScore += 1;
      }
    }

    if (tokenEstimate > 1500) {
      heavyScore += 3;
    }

    if (task.role === "architect" || task.role === "decomposer" || task.role === "auditor") {
      heavyScore += 4;
    }

    const isHeavy = heavyScore >= fastScore && heavyScore > 0;
    const tier: ModelTier = isHeavy ? "heavy" : "fast";
    const targetModel = isHeavy ? "claude-3-7-sonnet" : FAST_MODEL;
    const confidence = Math.min(1.0, 0.65 + Math.abs(heavyScore - fastScore) * 0.08);

    const reasoning = isHeavy
      ? `Requisitos de alta complexidade (score heavy: ${heavyScore}). Roteado para camada HEAVY (${targetModel}).`
      : `Instrução direta/conversacional (score fast: ${fastScore}). Roteado para camada FAST (${targetModel}).`;

    return {
      tier,
      targetModel,
      actualModelUsed: targetModel,
      confidence: parseFloat(confidence.toFixed(2)),
      reasoning,
      estimatedTokens: tokenEstimate,
      fallbackTriggered: false,
    };
  }

  /**
   * Verifica a disponibilidade de chaves BYOK no banco de dados e aplica o fallback inteligente
   */
  public resolveFallback(analysis: IntentAnalysis, keys: AvailableKeys): IntentAnalysis {
    if (analysis.tier === "heavy" && analysis.targetModel.includes("claude")) {
      if (!keys.hasClaudeKey) {
        // Fallback 1: Gemini Pro se houver chave Gemini
        if (keys.hasGeminiKey) {
          return {
            ...analysis,
            actualModelUsed: HEAVY_MODEL,
            fallbackTriggered: true,
            fallbackNotice: "Aviso: Chave Claude ausente no BYOK. Redirecionando tarefa HEAVY para Gemini Pro.",
          };
        }

        // Fallback 2: OmniRoute Local se houver endpoint customizado ou chave OmniRoute
        if (keys.customEndpoint || keys.hasOmniRouteKey) {
          return {
            ...analysis,
            tier: "custom",
            actualModelUsed: "auto",
            fallbackTriggered: true,
            fallbackNotice: "Aviso: Chaves remotas indisponíveis. Redirecionando tarefa para o OmniRoute Local.",
          };
        }

        // Fallback 3: Fallback final para Gemini Flash
        return {
          ...analysis,
          tier: "fast",
          actualModelUsed: FAST_MODEL,
          fallbackTriggered: true,
          fallbackNotice: "Aviso: Nenhuma chave HEAVY cadastrada. Executando via Gemini Flash.",
        };
      }
    }

    if (analysis.tier === "fast" && !keys.hasGeminiKey) {
      if (keys.hasClaudeKey) {
        return {
          ...analysis,
          actualModelUsed: "claude-3-7-sonnet",
          fallbackTriggered: true,
          fallbackNotice: "Chave Gemini não cadastrada. Executando via Claude Sonnet.",
        };
      }
      if (keys.customEndpoint || keys.hasOmniRouteKey) {
        return {
          ...analysis,
          tier: "custom",
          actualModelUsed: "auto",
          fallbackTriggered: true,
          fallbackNotice: "Roteando para OmniRoute Local.",
        };
      }
    }

    return analysis;
  }

  /**
   * Poda de Contexto (Token Guard): Trunca logs repetitivos, stack traces e saídas de terminal
   */
  public pruneContext(text: string, maxTokens: number = 3000): PruneResult {
    const originalTokens = Math.ceil(text.length / 4);

    if (originalTokens <= maxTokens) {
      return {
        prunedText: text,
        originalTokens,
        prunedTokens: originalTokens,
        tokensSaved: 0,
      };
    }

    const lines = text.split("\n");
    if (lines.length <= 40) {
      // Se tiver poucas linhas mas caracteres demais
      const prunedText = text.substring(0, maxTokens * 3) + "\n\n[... Contexto truncado pelo Token Guard ...]";
      const prunedTokens = Math.ceil(prunedText.length / 4);
      return {
        prunedText,
        originalTokens,
        prunedTokens,
        tokensSaved: originalTokens - prunedTokens,
      };
    }

    // Mantém as primeiras 20 linhas (cabeçalho) e as últimas 20 linhas (erros finais)
    const head = lines.slice(0, 20).join("\n");
    const tail = lines.slice(-20).join("\n");
    const omittedLinesCount = lines.length - 40;

    const prunedText = `${head}\n\n[... ${omittedLinesCount} linhas repetitivas removidas pelo Headroom Token Guard ...]\n\n${tail}`;
    const prunedTokens = Math.ceil(prunedText.length / 4);

    return {
      prunedText,
      originalTokens,
      prunedTokens,
      tokensSaved: Math.max(0, originalTokens - prunedTokens),
    };
  }

  /**
   * Tenta chamada direta à API da Groq Cloud
   */
  private async tryGroqDirect(messages: DispatchMessage[], apiKey?: string | null): Promise<DispatchResult | null> {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) return null;
    try {
      const res = await safeFetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        timeoutMs: 15000,
      });
      if (res.ok) {
        lastGroqFailure = "";
        console.log("[ROUTER] Chamada processada com sucesso via Groq Cloud (llama-3.3-70b-versatile).");
        return {
          response: res,
          providerUsed: "groq-fallback",
          badge: "⚡ Groq Cloud (Llama 3.3)",
          tierTag: "groq-fallback",
          modelUsed: "llama-3.3-70b-versatile",
        };
      }
      const errText = await res.text().catch(() => "");
      lastGroqFailure = `HTTP ${res.status}: ${errText.slice(0, 150)}`;
      console.warn(`[ROUTER] Groq Cloud retornou HTTP ${res.status}: ${errText.slice(0, 150)}`);
      return null;
    } catch (err) {
      lastGroqFailure = `Erro de rede: ${String(err).slice(0, 150)}`;
      console.warn(`[ROUTER] Erro de rede ao conectar com Groq Cloud: ${String(err)}`);
      return null;
    }
  }

  /**
   * Tenta chamada direta à API da NVIDIA NIM
   */
  private async tryNvidiaDirect(messages: DispatchMessage[], apiKey?: string | null): Promise<DispatchResult | null> {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) return null;
    try {
      const res = await safeFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.3-70b-instruct",
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        timeoutMs: 15000,
      });
      if (res.ok) {
        lastNvidiaFailure = "";
        console.log("[ROUTER] Chamada processada com sucesso via NVIDIA NIM (meta/llama-3.3-70b-instruct).");
        return {
          response: res,
          providerUsed: "nvidia-fallback",
          badge: "🟢 NVIDIA NIM (Llama 3.3)",
          tierTag: "nvidia-fallback",
          modelUsed: "meta/llama-3.3-70b-instruct",
        };
      }
      const errText = await res.text().catch(() => "");
      lastNvidiaFailure = `HTTP ${res.status}: ${errText.slice(0, 150)}`;
      console.warn(`[ROUTER] NVIDIA NIM retornou HTTP ${res.status}: ${errText.slice(0, 150)}`);
      return null;
    } catch (err) {
      lastNvidiaFailure = `Erro de rede: ${String(err).slice(0, 150)}`;
      console.warn(`[ROUTER] Erro de rede ao conectar com NVIDIA NIM: ${String(err)}`);
      return null;
    }
  }

  /**
   * Tenta chamada direta à API da DeepSeek
   */
  private async tryDeepseekDirect(messages: DispatchMessage[], apiKey?: string | null): Promise<DispatchResult | null> {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) return null;
    try {
      const res = await safeFetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        timeoutMs: 15000,
      });
      if (res.ok) {
        lastDeepseekFailure = "";
        console.log("[ROUTER] Chamada processada com sucesso via DeepSeek API (deepseek-chat).");
        return {
          response: res,
          providerUsed: "deepseek-fallback",
          badge: "🐋 DeepSeek API Direta",
          tierTag: "deepseek-fallback",
          modelUsed: "deepseek-chat",
        };
      }
      const errText = await res.text().catch(() => "");
      lastDeepseekFailure = `HTTP ${res.status}: ${errText.slice(0, 150)}`;
      console.warn(`[ROUTER] DeepSeek API retornou HTTP ${res.status}: ${errText.slice(0, 150)}`);
      return null;
    } catch (err) {
      lastDeepseekFailure = `Erro de rede: ${String(err).slice(0, 150)}`;
      console.warn(`[ROUTER] Erro de rede ao conectar com DeepSeek API: ${String(err)}`);
      return null;
    }
  }

  /**
   * Executa o despacho de chamadas LLM com cascata de fallback silenciosa (Waterfall):
   * 1. Tentativa 1 (Primária): OmniRoute Local Gateway (/v1/chat/completions)
   * 2. Tentativa 2: Groq Cloud API Direta
   * 3. Tentativa 3: NVIDIA NIM API Direta
   * 4. Tentativa 4: DeepSeek API Direta
   * 5. Tentativa 5: Google Gemini Direto
   * 6. Tentativa 6 (Esgotamento): Retorna alerta amigável de cota/serviço indisponível.
   */
  public async dispatchWithFallback(options: DispatchOptions): Promise<DispatchResult> {
    const {
      messages,
      tier = "fast",
      modelOverride,
      geminiKey,
      groqKey,
      nvidiaKey,
      deepseekKey,
      omniRouteUrl,
      omniRouteKey,
      stream = true,
    } = options;

    // Se o usuário selecionou explicitamente um modelo de provedor direto no UI
    if (modelOverride === "groq" && groqKey) {
      const groqRes = await this.tryGroqDirect(messages, groqKey);
      if (groqRes) return groqRes;
    }
    if (modelOverride === "nvidia" && nvidiaKey) {
      const nvidiaRes = await this.tryNvidiaDirect(messages, nvidiaKey);
      if (nvidiaRes) return nvidiaRes;
    }
    if (modelOverride === "deepseek" && deepseekKey) {
      const deepseekRes = await this.tryDeepseekDirect(messages, deepseekKey);
      if (deepseekRes) return deepseekRes;
    }

    const effectiveGeminiKey = resolveEffectiveGeminiKey(geminiKey);

    const effectiveOmniRouteKey =
      (() => {
        try {
          return require("../security/crypto").readSecret(omniRouteKey) as string;
        } catch {
          return "";
        }
      })().trim() ||
      process.env.OMNIROUTE_KEY ||
      process.env.OMNIROUTE_API_KEY ||
      "";

    if (omniRouteKey && /^enc:v\d:/i.test(omniRouteKey.trim())) {
      console.warn("[ROUTER] omniRouteKey recebida CRIPTOGRAFADA (enc:vN:) — use readSecret() antes do dispatch.");
    }

    const autoCascade =
      tier === "heavy"
        ? ["auto/coding:free", "auto/best-coding-fast", "auto/fast", "auto/cheap", "auto/best-free", "auto"]
        : ["auto/best-free", "auto/chat", "auto/fast", "auto/cheap", "auto"];
    const envModels = process.env.OMNIROUTE_MODEL?.trim();
    const fullList = envModels
      ? envModels.split(",").map((s) => s.trim()).filter(Boolean)
      : autoCascade;

    const requestedOmniModels = fullList.filter((m) => !isComboOnCooldown(m));
    if (requestedOmniModels.length === 0 && fullList.length > 0) {
      console.warn("[ROUTER] Todos os combos da cascata em cooldown de cota; tentando o primeiro como última chance.");
      requestedOmniModels.push(fullList[0]);
    }
    const omniMaxTokens = Number(process.env.OMNIROUTE_MAX_TOKENS) || 8192;

    const rawUrl = omniRouteUrl || process.env.OMNIROUTE_URL || "http://localhost:20128/v1";
    const { chatUrl: omniEndpoint } = buildOmniEndpoints(rawUrl);

    const omniConnectTimeoutMs = Number(process.env.OMNIROUTE_TIMEOUT_MS) || 15000;

    // ----------------------------------------------------
    // TENTATIVA 1: OmniRoute Local Gateway (Rota Primária)
    // ----------------------------------------------------
    recordOmniAttempt();
    if (omniCircuitOpen()) {
      lastOmniFailure = "circuit-breaker aberto apos falhas consecutivas (cooldown de 30s)";
      console.warn("[ROUTER] OmniRoute ignorado (circuit-breaker aberto); avançando na cascata BYOK.");
    } else
    for (let omniIdx = 0; omniIdx < requestedOmniModels.length; omniIdx++) {
      const requestedOmniModel = requestedOmniModels[omniIdx];
      let networkDown = false;
      try {
      const omniHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (effectiveOmniRouteKey) {
        omniHeaders["Authorization"] = `Bearer ${effectiveOmniRouteKey}`;
      }

      const omniBody = JSON.stringify({
        model: requestedOmniModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream,
        max_tokens: omniMaxTokens,
      });

      const omniStart = Date.now();
      const omniRes = await safeFetch(omniEndpoint, {
        method: "POST",
        headers: omniHeaders,
        body: omniBody,
        timeoutMs: omniConnectTimeoutMs,
      }).catch((err) => {
        networkDown = true;
        omniRecordFailure();
        lastOmniFailure = `falha de rede em ${omniEndpoint}: ${String(err).slice(0, 160)}`;
        console.warn(
          `[ROUTER] OmniRoute inacessível em ${omniEndpoint} (${Date.now() - omniStart}ms): ${String(err)}`
        );
        return null;
      });

      if (omniRes && omniRes.ok) {
        omniRecordSuccess();
        recordOmniSuccess(Date.now() - omniStart);

        const idleMs = Number(process.env.OMNIROUTE_IDLE_TIMEOUT_MS) || 45000;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let streamBroken = false;
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            streamBroken = true;
            try {
              omniRes.body?.cancel().catch(() => {});
            } catch {
              /* body já fechado */
            }
          }, idleMs);
        };
        resetIdle();

        if (omniRes.body) {
          const guarded = omniRes.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                resetIdle();
                controller.enqueue(chunk);
              },
              flush() {
                if (idleTimer) clearTimeout(idleTimer);
              },
            })
          );
          console.log(`[ROUTER] Chamada processada via OmniRoute Local (${requestedOmniModel}).`);
          return {
            response: new Response(guarded, { status: omniRes.status, headers: omniRes.headers }),
            providerUsed: "omniroute",
            badge: "🤖 OmniRoute Local",
            tierTag: "omniroute",
            modelUsed: requestedOmniModel,
          };
        } else {
          if (idleTimer) clearTimeout(idleTimer);
          console.log(`[ROUTER] Chamada processada via OmniRoute Local (${requestedOmniModel}).`);
          return {
            response: omniRes,
            providerUsed: "omniroute",
            badge: "🤖 OmniRoute Local",
            tierTag: "omniroute",
            modelUsed: requestedOmniModel,
          };
        }
      } else if (omniRes) {
        if (omniRes.status >= 500) omniRecordFailure();
        const errText = await omniRes.text().catch(() => "");
        const quotaHit = omniRes.status === 402 || omniRes.status === 429;
        if (quotaHit) markComboExhausted(requestedOmniModel, omniRes.status);
        lastOmniFailure = quotaHit
          ? `HTTP ${omniRes.status} (cotas/créditos esgotados no combo do gateway): ${errText.slice(0, 160)}`
          : `HTTP ${omniRes.status} em ${omniEndpoint}: ${errText.slice(0, 160)}`;
        console.warn(
          `[ROUTER] OmniRoute HTTP ${omniRes.status} no modelo "${requestedOmniModel}" (${Date.now() - omniStart}ms). ` +
            (quotaHit && omniIdx < requestedOmniModels.length - 1
              ? `tentando próximo combo da cascata: "${requestedOmniModels[omniIdx + 1]}"`
              : `Resposta: ${errText.substring(0, 200)}`)
        );
      }
      if (networkDown) break;
    } catch (omniErr) {
      omniRecordFailure();
      lastOmniFailure = `exceção na tentativa OmniRoute: ${String(omniErr).slice(0, 160)}`;
      console.warn(`[ROUTER] OmniRoute indisponível ou em erro: (${String(omniErr)})`);
      break;
    }
    }

    // ----------------------------------------------------
    // TENTATIVA 2: Fallback — Groq Cloud API Direta
    // ----------------------------------------------------
    if (groqKey) {
      const groqRes = await this.tryGroqDirect(messages, groqKey);
      if (groqRes) return groqRes;
    }

    // ----------------------------------------------------
    // TENTATIVA 3: Fallback — NVIDIA NIM API Direta
    // ----------------------------------------------------
    if (nvidiaKey) {
      const nvidiaRes = await this.tryNvidiaDirect(messages, nvidiaKey);
      if (nvidiaRes) return nvidiaRes;
    }

    // ----------------------------------------------------
    // TENTATIVA 4: Fallback — DeepSeek API Direta
    // ----------------------------------------------------
    if (deepseekKey) {
      const deepseekRes = await this.tryDeepseekDirect(messages, deepseekKey);
      if (deepseekRes) return deepseekRes;
    }

    // ----------------------------------------------------
    // TENTATIVA 5: Fallback — Google Gemini Direto
    // ----------------------------------------------------
    if (effectiveGeminiKey) {
      recordGeminiFallback();
      const cleanApiKey = effectiveGeminiKey.trim();

      const { getAvailableGeminiModels } = require("./gemini-client");
      const candidateModels: string[] = await getAvailableGeminiModels(cleanApiKey);

      for (const modelId of candidateModels) {
        try {
          const cleanModel = modelId.replace(/^models\//, "");
          const geminiUrl = stream
            ? `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse&key=${cleanApiKey}`
            : `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${cleanApiKey}`;

          const geminiBody = JSON.stringify({
            contents: messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: { temperature: 0.7 },
          });

          let geminiRes = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: geminiBody,
            signal: AbortSignal.timeout(20000),
          });

          if (geminiRes.status === 503 || geminiRes.status === 429) {
            console.warn(`[ROUTER] Gemini Direto (${cleanModel}) retornou HTTP ${geminiRes.status} (pico de demanda). Re-tentando em 1.2s...`);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            geminiRes = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: geminiBody,
              signal: AbortSignal.timeout(20000),
            });
          }

          if (geminiRes.ok) {
            lastGeminiFailure = "";
            console.log(`[ROUTER] Chamada processada com sucesso via Gemini Direto (${cleanModel}).`);
            return {
              response: geminiRes,
              providerUsed: "gemini-fallback",
              badge: "⚡ Gemini Flash (Fallback Automático)",
              tierTag: "fast-fallback",
              modelUsed: cleanModel,
            };
          } else {
            const errData = await geminiRes.json().catch(() => ({}));
            lastGeminiFailure = `${cleanModel}: HTTP ${geminiRes.status} — ${(errData as { error?: { message?: string } }).error?.message || "sem detalhe"}`.slice(0, 200);
            console.warn(
              `[ROUTER] Gemini Direto (${cleanModel}) retornou erro: ${(errData as { error?: { message?: string } }).error?.message || geminiRes.status}`
            );
            if (geminiRes.status === 401 || geminiRes.status === 403) break;
          }
        } catch (geminiErr) {
          lastGeminiFailure = `${modelId}: erro de rede ${String(geminiErr).slice(0, 120)}`;
          console.warn(`[ROUTER] Erro de rede ao conectar com Gemini Direto (${modelId}):`, geminiErr);
        }
      }
    } else {
      lastGeminiFailure = "nenhuma chave Gemini disponivel (readSecret vazio ou NEXTCODE_MASTER_KEY incorreta)";
    }

    // ----------------------------------------------------
    // TENTATIVA 6: Esgotamento de Cotas / Provedores
    // ----------------------------------------------------
    const alertText =
      "⚠️ **Cotas e Serviços Indisponíveis:** Não foi possível obter resposta de nenhum dos provedores configurados (OmniRoute Local, Groq Cloud, NVIDIA NIM, DeepSeek ou Gemini Direto). Verifique se o OmniRoute está em execução na porta 20128 ou regularize suas chaves em **Configurações > BYOK**." +
      buildDispatchDiagnostics();

    let fallbackResponse: Response;

    if (stream) {
      const encoder = new TextEncoder();
      const sseFormatted = `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: alertText }],
            },
          },
        ],
      })}\n\n`;

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseFormatted));
          controller.close();
        },
      });

      fallbackResponse = new Response(readable, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    } else {
      fallbackResponse = new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: alertText }] },
            },
          ],
          choices: [
            {
              message: { content: alertText },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    recordExhausted();
    return {
      response: fallbackResponse,
      providerUsed: "none",
      badge: "🚫 Sem Provedor Disponível",
      tierTag: "exhausted",
      modelUsed: "none",
    };
  }
}

