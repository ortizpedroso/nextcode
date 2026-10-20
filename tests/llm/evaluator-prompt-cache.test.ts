import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAnthropicCachedBody, dispatchStrongEvaluator, EVALUATOR_CACHE_SPLIT_MARKER } from "@/core/llm/evaluator-models";
import { costFromUsage } from "@/core/llm/cost";

describe("TR1 (9) — cache de prompt do avaliador na Anthropic", () => {
  afterEach(() => vi.restoreAllMocks());

  it("system vira bloco com cache_control; mensagem do usuário é cortada antes do código", () => {
    const body = buildAnthropicCachedBody([
      { role: "system", content: "Você é um Auditor Cego" },
      { role: "user", content: `[BRIEF ORIGINAL]\nREQ-001\n\n${EVALUATOR_CACHE_SPLIT_MARKER}\n--- src/a.ts ---\nx` },
    ]);
    expect(body.system).toEqual([{ type: "text", text: "Você é um Auditor Cego", cache_control: { type: "ephemeral" } }]);
    const content = body.messages[0].content as { type: string; text: string; cache_control?: unknown }[];
    expect(content).toHaveLength(2);
    expect(content[0].text).toBe("[BRIEF ORIGINAL]\nREQ-001\n\n");
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(content[1].text.startsWith(EVALUATOR_CACHE_SPLIT_MARKER)).toBe(true);
    expect(content[1].cache_control).toBeUndefined();
  });

  it("mensagem sem o marcador segue como texto simples; sem mensagens vira 'ok'", () => {
    expect(buildAnthropicCachedBody([{ role: "user", content: "pergunta" }]).messages).toEqual([
      { role: "user", content: "pergunta" },
    ]);
    expect(buildAnthropicCachedBody([{ role: "system", content: "s" }]).messages).toEqual([{ role: "user", content: "ok" }]);
  });

  it("a chamada real à Anthropic leva os cortes e o custo inclui leitura e escrita do cache", async () => {
    let sentBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sentBody = JSON.parse(String((init as RequestInit).body));
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"implemented":true}' }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const res = await dispatchStrongEvaluator(
      [
        { role: "system", content: "Auditor" },
        { role: "user", content: `[BRIEF ORIGINAL]\nB\n\n${EVALUATOR_CACHE_SPLIT_MARKER}\ncodigo` },
      ],
      { executorFamily: "deepseek", directClaudeKey: "sk-ant-teste" } as any
    );
    expect(res.content).toBe('{"implemented":true}');
    expect(sentBody.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sentBody.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(res.usage).toMatchObject({ cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 });
  });

  it("custo Sonnet 5.5: leitura do cache a US$ 0,20/M e escrita a 1,25× da entrada", () => {
    // 100 entrada × 2 + 4000 lidos × 0,2 + 10 saída × 10 = 1100 → US$ 0,0011
    expect(costFromUsage("claude-sonnet-5-5", { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 4000 })).toBeCloseTo(0.0011, 8);
    // 1000 escritos × 2 × 1,25 = 2500 → US$ 0,0025
    expect(costFromUsage("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000 })).toBeCloseTo(0.0025, 8);
  });
});
