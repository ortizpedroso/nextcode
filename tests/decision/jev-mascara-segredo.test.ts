import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { askJevBatch } from "@/core/decision/jev";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

describe("P5.1 — Máscara de segredos antes de qualquer envio ao Jev", () => {
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

  it("(a) askJevBatch com state contendo segredo falso de alta entropia mascara o body capturado no fetch", async () => {
    // Montado em tempo de execução conforme Trava T-G
    const fakeSecret = "sk-" + "aB3dE" + "kL9mZ8qW2vX7" + "pT4yR1zW8v9B";
    const rawState = `const config = {\n  apiKey: "${fakeSecret}",\n};`;

    let capturedBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init && init.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q1: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const res = await askJevBatch({
      purpose: "test_mask",
      state: rawState,
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-test-mask-1",
    });

    expect(res).not.toBeNull();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.state).not.toContain(fakeSecret);
    expect(capturedBody.state).toContain("«valor oculto:");
  });

  it("(b) state sem segredo envia body idêntico ao original", async () => {
    const rawState = JSON.stringify({ modulo: "core", arquivo: "src/index.ts" });

    let capturedBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init && init.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q1: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const res = await askJevBatch({
      purpose: "test_no_mask",
      state: rawState,
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-test-mask-2",
    });

    expect(res).not.toBeNull();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.state).toBe(rawState);
  });

  it("(c) JEV_STATE_MASKED registrado com count: 1 e sem o valor em details", async () => {
    const fakeSecret = "sk-" + "aB3dE" + "kL9mZ8qW2vX7" + "pT4yR1zW8v9B";
    const rawState = `apiKey = "${fakeSecret}"`;

    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q1: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await askJevBatch({
      purpose: "test_telemetry",
      state: rawState,
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-test-mask-3",
    });

    const maskCall = logSpy.mock.calls.find((c) => c[0]?.action === "JEV_STATE_MASKED");
    expect(maskCall).toBeDefined();
    expect(maskCall![0].details).toEqual({
      purpose: "test_telemetry",
      count: 1,
    });
    // Garante que o valor secreto falso nunca vaza em details
    const detailsStr = JSON.stringify(maskCall![0].details);
    expect(detailsStr).not.toContain(fakeSecret);
  });
});
