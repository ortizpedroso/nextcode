import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import * as empiricalGateMod from "@/core/governance/empirical-gate";
import { executeTaskNode, setExecutorModeForTests } from "@/core/orchestrator/node-executor";

describe("Passo 10.4 — Guarda de segredos no código gerado (ativo, fail-closed)", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    setExecutorModeForTests("chamada_unica");
    vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue([] as any);
    vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue([] as any);
    vi.spyOn(empiricalGateMod, "promoteWithEmpiricalGate").mockResolvedValue({
      passed: true,
      rolledBack: false,
      buildResult: { success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 },
    } as any);
  });

  afterEach(() => {
    setExecutorModeForTests(null);
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  function setupTaskWithGeneratedCode(fileName: string, fileContent: string) {
    const task: any = {
      id: "node-10-4",
      sessionId: "sess-10-4",
      specVersion: 1,
      title: `Implementar ${fileName}`,
      role: "executor-backend",
      cluster: "backend",
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      dependencies: "[]",
      filesScope: JSON.stringify([fileName]),
      payload: JSON.stringify({
        goal: "# Spec\nCliente de API",
        nodeFiles: [fileName],
        cluster: "backend",
      }),
      result: null,
      failureHistory: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      session: {
        id: "sess-10-4",
        canonicalSpec: "# Spec\nCliente de API",
        project: null,
      },
    };

    let lastUpdatedData: any = null;
    vi.spyOn(prisma.taskNode, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.taskNode, "findMany").mockResolvedValue([] as any);
    vi.spyOn(prisma.message, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
    vi.spyOn(prisma.taskNode, "update").mockImplementation((async (args: any) => {
      lastUpdatedData = args.data;
      return { ...task, ...args.data };
    }) as any);

    const executorOutput = `\`\`\`typescript\n// file: ${fileName}\n${fileContent}\n\`\`\``;
    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValue({
      response: new Response(
        JSON.stringify({
          choices: [{ message: { content: executorOutput } }],
        })
      ),
      providerUsed: "freellmapi",
      badge: "",
      tierTag: "freellmapi",
      modelUsed: "mock-model",
    } satisfies DispatchResult);

    vi.spyOn(DualLensAuditor, "validateType2").mockResolvedValue({
      verdict: "APPROVED",
      rawVerdict: "APROVADO",
      method: "blind_llm",
    } as any);

    return { task, getLastUpdatedData: () => lastUpdatedData };
  }

  it("segredo real → bloqueia antes da promoção; motivo e telemetria nunca contêm o valor", async () => {
    const telemetryCalls: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      telemetryCalls.push(entry);
    });

    const realKey = "sk_"+"live_9876543210abcdefSECRET";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q_0: { type: "noul", noul: 0.96 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { task, getLastUpdatedData } = setupTaskWithGeneratedCode(
      "src/lib/stripe.ts",
      `export const stripeKey = "${realKey}";\n`
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("failed");
    expect(res.promotionTarget).toBeNull();
    expect(empiricalGateMod.promoteWithEmpiricalGate).not.toHaveBeenCalled();

    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.rejectionReason).toBe(
      "[SECRET IN CODE] src/lib/stripe.ts:1 — use variável de ambiente"
    );
    expect(saved.rejectionReason).not.toContain(realKey);

    const secretGuardLogs = telemetryCalls.filter((c) => c.action === "SECRET_GUARD");
    expect(secretGuardLogs).toHaveLength(1);
    expect(secretGuardLogs[0].details).toMatchObject({
      nodeId: "node-10-4",
      arquivo: "src/lib/stripe.ts",
      linha: 1,
      noul: 0.96,
      bloqueado: true,
    });
    expect(JSON.stringify(secretGuardLogs[0])).not.toContain(realKey);
  });

  it("process.env → passa sem chamar Jev", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { task } = setupTaskWithGeneratedCode(
      "src/lib/stripe.ts",
      "export const stripeKey = process.env.STRIPE_SECRET_KEY || '';\n"
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(empiricalGateMod.promoteWithEmpiricalGate).toHaveBeenCalledTimes(1);
  });

  it("placeholder → passa sem chamar Jev", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { task } = setupTaskWithGeneratedCode(
      "src/lib/stripe.ts",
      [
        'export const k1 = "<sk_"+"live_placeholder>";',
        'export const k2 = "your-key-here-1234567890";',
        'export const apiKey = "changeme_example_xxx";',
      ].join("\n")
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Jev null + regex → bloqueia (fail-closed) sem expor o valor no motivo nem na telemetria", async () => {
    const telemetryCalls: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      telemetryCalls.push(entry);
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));

    const ghSecret = "ghp_Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4";
    const { task, getLastUpdatedData } = setupTaskWithGeneratedCode(
      "src/lib/github.ts",
      `const token = "${ghSecret}";\nexport default token;\n`
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("failed");
    expect(empiricalGateMod.promoteWithEmpiricalGate).not.toHaveBeenCalled();

    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.rejectionReason).toBe(
      "[SECRET IN CODE] src/lib/github.ts:1 — use variável de ambiente"
    );
    expect(saved.rejectionReason).not.toContain(ghSecret);

    const secretGuardLogs = telemetryCalls.filter((c) => c.action === "SECRET_GUARD");
    expect(secretGuardLogs).toHaveLength(1);
    expect(secretGuardLogs[0].details).toMatchObject({
      nodeId: "node-10-4",
      arquivo: "src/lib/github.ts",
      linha: 1,
      noul: null,
      bloqueado: true,
    });
    expect(JSON.stringify(secretGuardLogs[0])).not.toContain(ghSecret);
  });
});
