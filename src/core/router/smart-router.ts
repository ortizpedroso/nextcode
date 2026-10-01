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
let lastGeminiFailure = "";
function buildDispatchDiagnostics(): string {
  const parts: string[] = [];
  if (lastOmniFailure) parts.push(`OmniRoute: ${lastOmniFailure}`);
  if (lastGeminiFailure) parts.push(`Gemini: ${lastGeminiFailure}`);
  if (!parts.length) parts.push("nenhuma tentativa registrada (circuit-breaker aberto?)");
  return `\n\n🔎 _Diagnóstico da última tentativa — ${parts.join(" | ")}_`;
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
  geminiKey?: string | null;
  omniRouteUrl?: string | null;
  omniRouteKey?: string | null;
  stream?: boolean;
}

export interface DispatchResult {
  response: Response;
  providerUsed: "omniroute" | "gemini-fallback" | "none";
  badge: string;
  tierTag: "omniroute" | "fast-fallback" | "fast" | "heavy" | "exhausted";
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
   * Executa o despacho de chamadas LLM com cascata de fallback silenciosa (Waterfall):
   * 1. Tentativa 1 (Primária): OmniRoute Local Gateway (/v1/chat/completions, OpenAI-compatível)
   * 2. Tentativa 2 (Fallback): Google Gemini Direto (streamGenerateContent/generateContent)
   * 3. Tentativa 3 (Esgotamento): Retorna alerta amigável de cota/serviço indisponível.
   */
  public async dispatchWithFallback(options: DispatchOptions): Promise<DispatchResult> {
    const {
      messages,
      tier = "fast",
      geminiKey,
      omniRouteUrl,
      omniRouteKey,
      stream = true,
    } = options;

    // FIX DEFINITIVO (single source of truth): a chave que o dispatcher usa passa SEMPRE
    // por readSecret() aqui — mesmo que um caller esqueça de descriptografar e mande o
    // blob "enc:v1:" cru (foi exatamente assim que o chat enviava literalmente
    // "Authorization: Bearer enc:v1:..." ao gateway, gerando HTTP 401/4xx enquanto a UI
    // ficava verde). readSecret é idempotente: texto-plano passa intacto.
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
    // FIX (defesa em profundidade): se um caller esquecer de descriptografar e passar o
    // blob "enc:v1:...", ele NUNCA vai para a rede — cai no env/placeholder com aviso.
    if (omniRouteKey && /^enc:v\d:/i.test(omniRouteKey.trim())) {
      console.warn("[ROUTER] omniRouteKey recebida CRIPTOGRAFADA (enc:vN:) — use readSecret() antes do dispatch.");
    }

    // FIX (OmniRoute "nunca funcionava"): o modelo autocriado anteriormente era
    // "omniroute-" + "auto" (id inexistente), que NÃO consta no catálogo do OmniRoute —
    // qualquer client que envia esse model recebe erro de modelo desconhecido e cai no
    // fallback, dando a impressão de que o gateway "não funciona". O nome oficial do roteador
    // zero-config é "auto" (ou variantes "auto/fast", "auto/coding", "auto/cheap"),
    // que monta um combo virtual com os 350+ provedores conectados (docs: README
    // "Zero-config — just use `auto`" e docs/routing/AUTO-COMBO.md).
    // FIX (papel do OmniRoute): o gateway DEVE fazer o failover silencioso de provedor em
    // provedor. Antes pedíamos a variante premium do combo ("auto/coding", "auto/smart"),
    // que nos planos gratuitos estoura créditos e derruba o combo inteiro com HTTP 402 —
    // obrigando o NextCode a cair no fallback Gemini e exibindo "Cotas Indisponíveis".
    // Agora: variantes gratuitas por padrão + max_tokens limitado (o erro real do gateway
    // era literalmente "requested up to 131072 tokens, but can only ...").
    // FIX (papel do OmniRoute — não depender de um único provedor): o gateway possui
    // dezenas de combos "auto/*" que varrem TODOS os backends conectados (OpenRouter,
    // Kiro, Pollinations, Ollama, Gemini free, etc.), não apenas OpenRouter. Pedir só
    // "auto/best-free" travava o roteamento num único combo; se a cota dele esgotava
    // (HTTP 402), o NextCode derrubava tudo para o fallback Gemini. Agora montamos uma
    // CASCATA de variantes e tentamos cada uma em ordem: o gateway pula de provedor em
    // provedor silenciosamente até algum backend gratuito responder.
    const autoCascade =
      tier === "heavy"
        ? ["auto/coding:free", "auto/best-coding-fast", "auto/fast", "auto/cheap", "auto/best-free", "auto"]
        : ["auto/best-free", "auto/chat", "auto/fast", "auto/cheap", "auto"];
    const envModels = process.env.OMNIROUTE_MODEL?.trim();
    const fullList = envModels
      ? envModels.split(",").map((s) => s.trim()).filter(Boolean)
      : autoCascade;
    // FIX (Fase 12 — failover silencioso de cota): combos em cooldown por 402/429
    // são pulados até o reset dos free tiers. Se TODOS estiverem em cooldown,
    // usamos a lista completa mesmo assim (última chance antes do fallback Gemini).
    const requestedOmniModels = fullList.filter((m) => !isComboOnCooldown(m));
    if (requestedOmniModels.length === 0 && fullList.length > 0) {
      console.warn("[ROUTER] Todos os combos da cascata em cooldown de cota; tentando o primeiro como última chance.");
      requestedOmniModels.push(fullList[0]);
    }
    const omniMaxTokens = Number(process.env.OMNIROUTE_MAX_TOKENS) || 8192;

    const rawUrl = omniRouteUrl || process.env.OMNIROUTE_URL || "http://localhost:20128/v1";
    const { chatUrl: omniEndpoint } = buildOmniEndpoints(rawUrl);

    // Timeout de conexão do OmniRoute: o suficiente para detectar "porta fechada"
    // rapidamente, mas realista para respostas de streaming de LLM (que demoram >1.2s).
    const omniConnectTimeoutMs = Number(process.env.OMNIROUTE_TIMEOUT_MS) || 15000;

    // ----------------------------------------------------
    // TENTATIVA 1: OmniRoute Local Gateway (Rota Primária)
    // ----------------------------------------------------
    recordOmniAttempt();
    if (omniCircuitOpen()) {
      lastOmniFailure = "circuit-breaker aberto apos falhas consecutivas (cooldown de 30s)";
      console.warn("[ROUTER] OmniRoute ignorado (circuit-breaker aberto); indo direto para o fallback Gemini.");
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
        // FIX (HTTP 402 "requires more credits"): sem max_tokens o gateway reservava o
        // teto do modelo (131072 tokens), que excede o saldo de planos gratuitos e fazia
        // TODA a cascata de provedores falhar antes mesmo de tentar. Limitamos a reserva.
        max_tokens: omniMaxTokens,
      });

      const omniStart = Date.now();
      const omniRes = await safeFetch(omniEndpoint, {
        method: "POST",
        headers: omniHeaders,
        body: omniBody,
        // O sinal cobre apenas o establishment da conexão; após 200 OK o stream
        // segue vivo mesmo depois do timeout em Node >= 18.
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
        // FIX ("cai no meio da conversa"): o AbortSignal.timeout cobre apenas o handshake.
        // Se o gateway morrer/entrar em OOM durante o streaming, o body hangava para sempre.
        // Agora impomos um idle-timeout: se nenhum byte chegar por OMNIROUTE_IDLE_TIMEOUT_MS,
        // o stream é abortado e a requisição recai na cascata de fallback (Gemini direto).
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
        // FIX (failover silencioso do gateway): 402/429 NÃO são queda do OmniRoute — o
        // gateway está vivo e respondendo; quem falhou foi a cota do combo. Não devem
        // acionar circuit-breaker nem derrubar o card verde; apenas registrar diagnóstico.
        if (omniRes.status >= 500) omniRecordFailure();
        const errText = await omniRes.text().catch(() => "");
        const quotaHit = omniRes.status === 402 || omniRes.status === 429;
        // FIX (Fase 12): registra cooldown do COMBO esgotado — a próxima mensagem
        // já pula direto para o próximo combo da cascata, sem repetir o 402.
        if (quotaHit) markComboExhausted(requestedOmniModel, omniRes.status);
        lastOmniFailure = quotaHit
          ? `HTTP ${omniRes.status} (cotas/créditos esgotados no combo atual do gateway — adicione créditos ou ajuste OMNIROUTE_MODEL): ${errText.slice(0, 160)}`
          : `HTTP ${omniRes.status} em ${omniEndpoint}: ${errText.slice(0, 160)}`;
        console.warn(
          `[ROUTER] OmniRoute HTTP ${omniRes.status} no modelo "${requestedOmniModel}" (${Date.now() - omniStart}ms). ` +
            (quotaHit && omniIdx < requestedOmniModels.length - 1
              ? `tentando próximo combo da cascata: "${requestedOmniModels[omniIdx + 1]}"`
              : `Resposta: ${errText.substring(0, 200)}`)
        );
      }
      // Rede fora (porta fechada/timeout): não adianta tentar os próximos combos — aborta a cascata.
      if (networkDown) break;
    } catch (omniErr) {
      omniRecordFailure();
      lastOmniFailure = `exceção na tentativa OmniRoute: ${String(omniErr).slice(0, 160)}`;
      console.warn(`[ROUTER] OmniRoute indisponível ou em erro: (${String(omniErr)})`);
      break; // exceção de transporte: mesma lógica — não insistir nos próximos combos
    }
    }

    // ----------------------------------------------------
    // TENTATIVA 2: Fallback — Google Gemini Direto
    // ----------------------------------------------------
    if (effectiveGeminiKey) {
      recordGeminiFallback();
      const cleanApiKey = effectiveGeminiKey.trim();

      // FIX DEFINITIVO ("chave valida mas da erro"): a UI de provedores valida a chave
      // contra o endpoint /v1beta/models (listModels), que aceita QUALQUER chave Google
      // válida. Ja o chat chama modelos ESPECIFICOS por ID — se a chave nao tiver acesso
      // aquele modelo (free tier sem 2.5, projeto GCP sem API habilitada, restricao
      // regional), todos os IDs falham com 404/PERMISSION_DENIED e o usuario ve "erro"
      // mesmo com a chave verde. Agora descobrimos os IDs realmente acessiveis pela lista
      // de models (mesma fonte do teste verde) e usamos apenas candidatos suportados.
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

          // FIX (picos de demanda HTTP 503 / 429): picos temporários na infraestrutura do Gemini
          // são comuns na tier gratuita; se retornar 503/429, aguarda 1.2s e re-tenta uma vez
          // antes de desistir do modelo.
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
            // 401/403 = chave inválida: testar outros modelos é inútil, aborta a lista.
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
    // TENTATIVA 3: Esgotamento de Cotas / Provedores
    // ----------------------------------------------------
    // FIX (diagnóstico): o alerta genérico não dizia POR QUE cada rota falhou —
    // agora anexamos as últimas razões reais capturadas nas tentativas 1 e 2
    // (HTTP status/erro de rede do OmniRoute + último erro do Gemini).
    const alertText =
      "⚠️ **Cotas e Serviços Indisponíveis:** Não foi possível comunicar com o OmniRoute Local nem com a API direta do Gemini. Por favor, verifique se o OmniRoute está em execução na porta 20128 ou valide sua chave API em **Configurações > BYOK**." +
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
      // Nenhum provedor real respondeu: rotular como "gemini-direct"/"fast-fallback"
      // era uma inconsistência (o cliente recebia o alerta como se fosse resposta de IA).
      providerUsed: "none",
      badge: "🚫 Sem Provedor Disponível",
      tierTag: "exhausted",
      modelUsed: "none",
    };
  }
}

