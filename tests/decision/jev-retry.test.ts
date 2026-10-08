import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { askJevBatch, askJevChoice } from "@/core/decision/jev";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

describe("P1.2 — Nova tentativa em 429/529; alerta em 422", () => {
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
    vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("429 depois 200 → resposta válida e 1 JEV_RETRY", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: { q: { type: "choice", choice: "sim", confidence: 0.9, probabilities: { sim: 0.9, nao: 0.1 } } },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const res = await askJevChoice({
      purpose: "retry_429_ok",
      state: "ola",
      instructions: "Escolha",
      criteria: { sim: "sim", nao: "nao" },
      sessionId: "sess-retry-1",
    });

    expect(res?.choice).toBe("sim");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const retryLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_RETRY");
    expect(retryLogs).toHaveLength(1);
    expect(retryLogs[0][0].details).toEqual({
      purpose: "retry_429_ok",
      status: 429,
      attempt: 1,
    });
  });

  it("529, 529, 529 → null após 3 tentativas", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 529 }))
      .mockResolvedValueOnce(new Response("{}", { status: 529 }))
      .mockResolvedValueOnce(new Response("{}", { status: 529 }));

    const res = await askJevBatch({
      purpose: "retry_529_exhausted",
      state: '{"a":1}',
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-retry-2",
    });

    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const retryLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_RETRY");
    expect(retryLogs).toHaveLength(2);
    expect(retryLogs[0][0].details).toEqual({
      purpose: "retry_529_exhausted",
      status: 529,
      attempt: 1,
    });
    expect(retryLogs[1][0].details).toEqual({
      purpose: "retry_529_exhausted",
      status: 529,
      attempt: 2,
    });
  });

  it("retry-after 1 → espera ~1000 ms", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "retry-after": "1" } })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: { q1: { type: "noul", noul: 0.8 } },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const t0 = Date.now();
    const res = await askJevBatch({
      purpose: "retry_after_1",
      state: '{"a":1}',
      questions: { q1: { type: "noul", instructions: "ok?" } },
    });
    const elapsed = Date.now() - t0;

    expect(res).toBeTruthy();
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(1600);
  });

  it("422 → null, JEV_REQUEST_INVALID com o detalhe, sem nova tentativa", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response('{"detail":"Invalid question criteria"}', { status: 422 })
      );

    const res = await askJevBatch({
      purpose: "test_422",
      state: '{"a":1}',
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-422",
    });

    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const invalidLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_REQUEST_INVALID");
    expect(invalidLogs).toHaveLength(1);
    expect(invalidLogs[0][0].details).toEqual({
      purpose: "test_422",
      detail: '{"detail":"Invalid question criteria"}',
    });
    const failureLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_FAILURE");
    expect(failureLogs).toHaveLength(0);
    const retryLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_RETRY");
    expect(retryLogs).toHaveLength(0);
  });

  it("401 → null sem nova tentativa", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }));

    const res = await askJevChoice({
      purpose: "test_401",
      state: "ola",
      instructions: "Escolha",
      criteria: { a: "a", b: "b" },
      sessionId: "sess-401",
    });

    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const retryLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_RETRY");
    expect(retryLogs).toHaveLength(0);
    const failureLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_FAILURE");
    expect(failureLogs).toHaveLength(1);
  });

  it("signal do chamador abortado durante a espera → não faz nova chamada", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "retry-after": "2" } })
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);

    const res = await askJevBatch({
      purpose: "test_abort_wait",
      state: '{"a":1}',
      questions: { q1: { type: "noul", instructions: "ok?" } },
      signal: controller.signal,
    });

    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const retryLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_RETRY");
    expect(retryLogs).toHaveLength(0);
  });
});
