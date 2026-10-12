import { describe, it, expect } from "vitest";
import prisma from "@/lib/prisma";
import { sessionCostBreakdown, recordLlmCost, LLM_COST_ACTION } from "@/core/llm/cost";
import { getSessionBudget } from "@/core/orchestrator/budget-guard";
import { formatUsd } from "@/components/session/dag-sidebar";

describe("Pacote P5 — Telemetria e Monitoramento de Custos em Tempo Real", () => {
  async function makeTestSession() {
    const projId = `p-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sessId = `s-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await prisma.project.create({
      data: {
        id: projId,
        name: `Projeto Teste ${projId}`,
        path: `C:/tmp/${projId}`,
      },
    });
    await prisma.session.create({
      data: {
        id: sessId,
        projectId: projId,
        title: `Sessão Teste ${sessId}`,
      },
    });
    return { projId, sessId };
  }

  async function cleanupSession(projId: string, sessId: string) {
    try {
      // Nota: TelemetryLog é append-only (Trava T3), portanto não é apagado
      await prisma.session.delete({ where: { id: sessId } });
      await prisma.project.delete({ where: { id: projId } });
    } catch {}
  }

  it("1. Sessão sem registros de custo retorna breakdown zerado e seguro", async () => {
    const { projId, sessId } = await makeTestSession();
    try {
      const breakdown = await sessionCostBreakdown(sessId);
      expect(breakdown.totalUsd).toBe(0);
      expect(breakdown.executorUsd).toBe(0);
      expect(breakdown.avaliadorUsd).toBe(0);
      expect(breakdown.jevUsd).toBe(0);
      expect(breakdown.outroUsd).toBe(0);
      expect(breakdown.tokensTotal).toBe(0);
      expect(breakdown.byNode).toEqual({});
    } finally {
      await cleanupSession(projId, sessId);
    }
  });

  it("2. Agrupa corretamente custos e tokens por papel (executor, avaliador, jev) e por nó", async () => {
    const { projId, sessId } = await makeTestSession();
    try {
      // 1 chamada do executor no nó task-1
      await recordLlmCost({
        sessionId: sessId,
        nodeId: "task-1",
        papel: "executor",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });

      // 1 chamada do avaliador no nó task-1
      await recordLlmCost({
        sessionId: sessId,
        nodeId: "task-1",
        papel: "avaliador",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        usage: { prompt_tokens: 800, completion_tokens: 200 },
      });

      // 1 chamada do jev no nó task-2 (modelo oficial jev-batch)
      await recordLlmCost({
        sessionId: sessId,
        nodeId: "task-2",
        papel: "jev",
        provider: "typesafe",
        model: "jev-batch",
        usage: { prompt_tokens: 10000, completion_tokens: 0 },
      });

      const breakdown = await sessionCostBreakdown(sessId);

      expect(breakdown.totalUsd).toBeGreaterThan(0);
      expect(breakdown.executorUsd).toBeGreaterThan(0);
      expect(breakdown.avaliadorUsd).toBeGreaterThan(0);
      expect(breakdown.jevUsd).toBeGreaterThan(0);
      expect(breakdown.outroUsd).toBe(0);

      // Soma bate matematicamente
      const sumPapel = breakdown.executorUsd + breakdown.avaliadorUsd + breakdown.jevUsd;
      expect(Math.abs(breakdown.totalUsd - sumPapel)).toBeLessThan(0.00001);

      // Tokens consolidados
      expect(breakdown.tokensInput).toBe(11800);
      expect(breakdown.tokensOutput).toBe(700);
      expect(breakdown.tokensTotal).toBe(12500);

      // Agrupamento por nó
      expect(breakdown.byNode["task-1"]).toBeGreaterThan(0);
      expect(breakdown.byNode["task-2"]).toBeGreaterThan(0);
      expect(Math.abs(breakdown.byNode["task-1"] - (breakdown.executorUsd + breakdown.avaliadorUsd))).toBeLessThan(0.00001);
      expect(Math.abs(breakdown.byNode["task-2"] - breakdown.jevUsd)).toBeLessThan(0.00001);
    } finally {
      await cleanupSession(projId, sessId);
    }
  });

  it("3. Resiliência: ignora entradas corrompidas sem lançar erro", async () => {
    const { projId, sessId } = await makeTestSession();
    try {
      // Registra entrada corrompida diretamente na tabela
      await prisma.telemetryLog.create({
        data: {
          sessionId: sessId,
          action: LLM_COST_ACTION,
          details: "{ json_invalido_quebrado: ",
        },
      });

      // Registra entrada com valores nulos
      await prisma.telemetryLog.create({
        data: {
          sessionId: sessId,
          action: LLM_COST_ACTION,
          details: JSON.stringify({ papel: "executor", usd: "invalido", usage: null }),
        },
      });

      // Registra chamada válida
      await recordLlmCost({
        sessionId: sessId,
        nodeId: "task-valido",
        papel: "executor",
        provider: "deepseek",
        model: "deepseek-flash",
        usage: { prompt_tokens: 500, completion_tokens: 200 },
      });

      const breakdown = await sessionCostBreakdown(sessId);
      expect(breakdown.totalUsd).toBeGreaterThan(0);
      expect(Math.abs(breakdown.byNode["task-valido"] - breakdown.totalUsd)).toBeLessThan(0.00001);
    } finally {
      await cleanupSession(projId, sessId);
    }
  });

  it("4. getSessionBudget retorna o breakdown de custos fielmente acoplado", async () => {
    const { projId, sessId } = await makeTestSession();
    try {
      await recordLlmCost({
        sessionId: sessId,
        nodeId: "task-alpha",
        papel: "executor",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        usage: { prompt_tokens: 2000, completion_tokens: 1000 },
      });

      const budget = await getSessionBudget(sessId);
      expect(budget.spentUsd).toBeGreaterThan(0);
      expect(budget.breakdown).toBeDefined();
      expect(Math.abs(budget.breakdown!.totalUsd - budget.spentUsd)).toBeLessThan(0.00001);
      expect(Math.abs(budget.breakdown!.executorUsd - budget.spentUsd)).toBeLessThan(0.00001);
      expect(budget.status).toBe("ok");
    } finally {
      await cleanupSession(projId, sessId);
    }
  });

  it("5. formatUsd preserva alta precisão de 4 casas para micro-valores e 2 casas para valores altos", () => {
    expect(formatUsd(0)).toBe("US$ 0.00");
    expect(formatUsd(0.0078)).toBe("US$ 0.0078");
    expect(formatUsd(0.1191)).toBe("US$ 0.1191");
    expect(formatUsd(0.9999)).toBe("US$ 0.9999");
    expect(formatUsd(1.0)).toBe("US$ 1.00");
    expect(formatUsd(2.456)).toBe("US$ 2.46");
    expect(formatUsd(15.2)).toBe("US$ 15.20");
  });
});
