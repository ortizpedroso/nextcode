import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchOptions, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import * as empiricalGateMod from "@/core/governance/empirical-gate";
import * as orchestrationPolicyMod from "@/core/config/orchestration-policy";
import { invalidateGatewayCache } from "@/core/llm/gateways";
import {
  executeTaskNode,
  setExecutorModeForTests,
  setPaidOnlyRoutingForTests,
} from "@/core/orchestrator/node-executor";

describe("Passo R1.3 — Executor só no pago (Flash/Pro)", () => {
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    invalidateGatewayCache();
    setExecutorModeForTests("chamada_unica");
    setPaidOnlyRoutingForTests(null);
    vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue([] as any);
    vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue([] as any);
    vi.spyOn(empiricalGateMod, "promoteWithEmpiricalGate").mockResolvedValue({
      passed: true,
      rolledBack: false,
      buildResult: { success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 },
    } as any);
    vi.spyOn(DualLensAuditor, "validateType2").mockResolvedValue({
      verdict: "APPROVED",
      rawVerdict: "APROVADO",
      method: "blind_llm",
    } as any);
  });

  afterEach(() => {
    setExecutorModeForTests(null);
    setPaidOnlyRoutingForTests(null);
    invalidateGatewayCache();
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  function setupTask(tier: "rapido" | "medio" | "pesado", withFreellmapi = true) {
    const fileName = "src/lib/calc.ts";
    const task: any = {
      id: "node-r1-3",
      sessionId: "sess-r1-3",
      specVersion: 1,
      title: "Implementar calc.ts",
      role: "executor-backend",
      cluster: "backend",
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      dependencies: "[]",
      filesScope: JSON.stringify([fileName]),
      payload: JSON.stringify({
        goal: "# Spec\nCalculadora",
        nodeFiles: [fileName],
        cluster: "backend",
        jevPlan: { nivelModelo: tier },
      }),
      result: null,
      failureHistory: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      session: {
        id: "sess-r1-3",
        canonicalSpec: "# Spec\nCalculadora",
        project: null,
      },
    };

    let lastUpdatedData: any = null;
    let currentSessionPhase = "EXECUCAO";

    vi.spyOn(prisma.taskNode, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.taskNode, "findMany").mockResolvedValue([] as any);
    vi.spyOn(prisma.message, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.message, "create").mockResolvedValue({ id: "msg-1" } as any);
    vi.spyOn(prisma.llmGateway, "findMany").mockResolvedValue(
      withFreellmapi
        ? ([
            {
              id: "freellmapi",
              enabled: true,
              priority: 1,
              baseUrl: "http://localhost:3100/v1",
              apiKey: writeSecret("freellmapi-test-key"),
              modelFast: "auto:fast",
              modelHeavy: "auto:smart",
            },
          ] as any)
        : ([] as any)
    );
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      geminiKey: writeSecret("gemini-test-key"),
      groqKey: writeSecret("groq-test-key"),
      nvidiaKey: writeSecret("nvidia-test-key"),
      deepseekKey: writeSecret("deepseek-test-key"),
      omniRouteUrl: "http://localhost:20128/v1",
      omniRouteKey: writeSecret("omni-test-key"),
    } as any);
    vi.spyOn(prisma.taskNode, "update").mockImplementation((async (args: any) => {
      lastUpdatedData = args.data;
      return { ...task, ...args.data };
    }) as any);
    vi.spyOn(prisma.session, "findUnique").mockImplementation((async () => ({
      id: "sess-r1-3",
      phase: currentSessionPhase,
      phaseContext: JSON.stringify({ rodadasSemClareza: 0, voltasConferencia: 0 }),
    })) as any);
    vi.spyOn(prisma.session, "updateMany").mockImplementation((async (args: any) => {
      if (args?.data?.phase) currentSessionPhase = args.data.phase;
      return { count: 1 };
    }) as any);
    vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({ id: "tl-1" } as any);

    const executorOutput = `\`\`\`typescript\n// file: ${fileName}\nexport const add = (a: number, b: number) => a + b;\n\`\`\``;
    const capturedCalls: DispatchOptions[] = [];
    const dispatchSpy = vi
      .spyOn(SmartRouter.prototype, "dispatchWithFallback")
      .mockImplementation(async (opts: DispatchOptions): Promise<DispatchResult> => {
        capturedCalls.push(opts);
        return {
          response: new Response(
            JSON.stringify({
              choices: [{ message: { content: executorOutput } }],
            })
          ),
          providerUsed: "freellmapi",
          badge: "",
          tierTag: "freellmapi",
          modelUsed: `custom/${opts.gateways?.[0]?.modelHeavy || "deepseek-v4-pro"}`,
        };
      });

    return {
      task,
      capturedCalls,
      dispatchSpy,
      getLastUpdatedData: () => lastUpdatedData,
      getSessionPhase: () => currentSessionPhase,
    };
  }

  it("rapido chama o roteador com tier heavy e só o gateway pago com deepseek-flash", async () => {
    const telemetryCalls: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      telemetryCalls.push(entry);
    });

    const { task, capturedCalls } = setupTask("rapido", true);
    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].tier).toBe("heavy");
    expect(capturedCalls[0].gateways?.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls[0].gateways?.[0].id).toBe("freellmapi");
    expect(capturedCalls[0].gateways?.[0].modelHeavy).toBe("deepseek-flash");

    const rotaPagaLogs = telemetryCalls.filter((c) => c.action === "EXECUTOR_ROTA_PAGA");
    expect(rotaPagaLogs).toHaveLength(1);
    expect(rotaPagaLogs[0].details.nodeId).toBe("node-r1-3");
    expect(rotaPagaLogs[0].details.executorTier).toBe("rapido");
    expect(rotaPagaLogs[0].details.modelos).toContain("deepseek-flash");
    expect(rotaPagaLogs[0].details.gateways).toContain("freellmapi");
  });

  it("pesado chama com deepseek-v4-pro", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const { task, capturedCalls } = setupTask("pesado", true);
    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].tier).toBe("heavy");
    expect(capturedCalls[0].gateways?.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls[0].gateways?.[0].id).toBe("freellmapi");
    expect(capturedCalls[0].gateways?.[0].modelHeavy).toBe("deepseek-v4-pro");
  });

  it("nenhuma chamada do executor recebe groqKey, nvidiaKey, geminiKey ou omniRouteKey", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const { task, capturedCalls } = setupTask("rapido", true);
    await executeTaskNode(task);
    expect(capturedCalls.length).toBeGreaterThan(0);
    for (const call of capturedCalls) {
      expect(call.groqKey).toBeUndefined();
      expect(call.nvidiaKey).toBeUndefined();
      expect(call.geminiKey).toBeUndefined();
      expect(call.omniRouteKey).toBeUndefined();
      expect(call.omniRouteUrl).toBeUndefined();
    }
  });

  it('chamadas pagas levam allowedRoutedViaPrefixes com prefixos autorizados e não levam deepseekKey', async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const { task, capturedCalls } = setupTask("pesado", true);
    await executeTaskNode(task);
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].allowedRoutedViaPrefixes).toContain("custom/");
    expect(capturedCalls[0].deepseekKey).toBeUndefined();
  });

  it("C1.1: executor sem cascata — gateways só com o modelo pago e prefixos só custom/", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const { task, capturedCalls } = setupTask("pesado", true);
    await executeTaskNode(task);
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].allowedRoutedViaPrefixes).toEqual(["custom/"]);
    if (!capturedCalls[0].gateways) {
      throw new Error("capturedCalls[0].gateways não existe");
    }
    const forbiddenModels = [
      "codestral-latest",
      "deepseek-v4-flash",
      "qwen3-coder-30-a3b-instruct",
      "qwen-2.5-coder-32b-instruct",
    ];
    for (const gw of capturedCalls[0].gateways) {
      expect(forbiddenModels).not.toContain(gw.modelHeavy);
    }
  });

  it("sem gateway pago → providerUsed none → etapa volta a pending sem gastar tentativa e sessão PAUSADA", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const { task, dispatchSpy, getLastUpdatedData, getSessionPhase } = setupTask("rapido", false);

    dispatchSpy.mockImplementation(async (opts: DispatchOptions): Promise<DispatchResult> => {
      expect(opts.gateways).toEqual([]);
      return {
        response: new Response(JSON.stringify({ choices: [{ message: { content: "" } }] })),
        providerUsed: "none",
        badge: "🚫 Sem Provedor Disponível",
        tierTag: "exhausted",
        modelUsed: "none",
      };
    });

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("paused");
    expect(res.pausedDueToNoLlm).toBe(true);
    expect(getLastUpdatedData()).toEqual({
      status: "pending",
      attempts: 0,
    });
    expect(getSessionPhase()).toBe("PAUSADA");
  });

  it("somentePago false → chamada idêntica à de hoje (tier fast no rapido)", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const basePolicy = orchestrationPolicyMod.loadOrchestrationPolicy();
    vi.spyOn(orchestrationPolicyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...basePolicy,
      roteamentoPapeisCriticos: {
        ...basePolicy.roteamentoPapeisCriticos,
        somentePago: false,
      },
    });

    const { task, capturedCalls } = setupTask("rapido", true);
    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].tier).toBe("fast");
    expect(capturedCalls[0].gateways).toBeUndefined();
    expect(capturedCalls[0].geminiKey).toBe("gemini-test-key");
    expect(capturedCalls[0].groqKey).toBe("groq-test-key");
    expect(capturedCalls[0].nvidiaKey).toBe("nvidia-test-key");
    expect(capturedCalls[0].omniRouteKey).toBe("omni-test-key");
  });

  it("setPaidOnlyRoutingForTests(false) faz o executor voltar à rota antiga", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    setPaidOnlyRoutingForTests(false);

    const { task, capturedCalls } = setupTask("rapido", true);
    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].tier).toBe("fast");
    expect(capturedCalls[0].gateways).toBeUndefined();
    expect(capturedCalls[0].geminiKey).toBe("gemini-test-key");
    expect(capturedCalls[0].groqKey).toBe("groq-test-key");
    expect(capturedCalls[0].nvidiaKey).toBe("nvidia-test-key");
    expect(capturedCalls[0].omniRouteKey).toBe("omni-test-key");
  });
});
