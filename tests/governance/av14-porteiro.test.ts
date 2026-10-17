import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import * as empiricalGateMod from "@/core/governance/empirical-gate";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { executeTaskNode, setExecutorModeForTests } from "@/core/orchestrator/node-executor";
import os from "os";

describe("AV1.4 — porteiro: tsc do projeto antes do avaliador", () => {
  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY = process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    setExecutorModeForTests("chamada_unica");
    vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue([] as any);
    vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue([] as any);
  });
  afterEach(() => {
    setExecutorModeForTests(null);
    vi.restoreAllMocks();
  });

  it("tsc reprova no porteiro → etapa reprovada como Tipo 1, avaliador NÃO é chamado, erro vai no motivo", async () => {
    const logs: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((e) => {
      logs.push(e);
    });
    const gate = vi.spyOn(empiricalGateMod, "promoteWithEmpiricalGate").mockResolvedValue({
      passed: false,
      rolledBack: true,
      buildResult: { success: false, exitCode: 2, stdout: "", stderr: "", executionTimeMs: 1 },
      lintResult: null,
      preexistingFailure: false,
      newErrors: ["src/lib/a.ts|TS2322"],
      failedStage: "typecheck",
      failureLine: "src/lib/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.",
    } as any);

    const task: any = {
      id: "node-av14",
      sessionId: "sess-av14",
      specVersion: 1,
      title: "Implementar src/lib/a.ts",
      role: "executor-core",
      cluster: "core",
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      dependencies: "[]",
      filesScope: JSON.stringify(["src/lib/a.ts"]),
      payload: JSON.stringify({ goal: "# Spec\nA", nodeFiles: ["src/lib/a.ts"], cluster: "core" }),
      result: null,
      failureHistory: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      // O porteiro só roda com pasta de projeto vinculada (o portão é simulado, nada é escrito nela).
      session: { id: "sess-av14", canonicalSpec: "# Spec\nA", project: { path: os.tmpdir() } },
    };
    let lastData: any = null;
    vi.spyOn(prisma.taskNode, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.taskNode, "findMany").mockResolvedValue([] as any);
    vi.spyOn(prisma.message, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({ id: "default", typesafeKey: writeSecret("ts-test-key") } as any);
    vi.spyOn(prisma.taskNode, "update").mockImplementation((async (args: any) => {
      lastData = args.data;
      return { ...task, ...args.data };
    }) as any);
    const router = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValue({
      response: new Response(
        JSON.stringify({ choices: [{ message: { content: "```typescript\n// file: src/lib/a.ts\nexport const a: number = 'x';\n```" } }] })
      ),
      providerUsed: "freellmapi",
      badge: "",
      tierTag: "freellmapi",
      modelUsed: "mock-model",
    } satisfies DispatchResult);
    const type2 = vi.spyOn(DualLensAuditor, "validateType2");

    const res = await executeTaskNode(task);

    expect(res.finalStatus).not.toBe("completed");
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0][4]).toEqual({ checkOnly: true });
    expect(type2.mock.calls[0][0].passed).toBe(false);
    const evaluatorCalls = router.mock.calls.filter((c) =>
      (c[0] as any).messages.some((m: any) => m.role === "system" && m.content.includes("Auditor Cego"))
    );
    expect(evaluatorCalls).toHaveLength(0);
    expect(logs.some((l) => l.action === "PORTEIRO_REPROVADO")).toBe(true);
    expect(JSON.stringify(lastData)).toContain("[PORTEIRO");
    expect(JSON.stringify(lastData)).toContain("TS2322");
  });

  it("modo checkOnly desfaz a promoção mesmo passando; a promoção real reaplica o retrato e roda o tsc de novo", async () => {
    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({ success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 } as any);
    vi.spyOn(TerminalExecutionEngine, "verifyProjectLint").mockResolvedValue(null as any);
    let quarantineExists = true;
    let snapshot = false;
    const qm: any = {
      promoteToMainRepo: vi.fn(() => {
        if (!quarantineExists) return false;
        quarantineExists = false;
        snapshot = true;
        return true;
      }),
      lastPromotedFiles: vi.fn(() => (snapshot ? ["src/lib/a.ts"] : [])),
      hasPromotionSnapshot: vi.fn(() => snapshot),
      rollbackPromotion: vi.fn(),
      reapplyPromotion: vi.fn(),
    };
    const check = await empiricalGateMod.promoteWithEmpiricalGate(qm, "t1", process.cwd(), ["src/lib/a.ts"], { checkOnly: true });
    expect(check.passed).toBe(true);
    expect(qm.rollbackPromotion).toHaveBeenCalledTimes(1);

    const real = await empiricalGateMod.promoteWithEmpiricalGate(qm, "t1", process.cwd(), ["src/lib/a.ts"]);
    expect(real.passed).toBe(true);
    expect(qm.reapplyPromotion).toHaveBeenCalledTimes(1);
    expect(qm.rollbackPromotion).toHaveBeenCalledTimes(1);
    expect(TerminalExecutionEngine.verifyProjectBuild).toHaveBeenCalledTimes(2);
  });
});
