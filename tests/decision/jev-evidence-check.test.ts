import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import * as empiricalGateMod from "@/core/governance/empirical-gate";
import * as policyMod from "@/core/config/orchestration-policy";
import { executeTaskNode, setExecutorModeForTests } from "@/core/orchestrator/node-executor";

describe("Passo 10.3 — Verificação de evidência (sombra) via Jev", () => {
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
    const basePol = policyMod.loadOrchestrationPolicy();
    vi.spyOn(policyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...basePol,
      jevExecucao: {
        ...basePol.jevExecucao,
        verificacaoEvidencia: "sombra",
      },
    });
  });

  afterEach(() => {
    setExecutorModeForTests(null);
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  function makeFakeTaskWithMicrobrief() {
    const microbrief = {
      documento: "microbrief",
      idMicrobrief: "mb-10-3",
      idMacrobrief: "macro-1",
      idProjeto: "proj-1",
      cluster: "core",
      nivelModeloSugerido: "medio",
      dependeDe: [],
      reqsCobertos: ["REQ-001"],
      arquivosPermitidos: {
        criar: ["src/lib/calc.ts"],
        modificar: [],
        lerContratos: [],
      },
      statusExecucao: "PENDENTE",
      tentativaAtual: 0,
      medidoPeloHarness: { compilou: null, testes: null, arquivosAlterados: [] },
      interfacesConsome: [],
      interfacesProduz: "export function sum(a: number, b: number): number",
      criteriosAceitePorReq: {
        "REQ-001": ["A função sum(a, b) deve retornar a soma aritmética de a e b."],
      },
      registroCumprimento: [
        {
          reqId: "REQ-001",
          statusDeclarado: "PENDENTE",
          arquivoLinha: "PENDENTE",
          comoFoiImplementado: "PENDENTE",
        },
      ],
    };

    return {
      id: "node-10-3",
      sessionId: "sess-10-3",
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
        microbrief,
      }),
      result: null,
      failureHistory: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      session: {
        id: "sess-10-3",
        canonicalSpec: "# Spec\nREQ-001: somar dois números",
        project: null,
      },
    } as any;
  }

  function setupMocks(opts: {
    executorFileLine: string;
    avaliadorEvidencia: string;
    verdict?: "APPROVED" | "REJECTED";
  }) {
    const task = makeFakeTaskWithMicrobrief();
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

    const executorOutput = [
      "```typescript",
      "// file: src/lib/calc.ts",
      "export function sum(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "```",
      "```yaml relatorio_executor",
      "reqs:",
      "  - id: REQ-001",
      "    status: atendido",
      `    arquivo_linha: "${opts.executorFileLine}"`,
      '    como: "Soma aritmética implementada na função sum"',
      "```",
    ].join("\n");

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

    const verdict = opts.verdict ?? "APPROVED";
    vi.spyOn(DualLensAuditor, "validateType2").mockResolvedValue({
      verdict,
      rawVerdict: verdict === "APPROVED" ? "APROVADO" : "REPROVADO",
      method: "blind_llm",
      rejectionReason: verdict === "APPROVED" ? undefined : "Reprovado no teste.",
      reqVerdicts: [
        {
          id: "REQ-001",
          status: verdict === "APPROVED" ? "implementado" : "ausente",
          evidencia: opts.avaliadorEvidencia,
        },
      ],
    } as any);

    return { task, getLastUpdatedData: () => lastUpdatedData };
  }

  it("evidência coerente → sem divergência e veredito da etapa idêntico ao anterior", async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            "executor_REQ-001": {
              type: "choice",
              choice: "supports",
              confidence: 0.94,
              probabilities: { supports: 0.94, contradicts: 0.03, unrelated: 0.03 },
            },
            "avaliador_REQ-001": {
              type: "choice",
              choice: "supports",
              confidence: 0.96,
              probabilities: { supports: 0.96, contradicts: 0.02, unrelated: 0.02 },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { task, getLastUpdatedData } = setupMocks({
      executorFileLine: "src/lib/calc.ts:1-3",
      avaliadorEvidencia: "src/lib/calc.ts:1-3",
      verdict: "APPROVED",
    });

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.auditVerdict).toBe("APPROVED");
    expect(saved.jevEvidencia.divergencias).toEqual([]);
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_EVIDENCE_CHECK",
        details: expect.objectContaining({
          nodeId: "node-10-3",
          modo: "sombra",
          divergencias: [],
        }),
      })
    );
  });

  it("trecho contraditório → divergência registrada em JEV_EVIDENCE_CHECK e veredito da etapa idêntico ao anterior", async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            "executor_REQ-001": {
              type: "choice",
              choice: "unrelated",
              confidence: 0.89,
              probabilities: { supports: 0.05, contradicts: 0.06, unrelated: 0.89 },
            },
            "avaliador_REQ-001": {
              type: "choice",
              choice: "contradicts",
              confidence: 0.92,
              probabilities: { supports: 0.04, contradicts: 0.92, unrelated: 0.04 },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { task, getLastUpdatedData } = setupMocks({
      executorFileLine: "src/lib/calc.ts:1-3",
      avaliadorEvidencia: "src/lib/calc.ts:1-3",
      verdict: "APPROVED",
    });

    const res = await executeTaskNode(task);
    // Veredito da etapa permanece idêntico (APPROVED / completed)
    expect(res.finalStatus).toBe("completed");
    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.auditVerdict).toBe("APPROVED");
    expect(saved.jevEvidencia.divergencias).toHaveLength(2);
    expect(saved.jevEvidencia.divergencias).toEqual([
      expect.objectContaining({
        reqId: "REQ-001",
        origem: "executor",
        statusDeclarado: "atendido",
        vereditoJev: "unrelated",
      }),
      expect.objectContaining({
        reqId: "REQ-001",
        origem: "avaliador",
        statusDeclarado: "implementado",
        vereditoJev: "contradicts",
      }),
    ]);

    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_EVIDENCE_CHECK",
        details: expect.objectContaining({
          nodeId: "node-10-3",
          modo: "sombra",
          divergencias: expect.arrayContaining([
            expect.objectContaining({ reqId: "REQ-001", origem: "executor", vereditoJev: "unrelated" }),
            expect.objectContaining({ reqId: "REQ-001", origem: "avaliador", vereditoJev: "contradicts" }),
          ]),
        }),
      })
    );
  });

  it("linha/arquivo inexistente → marca evidencia_inexistente em código, NÃO chama Jev e mantém veredito idêntico", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Para não entrar no loop de reenvio do relatório do executor, usamos tarefa sem microbrief no relatório do executor
    // e passamos linha 999 inexistente no avaliador
    const { task, getLastUpdatedData } = setupMocks({
      executorFileLine: "src/lib/calc.ts:999",
      avaliadorEvidencia: "src/lib/calc.ts:999",
      verdict: "APPROVED",
    });
    // Desabilita reenvios do relatório para que validatedExecutorReport fique null (inexistente) e avaliador aponte linha 999
    const defaultPolicy = policyMod.loadOrchestrationPolicy();
    vi.spyOn(policyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...defaultPolicy,
      tentativas: {
        ...defaultPolicy.tentativas,
        maxReenviosSoRelatorio: 0,
      },
    });

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();

    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.auditVerdict).toBe("APPROVED");
    expect(saved.jevEvidencia.porReq["REQ-001"].trechoExecutor).toBe("evidencia_inexistente");
    expect(saved.jevEvidencia.porReq["REQ-001"].trechoAvaliador).toBe("evidencia_inexistente");
  });
});
