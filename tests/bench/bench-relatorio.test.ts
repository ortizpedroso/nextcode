import { describe, it, expect } from "vitest";
import {
  calcularMedias,
  formatarRelatorioMarkdown,
  type MetricasExecucao,
} from "../../scripts/bench";

describe("P2.2 — Agregação e Relatório do Benchmark", () => {
  const mockExecucoes: MetricasExecucao[] = [
    {
      projeto: "p1",
      variante: "padrao",
      repeticao: 1,
      faseFinal: "ENTREGUE",
      tempoSeg: 120.0,
      etapas: 3,
      aprovadasNa1a: 3,
      tentativasTotais: 0,
      tscProjeto: 0,
      uiCheck: "ausente",
      aceite: {
        aprovados: 10,
        total: 10,
        reprovadosIds: [],
        resumoRaw: 'RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}',
      },
      custo: {
        executor: 0.03,
        avaliador: 0.01,
        jev: 0.001,
        total: 0.041,
      },
      avaliadorServedBy: ["ollama/nemotron-3-ultra"],
      timeoutsAvaliador: 0,
      divergenciasEvidencia: 0,
      jevChamadas: 3,
    },
    {
      projeto: "p1",
      variante: "padrao",
      repeticao: 2,
      faseFinal: "ENTREGUE",
      tempoSeg: 130.0,
      etapas: 3,
      aprovadasNa1a: 2,
      tentativasTotais: 1,
      tscProjeto: 0,
      uiCheck: "ausente",
      aceite: {
        aprovados: 9,
        total: 10,
        reprovadosIds: ["A5"],
        resumoRaw: 'RESUMO {"projeto":"p1","total":10,"aprovados":9,"reprovados":1}',
      },
      custo: {
        executor: 0.035,
        avaliador: 0.012,
        jev: 0.001,
        total: 0.048,
      },
      avaliadorServedBy: ["ollama/nemotron-3-ultra"],
      timeoutsAvaliador: 0,
      divergenciasEvidencia: 0,
      jevChamadas: 3,
    },
    {
      projeto: "p1",
      variante: "sem-jev",
      repeticao: 1,
      faseFinal: "BLOQUEADO",
      tempoSeg: 90.0,
      etapas: 2,
      aprovadasNa1a: 1,
      tentativasTotais: 2,
      tscProjeto: 1,
      uiCheck: "ausente",
      aceite: {
        aprovados: 5,
        total: 10,
        reprovadosIds: ["A1", "A2", "A3", "A4", "A5"],
        resumoRaw: 'RESUMO {"projeto":"p1","total":10,"aprovados":5,"reprovados":5}',
      },
      custo: {
        executor: 0.02,
        avaliador: 0.005,
        jev: 0,
        total: 0.025,
      },
      avaliadorServedBy: ["ollama/nemotron-3-ultra"],
      timeoutsAvaliador: 0,
      divergenciasEvidencia: 0,
      jevChamadas: 0,
    },
  ];

  it("médias por projeto × variante", () => {
    const medias = calcularMedias(mockExecucoes);
    const p1Padrao = medias.find((m) => m.projeto === "p1" && m.variante === "padrao");
    expect(p1Padrao).toBeDefined();
    expect(p1Padrao?.execucoes).toBe(2);
    expect(p1Padrao?.faseFinalEntreguePct).toBe(100);
    expect(p1Padrao?.tempoMedioSeg).toBe(125.0);
    expect(p1Padrao?.aprovadasNa1aMedia).toBe(2.5);
    expect(p1Padrao?.tentativasTotaisMedia).toBe(0.5);
    expect(p1Padrao?.tscZeroErrosPct).toBe(100);
    expect(p1Padrao?.custoTotalMedio).toBeCloseTo(0.0445, 4);

    const p1SemJev = medias.find((m) => m.projeto === "p1" && m.variante === "sem-jev");
    expect(p1SemJev?.execucoes).toBe(1);
    expect(p1SemJev?.faseFinalEntreguePct).toBe(0);
    expect(p1SemJev?.tscZeroErrosPct).toBe(0);
    expect(p1SemJev?.custoJevMedio).toBe(0);
  });

  it("aceite agregado", () => {
    const medias = calcularMedias(mockExecucoes);
    const p1Padrao = medias.find((m) => m.projeto === "p1" && m.variante === "padrao");
    // (10/10*100 + 9/10*100) / 2 = 95%
    expect(p1Padrao?.aceiteMediaPct).toBe(95.0);

    const p1SemJev = medias.find((m) => m.projeto === "p1" && m.variante === "sem-jev");
    expect(p1SemJev?.aceiteMediaPct).toBe(50.0);
  });

  it("execução com fase diferente de ENTREGUE aparece marcada", () => {
    const medias = calcularMedias(mockExecucoes);
    const md = formatarRelatorioMarkdown(mockExecucoes, medias, "2026-10-09-0700");
    expect(md).toContain("⚠️ BLOQUEADO");
    expect(md).toContain("ENTREGUE");
  });
});
