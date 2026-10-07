import { describe, it, expect, vi, afterEach } from "vitest";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { readPlannedTier } from "@/core/orchestrator/node-executor";
import { resolveExecutorTierForAttempt } from "@/core/config/orchestration-policy";
import { dispatchStrongEvaluator, resetEvaluatorState } from "@/core/llm/evaluator-models";

const type1Ok = { passed: true, compilationErrors: [], lintWarnings: [], securityViolations: [] } as never;
const code = { "src/lib/x.ts": "export const x = 1;\n" };

afterEach(() => {
  vi.restoreAllMocks();
  resetEvaluatorState();
});

describe("Veredito por REQ obrigatório", () => {
  it("avaliador aprova sem julgar todos os REQ → resposta descartada e a etapa NÃO é aprovada", async () => {
    const calls: number[] = [];
    const res = await DualLensAuditor.validateType2(type1Ok, "# brief", "ok", code, async () => {
      calls.push(1);
      return JSON.stringify({ implemented: true, missingRequirements: [], justification: "ok",
        reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/x.ts:1" }] });
    }, { expectedReqs: ["REQ-001", "REQ-002"] });
    expect(calls.length).toBe(2); // perguntou de novo
    expect(res.verdict).toBe("REJECTED");
  });

  it("todos os REQ julgados como implementado → aprovado; REQ inventado é ignorado", async () => {
    const res = await DualLensAuditor.validateType2(type1Ok, "# brief", "ok", code, async () =>
      JSON.stringify({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [
        { id: "REQ-001", status: "implementado", evidencia: "src/lib/x.ts:1" },
        { id: "REQ-999", status: "ausente", evidencia: "-" },
      ] }), { expectedReqs: ["REQ-001"] });
    expect(res.verdict).toBe("APPROVED");
    expect(res.reqVerdicts?.map((r) => r.id)).toEqual(["REQ-001"]);
  });
});

describe("Nível de modelo do executor (Jev + escalada)", () => {
  it("lê o plano do Jev; nó antigo sem plano fica no pesado", () => {
    expect(readPlannedTier(JSON.stringify({ jevPlan: { nivelModelo: "rapido" } }))).toBe("rapido");
    expect(readPlannedTier(JSON.stringify({ goal: "x" }))).toBe("pesado");
  });

  it("rápido sobe a cada tentativa: rápido → médio → pesado", () => {
    expect([1, 2, 3].map((a) => resolveExecutorTierForAttempt("rapido", a))).toEqual(["rapido", "medio", "pesado"]);
  });
});

describe("Cadeia do avaliador pago (Gemini → Claude → DeepSeek)", () => {
  it("Gemini sem crédito (402) e Claude sem crédito → usa DeepSeek e marca que não é independente", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("googleapis")) return new Response('{"error":{"message":"prepayment credits are depleted"}}', { status: 402 });
      if (u.includes("anthropic")) return new Response('{"error":{"message":"credit balance is too low"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"implemented\":true}" } }] }), { status: 200 });
    });
    const keys = { geminiKey: "g", claudeKey: "c", deepseekKey: "d" };
    const r1 = await dispatchStrongEvaluator([{ role: "user", content: "x" }], keys);
    expect(r1.provider).toBe("deepseek");
    expect(r1.independent).toBe(false);
    expect(r1.failures.length).toBe(2);

    // Sem crédito = fora por 10 min: na 2ª chamada nem tenta Gemini/Claude.
    fetchMock.mockClear();
    await dispatchStrongEvaluator([{ role: "user", content: "x" }], keys);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["https://api.deepseek.com/chat/completions"]);
  });

  it("Gemini respondendo → usa Gemini, independente do executor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
    );
    const r = await dispatchStrongEvaluator([{ role: "user", content: "x" }], { geminiKey: "g" });
    expect(r.provider).toBe("gemini");
    expect(r.independent).toBe(true);
  });
});
