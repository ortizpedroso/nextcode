import { describe, it, expect } from "vitest";
import {
  BENCH_TETO_PROJETO_USD,
  BENCH_VARIANTES_PADRAO,
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
      tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
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
      tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
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
      tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
    },
  ];

  it("B1.1: relatório inclui linha avaliador-claude", () => {
    const mock: MetricasExecucao[] = [
      {
        projeto: "p1",
        variante: "avaliador-claude",
        repeticao: 1,
        faseFinal: "ENTREGUE",
        tempoSeg: 100,
        etapas: 2,
        aprovadasNa1a: 2,
        tentativasTotais: 0,
        tscProjeto: 0,
        uiCheck: "ausente",
        aceite: { aprovados: 10, total: 10, reprovadosIds: [] },
        custo: { executor: 0.02, avaliador: 0.05, jev: 0, total: 0.07 },
        avaliadorServedBy: ["claude-opus-5-5"],
        timeoutsAvaliador: 0,
        divergenciasEvidencia: 0,
        jevChamadas: 2,
        tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      },
    ];
    const md = formatarRelatorioMarkdown(mock, calcularMedias(mock), "2026-10-16-1500");
    expect(md).toContain("avaliador-claude");
    expect(md).toContain("| 3.00 |");
  });

  it("B1.1: variantes padrão do bench sem --variantes", () => {
    expect(BENCH_VARIANTES_PADRAO).toEqual(["padrao", "sem-jev", "avaliador-deepseek"]);
  });

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

  it("coluna Reprovados lista os ids", () => {
    const mock: MetricasExecucao[] = [
      {
        projeto: "p3",
        variante: "padrao",
        repeticao: 1,
        faseFinal: "ENTREGUE",
        tempoSeg: 100.0,
        etapas: 2,
        aprovadasNa1a: 2,
        tentativasTotais: 0,
        tscProjeto: 0,
        uiCheck: "ausente",
        aceite: {
          aprovados: 10,
          total: 12,
          reprovadosIds: ["L8", "L12"],
          resumoRaw: 'RESUMO {"projeto":"p3","total":12,"aprovados":10,"reprovados":2}',
        },
        custo: {
          executor: 0.01,
          avaliador: 0.01,
          jev: 0,
          total: 0.02,
        },
        avaliadorServedBy: [],
        timeoutsAvaliador: 0,
        divergenciasEvidencia: 0,
        jevChamadas: 0,
        tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      },
      {
        projeto: "p3",
        variante: "padrao",
        repeticao: 2,
        faseFinal: "ENTREGUE",
        tempoSeg: 100.0,
        etapas: 2,
        aprovadasNa1a: 2,
        tentativasTotais: 0,
        tscProjeto: 0,
        uiCheck: "ausente",
        aceite: {
          aprovados: 12,
          total: 12,
          reprovadosIds: [],
          resumoRaw: 'RESUMO {"projeto":"p3","total":12,"aprovados":12,"reprovados":0}',
        },
        custo: {
          executor: 0.01,
          avaliador: 0.01,
          jev: 0,
          total: 0.02,
        },
        avaliadorServedBy: [],
        timeoutsAvaliador: 0,
        divergenciasEvidencia: 0,
        jevChamadas: 0,
        tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      },
    ];

    const medias = calcularMedias(mock);
    const md = formatarRelatorioMarkdown(mock, medias, "2026-10-09-0700");
    expect(md).toContain("| Reprovados |");
    expect(md).toContain("L8, L12");
    expect(md).toContain("—");
  });

  it("execução ERRO_BENCH aparece marcada e conta 0 no aceite", () => {
    const mock: MetricasExecucao[] = [
      {
        projeto: "p4",
        variante: "padrao",
        repeticao: 1,
        faseFinal: "ERRO_BENCH",
        tempoSeg: 0,
        etapas: 0,
        aprovadasNa1a: 0,
        tentativasTotais: 0,
        tscProjeto: 1,
        uiCheck: "ausente",
        aceite: {
          aprovados: 0,
          total: 12,
          reprovadosIds: [],
          resumoRaw: "ERRO_BENCH: subprocess crash",
        },
        custo: {
          executor: 0,
          avaliador: 0,
          jev: 0,
          total: 0.015,
        },
        avaliadorServedBy: [],
        timeoutsAvaliador: 0,
        divergenciasEvidencia: 0,
        jevChamadas: 0,
        erroBench: "subprocess crash",
        tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      },
    ];

    const medias = calcularMedias(mock);
    const md = formatarRelatorioMarkdown(mock, medias, "2026-10-09-0700");
    expect(md).toContain("⚠️ ERRO_BENCH");
    expect(md).toContain("0/12");
    expect(medias[0].aceiteMediaPct).toBe(0);
    expect(medias[0].faseFinalEntreguePct).toBe(0);
  });

  it("médias separam p3 e p4", () => {
    const mock: MetricasExecucao[] = [
      {
        projeto: "p3",
        variante: "padrao",
        repeticao: 1,
        faseFinal: "ENTREGUE",
        tempoSeg: 100.0,
        etapas: 2,
        aprovadasNa1a: 2,
        tentativasTotais: 0,
        tscProjeto: 0,
        uiCheck: "ausente",
        aceite: {
          aprovados: 12,
          total: 12,
          reprovadosIds: [],
        },
        custo: {
          executor: 0.01,
          avaliador: 0.01,
          jev: 0,
          total: 0.02,
        },
        avaliadorServedBy: [],
        timeoutsAvaliador: 0,
        divergenciasEvidencia: 0,
        jevChamadas: 0,
        tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      },
      {
        projeto: "p4",
        variante: "padrao",
        repeticao: 1,
        faseFinal: "ENTREGUE",
        tempoSeg: 120.0,
        etapas: 2,
        aprovadasNa1a: 2,
        tentativasTotais: 0,
        tscProjeto: 0,
        uiCheck: "ausente",
        aceite: {
          aprovados: 10,
          total: 12,
          reprovadosIds: ["C1", "C2"],
        },
        custo: {
          executor: 0.01,
          avaliador: 0.01,
          jev: 0,
          total: 0.02,
        },
        avaliadorServedBy: [],
        timeoutsAvaliador: 0,
        divergenciasEvidencia: 0,
        jevChamadas: 0,
        tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      },
    ];

    const medias = calcularMedias(mock);
    const mP3 = medias.find((m) => m.projeto === "p3");
    const mP4 = medias.find((m) => m.projeto === "p4");
    expect(mP3).toBeDefined();
    expect(mP4).toBeDefined();
    expect(mP3?.aceiteMediaPct).toBe(100);
    expect(mP4?.aceiteMediaPct).toBeCloseTo((10 / 12) * 100, 1);
  });

  it("detalhe por etapa soma igual ao custo do papel", () => {
    const metricaComEtapas: MetricasExecucao = {
      projeto: "p1",
      variante: "padrao",
      repeticao: 1,
      faseFinal: "ENTREGUE",
      tempoSeg: 100.0,
      etapas: 2,
      aprovadasNa1a: 2,
      tentativasTotais: 0,
      tscProjeto: 0,
      uiCheck: "ausente",
      aceite: { aprovados: 10, total: 10, reprovadosIds: [] },
      custo: { executor: 0.035, avaliador: 0.015, jev: 0.001, total: 0.051 },
      avaliadorServedBy: ["nemotron"],
      timeoutsAvaliador: 0,
      divergenciasEvidencia: 0,
      jevChamadas: 2,
      tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
      etapasDetalhe: [
        {
          nodeId: "node-1",
          titulo: "Store",
          cluster: "core",
          nivelPlanejado: "medio",
          fontePlano: "jev",
          executorModelos: ["deepseek-v4-pro"],
          executorTokensEntrada: 1000,
          executorTokensSaida: 500,
          executorUsd: 0.02,
          avaliadorModelos: ["nemotron"],
          avaliadorUsd: 0.008,
        },
        {
          nodeId: "node-2",
          titulo: "API",
          cluster: "backend",
          nivelPlanejado: "medio",
          fontePlano: "jev",
          executorModelos: ["deepseek-v4-pro"],
          executorTokensEntrada: 800,
          executorTokensSaida: 400,
          executorUsd: 0.015,
          avaliadorModelos: ["nemotron"],
          avaliadorUsd: 0.007,
        },
      ],
    };

    const somaExec = metricaComEtapas.etapasDetalhe!.reduce((acc, e) => acc + e.executorUsd, 0);
    const somaEval = metricaComEtapas.etapasDetalhe!.reduce((acc, e) => acc + e.avaliadorUsd, 0);

    expect(Number(somaExec.toFixed(4))).toBe(metricaComEtapas.custo.executor);
    expect(Number(somaEval.toFixed(4))).toBe(metricaComEtapas.custo.avaliador);
  });
});

