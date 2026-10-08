import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { askJevBatch, askJevChoice } from "@/core/decision/jev";
import { costFromUsage, LLM_COST_ACTION } from "@/core/llm/cost";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

describe("P1.1 — Custo do Jev em LLM_COST e usage na trilha", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
  });

  afterEach(() => {
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("askJevBatch com sessionId grava LLM_COST papel jev com o custo de input_tokens", async () => {
    const createSpy = vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({} as any);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 1_000_000, output_tokens: 50 },
          answers: {
            q1: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await askJevBatch({
      purpose: "test_batch_cost",
      state: '{"ok":true}',
      questions: { q1: { type: "noul", instructions: "Is it ok?" } },
      sessionId: "sess-jev-1",
    });

    expect(res).toBeTruthy();
    const costCalls = createSpy.mock.calls.filter(
      (c) => (c[0] as any)?.data?.action === LLM_COST_ACTION
    );
    expect(costCalls).toHaveLength(1);
    const details = JSON.parse((costCalls[0][0] as any).data.details);
    expect(details).toEqual({
      papel: "jev",
      provider: "typesafe",
      model: "jev-1.13.0",
      usd: 0.042,
      usage: { input_tokens: 1_000_000, output_tokens: 50 },
    });
  });

  it("askJevChoice idem", async () => {
    const createSpy = vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({} as any);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 1_000_000, output_tokens: 10 },
          answers: {
            q: { type: "choice", choice: "sim", confidence: 0.95, probabilities: { sim: 0.95, nao: 0.05 } },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await askJevChoice({
      purpose: "test_choice_cost",
      state: "texto",
      instructions: "Escolha",
      criteria: { sim: "sim", nao: "nao" },
      sessionId: "sess-jev-2",
    });

    expect(res?.choice).toBe("sim");
    const costCalls = createSpy.mock.calls.filter(
      (c) => (c[0] as any)?.data?.action === LLM_COST_ACTION
    );
    expect(costCalls).toHaveLength(1);
    const details = JSON.parse((costCalls[0][0] as any).data.details);
    expect(details).toEqual({
      papel: "jev",
      provider: "typesafe",
      model: "jev-1.13.0",
      usd: 0.042,
      usage: { input_tokens: 1_000_000, output_tokens: 10 },
    });
  });

  it("JEV_DECISION traz usage", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({} as any);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 420, output_tokens: 12 },
          answers: {
            q1: { type: "noul", noul: 0.8 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await askJevBatch({
      purpose: "test_usage_trilha",
      state: '{"a":1}',
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-jev-3",
    });

    const decisionCall = logSpy.mock.calls.find((c) => c[0].action === "JEV_DECISION");
    expect(decisionCall).toBeTruthy();
    expect(decisionCall![0].details).toMatchObject({
      purpose: "test_usage_trilha",
      usage: { input_tokens: 420, output_tokens: 12 },
    });
  });

  it("sem sessionId não grava LLM_COST", async () => {
    const createSpy = vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({} as any);
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 1000, output_tokens: 5 },
          answers: {
            q1: { type: "noul", noul: 0.7 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await askJevBatch({
      purpose: "test_no_session",
      state: '{"a":1}',
      questions: { q1: { type: "noul", instructions: "ok?" } },
    });

    const costCalls = createSpy.mock.calls.filter(
      (c) => (c[0] as any)?.data?.action === LLM_COST_ACTION
    );
    expect(costCalls).toHaveLength(0);
  });

  it('costFromUsage("jev-1.13.0", { input_tokens: 1000, output_tokens: 500 }) = 0.000042', () => {
    expect(costFromUsage("jev-1.13.0", { input_tokens: 1000, output_tokens: 500 })).toBeCloseTo(
      0.000042,
      10
    );
  });
});
