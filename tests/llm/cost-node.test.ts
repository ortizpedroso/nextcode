import { describe, it, expect } from "vitest";
import { recordLlmCost, LLM_COST_ACTION } from "@/core/llm/cost";
import { prisma } from "@/lib/prisma";

describe("S1.1 — recordLlmCost com nodeId opcional", () => {
  it("nodeId gravado quando informado", async () => {
    const sessionId = `test-cost-node-with-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await recordLlmCost({
      sessionId,
      nodeId: "node-123",
      papel: "executor",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const logs = await prisma.telemetryLog.findMany({
      where: { sessionId, action: LLM_COST_ACTION },
    });
    expect(logs).toHaveLength(1);
    const details = JSON.parse(logs[0].details || "{}");
    expect(details.nodeId).toBe("node-123");
    expect(details.papel).toBe("executor");
    expect(details.provider).toBe("deepseek");
  });

  it("ausente quando não informado", async () => {
    const sessionId = `test-cost-node-without-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await recordLlmCost({
      sessionId,
      papel: "avaliador",
      provider: "nvidia",
      model: "nemotron-3-ultra",
      usage: { prompt_tokens: 200, completion_tokens: 20 },
    });

    const logs = await prisma.telemetryLog.findMany({
      where: { sessionId, action: LLM_COST_ACTION },
    });
    expect(logs).toHaveLength(1);
    const details = JSON.parse(logs[0].details || "{}");
    expect(details.nodeId).toBeUndefined();
    expect(details.papel).toBe("avaliador");
  });
});
