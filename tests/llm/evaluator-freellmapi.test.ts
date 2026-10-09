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
});
