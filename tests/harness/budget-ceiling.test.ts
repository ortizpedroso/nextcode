import { describe, it, expect, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import { costFromUsage, recordLlmCost, sessionCostUsd } from "@/core/llm/cost";
import { enforceBudgetBeforeBatch, getSessionBudget, BUDGET_AUTHORIZED_ACTION } from "@/core/orchestrator/budget-guard";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { supervisePausedSessions } from "@/core/orchestrator/job-worker";

const created: string[] = [];
afterEach(async () => {
  await prisma.message.deleteMany({ where: { sessionId: { in: created } } });
  await prisma.session.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

async function sessionInExecution() {
  const s = await prisma.session.create({ data: { title: "Teto", phase: "EXECUCAO", phaseContext: "{}" } });
  created.push(s.id);
  return s.id;
}

describe("Custo pelas tabelas oficiais", () => {
  it("DeepSeek v4-pro (pico): cache conta pelo preço de cache; FreeLLMAPI custa 0", () => {
    // 1M de entrada sem cache + 1M com cache + 1M de saída = 1,32 + 0,044 + 3,96
    const usd = costFromUsage("deepseek-v4-pro", {
      prompt_tokens: 2_000_000, prompt_cache_hit_tokens: 1_000_000, completion_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(5.324, 6);
    expect(costFromUsage("electronhub/qwen3.8-flash", { prompt_tokens: 1e6, completion_tokens: 1e6 })).toBe(0);
  });

  it("Claude (formato Anthropic) e Gemini", () => {
    expect(costFromUsage("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(12, 6);
    expect(costFromUsage("gemini-3.1-pro-preview", { prompt_tokens: 1e6, completion_tokens: 1e6 })).toBeCloseTo(14, 6);
  });
});

describe("Teto de custo por projeto (US$ 0,50)", () => {
  it("abaixo de 80% segue; acima avisa uma vez; no teto bloqueia e só a autorização humana retoma", async () => {
    const id = await sessionInExecution();
    await recordLlmCost({ sessionId: id, papel: "executor", provider: "deepseek", model: "deepseek-v4-pro",
      usage: { prompt_tokens: 0, completion_tokens: 50_000 } }); // US$ 0,198
    expect(await enforceBudgetBeforeBatch(id)).toBe(true);

    await recordLlmCost({ sessionId: id, papel: "avaliador", provider: "deepseek", model: "deepseek-v4-pro",
      usage: { prompt_tokens: 0, completion_tokens: 52_000 } }); // total US$ 0,404 → alerta
    expect(await enforceBudgetBeforeBatch(id)).toBe(true);
    expect(await enforceBudgetBeforeBatch(id)).toBe(true);
    const alerts = await prisma.message.count({ where: { sessionId: id, content: { contains: "Alerta de custo" } } });
    expect(alerts).toBe(1);

    await recordLlmCost({ sessionId: id, papel: "executor", provider: "deepseek", model: "deepseek-v4-pro",
      usage: { prompt_tokens: 0, completion_tokens: 30_000 } }); // total US$ 0,523 → teto
    expect(await enforceBudgetBeforeBatch(id)).toBe(false);
    let s = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(s.phase).toBe("BLOQUEADA");
    expect(await prisma.message.count({ where: { sessionId: id, content: { contains: "Teto de custo atingido" } } })).toBe(1);

    // O supervisor da pausa por falta de IA NÃO retoma um bloqueio de teto.
    await supervisePausedSessions(async () => true);
    s = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(s.phase).toBe("BLOQUEADA");

    // Autorização humana: +US$ 0,50 → novo teto US$ 1,00 e a fila pode seguir.
    await prisma.telemetryLog.create({ data: { sessionId: id, action: BUDGET_AUTHORIZED_ACTION, details: JSON.stringify({ acrescimoUsd: 0.5 }) } });
    await applyPhaseEvent(id, { type: "DESBLOQUEIO_HUMANO" });
    const b = await getSessionBudget(id);
    expect(b.limitUsd).toBeCloseTo(1.0, 6);
    expect(await sessionCostUsd(id)).toBeCloseTo(0.52272, 5);
    s = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(s.phase).toBe("EXECUCAO");
    expect(await enforceBudgetBeforeBatch(id)).toBe(true);
  });

  it("custo da Spec (papel elicitador) não conta para o teto; execução segue", async () => {
    const id = await sessionInExecution();
    await recordLlmCost({
      sessionId: id,
      papel: "elicitador",
      provider: "anthropic",
      model: "claude-opus-5-5",
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
    });
    const b = await getSessionBudget(id);
    expect(b.spentUsd).toBe(0);
    expect(await enforceBudgetBeforeBatch(id)).toBe(true);

    await recordLlmCost({
      sessionId: id,
      papel: "executor",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      usage: { prompt_tokens: 0, completion_tokens: 50_000 },
    });
    expect((await getSessionBudget(id)).spentUsd).toBeGreaterThan(0);
    expect(await enforceBudgetBeforeBatch(id)).toBe(true);
  });
});

describe("TR1 (4) — teto pelo tamanho do plano e 1 autorização", () => {
  afterEach(async () => {
    await prisma.taskNode.deleteMany({ where: { sessionId: { in: created } } });
  });

  async function sessionWithStages(total: number, completed: number) {
    const id = await sessionInExecution();
    for (let i = 0; i < total; i++) {
      await prisma.taskNode.create({
        data: {
          sessionId: id,
          title: `Etapa ${i + 1}`,
          role: "executor",
          status: i < completed ? "completed" : "pending",
          specVersion: 0,
        },
      });
    }
    return id;
  }

  it("plano de 20 etapas: teto = 20 × 0,35 × 1,5 = US$ 10,50 (maior que o fixo de 0,50)", async () => {
    const id = await sessionWithStages(20, 0);
    const b = await getSessionBudget(id);
    expect(b.estimativaPlanoUsd).toBeCloseTo(10.5, 6);
    expect(b.limitUsd).toBeCloseTo(10.5, 6);
  });

  it("plano pequeno: fica o teto fixo; sugestão nunca abaixo de US$ 0,50", async () => {
    const id = await sessionWithStages(1, 0);
    const b = await getSessionBudget(id);
    expect(b.limitUsd).toBeCloseTo(0.525, 6);
    expect(b.sugestaoAutorizacaoUsd).toBeGreaterThanOrEqual(0.5);
    const empty = await sessionInExecution();
    const e = await getSessionBudget(empty);
    expect(e.limitUsd).toBe(0.5);
    expect(e.sugestaoAutorizacaoUsd).toBe(0.5);
  });

  it("no teto, a mensagem pede de uma vez o que falta para as etapas restantes", async () => {
    const id = await sessionWithStages(4, 2);
    await recordLlmCost({
      sessionId: id,
      papel: "executor",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      usage: { prompt_tokens: 0, completion_tokens: 600_000 },
    });
    const b = await getSessionBudget(id);
    expect(b.status).toBe("teto");
    expect(b.sugestaoAutorizacaoUsd).toBeCloseTo(1.05, 6);
    expect(await enforceBudgetBeforeBatch(id)).toBe(false);
    const msg = await prisma.message.findFirst({ where: { sessionId: id, content: { contains: "Teto de custo atingido" } } });
    expect(msg?.content).toContain("autorize US$ 1.05");
    expect(msg?.content).toContain("uma autorização cobre o resto do plano");
  });
});
