import { describe, it, expect } from "vitest";
import { detectClusterGaps, clusterNamedByHuman } from "@/core/intake/cluster-gaps";
import {
  contractStagesForNode,
  planContractErrorsFromPayload,
  renderConformance,
  resolvePlanStageId,
  restoreCutStageIds,
  stagesFromContract,
  validateContract,
} from "@/core/orchestrator/project-contract";

describe("lacunas de cluster", () => {
  it("domínio sem core devolve core_ausente uma vez; exceção confirmada cala a lacuna", () => {
    const base = {
      arquivos: ["src/app/api/items/route.ts", "src/app/page.tsx"],
      requisitosTexto: "A tela lista itens da API. Entidade Item com invariante de nome único.",
      notas: [],
      entidades: 1,
      clustersPresentes: ["backend", "frontend"],
    };
    const gaps = detectClusterGaps(base).map((g) => g.gap);
    expect(gaps).toContain("core_ausente");
    expect(gaps).toContain("integracao_ausente");
    expect(gaps).not.toContain("frontend_ausente");
    expect(gaps).not.toContain("backend_ausente");

    const depois = detectClusterGaps({
      ...base,
      excecoes: [
        { gap: "core_ausente", cluster: "backend" },
        { gap: "integracao_ausente", cluster: "integration" },
      ],
      clustersPresentes: ["backend", "frontend", "integration"],
    });
    expect(depois.map((g) => g.gap)).not.toContain("core_ausente");
    expect(depois.map((g) => g.gap)).not.toContain("integracao_ausente");
  });

  it("landing sem domínio não inventa core", () => {
    const gaps = detectClusterGaps({
      arquivos: ["src/app/page.tsx"],
      requisitosTexto: "Página estática com o título do produto.",
      notas: [],
      entidades: 0,
      clustersPresentes: ["frontend"],
    });
    expect(gaps.map((g) => g.gap)).not.toContain("core_ausente");
    expect(gaps.map((g) => g.gap)).not.toContain("backend_ausente");
  });

  it("humano nomeia o cluster", () => {
    expect(clusterNamedByHuman("pode ficar no backend")).toBe("backend");
    expect(clusterNamedByHuman("a integração fica junto")).toBe("integration");
    expect(clusterNamedByHuman("sim, pode seguir")).toBeNull();
  });
});

describe("validateContract no grafo inteiro", () => {
  const contrato = {
    entidades: [],
    enums: [],
    funcoes: [
      { nome: "criar", arquivo: "src/core/criar.ts", assinatura: "string", dono: "core-1", usadoPor: ["api-1"] },
    ],
    rotas: [],
  };

  it("um único estágio com dependeDe vazio acusa dono inexistente no consumidor", () => {
    const erros = validateContract(contrato, [{ id: "core-1", arquivos: ["src/core/criar.ts"], dependeDe: [] }]);
    expect(erros.some((e) => e.includes("INEXISTENTE"))).toBe(true);
  });

  it("o grafo derivado do contrato aceita dono e consumidor", () => {
    const stages = stagesFromContract(contrato);
    expect(stages.map((s) => s.id).sort()).toEqual(["api-1", "core-1"]);
    const api = stages.find((s) => s.id === "api-1");
    expect(api?.dependeDe).toContain("core-1");
    expect(validateContract(contrato, stages)).toEqual([]);
  });

  it("planoStages do nó tem prioridade sobre o grafo derivado", () => {
    const stages = contractStagesForNode(contrato, "core-1", ["src/core/criar.ts"], [
      { id: "core-1", arquivos: ["src/core/criar.ts"], dependeDe: [] },
      { id: "api-1", arquivos: ["src/app/api/route.ts"], dependeDe: ["core-1"] },
    ]);
    expect(validateContract(contrato, stages)).toEqual([]);
  });

  it("id cortado pelo harness volta ao id do contrato; id diferente continua reprovando", () => {
    const contrato = {
      entidades: [],
      enums: [],
      funcoes: [
        {
          nome: "reaisParaCentavos",
          arquivo: "src/lib/money.ts",
          assinatura: "(v: number) => number",
          dono: "mb-core-v1",
          usadoPor: ["mb-back-v1"],
        },
      ],
      rotas: [],
    };
    const stages = [
      { id: "mb-core", arquivos: ["src/lib/money.ts"], dependeDe: [] },
      { id: "mb-back", arquivos: ["src/app/api/cobrancas/route.ts"], dependeDe: ["mb-core"] },
      { id: "mb-front", arquivos: ["src/app/layout.tsx", "src/app/page.tsx", "src/app/globals.css"], dependeDe: ["mb-back"] },
    ];
    expect(validateContract(contrato, stages).some((e) => e.includes("INEXISTENTE"))).toBe(true);
    const restored = restoreCutStageIds(contrato, stages);
    expect(restored.map((s) => s.id)).toEqual(["mb-core-v1", "mb-back-v1", "mb-front"]);
    expect(restored.find((s) => s.id === "mb-back-v1")?.dependeDe).toEqual(["mb-core-v1"]);
    expect(validateContract(contrato, restored)).toEqual([]);
    expect(resolvePlanStageId("mb-core", restored)).toBe("mb-core-v1");
    expect(renderConformance(contrato, resolvePlanStageId("mb-core", restored))).toContain("reaisParaCentavos");

    const ambiguo = restoreCutStageIds(
      {
        ...contrato,
        funcoes: [{ ...contrato.funcoes[0], usadoPor: ["mb-back-v1", "mb-back-v2"] }],
      },
      stages
    );
    expect(ambiguo.find((s) => s.id === "mb-back")).toBeTruthy();
  });

  it("contrato quebrado é do plano: não chega ao executor; id com sufixo cortado não quebra", () => {
    const quebrado = {
      contrato,
      etapaId: "mb-front",
      planoStages: [{ id: "mb-front", arquivos: ["src/app/page.tsx"], dependeDe: [] }],
    };
    const erros = planContractErrorsFromPayload(JSON.stringify(quebrado));
    expect(erros.some((e) => e.includes("CONSUMIDOR INEXISTENTE"))).toBe(true);
    const casado = {
      contrato,
      etapaId: "core-1",
      planoStages: [
        { id: "core-1", arquivos: ["src/core/criar.ts"], dependeDe: [] },
        { id: "api-1", arquivos: ["src/app/api/route.ts"], dependeDe: ["core-1"] },
      ],
    };
    expect(planContractErrorsFromPayload(JSON.stringify(casado))).toEqual([]);
    expect(planContractErrorsFromPayload(null)).toEqual([]);
  });

  it("o grafo novo conserva o sufixo -vN do id da etapa", () => {
    const stages = contractStagesForNode(
      { entidades: [], enums: [], funcoes: [], rotas: [] },
      "mb-front",
      ["src/app/page.tsx"],
      [{ id: "mb-back-v1", arquivos: ["src/lib/money.ts"], dependeDe: ["mb-core-v2"] }]
    );
    expect(stages).toEqual([
      { id: "mb-back-v1", arquivos: ["src/lib/money.ts"], dependeDe: ["mb-core-v2"] },
    ]);
  });
});
