import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchStrongEvaluator } from "@/core/llm/evaluator-models";

// J3 no Gateway real (22/10): o Sonnet devolveu só thinking até o max_tokens (8000) — sem texto, sem custo registrado.
describe("avaliador forte — teto de resposta e custo da resposta sem texto", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maxTokens chega ao corpo; resposta só com thinking devolve o uso desperdiçado de cada modelo", async () => {
    const bodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(
        JSON.stringify({ content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens", usage: { input_tokens: 150000, output_tokens: 32000 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const res = await dispatchStrongEvaluator([{ role: "user", content: "x" }], {
      executorFamily: "deepseek",
      directClaudeKey: "sk-ant-teste",
      maxTokens: 32000,
      chain: [
        { provider: "claude", model: "claude-sonnet-5-5", routedPrefixes: ["anthropic/"] },
        { provider: "claude", model: "claude-opus-5-5", routedPrefixes: ["anthropic/"] },
      ],
    });
    expect(bodies.map((b) => b.max_tokens)).toEqual([32000, 32000]);
    expect(res.content).toBeNull();
    expect(res.failures.join(" ")).toContain("stop_reason=max_tokens");
    expect(res.wastedUsage?.map((w) => w.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(res.wastedUsage?.[0].usage).toMatchObject({ input_tokens: 150000, output_tokens: 32000 });
  });

  it("sem maxTokens continua 8000 (avaliador de etapa)", async () => {
    let body: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }), { status: 200 });
    });
    await dispatchStrongEvaluator([{ role: "user", content: "x" }], { executorFamily: "deepseek", directClaudeKey: "sk-ant-teste" });
    expect(body.max_tokens).toBe(8000);
  });
});
