import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchMessage, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { IncidentReporter, type FailureAttemptRecord } from "@/core/governance/incident-reporter";
import * as policyMod from "@/core/config/orchestration-policy";
import { executeTaskNode, setExecutorModeForTests } from "@/core/orchestrator/node-executor";

describe("Passo 10.2 — Diagnóstico da falha via Jev (antes da próxima tentativa)", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    setExecutorModeForTests("chamada_unica");
    vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue([] as any);
    vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue([] as any);
  });

  afterEach(() => {
    setExecutorModeForTests(null);
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  function makeFakeTask(overrides: Record<string, any> = {}): any {
    return {
      id: "node-10-2",
      sessionId: "sess-10-2",
      specVersion: 1,
      title: "Implementar src/lib/calc.ts",
      role: "executor-core",
      cluster: "core",
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      dependencies: "[]",
      filesScope: JSON.stringify(["src/lib/calc.ts"]),
      payload: JSON.stringify({
        goal: "# Spec\nREQ-001: somar dois números",
        nodeFiles: ["src/lib/calc.ts"],
        cluster: "core",
        reqsCobertos: ["REQ-001"],
      }),
      result: null,
      failureHistory: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      session: {
        id: "sess-10-2",
        canonicalSpec: "# Spec\nREQ-001: somar dois números",
        project: null,
      },
      ...overrides,
    };
  }

  function mockPrismaAndRouterForRejection(task: any) {
    const capturedMessages: DispatchMessage[][] = [];
    const createdChatMessages: any[] = [];
    let lastUpdatedData: any = null;

    vi.spyOn(prisma.taskNode, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.taskNode, "findMany").mockResolvedValue([] as any);
    vi.spyOn(prisma.message, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.message, "create").mockImplementation((async (args: any) => {
      createdChatMessages.push(args.data);
      return { id: "msg-1", ...args.data };
    }) as any);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
    vi.spyOn(prisma.taskNode, "update").mockImplementation((async (args: any) => {
      lastUpdatedData = args.data;
      return { ...task, ...args.data };
    }) as any);

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(async (opts) => {
      capturedMessages.push(opts.messages);
      return {
        response: new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "```typescript\n// file: src/lib/calc.ts\nexport const sum = (a: number, b: number) => a - b;\n```",
                },
              },
            ],
          })
        ),
        providerUsed: "freellmapi",
        badge: "",
        tierTag: "freellmapi",
        modelUsed: "mock-model",
      } satisfies DispatchResult;
    });

    vi.spyOn(DualLensAuditor, "validateType2").mockResolvedValue({
      verdict: "REJECTED",
      rawVerdict: "REPROVADO",
      method: "blind_llm",
      rejectionReason: "REQ-001 ausente: sum subtrai em vez de somar.",
      reqVerdicts: [{ id: "REQ-001", status: "ausente", evidencia: "-" }],
    } as any);

    return {
      capturedMessages,
      createdChatMessages,
      getLastUpdatedData: () => lastUpdatedData,
    };
  }

  it("linha de diagnóstico no feedback acima do limiar e ausente abaixo", async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    // 1) Tentativa 1 falha e Jev retorna wrong_code com confiança 0.91 (>= 0.80)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            failure_cause: {
              type: "choice",
              choice: "wrong_code",
              confidence: 0.91,
              probabilities: {
                wrong_code: 0.91,
                environment: 0.03,
                ambiguous_spec: 0.02,
                evaluator_error: 0.02,
                incomplete_output: 0.02,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const task1 = makeFakeTask({ attempts: 0 });
    const ctx1 = mockPrismaAndRouterForRejection(task1);
    const res1 = await executeTaskNode(task1);
    expect(res1.finalStatus).toBe("failed");

    const savedResult1 = JSON.parse(ctx1.getLastUpdatedData().result);
    expect(savedResult1.jevDiagnostico).toEqual({
      causa: "wrong_code",
      confianca: 0.91,
      probabilidades: {
        wrong_code: 0.91,
        environment: 0.03,
        ambiguous_spec: 0.02,
        evaluator_error: 0.02,
        incomplete_output: 0.02,
      },
    });
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_FAILURE_DIAGNOSIS",
        details: expect.objectContaining({
          nodeId: "node-10-2",
          causa: "wrong_code",
          confianca: 0.91,
          modo: "ativo",
        }),
      })
    );

    // 2) Na tentativa seguinte (attempts=1), o feedback enviado ao executor inclui a linha "Diagnóstico provável:"
    // E se nesta tentativa o Jev retornar confiança 0.55 (< 0.80), na próxima tentativa a linha estará ausente.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            failure_cause: {
              type: "choice",
              choice: "wrong_code",
              confidence: 0.55,
              probabilities: {
                wrong_code: 0.55,
                environment: 0.15,
                ambiguous_spec: 0.1,
                evaluator_error: 0.1,
                incomplete_output: 0.1,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const task2 = makeFakeTask({
      attempts: 1,
      result: ctx1.getLastUpdatedData().result,
      failureHistory: ctx1.getLastUpdatedData().failureHistory,
    });
    const ctx2 = mockPrismaAndRouterForRejection(task2);
    await executeTaskNode(task2);

    const feedbackAbove = ctx2.capturedMessages[0]
      .map((m) => m.content)
      .find((c) => c.includes("[AUTO-HEALING FEEDBACK"));
    expect(feedbackAbove).toBeDefined();
    expect(feedbackAbove).toContain("Diagnóstico provável: código incorreto — ");

    // 3) Com o resultado de confiança 0.55 (< 0.80), o feedback da tentativa seguinte NÃO tem a linha de diagnóstico
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));
    const task3 = makeFakeTask({
      attempts: 2,
      result: ctx2.getLastUpdatedData().result,
      failureHistory: ctx2.getLastUpdatedData().failureHistory,
    });
    const ctx3 = mockPrismaAndRouterForRejection(task3);
    await executeTaskNode(task3);

    const feedbackBelow = ctx3.capturedMessages[0]
      .map((m) => m.content)
      .find((c) => c.includes("[AUTO-HEALING FEEDBACK"));
    expect(feedbackBelow).toBeDefined();
    expect(feedbackBelow).not.toContain("Diagnóstico provável:");
  });

  it("Jev null → feedback igual ao atual", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));

    const task1 = makeFakeTask({ attempts: 0 });
    const ctx1 = mockPrismaAndRouterForRejection(task1);
    await executeTaskNode(task1);

    const savedResult1 = JSON.parse(ctx1.getLastUpdatedData().result);
    expect(savedResult1.jevDiagnostico).toBeUndefined();

    const task2 = makeFakeTask({
      attempts: 1,
      result: ctx1.getLastUpdatedData().result,
      failureHistory: ctx1.getLastUpdatedData().failureHistory,
    });
    const ctx2 = mockPrismaAndRouterForRejection(task2);
    await executeTaskNode(task2);

    const feedbackMsg = ctx2.capturedMessages[0]
      .map((m) => m.content)
      .find((c) => c.includes("[AUTO-HEALING FEEDBACK"));
    expect(feedbackMsg).toBe(
      `\n\n⚠️ [AUTO-HEALING FEEDBACK - RE-TENTATIVA #2]\nA tentativa anterior foi REJEITADA pela auditoria com os seguintes erros:\nREQ-001 ausente: sum subtrai em vez de somar.\nVocê DEVE obrigatoriamente corrigir esses erros e garantir que todos os imports e módulos existam!`
    );
  });

  it('bloqueio_spec_ambigua em "sombra" não bloqueia (apenas registra JEV_WOULD_BLOCK_AMBIGUOUS_SPEC)', async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            failure_cause: {
              type: "choice",
              choice: "ambiguous_spec",
              confidence: 0.88,
              probabilities: {
                wrong_code: 0.03,
                environment: 0.03,
                ambiguous_spec: 0.88,
                evaluator_error: 0.03,
                incomplete_output: 0.03,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    // Tentativa #2 (attempts = 1 -> newAttempts = 2, maxAttempts = 3)
    const task = makeFakeTask({ attempts: 1, maxAttempts: 3 });
    const ctx = mockPrismaAndRouterForRejection(task);
    const res = await executeTaskNode(task);

    expect(res.finalStatus).toBe("failed");
    expect(ctx.getLastUpdatedData().status).toBe("failed");
    expect(ctx.getLastUpdatedData().attempts).toBe(2);
    expect(ctx.createdChatMessages).toHaveLength(0);
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_WOULD_BLOCK_AMBIGUOUS_SPEC",
        details: expect.objectContaining({
          nodeId: "node-10-2",
          tentativa: 2,
          causa: "ambiguous_spec",
          confianca: 0.88,
          modo: "sombra",
        }),
      })
    );
  });

  it('bloqueio_spec_ambigua em "ativo" bloqueia sem incrementar attempts e posta relatório no chat', async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const defaultPolicy = policyMod.loadOrchestrationPolicy();
    vi.spyOn(policyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...defaultPolicy,
      jevExecucao: {
        ...defaultPolicy.jevExecucao,
        bloqueioSpecAmbigua: "ativo",
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            failure_cause: {
              type: "choice",
              choice: "ambiguous_spec",
              confidence: 0.92,
              probabilities: {
                wrong_code: 0.02,
                environment: 0.02,
                ambiguous_spec: 0.92,
                evaluator_error: 0.02,
                incomplete_output: 0.02,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const task = makeFakeTask({ attempts: 1, maxAttempts: 3 });
    const ctx = mockPrismaAndRouterForRejection(task);
    const res = await executeTaskNode(task);

    expect(res.finalStatus).toBe("blocked");
    expect(ctx.getLastUpdatedData().status).toBe("blocked");
    // Sem incrementar attempts (permanece 1)
    expect(ctx.getLastUpdatedData().attempts).toBe(1);
    expect(ctx.createdChatMessages).toHaveLength(1);
    expect(ctx.createdChatMessages[0].content).toContain("especificação ambígua (Jev)");
    expect(ctx.createdChatMessages[0].content).toContain("Diagnóstico Jev:");
    expect(ctx.createdChatMessages[0].content).toContain("ambiguous_spec");
  });

  it("diagnóstico aparece no relatório de incidente", () => {
    const history: FailureAttemptRecord[] = [
      {
        attemptNumber: 1,
        rejectionReason: "REQ-001 não implementado",
        filesScope: ["src/lib/calc.ts"],
        timestamp: "2026-10-07T12:00:00.000Z",
        diagnostico: {
          causa: "wrong_code",
          confianca: 0.85,
          probabilidades: { wrong_code: 0.85 },
        },
      },
      {
        attemptNumber: 2,
        rejectionReason: "REQ-001 contraditório",
        filesScope: ["src/lib/calc.ts"],
        timestamp: "2026-10-07T12:01:00.000Z",
        diagnostico: {
          causa: "ambiguous_spec",
          confianca: 0.93,
          probabilidades: { ambiguous_spec: 0.93 },
        },
      },
    ];

    const report = IncidentReporter.generateIncidentReport(
      "node-10-2",
      "Implementar src/lib/calc.ts",
      "core",
      history,
      { maxAttempts: 3 }
    );

    expect(report).toContain("- **Diagnóstico Jev:** `wrong_code` (confiança: 85%)");
    expect(report).toContain("- **Diagnóstico Jev:** `ambiguous_spec` (confiança: 93%)");
  });
});
