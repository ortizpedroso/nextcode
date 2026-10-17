import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeFailureRoutePersistence,
  detectPlanErrorMechanically,
  diagnoseStageFailureWithJev,
  FAILURE_CAUSE_CRITERIA,
  JEV_FAILURE_CAUSE_CRITERIA,
  FAILURE_ROUTE_DONO,
  GENERIC_FILE_NAMES,
  pathInStageScope,
  type JevFailureCause,
} from "@/core/decision/jev-execution-checks";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchMessage, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { IncidentReporter, type FailureAttemptRecord } from "@/core/governance/incident-reporter";
import * as policyMod from "@/core/config/orchestration-policy";
import { executeTaskNode, setExecutorModeForTests } from "@/core/orchestrator/node-executor";
import * as jevMod from "@/core/decision/jev";

const BASELINE_ATTEMPT: FailureAttemptRecord = {
  attemptNumber: 2,
  rejectionReason: "Verificação empírica falhou — promoção desfeita: src/a.ts(1,1): error TS2322",
  filesScope: ["src/a.ts"],
  timestamp: "2026-10-03T00:00:00.000Z",
};

function persistenceForCause(
  causa: JevFailureCause,
  mode: "ativo" | "sombra" | "desligado",
  extra?: Partial<Parameters<typeof computeFailureRoutePersistence>[0]>
) {
  return computeFailureRoutePersistence({
    mode,
    diagnostico: {
      causa,
      confianca: 0.9,
      probabilidades: { [causa]: 0.9 },
      fonte: "jev",
    },
    limiarConfianca: 0.8,
    priorEvaluatorErrorRoutesInHistory: 0,
    baselineFinalStatus: "failed",
    baselineWouldIncrementAttempt: true,
    ...extra,
  });
}

describe("A3.1 — plan_error mecânico e estado curto do diagnóstico", () => {
  beforeEach(() => {
    vi.spyOn(jevMod, "askJevBatch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const escopoEtapa3 = [
    "src/lib/foo.ts",
    "src/lib/bar.ts",
    "src/app/page.tsx",
    "tests/foo.test.ts",
  ];

  it("a) etapa 3 real: REQ-032 + links/route.ts fora do escopo → plan_error mecânico, Jev não chamado", async () => {
    const mecanica = detectPlanErrorMechanically({
      arquivosEscopo: escopoEtapa3,
      criteriosPorReq: {
        "REQ-032": "Implementar src/app/api/v1/links/route.ts conforme contrato REST.",
      },
      reqsCobertos: ["REQ-032"],
      motivoRejeicao: "REQ-032: arquivo src/app/api/v1/links/route.ts ausente do escopo da etapa.",
    });
    expect(mecanica?.causa).toBe("plan_error");
    expect(mecanica?.fonte).toBe("mecanica");

    const diag = await diagnoseStageFailureWithJev({
      nodeId: "node-a3-3",
      etapa: { titulo: "Etapa 3", cluster: "backend", reqs_cobertos: ["REQ-032"] },
      arquivosEscopo: escopoEtapa3,
      criteriosPorReq: {
        "REQ-032": "Implementar src/app/api/v1/links/route.ts conforme contrato REST.",
      },
      motivoRejeicao: "REQ-032: arquivo src/app/api/v1/links/route.ts ausente do escopo da etapa.",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    expect(diag?.causa).toBe("plan_error");
    expect(diag?.fonte).toBe("mecanica");
    expect(jevMod.askJevBatch).not.toHaveBeenCalled();
  });

  it("b) etapa 1 real: vitest.config.ts no critério, fora do escopo → plan_error mecânico", async () => {
    const escopo = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
    const diag = await diagnoseStageFailureWithJev({
      nodeId: "node-a3-1",
      etapa: { titulo: "Etapa 1", cluster: "core", reqs_cobertos: ["REQ-002"] },
      arquivosEscopo: escopo,
      criteriosPorReq: {
        "REQ-002": "Configurar vitest.config.ts para rodar testes de unidade.",
      },
      motivoRejeicao: "REQ-002: vitest.config.ts não está no files_scope desta etapa.",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    expect(diag?.causa).toBe("plan_error");
    expect(diag?.fonte).toBe("mecanica");
    expect(jevMod.askJevBatch).not.toHaveBeenCalled();
  });

  it("c) motivo cita arquivo fora do escopo que o critério não cita → Jev chamado", async () => {
    vi.mocked(jevMod.askJevBatch).mockResolvedValue({
      failure_cause: {
        type: "choice",
        choice: "evaluator_error",
        confidence: 0.88,
        probabilities: {
          wrong_code: 0.02,
          environment: 0.02,
          ambiguous_spec: 0.02,
          plan_error: 0.02,
          evaluator_error: 0.88,
          incomplete_output: 0.04,
        },
      },
    } as any);

    const mecanica = detectPlanErrorMechanically({
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma(a,b)" },
      reqsCobertos: ["REQ-001"],
      motivoRejeicao: "Falta src/lib/outro.ts que não está no critério.",
    });
    expect(mecanica).toBeNull();

    await diagnoseStageFailureWithJev({
      nodeId: "node-a3-c",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma(a,b)" },
      motivoRejeicao: "Falta src/lib/outro.ts que não está no critério.",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    expect(jevMod.askJevBatch).toHaveBeenCalledTimes(1);
  });

  it("d) arquivo do critério dentro do escopo (lib/x.ts × src/lib/x.ts) → não dispara mecânico", async () => {
    vi.mocked(jevMod.askJevBatch).mockResolvedValue({
      failure_cause: {
        type: "choice",
        choice: "wrong_code",
        confidence: 0.9,
        probabilities: {
          wrong_code: 0.9,
          environment: 0.02,
          ambiguous_spec: 0.02,
          plan_error: 0.02,
          evaluator_error: 0.02,
          incomplete_output: 0.02,
        },
      },
    } as any);

    const mecanica = detectPlanErrorMechanically({
      arquivosEscopo: ["src/lib/x.ts"],
      criteriosPorReq: { "REQ-001": "lib/x.ts deve exportar foo" },
      reqsCobertos: ["REQ-001"],
      motivoRejeicao: "REQ-001: foo incorreto em lib/x.ts",
    });
    expect(mecanica).toBeNull();

    await diagnoseStageFailureWithJev({
      nodeId: "node-a3-d",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/x.ts"],
      criteriosPorReq: { "REQ-001": "lib/x.ts deve exportar foo" },
      motivoRejeicao: "REQ-001: foo incorreto em lib/x.ts",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });
    expect(jevMod.askJevBatch).toHaveBeenCalled();
  });

  it("e) motivo de 50.000 caracteres → estado ≤ 8.000 e arquivos_escopo intacto", async () => {
    const escopo = ["src/keep/a.ts", "src/keep/b.ts"];
    const motivoLongo = "REQ-001: ".padEnd(50_000, "x");

    vi.mocked(jevMod.askJevBatch).mockImplementation(async (args) => {
      expect(args.state.length).toBeLessThanOrEqual(8000);
      const parsed = JSON.parse(args.state);
      expect(parsed.arquivos_escopo).toEqual(["src/keep/a.ts", "src/keep/b.ts"]);
      expect(Object.keys(parsed.reqs_com_arquivos)).toContain("REQ-001");
      return {
        failure_cause: {
          type: "choice",
          choice: "wrong_code",
          confidence: 0.7,
          probabilities: { wrong_code: 0.7 },
        },
      } as any;
    });

    await diagnoseStageFailureWithJev({
      nodeId: "node-a3-e",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: escopo,
      criteriosPorReq: { "REQ-001": "src/keep/a.ts implementa foo" },
      motivoRejeicao: motivoLongo,
      tentativa: 2,
      historicoMotivos: ["h1", "h2", "h3"],
      modo: "ativo",
    });
  });

  it("f) as 5 opções de causa (sem plan_error) chegam ao Jev no criteria", async () => {
    vi.mocked(jevMod.askJevBatch).mockImplementation(async (args) => {
      const q = args.questions.failure_cause;
      expect(Object.keys(q.criteria).sort()).toEqual(Object.keys(JEV_FAILURE_CAUSE_CRITERIA).sort());
      expect(Object.keys(q.criteria)).toHaveLength(5);
      return {
        failure_cause: {
          type: "choice",
          choice: "wrong_code",
          confidence: 0.6,
          probabilities: { wrong_code: 0.6 },
        },
      } as any;
    });

    await diagnoseStageFailureWithJev({
      nodeId: "node-a3-f",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma" },
      motivoRejeicao: "REQ-001: lógica errada em src/lib/soma.ts",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });
  });

  it("7) critério cita route.ts fora do escopo mas motivo só src/lib/soma.ts → null (Jev)", async () => {
    const mecanica = detectPlanErrorMechanically({
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: {
        "REQ-001":
          "src/lib/soma.ts exporta soma(a,b) que retorna a+b, usada por src/app/api/soma/route.ts",
      },
      reqsCobertos: ["REQ-001"],
      motivoRejeicao: "REQ-001: soma retorna a-b em src/lib/soma.ts:3",
    });
    expect(mecanica).toBeNull();
  });

  it("8) pathInStageScope page.tsx × homepage.tsx → false", () => {
    expect(pathInStageScope(["page.tsx"], "src/app/homepage.tsx")).toBe(false);
  });

  it("9) motivo cita só route.ts genérico → null", () => {
    const mecanica = detectPlanErrorMechanically({
      arquivosEscopo: ["src/app/api/cobrancas/route.ts"],
      criteriosPorReq: {
        "REQ-010": "src/app/api/links/route.ts responde 201",
      },
      reqsCobertos: ["REQ-010"],
      motivoRejeicao: "REQ-010: route.ts devolve 500",
    });
    expect(mecanica).toBeNull();
  });

  it("10) casos reais etapa 3 e etapa 1 continuam plan_error mecânico", async () => {
    const escopo3 = [
      "src/lib/foo.ts",
      "src/lib/bar.ts",
      "src/app/page.tsx",
      "tests/foo.test.ts",
    ];
    expect(
      detectPlanErrorMechanically({
        arquivosEscopo: escopo3,
        criteriosPorReq: {
          "REQ-032": "Implementar src/app/api/v1/links/route.ts conforme contrato REST.",
        },
        reqsCobertos: ["REQ-032"],
        motivoRejeicao: "REQ-032: arquivo src/app/api/v1/links/route.ts ausente do escopo da etapa.",
      })?.causa
    ).toBe("plan_error");

    expect(
      detectPlanErrorMechanically({
        arquivosEscopo: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        criteriosPorReq: {
          "REQ-002": "Configurar vitest.config.ts para rodar testes de unidade.",
        },
        reqsCobertos: ["REQ-002"],
        motivoRejeicao: "REQ-002: vitest.config.ts não está no files_scope desta etapa.",
      })?.causa
    ).toBe("plan_error");
  });
});

describe("A3.2 — roteamento de falha (sombra / ativo) e incidente", () => {
  it("exporta GENERIC_FILE_NAMES para uso em testes e políticas", () => {
    expect(GENERIC_FILE_NAMES.has("page.tsx")).toBe(true);
    expect(GENERIC_FILE_NAMES.has("vitest.config.ts")).toBe(false);
  });

  it("relatório de incidente sem dono permanece idêntico ao formato anterior", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    const history = [BASELINE_ATTEMPT];
    const golden = `# Relatório de Incidente de Evolução (Política D-RANHO - Trava T6)

> **Severidade:** ALTA — ciclo de tentativas automáticas esgotado (${history.length}/3)
> **Tarefa:** \`N-golden\` — API
> **Cluster Afetado:** \`backend\`
> **Data de Registro:** 2026-10-03T12:00:00.000Z

---

## 1. Causa principal
**Type-check real do projeto reprovado (promoção desfeita)**

As tentativas falharam por causas diferentes: Type-check real do projeto reprovado (promoção desfeita).

**Último erro (tentativa 2):**
\`\`\`text
Verificação empírica falhou — promoção desfeita: src/a.ts(1,1): error TS2322
\`\`\`

## 2. O que você precisa fazer
O código passou nas auditorias isoladas, mas quebra o build do projeto mesclado. Abra os arquivos citados nos erros \`TS\` abaixo — normalmente é uma assinatura/export que o resto do projeto espera e o código gerado mudou. Corrija a interface esperada na Spec ou ajuste o arquivo manualmente.

- **Arquivos envolvidos:** \`src/a.ts\`
- **Para liberar:** depois de ajustar, clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo de tentativas começa do zero.

## 3. Histórico das tentativas rejeitadas

### Tentativa 2 — Type-check real do projeto reprovado (promoção desfeita)
- **Data/Hora:** 2026-10-03T00:00:00.000Z
- **Escopo:** \`src/a.ts\`
- **Motivo:** Verificação empírica falhou — promoção desfeita: src/a.ts(1,1): error TS2322

## 4. Estado do grafo (DAG)
- Esta etapa está \`blocked\` e não será executada de novo automaticamente (nem pelo botão "Executar nó").
- Etapas que não dependem dela seguem executando normalmente.
`;
    const report = IncidentReporter.generateIncidentReport("N-golden", "API", "backend", history, {
      maxAttempts: 3,
    });
    expect(report).toBe(golden);
    vi.useRealTimers();
  });

  it("relatório com dono inclui linha Dono", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    const report = IncidentReporter.generateIncidentReport("N1", "API", "backend", [BASELINE_ATTEMPT], {
      maxAttempts: 3,
      dono: "analista (erro do plano)",
    });
    expect(report).toContain("**Dono:** analista (erro do plano)");
    vi.useRealTimers();
  });

  const causes: JevFailureCause[] = [
    "plan_error",
    "ambiguous_spec",
    "evaluator_error",
    "wrong_code",
    "incomplete_output",
    "environment",
  ];

  it.each(causes)("sombra %s: persistência igual a desligado + emitWouldAct", (causa) => {
    const desligado = persistenceForCause(causa, "desligado")!;
    const sombra = persistenceForCause(causa, "sombra")!;
    expect(sombra.finalStatus).toBe(desligado.finalStatus);
    expect(sombra.incrementAttempt).toBe(desligado.incrementAttempt);
    expect(sombra.planErrorSkipAttempt).toBe(desligado.planErrorSkipAttempt);
    expect(sombra.evaluatorErrorFreeRetry).toBe(desligado.evaluatorErrorFreeRetry);
    expect(sombra.blockedByPlanError).toBe(desligado.blockedByPlanError);
    expect(sombra.emitWouldAct).toBe(true);
    expect(sombra.dono).toBe(FAILURE_ROUTE_DONO[causa]);
  });

  it("ativo plan_error: blocked, não incrementa tentativa", () => {
    const route = persistenceForCause("plan_error", "ativo", {
      diagnostico: {
        causa: "plan_error",
        confianca: 1,
        probabilidades: { plan_error: 1 },
        fonte: "mecanica",
        foraDoEscopo: [{ req: "REQ-032", arquivo: "src/app/api/v1/links/route.ts" }],
      },
    })!;
    expect(route.finalStatus).toBe("blocked");
    expect(route.planErrorSkipAttempt).toBe(true);
    expect(route.incrementAttempt).toBe(false);
    expect(route.dono).toBe("analista (erro do plano)");
  });

  it("ativo evaluator_error: 1ª vez reavaliação sem tentativa; 2ª como wrong_code", () => {
    const first = persistenceForCause("evaluator_error", "ativo")!;
    expect(first.evaluatorErrorFreeRetry).toBe(true);
    expect(first.finalStatus).toBe("failed");
    expect(first.incrementAttempt).toBe(false);

    const second = persistenceForCause("evaluator_error", "ativo", {
      priorEvaluatorErrorRoutesInHistory: 1,
    })!;
    expect(second.evaluatorErrorFreeRetry).toBe(false);
    expect(second.dono).toBe(FAILURE_ROUTE_DONO.wrong_code);
    expect(second.acao).toBe("comportamento_wrong_code");
  });

  it("mecânica plan_error aplica roteamento mesmo abaixo do limiar Jev", () => {
    const route = computeFailureRoutePersistence({
      mode: "sombra",
      diagnostico: {
        causa: "plan_error",
        confianca: 0.2,
        probabilidades: { plan_error: 1 },
        fonte: "mecanica",
      },
      limiarConfianca: 0.8,
      priorEvaluatorErrorRoutesInHistory: 0,
      baselineFinalStatus: "failed",
      baselineWouldIncrementAttempt: true,
    });
    expect(route?.emitWouldAct).toBe(true);
  });
});

describe("A3.2b — dono no incidente só em roteamento ativo", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  const AMBIGUOUS_JEV_RESPONSE = {
    model: "jev-1.13.0",
    answers: {
      failure_cause: {
        type: "choice",
        choice: "ambiguous_spec",
        confidence: 0.91,
        probabilities: {
          wrong_code: 0.02,
          environment: 0.02,
          ambiguous_spec: 0.91,
          plan_error: 0.02,
          evaluator_error: 0.02,
          incomplete_output: 0.01,
        },
      },
    },
  };

  function makeBlockedAmbiguousTask() {
    return {
      id: "node-a3-2b",
      sessionId: "sess-a3-2b",
      specVersion: 1,
      title: "Etapa ambígua",
      role: "executor-core",
      cluster: "core",
      status: "pending",
      attempts: 2,
      maxAttempts: 4,
      dependencies: "[]",
      filesScope: JSON.stringify(["src/lib/calc.ts"]),
      payload: JSON.stringify({
        goal: "# Spec\nREQ-001: critério contraditório",
        nodeFiles: ["src/lib/calc.ts"],
        cluster: "core",
        reqsCobertos: ["REQ-001"],
      }),
      result: null,
      failureHistory: JSON.stringify([
        {
          attemptNumber: 1,
          rejectionReason: "REQ-001 falhou na tentativa 1",
          filesScope: ["src/lib/calc.ts"],
          timestamp: "2026-10-01T00:00:00.000Z",
        },
        {
          attemptNumber: 2,
          rejectionReason: "REQ-001 falhou na tentativa 2",
          filesScope: ["src/lib/calc.ts"],
          timestamp: "2026-10-02T00:00:00.000Z",
        },
      ]),
      createdAt: new Date(),
      updatedAt: new Date(),
      session: {
        id: "sess-a3-2b",
        canonicalSpec: "# Spec\nREQ-001: critério contraditório",
        project: null,
      },
    };
  }

  function mockExecutionHarness(task: ReturnType<typeof makeBlockedAmbiguousTask>) {
    vi.spyOn(prisma.taskNode, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.taskNode, "findMany").mockResolvedValue([] as any);
    vi.spyOn(prisma.message, "findFirst").mockResolvedValue(null as any);
    const createdChatMessages: { content: string }[] = [];
    vi.spyOn(prisma.message, "create").mockImplementation((async (args: { data: { content: string } }) => {
      createdChatMessages.push(args.data);
      return { id: "msg-a3-2b", ...args.data };
    }) as any);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
    vi.spyOn(prisma.taskNode, "update").mockImplementation((async (args: any) => {
      return { ...task, ...args.data };
    }) as any);

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(async (opts) => {
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
      rejectionReason: "REQ-002 contraditório: pede taxa de 2% e isenção ao mesmo tempo",
      reqVerdicts: [{ id: "REQ-001", status: "ausente", evidencia: "-" }],
    } as any);

    return { createdChatMessages };
  }

  function incidentBodyFromChat(chatContent: string): string {
    const marker = "especificação ambígua (Jev)";
    const idx = chatContent.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    return chatContent.slice(chatContent.indexOf("\n\n", idx) + 2);
  }

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    setExecutorModeForTests("chamada_unica");
    vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue([] as any);
    vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue([] as any);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
  });

  afterEach(() => {
    setExecutorModeForTests(null);
    vi.useRealTimers();
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("3ª tentativa + ambiguous_spec bloqueada: sombra — relatório sem Dono, trilha FAILURE_ROUTE_WOULD_ACT", async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const defaultPolicy = policyMod.loadOrchestrationPolicy();
    vi.spyOn(policyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...defaultPolicy,
      jevExecucao: {
        ...defaultPolicy.jevExecucao,
        bloqueioSpecAmbigua: "ativo",
        roteamentoFalha: "sombra",
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(AMBIGUOUS_JEV_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const task = makeBlockedAmbiguousTask();
    const { createdChatMessages } = mockExecutionHarness(task);
    const res = await executeTaskNode(task);

    expect(res.finalStatus).toBe("blocked");
    expect(createdChatMessages).toHaveLength(1);

    const incidentInChat = incidentBodyFromChat(createdChatMessages[0].content);
    expect(incidentInChat).not.toContain("**Dono:**");

    const history: FailureAttemptRecord[] = JSON.parse(
      JSON.stringify([
        ...(JSON.parse(task.failureHistory!) as FailureAttemptRecord[]),
        {
          attemptNumber: 3,
          rejectionReason: "REQ-002 contraditório: pede taxa de 2% e isenção ao mesmo tempo",
          filesScope: ["src/lib/calc.ts"],
          timestamp: "2026-10-03T12:00:00.000Z",
          diagnostico: {
            causa: "ambiguous_spec",
            confianca: 0.91,
            probabilidades: { ambiguous_spec: 0.91 },
          },
        },
      ])
    );
    const preA3Report = IncidentReporter.generateIncidentReport(
      task.id,
      task.title,
      task.cluster,
      history,
      {
        maxAttempts: task.maxAttempts,
        unblockHint:
          'Ajuste a Spec Canônica para eliminar a ambiguidade apontada no diagnóstico Jev e depois clique em "Desbloquear / Re-tentar Etapa" no painel da DAG.',
      }
    );
    expect(incidentInChat).toBe(preA3Report);

    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "FAILURE_ROUTE_WOULD_ACT",
        details: expect.objectContaining({
          nodeId: task.id,
          tentativa: 3,
          causa: "ambiguous_spec",
          dono: "elicitador / fundador",
        }),
      })
    );
  });

  it("3ª tentativa + ambiguous_spec bloqueada: ativo — relatório com Dono elicitador / fundador", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const defaultPolicy = policyMod.loadOrchestrationPolicy();
    vi.spyOn(policyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...defaultPolicy,
      jevExecucao: {
        ...defaultPolicy.jevExecucao,
        bloqueioSpecAmbigua: "ativo",
        roteamentoFalha: "ativo",
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(AMBIGUOUS_JEV_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const task = makeBlockedAmbiguousTask();
    const { createdChatMessages } = mockExecutionHarness(task);
    await executeTaskNode(task);

    expect(createdChatMessages).toHaveLength(1);
    const incidentInChat = incidentBodyFromChat(createdChatMessages[0].content);
    expect(incidentInChat).toContain("**Dono:** elicitador / fundador");
  });
});

describe("A3.3b — plan_error só mecânico no Jev", () => {
  beforeEach(() => {
    vi.spyOn(jevMod, "askJevBatch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("critérios enviados ao Jev não contêm plan_error (5 opções)", async () => {
    vi.mocked(jevMod.askJevBatch).mockImplementation(async (args) => {
      const q = args.questions.failure_cause;
      expect(Object.keys(q.criteria).sort()).toEqual(Object.keys(JEV_FAILURE_CAUSE_CRITERIA).sort());
      expect(Object.keys(q.criteria)).toHaveLength(5);
      expect(q.criteria).not.toHaveProperty("plan_error");
      return {
        failure_cause: {
          type: "choice",
          choice: "wrong_code",
          confidence: 0.9,
          probabilities: { wrong_code: 0.9 },
        },
      } as any;
    });

    await diagnoseStageFailureWithJev({
      nodeId: "node-a3-3b-criteria",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma" },
      motivoRejeicao: "REQ-001: lógica errada em src/lib/soma.ts",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });
  });

  it("resposta plan_error do Jev (mock) vira null", async () => {
    vi.mocked(jevMod.askJevBatch).mockResolvedValue({
      failure_cause: {
        type: "choice",
        choice: "plan_error",
        confidence: 0.95,
        probabilities: { plan_error: 0.95 },
      },
    } as any);

    const diag = await diagnoseStageFailureWithJev({
      nodeId: "node-a3-3b-null",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma" },
      motivoRejeicao: "REQ-001: falta o arquivo src/lib/outro.ts",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    expect(diag).toBeNull();
  });

  it("Jev responde plan_error → trilha com descartado, não available:false", async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    vi.mocked(jevMod.askJevBatch).mockResolvedValue({
      failure_cause: {
        type: "choice",
        choice: "plan_error",
        confidence: 0.95,
        probabilities: { plan_error: 0.95 },
      },
    } as any);

    const diag = await diagnoseStageFailureWithJev({
      nodeId: "node-a3-5-descartado",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma" },
      motivoRejeicao: "REQ-001: falta o arquivo src/lib/outro.ts",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    expect(diag).toBeNull();
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_FAILURE_DIAGNOSIS",
        details: expect.objectContaining({
          nodeId: "node-a3-5-descartado",
          available: true,
          descartado: "plan_error",
          confianca: 0.95,
        }),
      })
    );
    const failureLogs = telemetrySpy.mock.calls.filter((c) => c[0].action === "JEV_FAILURE_DIAGNOSIS");
    expect(failureLogs.some((c) => c[0].details?.available === false)).toBe(false);
  });

  it("Jev sem resposta → trilha available:false sem descartado", async () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    vi.mocked(jevMod.askJevBatch).mockResolvedValue(null);

    const diag = await diagnoseStageFailureWithJev({
      nodeId: "node-a3-5-indisponivel",
      etapa: { titulo: "T", cluster: "core", reqs_cobertos: ["REQ-001"] },
      arquivosEscopo: ["src/lib/soma.ts"],
      criteriosPorReq: { "REQ-001": "src/lib/soma.ts exporta soma" },
      motivoRejeicao: "REQ-001: lógica errada",
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    expect(diag).toBeNull();
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_FAILURE_DIAGNOSIS",
        details: {
          nodeId: "node-a3-5-indisponivel",
          tentativa: 1,
          modo: "ativo",
          available: false,
        },
      })
    );
    const failureLogs = telemetrySpy.mock.calls.filter((c) => c[0].action === "JEV_FAILURE_DIAGNOSIS");
    expect(failureLogs.every((c) => !("descartado" in (c[0].details ?? {})))).toBe(true);
  });
});
