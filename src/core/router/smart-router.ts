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

export function resolveOmniRouteUrl(rawUrl?: string): string {
  const base = rawUrl || process.env.OMNIROUTE_URL || "http://localhost:20128/v1";

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

export const FAST_MODEL = "gemini-3.5-flash";
export const HEAVY_MODEL = "gemini-3.7-flash";


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

    const effectiveGeminiKey =
      (geminiKey && geminiKey.trim()) ||
      process.env.GEMINI_API_KEY ||
      process.env.GEMINI_KEY ||
      process.env.GOOGLE_API_KEY ||
      "";

    const effectiveOmniRouteKey =
      (omniRouteKey && omniRouteKey.trim()) ||
      process.env.OMNIROUTE_KEY ||
      process.env.OMNIROUTE_API_KEY ||
      "";

    // FIX (OmniRoute "nunca funcionava"): o modelo autocriado anteriormente era
    // "omniroute-" + "auto" (id inexistente), que NÃO consta no catálogo do OmniRoute —
    // qualquer client que envia esse model recebe erro de modelo desconhecido e cai no
    // fallback, dando a impressão de que o gateway "não funciona". O nome oficial do roteador
    // zero-config é "auto" (ou variantes "auto/fast", "auto/coding", "auto/cheap"),
    // que monta um combo virtual com os 350+ provedores conectados (docs: README
    // "Zero-config — just use `auto`" e docs/routing/AUTO-COMBO.md).
    const tierAutoVariant =
      tier === "heavy" ? "auto/coding" : tier === "custom" ? "auto/smart" : "auto";
    const requestedOmniModel = process.env.OMNIROUTE_MODEL?.trim() || tierAutoVariant;

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
      console.warn("[ROUTER] OmniRoute ignorado (circuit-breaker aberto); indo direto para o fallback Gemini.");
    } else
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
        omniRecordFailure();
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
        if (omniRes.status >= 500) omniRecordFailure();
        const errText = await omniRes.text().catch(() => "");
        console.warn(
          `[ROUTER] OmniRoute retornou HTTP ${omniRes.status} em ${omniEndpoint}. Resposta: ${errText.substring(0, 200)}`
        );
      }
    } catch (omniErr) {
      omniRecordFailure();
      console.warn(`[ROUTER] OmniRoute indisponível ou em erro: (${String(omniErr)})`);
    }

    // ----------------------------------------------------
    // TENTATIVA 2: Fallback — Google Gemini Direto
    // ----------------------------------------------------
    if (effectiveGeminiKey) {
      recordGeminiFallback();
      const cleanApiKey = effectiveGeminiKey.trim();
      // Ordem coerente: modelos reais primeiro; nunca pedir "lite/latest" para uma tarefa heavy.
      const candidateModels =
        tier === "heavy"
          ? [HEAVY_MODEL, FAST_MODEL, "gemini-flash-latest"]
          : [FAST_MODEL, "gemini-3.5-flash-lite", "gemini-flash-latest"];

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

          const geminiRes = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: geminiBody,
            signal: AbortSignal.timeout(8000),
          });

          if (geminiRes.ok) {
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
            console.warn(
              `[ROUTER] Gemini Direto (${cleanModel}) retornou erro: ${errData.error?.message || geminiRes.status}`
            );
            // 401/403 = chave inválida: testar outros modelos é inútil, aborta a lista.
            if (geminiRes.status === 401 || geminiRes.status === 403) break;
          }
        } catch (geminiErr) {
          console.warn(`[ROUTER] Erro de rede ao conectar com Gemini Direto (${modelId}):`, geminiErr);
        }
      }
    }

    // ----------------------------------------------------
    // TENTATIVA 3: Esgotamento de Cotas / Provedores
    // ----------------------------------------------------
    const alertText =
      "⚠️ **Cotas e Serviços Indisponíveis:** Não foi possível comunicar com o OmniRoute Local nem com a API direta do Gemini. Por favor, verifique se o OmniRoute está em execução na porta 20128 ou valide sua chave API em **Configurações > BYOK**.";

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

