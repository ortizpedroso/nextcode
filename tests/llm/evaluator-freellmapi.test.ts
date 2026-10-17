import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchStrongEvaluator, resetEvaluatorState, defaultEvaluatorChain } from "@/core/llm/evaluator-models";

const anthropicOk = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 150, output_tokens: 30 } }), {
    status: 200,
  });

describe("AV1.1 — avaliador Claude (Sonnet 5.5 → Opus 5.5), nunca a família do executor", () => {
  beforeEach(() => resetEvaluatorState());
  afterEach(() => {
    vi.restoreAllMocks();
    resetEvaluatorState();
  });

  it("cadeia padrão: claude-sonnet-5-5 e depois claude-opus-5-5; sem DeepSeek nem Nemotron", () => {
    const chain = defaultEvaluatorChain();
    expect(chain.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(chain.every((c) => c.provider === "claude")).toBe(true);
  });

  it("Sonnet responde → usado, independente, custo com usage; nenhuma chamada ao FreeLLMAPI nem à DeepSeek", async () => {
    const urls: string[] = [];
    const models: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      urls.push(String(url));
      models.push(JSON.parse(String(init?.body || "{}")).model);
      return anthropicOk('{"implemented":true}');
    });
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      executorFamily: "deepseek",
      directClaudeKey: "sk-ant-test-key",
    });
    expect(res.content).toBe('{"implemented":true}');
    expect(res.provider).toBe("claude");
    expect(res.model).toBe("claude-sonnet-5-5");
    expect(res.independent).toBe(true);
    expect(res.usage).toEqual({ input_tokens: 150, output_tokens: 30 });
    expect(models).toEqual(["claude-sonnet-5-5"]);
    expect(urls.every((u) => u.startsWith("https://api.anthropic.com/"))).toBe(true);
  });

  it("Sonnet 404 → registra a falha e vai para o Opus (sem trocar de modelo calado pelo catálogo)", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      urls.push(String(url));
      const model = JSON.parse(String(init?.body || "{}")).model;
      if (model === "claude-sonnet-5-5") {
        return new Response(JSON.stringify({ error: { type: "not_found_error", message: "model not found" } }), { status: 404 });
      }
      return anthropicOk("OPUS_OK");
    });
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { directClaudeKey: "sk-ant-test-key" });
    expect(res.content).toBe("OPUS_OK");
    expect(res.model).toBe("claude-opus-5-5");
    expect(res.failures.some((f) => f.includes("HTTP 404"))).toBe(true);
    expect(urls.some((u) => u.includes("/v1/models"))).toBe(false);
  });

  it("executor da família Claude → toda a cadeia Claude é recusada (T4) e nada é chamado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      executorFamily: "claude",
      directClaudeKey: "sk-ant-test-key",
    });
    expect(res.content).toBeNull();
    expect(res.failures.filter((f) => f.includes("mesma família do executor"))).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cadeia trocada com DeepSeek e executor DeepSeek → DeepSeek recusado (nunca avalia o próprio código)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      executorFamily: "deepseek",
      chain: [{ provider: "deepseek", model: "deepseek-v4-pro", routedPrefixes: ["custom/deepseek"] }],
    });
    expect(res.content).toBeNull();
    expect(res.failures[0]).toContain("mesma família do executor");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sem chave da Anthropic → falha registrada para os dois modelos, content null", async () => {
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { directClaudeKey: "" });
    expect(res.content).toBeNull();
    expect(res.failures.filter((f) => f.includes("sem chave da Anthropic"))).toHaveLength(2);
  });

  it("429 (sem crédito) → Claude fica de fora 10 min; 2ª chamada nem tenta", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "x" } }), { status: 429 }));
    const r1 = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { directClaudeKey: "sk-ant-test-key" });
    expect(r1.content).toBeNull();
    const calls = fetchSpy.mock.calls.length;
    const r2 = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], { directClaudeKey: "sk-ant-test-key" });
    expect(r2.content).toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(calls);
    expect(r2.failures.every((f) => f.includes("pausa de 10 min"))).toBe(true);
  });

  it("B1c.1a: bloco thinking antes de text → content concatena só text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "VEREDITO" }], stop_reason: "end_turn" }),
        { status: 200 }
      )
    );
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      directClaudeKey: "sk-ant-test-key",
      chain: [{ provider: "claude", model: "claude-opus-5-5", routedPrefixes: ["anthropic/"] }],
    });
    expect(res.content).toBe("VEREDITO");
    expect(res.provider).toBe("claude");
  });

  it("B1c.1b: 200 só com bloco não-texto → content null e failure sem texto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "sem text block" }], stop_reason: "end_turn" }), { status: 200 })
    );
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      directClaudeKey: "sk-ant-test-key",
      chain: [{ provider: "claude", model: "claude-opus-5-5", routedPrefixes: ["anthropic/"] }],
    });
    expect(res.content).toBeNull();
    expect(res.failures.some((f) => f.includes("claude/direct: sem texto"))).toBe(true);
  });

  it("B1c.1c: HTTP 400 com corpo de erro → failure HTTP 400 e mensagem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "model not allowed for this key" } }), { status: 400 })
    );
    const res = await dispatchStrongEvaluator([{ role: "user", content: "avalie" }], {
      directClaudeKey: "sk-ant-test-key",
      chain: [{ provider: "claude", model: "claude-opus-5-5", routedPrefixes: ["anthropic/"] }],
    });
    expect(res.content).toBeNull();
    expect(res.failures.some((f) => f.includes("claude/direct: HTTP 400"))).toBe(true);
    expect(res.failures.some((f) => f.includes("model not allowed"))).toBe(true);
  });
});
