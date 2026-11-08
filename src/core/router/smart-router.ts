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
  customEndpoint?: string | null;
}

export interface PruneResult {
  prunedText: string;
  originalTokens: number;
  prunedTokens: number;
  tokensSaved: number;
}

import { safeFetch } from "../security/safe-fetch";
import { readSecret, isEncrypted } from "../security/crypto";
import { getAvailableGeminiModels } from "./gemini-client";
import { TelemetryLogger } from "../telemetry/telemetry-logger";
import {
  loadGatewayConfigs,
  modelForTier,
  callGateway,
  GATEWAY_DEFAULTS,
  type GatewayConfig,
  type GatewayFailureKind,
} from "../llm/gateways";
import { extractAssistantTextFromCompletion } from "../llm/chat-completion-text";

// FIX (chave Gemini válida dando erro 404): os IDs "gemini-3.5-flash"/"gemini-3.7-flash"
// NÃO existem na API v1beta do Google — qualquer requisição com eles retorna
// "404 NOT_FOUND: Model not found", o que parecia erro de chave. Agora usamos IDs
// reais da API, e a cascata de candidatos abaixo cobre variantes oficiais em ordem
// de preferência; um 404/400 avança para o próximo candidato em vez de derrubar tudo.
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-flash-latest";
export const HEAVY_MODEL = process.env.GEMINI_HEAVY_MODEL || "gemini-1.5-pro";

// FIX (diagnóstico): guarda a última razão de falha de cada rota para embutir no
// alerta de esgotamento — sem isso, UI verde + chat quebrado ficava indepurável.
let lastGatewayFailure = "";
let lastGroqFailure = "";
let lastNvidiaFailure = "";
let lastDeepseekFailure = "";
let lastGeminiFailure = "";

function buildDispatchDiagnostics(): string {
  const parts: string[] = [];
  if (lastGatewayFailure) parts.push(lastGatewayFailure);
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
    // Quem chama costuma já passar a chave aberta: só descriptografa se vier cifrada (evita o
    // falso alarme "chave legada em texto plano" a cada chamada).
    const plain = isEncrypted(storedGeminiKey) ? readSecret(storedGeminiKey) : storedGeminiKey || "";
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
  stream?: boolean;
  /**
   * C5 — sinal de abort real (ex.: AbortSignal.timeout do guard da DAG).
   * Quando informado, cancela ativamente os fetches dos provedores em vez de
   * apenas "esquecer" a promise via Promise.race (timeout decorativo).
   */
  signal?: AbortSignal;
  /** Gateways LLM em ordem (testes/diagnóstico). Omitido = lidos do banco (LlmGateway). */
  gateways?: GatewayConfig[];
  /** Teto de tokens da resposta nos gateways (padrão LLM_GATEWAY_MAX_TOKENS ou 8192). */
  maxTokens?: number;
  /** Papéis críticos: só aceita resposta cujo X-Routed-Via comece com um destes prefixos. */
  allowedRoutedViaPrefixes?: string[];
  /** Tempo máximo de cada chamada aos gateways (padrão do `callGateway`: 120 s). A2.3b: o analista precisa de mais. */
  gatewayTimeoutMs?: number;
  /** F10: sessão que pediu a chamada — a falha do gateway fica na trilha dela (o worker lê o erro certo). */
  sessionId?: string;
  /** Papéis com laudo JSON (conferente): pede json_object nos gateways compatíveis. */
  responseFormat?: import("@/core/llm/gateways").LlmResponseFormat;
}

export interface DispatchResult {
  response: Response;
  providerUsed: "freellmapi" | "deepseek" | "groq-fallback" | "nvidia-fallback" | "deepseek-fallback" | "gemini-fallback" | "none";
  badge: string;
  tierTag: "freellmapi" | "deepseek" | "groq-fallback" | "nvidia-fallback" | "deepseek-fallback" | "fast-fallback" | "fast" | "heavy" | "exhausted";
  modelUsed: string;
}


// ---------------------------------------------------------------------------
// Fase 6 — Métricas leves do dispatcher (in-memory, expostas via GET /api/metrics)
// ---------------------------------------------------------------------------
export interface RouterMetrics {
  geminiFallbacks: number;
  exhausted: number;
}
const metrics: RouterMetrics = {
  geminiFallbacks: 0,
  exhausted: 0,
};
export function getRouterMetrics(): RouterMetrics {
  return { ...metrics };
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
   * Classificador REAL de complexidade: uma chamada curta ao modelo FAST (o mais barato já
   * configurado) pedindo um veredito fast/heavy com base no SIGNIFICADO do pedido — não em
   * substring matching. Custo marginal = 1 chamada barata; nunca usa o modelo HEAVY para
   * classificar (isso anularia a economia que o próprio tiering existe para gerar).
   * Retorna null em qualquer falha/timeout/resposta não-parseável, para que o chamador caia
   * de volta no heurístico sem quebrar o fluxo principal do chat.
   */
  public async classifyComplexity(
    task: TaskPayload,
    dispatchConfig: Omit<DispatchOptions, "messages" | "tier" | "stream" | "modelOverride">
  ): Promise<{ tier: ModelTier; reasoning: string } | null> {
    const classifierMessages: DispatchMessage[] = [
      {
        role: "system",
        content:
          'Você é um classificador de complexidade de tarefas de engenharia de software. ' +
          'Responda SOMENTE com um JSON de uma linha, sem markdown e sem texto extra, no formato ' +
          'exato: {"tier":"fast"|"heavy","reasoning":"motivo em até 15 palavras"}. ' +
          '"heavy" = exige raciocínio arquitetural, múltiplos arquivos/módulos, segurança, ' +
          'migração de schema/dados ou lógica não-trivial. ' +
          '"fast" = pergunta direta, ajuste pontual, formatação, explicação ou conversa.',
      },
      { role: "user", content: task.prompt.slice(0, 4000) },
    ];

    try {
      const dispatchRes = await this.dispatchWithFallback({
        ...dispatchConfig,
        messages: classifierMessages,
        tier: "fast",
        stream: false,
        signal: AbortSignal.timeout(8000),
      });
      const json = await dispatchRes.response.json().catch(() => null);
      const raw: string =
        json?.choices?.[0]?.message?.content ??
        json?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";
      const match = raw.match(/\{[^{}]*"tier"\s*:\s*"(fast|heavy)"[^{}]*\}/i);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (parsed.tier !== "fast" && parsed.tier !== "heavy") return null;
      return { tier: parsed.tier, reasoning: String(parsed.reasoning || "").slice(0, 200) };
    } catch {
      return null;
    }
  }

  /**
   * Classificador de elegibilidade para a Telemetria "graphify": decide, via LLM barato (mesmo
   * padrão de classifyComplexity), se o pedido do usuário se beneficiaria de consultar/construir
   * um grafo de conhecimento do projeto (arquitetura, dependências entre arquivos, módulos
   * centrais, visão geral de base grande/desconhecida) — em vez de um heurístico de palavras-chave,
   * que erraria tanto em falsos positivos ("grafo" mencionado sem intenção estrutural) quanto em
   * negativos (pedidos de arquitetura sem a palavra "grafo"). Retorna null em qualquer falha, para
   * que o chamador simplesmente não exiba a sugestão em vez de quebrar o fluxo do chat.
   */
  public async classifyGraphifyEligibility(
    task: TaskPayload,
    dispatchConfig: Omit<DispatchOptions, "messages" | "tier" | "stream" | "modelOverride">
  ): Promise<{ eligible: boolean; reasoning: string } | null> {
    const classifierMessages: DispatchMessage[] = [
      {
        role: "system",
        content:
          'Você decide se uma ferramenta chamada "graphify" ajudaria a responder o pedido do usuário. ' +
          'O graphify constrói um grafo de conhecimento do código-fonte do projeto (dependências entre ' +
          'arquivos/módulos, comunidades, módulos centrais "god nodes"). Responda SOMENTE com um JSON de ' +
          'uma linha, sem markdown e sem texto extra, no formato exato: ' +
          '{"eligible":true|false,"reasoning":"motivo em até 15 palavras"}. ' +
          '"eligible":true = o pedido pede visão geral de arquitetura, mapear dependências/módulos, ' +
          'entender uma base de código grande/desconhecida, ou identificar módulos muito acoplados antes ' +
          'de uma refatoração ampla. "eligible":false = pergunta pontual sobre um arquivo específico, ' +
          'pedido de implementação direta, conversa geral, ou qualquer coisa que não exija mapear a base inteira.',
      },
      { role: "user", content: task.prompt.slice(0, 4000) },
    ];

    try {
      const dispatchRes = await this.dispatchWithFallback({
        ...dispatchConfig,
        messages: classifierMessages,
        tier: "fast",
        stream: false,
        signal: AbortSignal.timeout(8000),
      });
      const json = await dispatchRes.response.json().catch(() => null);
      const raw: string =
        json?.choices?.[0]?.message?.content ??
        json?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";
      const match = raw.match(/\{[^{}]*"eligible"\s*:\s*(true|false)[^{}]*\}/i);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.eligible !== "boolean") return null;
      return { eligible: parsed.eligible, reasoning: String(parsed.reasoning || "").slice(0, 200) };
    } catch {
      return null;
    }
  }

  /**
   * Roteamento por complexidade real (Opção A da revisão arquitetural): usa o heurístico de
   * palavras-chave apenas como baseline/fallback barato, e tenta sobrepor um veredito real do
   * classificador LLM. Toda decisão (heurística, LLM, concordância/divergência, latência) é
   * registrada via TelemetryLogger — essa é a telemetria-base para, no futuro, treinar um
   * roteador aprendido (Opção C) a partir de dados reais em vez de heurística ou só um LLM.
   * Mensagens triviais (<15 tokens estimados) pulam a chamada extra: o ganho de precisão não
   * compensa gastar uma chamada de rede num "oi"/"ok".
   */
  public async routeTaskSmart(
    task: TaskPayload,
    dispatchConfig: Omit<DispatchOptions, "messages" | "tier" | "stream" | "modelOverride">,
    sessionId?: string
  ): Promise<IntentAnalysis & { classifiedBy: "heuristic_trivial" | "heuristic_fallback" | "llm" }> {
    const heuristic = this.routeTask(task);

    if (heuristic.estimatedTokens < 15) {
      TelemetryLogger.log({
        sessionId,
        action: "router.complexity_decision",
        details: {
          method: "heuristic_trivial",
          heuristicTier: heuristic.tier,
          finalTier: heuristic.tier,
          estimatedTokens: heuristic.estimatedTokens,
        },
      });
      return { ...heuristic, classifiedBy: "heuristic_trivial" };
    }

    const startedAt = Date.now();
    const llmResult = await this.classifyComplexity(task, dispatchConfig).catch(() => null);
    const latencyMs = Date.now() - startedAt;

    if (!llmResult) {
      TelemetryLogger.log({
        sessionId,
        action: "router.complexity_decision",
        details: {
          method: "heuristic_fallback",
          heuristicTier: heuristic.tier,
          finalTier: heuristic.tier,
          estimatedTokens: heuristic.estimatedTokens,
          latencyMs,
        },
        durationMs: latencyMs,
      });
      return { ...heuristic, classifiedBy: "heuristic_fallback" };
    }

    const finalTier = llmResult.tier;
    const agree = finalTier === heuristic.tier;
    const targetModel = finalTier === "heavy" ? "claude-3-7-sonnet" : FAST_MODEL;

    TelemetryLogger.log({
      sessionId,
      action: "router.complexity_decision",
      details: {
        method: "llm",
        heuristicTier: heuristic.tier,
        llmTier: finalTier,
        finalTier,
        agree,
        llmReasoning: llmResult.reasoning,
        estimatedTokens: heuristic.estimatedTokens,
        latencyMs,
      },
      durationMs: latencyMs,
    });

    return {
      ...heuristic,
      tier: finalTier,
      targetModel,
      actualModelUsed: targetModel,
      reasoning: `${llmResult.reasoning} (classificador LLM; heurística sugeria "${heuristic.tier}", ${agree ? "concordância" : "divergência"})`,
      classifiedBy: "llm",
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

        // Fallback 2: Fallback final para Gemini Flash
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
  private async tryGroqDirect(messages: DispatchMessage[], apiKey?: string | null, signal?: AbortSignal): Promise<DispatchResult | null> {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) return null;
    try {
      const res = await safeFetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cleanKey}`,
        },
        signal,
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
  private async tryNvidiaDirect(messages: DispatchMessage[], apiKey?: string | null, signal?: AbortSignal): Promise<DispatchResult | null> {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) return null;
    try {
      const res = await safeFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cleanKey}`,
        },
        signal,
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
  private async tryDeepseekDirect(messages: DispatchMessage[], apiKey?: string | null, signal?: AbortSignal): Promise<DispatchResult | null> {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) return null;
    try {
      const res = await safeFetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cleanKey}`,
        },
        signal,
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
   * Gateway compatível com OpenAI que já faz roteamento/fallback/cota entre provedores
   * (FreeLLMAPI). Uma chamada; falha classificada vai para o diagnóstico e o próximo gateway.
   */
  private async tryOpenAiGateway(
    gw: GatewayConfig,
    messages: DispatchMessage[],
    tier: ModelTier,
    stream: boolean,
    signal?: AbortSignal,
    maxTokens?: number,
    allowedRoutedViaPrefixes?: string[],
    timeoutMs?: number,
    sessionId?: string,
    responseFormat?: import("@/core/llm/gateways").LlmResponseFormat
  ): Promise<DispatchResult | { failedKind: GatewayFailureKind }> {
    const label = GATEWAY_DEFAULTS[gw.id].label;
    const model = modelForTier(gw, tier) || "auto";
    const attempt = await callGateway(gw, {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      model,
      stream,
      signal,
      maxTokens: maxTokens || Number(process.env.LLM_GATEWAY_MAX_TOKENS) || 8192,
      timeoutMs,
      responseFormat,
    });
    if (attempt.ok) {
      if (
        allowedRoutedViaPrefixes &&
        allowedRoutedViaPrefixes.length > 0 &&
        !allowedRoutedViaPrefixes.some((p) => attempt.servedBy.toLowerCase().startsWith(p.toLowerCase()))
      ) {
        if (attempt.response.body) await attempt.response.body.cancel().catch(() => {});
        TelemetryLogger.log({
          sessionId,
          action: "llm.gateway_failure",
          details: {
            gateway: gw.id,
            requestedModel: model,
            kind: "bad_request",
            status: null,
            detail: `rota não paga recusada: ${attempt.servedBy}`,
          },
        });
        return { failedKind: "bad_request" };
      }
      if (!stream) {
        const peek = await attempt.response.clone().json().catch(() => null);
        const text = extractAssistantTextFromCompletion(peek);
        if (!text) {
          if (attempt.response.body) await attempt.response.body.cancel().catch(() => {});
          const finish = peek?.choices?.[0]?.finish_reason ?? "";
          const detail = finish
            ? `HTTP 200 sem texto (finish_reason=${finish})`
            : "HTTP 200 sem message.content nem reasoning_content";
          lastGatewayFailure = `${label}: ${detail}`;
          console.warn(`[ROUTER] ${lastGatewayFailure}. Tentando a próxima rota.`);
          TelemetryLogger.log({
            sessionId,
            action: "llm.gateway_failure",
            details: {
              gateway: gw.id,
              requestedModel: model,
              kind: "bad_request",
              status: 200,
              detail,
              servedBy: attempt.servedBy,
            },
          });
          return { failedKind: "bad_request" };
        }
      }
      lastGatewayFailure = "";
      console.log(`[ROUTER] Chamada processada via ${label} (${attempt.servedBy}, ${attempt.latencyMs}ms).`);
      TelemetryLogger.log({
        action: "llm.gateway_call",
        details: { gateway: gw.id, requestedModel: model, servedBy: attempt.servedBy, latencyMs: attempt.latencyMs, tier },
      });
      return {
        response: attempt.response,
        providerUsed: gw.id === "deepseek" ? "deepseek" : "freellmapi",
        badge: gw.id === "deepseek" ? `💎 ${label} (${attempt.servedBy})` : `🆓 ${label} (${attempt.servedBy})`,
        tierTag: gw.id === "deepseek" ? "deepseek" : "freellmapi",
        modelUsed: attempt.servedBy,
      };
    }
    lastGatewayFailure = `${label}: ${attempt.kind}${attempt.status ? ` HTTP ${attempt.status}` : ""} — ${attempt.detail}`;
    console.warn(`[ROUTER] ${lastGatewayFailure}. Tentando a próxima rota.`);
    TelemetryLogger.log({
      sessionId,
      action: "llm.gateway_failure",
      details: { gateway: gw.id, requestedModel: model, kind: attempt.kind, status: attempt.status ?? null, detail: attempt.detail },
    });
    return { failedKind: attempt.kind };
  }

  /**
   * Executa o despacho de chamadas LLM com cascata de fallback silenciosa (Waterfall).
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
      stream = true,
      signal,
    } = options;

    // Se o usuário selecionou explicitamente um modelo de provedor direto no UI
    if (modelOverride === "groq" && groqKey) {
      const groqRes = await this.tryGroqDirect(messages, groqKey, signal);
      if (groqRes) return groqRes;
    }
    if (modelOverride === "nvidia" && nvidiaKey) {
      const nvidiaRes = await this.tryNvidiaDirect(messages, nvidiaKey, signal);
      if (nvidiaRes) return nvidiaRes;
    }
    if (modelOverride === "deepseek" && deepseekKey) {
      const deepseekRes = await this.tryDeepseekDirect(messages, deepseekKey, signal);
      if (deepseekRes) return deepseekRes;
    }

    const effectiveGeminiKey = resolveEffectiveGeminiKey(geminiKey);

    const gateways = options.gateways ?? (await loadGatewayConfigs().catch(() => [] as GatewayConfig[]));
    const gatewayOrder: GatewayConfig[] = (
      tier === "heavy"
        ? [...gateways.filter((g) => g.heavyFirst), ...gateways.filter((g) => !g.heavyFirst)]
        : gateways
    ).filter((g) => modelForTier(g, tier) !== null);
    let aggregatorAlreadyTried = false;
    for (const gw of gatewayOrder) {
      if (signal?.aborted) break;
      const gatewayResult = await this.tryOpenAiGateway(
        gw,
        messages,
        tier,
        stream,
        signal,
        options.maxTokens,
        options.allowedRoutedViaPrefixes,
        options.gatewayTimeoutMs,
        options.sessionId,
        options.responseFormat
      );
      if ("response" in gatewayResult) return gatewayResult;
      // O gateway está no ar e já tentou os provedores dele (com as mesmas chaves): as rotas
      // nativas abaixo usam modelos fixos (vários já descontinuados) e só somavam minutos.
      if (gatewayResult.failedKind !== "network") aggregatorAlreadyTried = true;
    }

    if (aggregatorAlreadyTried && !signal?.aborted) {
      console.warn("[ROUTER] Gateway agregador no ar já esgotou os provedores; rotas nativas (BYOK direto) puladas.");
    }

    // ----------------------------------------------------
    // TENTATIVA 2: Fallback — Groq Cloud API Direta
    // ----------------------------------------------------
    if (groqKey && !aggregatorAlreadyTried) {
      const groqRes = await this.tryGroqDirect(messages, groqKey, signal);
      if (groqRes) return groqRes;
    }

    // ----------------------------------------------------
    // TENTATIVA 3: Fallback — NVIDIA NIM API Direta
    // ----------------------------------------------------
    if (nvidiaKey && !aggregatorAlreadyTried) {
      const nvidiaRes = await this.tryNvidiaDirect(messages, nvidiaKey, signal);
      if (nvidiaRes) return nvidiaRes;
    }

    // ----------------------------------------------------
    // TENTATIVA 4: Fallback — DeepSeek API Direta
    // ----------------------------------------------------
    if (deepseekKey && !aggregatorAlreadyTried) {
      const deepseekRes = await this.tryDeepseekDirect(messages, deepseekKey, signal);
      if (deepseekRes) return deepseekRes;
    }

    // ----------------------------------------------------
    // TENTATIVA 5: Fallback — Google Gemini Direto
    // ----------------------------------------------------
    if (effectiveGeminiKey && !signal?.aborted && !aggregatorAlreadyTried) {
      recordGeminiFallback();
      const cleanApiKey = effectiveGeminiKey.trim();

      const candidateModels: string[] = await getAvailableGeminiModels(cleanApiKey, signal);

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

          // Anti-SSRF: mesmo o host do Gemini sendo fixo, toda saída HTTP do router passa
          // pelo safeFetch (validação pós-DNS + sem redirect), como Groq/NVIDIA/BYOK.
          // O Response é devolvido intacto, então o streaming SSE continua funcionando.
          let geminiRes = await safeFetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: geminiBody,
            // C5: aborta imediatamente quando o guard da DAG cancela; senão usa teto de 20s.
            signal: signal ?? AbortSignal.timeout(20000),
          });

          if (geminiRes.status === 503 || geminiRes.status === 429) {
            console.warn(`[ROUTER] Gemini Direto (${cleanModel}) retornou HTTP ${geminiRes.status} (pico de demanda). Re-tentando em 1.2s...`);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            geminiRes = await safeFetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: geminiBody,
              signal: signal ?? AbortSignal.timeout(20000),
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
    } else if (aggregatorAlreadyTried) {
      lastGeminiFailure = "";
    } else {
      lastGeminiFailure = "nenhuma chave Gemini disponivel (readSecret vazio ou NEXTCODE_MASTER_KEY incorreta)";
    }

    // ----------------------------------------------------
    // TENTATIVA 6: Esgotamento de Cotas / Provedores
    // ----------------------------------------------------
    const alertText =
      "⚠️ **Cotas e Serviços Indisponíveis:** Não foi possível obter resposta de nenhum dos provedores configurados (FreeLLMAPI, Groq Cloud, NVIDIA NIM, DeepSeek ou Gemini Direto). Abra **Configurações > Gateways LLM** e rode o diagnóstico: ele diz exatamente o que falhou e o que fazer." +
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

