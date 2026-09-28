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

import * as fs from "fs";

export function resolveOmniRouteUrl(rawUrl?: string): string {
  const base = rawUrl || process.env.OMNIROUTE_URL || "http://localhost:20128/v1";

  let isDocker =
    process.env.IS_DOCKER === "true" ||
    process.env.DOCKER_CONTAINER === "1" ||
    process.env.DOCKER === "true" ||
    Boolean(process.env.OMNIROUTE_URL?.includes("omniroute")) ||
    Boolean(process.env.OMNIROUTE_URL?.includes("host.docker.internal"));

  if (!isDocker) {
    try {
      isDocker = fs.existsSync("/.dockerenv");
    } catch {
      isDocker = false;
    }
  }

  if (isDocker && (base.includes("localhost") || base.includes("127.0.0.1"))) {
    return base
      .replace("localhost", "omniroute")
      .replace("127.0.0.1", "omniroute");
  }
  return base;
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
  providerUsed: "omniroute" | "gemini-fallback" | "gemini-direct";
  badge: "🤖 OmniRoute Local" | "⚡ Gemini Flash (Fallback Automático)" | "⚡ Gemini Flash (Fallback)" | "⚡ Gemini Flash" | "🧠 Claude Sonnet";
  tierTag: "omniroute" | "fast-fallback" | "fast" | "heavy";
  modelUsed: string;
}


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
            actualModelUsed: "omniroute-auto",
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
          actualModelUsed: "omniroute-auto",
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
   * 1. Tentativa 1 (Primária): OmniRoute Local Gateway (http://localhost:8080/v1/chat/completions, timeout 5s)
   * 2. Tentativa 2 (Fallback Imediato): Google Gemini Direto (https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent)
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

    const primaryModel = tier === "heavy" ? HEAVY_MODEL : FAST_MODEL;
    const rawUrl = omniRouteUrl || process.env.OMNIROUTE_URL || "http://localhost:20128/v1";
    const resolvedUrl = resolveOmniRouteUrl(rawUrl);
    const baseUrl = resolvedUrl.replace(/\/$/, "");
    const omniEndpoint = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    // ----------------------------------------------------
    // TENTATIVA 1: Google Gemini Direto (Resposta Ultra-rápida)
    // ----------------------------------------------------
    if (effectiveGeminiKey) {
      const cleanApiKey = effectiveGeminiKey.trim();
      const candidateModels = [
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-flash-latest",
        "gemini-3.5-flash",
        "gemini-3.7-flash",
      ];

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
            signal: AbortSignal.timeout(6000),
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
          }
        } catch (geminiErr) {
          console.warn(`[ROUTER] Erro de rede ao conectar com Gemini Direto (${modelId}):`, geminiErr);
        }
      }
    }

    // ----------------------------------------------------
    // TENTATIVA 2: OmniRoute Local Gateway
    // ----------------------------------------------------
    try {
      const omniHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (effectiveOmniRouteKey) {
        omniHeaders["Authorization"] = `Bearer ${effectiveOmniRouteKey}`;
      }

      const omniBody = JSON.stringify({
        model: primaryModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream,
      });

      let omniRes: Response | null = null;
      try {
        omniRes = await fetch(omniEndpoint, {
          method: "POST",
          headers: omniHeaders,
          body: omniBody,
          signal: AbortSignal.timeout(1200),
        });
      } catch (err) {
        console.warn(`[ROUTER] OmniRoute timeout/error (1200ms fast failover): ${String(err)}`);
      }

      if (omniRes && omniRes.ok) {
        console.log(`[ROUTER] Chamada processada com sucesso via OmniRoute Local (${primaryModel}).`);
        return {
          response: omniRes,
          providerUsed: "omniroute",
          badge: "🤖 OmniRoute Local",
          tierTag: "omniroute",
          modelUsed: primaryModel,
        };
      } else if (omniRes) {
        const errText = await omniRes.text().catch(() => "");
        console.warn(
          `[ROUTER] OmniRoute retornou status HTTP ${omniRes.status}. Resposta: ${errText.substring(0, 100)}`
        );
      }
    } catch (omniErr) {
      console.log(`[ROUTER] OmniRoute indisponível ou em erro: (${String(omniErr)})`);
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

    return {
      response: fallbackResponse,
      providerUsed: "gemini-direct",
      badge: "⚡ Gemini Flash (Fallback)",
      tierTag: "fast-fallback",
      modelUsed: "none",
    };
  }
}

