import { describe, expect, it } from "vitest";
import {
  blockedTaskReleaseKind,
  canReleaseStaleContractBlocks,
  canRetryExhaustedCodeOnResume,
  blockEventFromTransition,
  keptBlockedNote,
  planBlockedRetryRelease,
  resumeContinuesPendingQueue,
  type ResumeTaskView,
} from "@/core/orchestrator/session-resume";

const contrato = {
  entidades: [],
  enums: [],
  funcoes: [
    {
      nome: "reaisParaCentavos",
      arquivo: "src/lib/money.ts",
      assinatura: "(v: number) => number",
      dono: "mb-core-lib",
      usadoPor: ["mb-back-v1"],
    },
  ],
  rotas: [],
};

const planoOk = {
  contrato,
  etapaId: "mb-front",
  planoStages: [
    { id: "mb-core-lib", arquivos: ["src/lib/money.ts"], dependeDe: [] },
    { id: "mb-back", arquivos: ["src/app/api/v1/cobrancas/route.ts"], dependeDe: ["mb-core-lib"] },
  ],
};

const history = JSON.stringify([
  {
    rejectionReason:
      'Falha no Validador Tipo 1: [CONTRATO] Violação do contrato TypeScript (12 erro(s)): [CONSUMIDOR INEXISTENTE] Função "reaisParaCentavos" cita consumidor inexistente "mb-back-v1".',
  },
]);

describe("Retomar depois de bloqueio de contrato já corrigido no harness", () => {
  it("libera a etapa que citou mb-back-v1 e as que só herdaram o bloqueio", () => {
    const failed = { payload: JSON.stringify(planoOk), failureHistory: history };
    const cascade = { payload: JSON.stringify(planoOk), failureHistory: "[]" };
    expect(blockedTaskReleaseKind(failed)).toBe("stale-contract");
    expect(blockedTaskReleaseKind(cascade)).toBe("cascade");
    expect(canReleaseStaleContractBlocks([failed, cascade, cascade])).toBe(true);
  });

  it("não libera quando o contrato ainda falha ou a falha não é de contrato", () => {
    const ainda = {
      payload: JSON.stringify({
        ...planoOk,
        contrato: {
          ...contrato,
          funcoes: [{ ...contrato.funcoes[0], usadoPor: ["mb-que-nao-existe"] }],
        },
      }),
      failureHistory: history,
    };
    const codigo = {
      payload: JSON.stringify(planoOk),
      failureHistory: JSON.stringify([{ rejectionReason: "Falha no Validador Tipo 1: syntax error" }]),
    };
    expect(blockedTaskReleaseKind(ainda)).toBe("keep");
    expect(blockedTaskReleaseKind(codigo)).toBe("keep");
    expect(canReleaseStaleContractBlocks([ainda])).toBe(false);
    expect(canReleaseStaleContractBlocks([{ payload: "{}", failureHistory: "[]" }])).toBe(false);
    expect(canRetryExhaustedCodeOnResume([ainda])).toBe(false);
    const cascade = { payload: JSON.stringify(planoOk), failureHistory: "[]" };
    expect(canRetryExhaustedCodeOnResume([codigo, cascade])).toBe(true);
    expect(canRetryExhaustedCodeOnResume([cascade])).toBe(false);
  });
});

describe("Retomar libera só a etapa pedida e a cascata dela", () => {
  const schema: ResumeTaskView = {
    id: "e1",
    title: "Etapa 1: schema",
    status: "completed",
    filesScope: ["prisma/schema.prisma"],
    dependencies: [],
    payload: "{}",
    failureHistory: "[]",
  };
  const etapa4: ResumeTaskView = {
    id: "e4",
    title: "Etapa 4",
    status: "blocked",
    filesScope: ["src/lib/api-keys.ts"],
    dependencies: ["e1"],
    payload: "{}",
    failureHistory: JSON.stringify([
      {
        rejectionReason:
          "[critico] src/lib/api-keys.ts:65: campo que não existe no modelo ApiKey. Acrescentar o campo ao schema.",
      },
    ]),
  };
  const cascata4: ResumeTaskView = {
    id: "e5",
    title: "Etapa 5",
    status: "blocked",
    filesScope: ["src/lib/out.ts"],
    dependencies: ["e4"],
    payload: "{}",
    failureHistory: "[]",
  };
  const etapa8: ResumeTaskView = {
    id: "e8",
    title: "Etapa 8",
    status: "blocked",
    filesScope: ["src/lib/webhooks-saida.ts"],
    dependencies: ["e1"],
    payload: "{}",
    failureHistory: JSON.stringify([{ rejectionReason: "[critico] src/lib/webhooks-saida.ts:4: segredo fixo no código." }]),
  };
  const cascata8: ResumeTaskView = {
    id: "e9",
    title: "Etapa 9",
    status: "blocked",
    filesScope: ["src/lib/cobrancas-service.ts"],
    dependencies: ["e8"],
    payload: "{}",
    failureHistory: "[]",
  };

  it("reabre o schema e não libera a etapa que falhou por conta própria", () => {
    const plan = planBlockedRetryRelease("e4", [schema, etapa4, cascata4, etapa8, cascata8]);
    expect(plan.reopen?.ownerId).toBe("e1");
    expect(plan.reopen?.citedFiles).toEqual(["prisma/schema.prisma"]);
    expect(plan.releaseIds.sort()).toEqual(["e4", "e5"]);
    expect(plan.keptBlockedIds.sort()).toEqual(["e8", "e9"]);
  });

  it("provedor fora com etapa pendente não reabre a falha de código", () => {
    const details = JSON.stringify({
      from: "PAUSADA",
      to: "BLOQUEADA",
      event: { type: "SEM_LLM_PERSISTENTE" },
    });
    expect(blockEventFromTransition(details)).toBe("SEM_LLM_PERSISTENTE");
    expect(resumeContinuesPendingQueue("SEM_LLM_PERSISTENTE", 15)).toBe(true);
    expect(resumeContinuesPendingQueue("EXECUTOR_BLOQUEADO", 15)).toBe(false);
    expect(resumeContinuesPendingQueue("SEM_LLM_PERSISTENTE", 0)).toBe(false);
  });

  it("o aviso separa falha própria de quem só espera essa falha", () => {
    const note = keptBlockedNote([schema, etapa4, cascata4, etapa8, cascata8], ["e8", "e9"]);
    expect(note).toContain("1 etapa(s) com falha própria seguem bloqueadas");
    expect(note).toContain("1 etapa(s) que ainda dependem delas também");
    expect(note).not.toContain("2 etapa(s) com falha própria");
  });

  it("falha só no arquivo da etapa não reabre outro dono", () => {
    const plan = planBlockedRetryRelease("e8", [schema, etapa4, cascata4, etapa8, cascata8]);
    expect(plan.reopen).toBeNull();
    expect(plan.releaseIds.sort()).toEqual(["e8", "e9"]);
    expect(plan.keptBlockedIds.sort()).toEqual(["e4", "e5"]);
  });
});
