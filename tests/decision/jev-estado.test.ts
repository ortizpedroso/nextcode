import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { askJevBatch } from "@/core/decision/jev";
import { checkSecretsInCodeWithJev } from "@/core/governance/secret-guard";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

describe("P1.3 — Estado do Jev nunca cortado no meio; score com probabilidades em objeto", () => {
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
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("estado acima do limite → null, JEV_STATE_TOO_LARGE e nenhuma chamada HTTP", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const hugeState = JSON.stringify({ data: "x".repeat(25000) });
    const res = await askJevBatch({
      purpose: "test_huge_state",
      state: hugeState,
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-state-1",
      maxStateChars: 24000,
    });

    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    const tooLargeLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_STATE_TOO_LARGE");
    expect(tooLargeLogs).toHaveLength(1);
    expect(tooLargeLogs[0][0].details).toEqual({
      purpose: "test_huge_state",
      length: hugeState.length,
      max: 24000,
    });
  });

  it("estado no limite → enviado inteiro (JSON.parse do state enviado funciona)", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const base = JSON.stringify({ padding: "" });
    const payloadObj = { padding: "a".repeat(24000 - base.length) };
    const exactState = JSON.stringify(payloadObj);
    expect(exactState.length).toBe(24000);

    let sentState = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => {
      const parsedBody = JSON.parse(String(init?.body ?? "{}"));
      sentState = parsedBody.state;
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { q1: { type: "noul", noul: 0.9 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any);

    const res = await askJevBatch({
      purpose: "test_exact_state",
      state: exactState,
      questions: { q1: { type: "noul", instructions: "ok?" } },
      maxStateChars: 24000,
    });

    expect(res).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentState.length).toBe(24000);
    expect(() => JSON.parse(sentState)).not.toThrow();
    expect(JSON.parse(sentState)).toEqual(payloadObj);
  });

  it('score com probabilities objeto {"0":0.1,"1":0.9} → [0.1, 0.9]', async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            clareza: {
              type: "score",
              score: 0.9,
              confidence: 0.85,
              probabilities: { "1": 0.9, "0": 0.1 },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await askJevBatch({
      purpose: "test_score_obj",
      state: '{"spec":"ok"}',
      questions: {
        clareza: { type: "score", instructions: "Quão claro?", criteria: ["ruim", "bom"] },
      },
    });

    expect(res?.clareza).toEqual({
      type: "score",
      score: 0.9,
      confidence: 0.85,
      probabilities: [0.1, 0.9],
    });
  });

  it("score com probabilities array continua funcionando", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            clareza: {
              type: "score",
              score: 1.8,
              confidence: 0.8,
              probabilities: [0.05, 0.1, 0.85],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await askJevBatch({
      purpose: "test_score_arr",
      state: '{"spec":"ok"}',
      questions: {
        clareza: { type: "score", instructions: "Quão claro?", criteria: ["0", "1", "2"] },
      },
    });

    expect(res?.clareza).toEqual({
      type: "score",
      score: 1.8,
      confidence: 0.8,
      probabilities: [0.05, 0.1, 0.85],
    });
  });

  it("guarda de segredos com Jev indisponível por estado grande continua fail-closed (bloqueia)", async () => {
    const logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(
        `export const k_${i} = "sk_"+"live_AbCdEfGhIjKlMnOpQrStUvWxYz${String(i).padStart(4, "0")}"; // ${"comentario_longo_".repeat(8)}`
      );
    }

    const result = await checkSecretsInCodeWithJev({
      sessionId: "sess-sec-large",
      nodeId: "node-sec-1",
      codeContentMap: { "src/keys.ts": lines.join("\n") },
      modo: "ativo",
      limiarSegredoNoul: 0.7,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    const tooLargeLogs = logSpy.mock.calls.filter((c) => c[0].action === "JEV_STATE_TOO_LARGE");
    expect(tooLargeLogs).toHaveLength(1);
    expect(result.blocked).toBe(true);
    expect(result.candidatos.length).toBeGreaterThan(0);
    expect(result.candidatos.every((c) => c.bloqueado && c.noul === null)).toBe(true);
  });
});
