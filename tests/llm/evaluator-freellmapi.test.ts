import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchStrongEvaluator, resetEvaluatorState } from "@/core/llm/evaluator-models";
import type { GatewayConfig } from "@/core/llm/gateways";

describe("P3.1 — Cadeia do avaliador pelo FreeLLMAPI (Nemotron → DeepSeek → Claude)", () => {
  const fakeGateway: GatewayConfig = {
    id: "freellmapi",
    enabled: true,
    priority: 0,
    baseUrl: "http://localhost:3100/v1",
    apiKey: "free-key",
    modelFast: "auto:fast",
    modelHeavy: "auto:smart",
  };
  const loader = async () => [fakeGateway];

  beforeEach(() => {
    resetEvaluatorState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEvaluatorState();
  });

  it("nemotron responde via ollama/nemotron → usado, independent true, model = servedBy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"APROVADO"}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        {
          status: 200,
          headers: { "x-routed-via": "ollama/nemotron-3-ultra" },
        }
      )
    );

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(res.content).toBe('{"verdict":"APROVADO"}');
    expect(res.provider).toBe("nvidia");
    expect(res.model).toBe("ollama/nemotron-3-ultra");
    expect(res.independent).toBe(true);
    expect(res.failures).toHaveLength(0);
    expect(res.usage).toEqual({ prompt_tokens: 100, completion_tokens: 20 });
  });

  it("nemotron via nvidia/ também é aceito", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"APROVADO"}' } }],
        }),
        {
          status: 200,
          headers: { "x-routed-via": "nvidia/nvidia/nemotron-3-ultra-550b-a55b" },
        }
      )
    );

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(res.provider).toBe("nvidia");
    expect(res.model).toBe("nvidia/nvidia/nemotron-3-ultra-550b-a55b");
    expect(res.independent).toBe(true);
  });

  it("nemotron servido por rota fora dos prefixos → recusado, segue para deepseek (custom/deepseek-v4-pro), independent false", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.model.includes("nemotron")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "rejeitado" } }] }),
          { status: 200, headers: { "x-routed-via": "groq/some-nemotron" } }
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"verdict":"DEEPSEEK_OK"}' } }] }),
        { status: 200, headers: { "x-routed-via": "custom/deepseek-v4-pro" } }
      );
    });

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(res.content).toBe('{"verdict":"DEEPSEEK_OK"}');
    expect(res.provider).toBe("deepseek");
    expect(res.model).toBe("custom/deepseek-v4-pro");
    expect(res.independent).toBe(false);
    expect(res.failures).toContain("nvidia/nemotron-3-ultra: rota recusada groq/some-nemotron");
  });

  it("nemotron 429 → pausa 10 min; 2ª chamada nem tenta nemotron", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.model.includes("nemotron")) {
        return new Response('{"error":{"message":"rate limit exceeded"}}', { status: 429 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"verdict":"OK"}' } }] }),
        { status: 200, headers: { "x-routed-via": "custom/deepseek-v4-pro" } }
      );
    });

    const r1 = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(r1.provider).toBe("deepseek");
    expect(r1.failures[0]).toContain("nvidia/nemotron-3-ultra");

    fetchSpy.mockClear();
    const r2 = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(r2.provider).toBe("deepseek");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body || "{}"));
    expect(sentBody.model).toBe("deepseek-v4-pro");
  });

  it("nemotron e deepseek falham, claude 404 → content null com 3 falhas", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.model.includes("nemotron")) {
        return new Response('{"error":{"message":"service down"}}', { status: 503 });
      }
      if (body.model.includes("deepseek")) {
        return new Response('{"error":{"message":"insufficient quota"}}', { status: 402 });
      }
      return new Response('{"error":{"message":"not in the catalog"}}', { status: 404 });
    });

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(res.content).toBeNull();
    expect(res.provider).toBeNull();
    expect(res.model).toBeNull();
    expect(res.failures).toHaveLength(3);
    expect(res.failures[0]).toContain("nvidia/nemotron-3-ultra");
    expect(res.failures[1]).toContain("deepseek/deepseek-v4-pro");
    expect(res.failures[2]).toContain("claude/claude-sonnet-4-5");
  });

  it("sem freellmapi configurado → content null", async () => {
    const emptyLoader = async () => [];
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader: emptyLoader });
    expect(res.content).toBeNull();
    expect(res.failures).toEqual(["freellmapi: não configurado"]);
  });

  it("nenhuma chamada vai a api.deepseek.com, api.anthropic.com ou googleapis", async () => {
    const urlsCalled: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      urlsCalled.push(String(url));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "x-routed-via": "ollama/nemotron-3-ultra" } }
      );
    });

    await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { loader });
    expect(urlsCalled.length).toBeGreaterThan(0);
    for (const url of urlsCalled) {
      expect(url).not.toContain("api.deepseek.com");
      expect(url).not.toContain("api.anthropic.com");
      expect(url).not.toContain("googleapis");
      expect(url).toContain("localhost:3100");
    }
  });

  it("preferIndependentFirst: true prioriza Claude (independente) antes de DeepSeek quando executor for DeepSeek", async () => {
    const modelsAttempted: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      modelsAttempted.push(body.model);
      if (body.model.includes("nemotron")) {
        return new Response('{"error":{"message":"nemotron indisponivel"}}', { status: 503 });
      }
      if (body.model.includes("claude")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"CLAUDE_APROVADO"}' } }] }),
          { status: 200, headers: { "x-routed-via": "anthropic/claude-sonnet-4-5" } }
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"verdict":"DEEPSEEK_OK"}' } }] }),
        { status: 200, headers: { "x-routed-via": "custom/deepseek-v4-pro" } }
      );
    });

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      loader,
      executorFamily: "deepseek",
      preferIndependentFirst: true,
    });

    expect(res.content).toBe('{"verdict":"CLAUDE_APROVADO"}');
    expect(res.provider).toBe("claude");
    expect(res.independent).toBe(true);
    expect(modelsAttempted[0]).toContain("nemotron");
    expect(modelsAttempted[1]).toContain("claude");
    expect(modelsAttempted).not.toContain("deepseek-v4-pro");
  });

  it("quando FreeLLMAPI falha mas ha claudeKey valida salva, fallback direto para api.anthropic.com e bem-sucedido", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("localhost:3100")) {
        return new Response('{"error":{"message":"gateway offline"}}', { status: 502 });
      }
      if (u.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: '{"verdict":"CLAUDE_DIRECT_OK"}' }],
            usage: { input_tokens: 150, output_tokens: 30 },
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      loader,
      executorFamily: "deepseek",
      preferIndependentFirst: true,
      directClaudeKey: "sk-ant-test-key",
    });

    expect(res.content).toBe('{"verdict":"CLAUDE_DIRECT_OK"}');
    expect(res.provider).toBe("claude");
    expect(res.independent).toBe(true);
    expect(res.usage).toEqual({ input_tokens: 150, output_tokens: 30 });
  });

  it("quando modelo Claude direto responde 404 (descontinuado), auto-cura silenciosa busca /v1/models e refaz chamada com sucesso", async () => {
    const urlsCalled: string[] = [];
    const modelsUsed: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      urlsCalled.push(u);

      if (u.includes("localhost:3100")) {
        return new Response('{"error":{"message":"gateway offline"}}', { status: 502 });
      }

      // Endpoint de modelos (GET /v1/models)
      if (u.includes("api.anthropic.com/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "claude-3-haiku-20240307", display_name: "Claude 3 Haiku" },
              { id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" },
              { id: "claude-3-5-sonnet-latest", display_name: "Claude 3.5 Sonnet (Latest)" },
            ],
          }),
          { status: 200 }
        );
      }

      // Endpoint de mensagens (POST /v1/messages)
      if (u.includes("api.anthropic.com/v1/messages")) {
        const body = JSON.parse(String(init?.body || "{}"));
        modelsUsed.push(body.model);

        // Se for o modelo inicial antigo/descontinuado, simula 404 da Anthropic
        if (body.model === "claude-sonnet-4-5-20250929") {
          return new Response(
            JSON.stringify({ error: { type: "not_found_error", message: "model not found" } }),
            { status: 404 }
          );
        }

        // Se for o modelo curado dinamicamente, responde 200 com sucesso
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: '{"verdict":"AUTO_HEAL_OK"}' }],
            usage: { input_tokens: 200, output_tokens: 45 },
          }),
          { status: 200 }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      loader,
      executorFamily: "deepseek",
      preferIndependentFirst: true,
      directClaudeKey: "sk-ant-test-key",
    });

    expect(res.content).toBe('{"verdict":"AUTO_HEAL_OK"}');
    expect(res.provider).toBe("claude");
    expect(res.model).toBe("claude-3-5-sonnet-latest");
    expect(res.independent).toBe(true);
    // Verificação de que houve chamada para consulta dinâmica e nova tentativa
    expect(urlsCalled.some((u) => u.includes("/v1/models"))).toBe(true);
    expect(modelsUsed).toContain("claude-sonnet-4-5-20250929");
    expect(modelsUsed).toContain("claude-3-5-sonnet-latest");
  });
});

