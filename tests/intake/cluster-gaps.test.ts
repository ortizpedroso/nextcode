import { describe, it, expect } from "vitest";
import { detectClusterGaps, clusterNamedByHuman } from "@/core/intake/cluster-gaps";
import { contractStagesForNode, stagesFromContract, validateContract } from "@/core/orchestrator/project-contract";

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
});
