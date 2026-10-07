import { describe, it, expect } from "vitest";
import {
  buildP1ProjectArtifacts,
  validateSpecMechanical,
  validateMacrobriefMechanical,
  validateMicrobriefMechanical,
  stampHarnessMeasuredFields,
  validateExecutorReportMechanical,
  classifyLens2Divergence,
  validateEvaluatorVerdictMechanical,
  type EvaluatorVerdictDocument,
} from "@/core/templates/artifact-templates";
import { renderCanonicalSpecDocument, parseSpecDocument } from "@/core/intake/spec-format";

describe("Templates Canônicos (P1) e Conferências Mecânicas (P12 / T2 / T3 / T4 / T8b)", () => {
  it("valida Spec, Macrobrief e os 3 Microbriefs do Projeto P1 (API de Tarefas)", () => {
    const { spec, macrobrief, microbriefs } = buildP1ProjectArtifacts();

    const specCheck = validateSpecMechanical(spec, { requireApprovalForPhase2: true });
    expect(specCheck.valid).toBe(true);
    expect(specCheck.errors).toEqual([]);

    const macroCheck = validateMacrobriefMechanical(macrobrief, spec.requisitosIds);
    expect(macroCheck.valid).toBe(true);
    expect(macroCheck.errors).toEqual([]);

    for (const mb of microbriefs) {
      const mbCheck = validateMicrobriefMechanical(mb, macrobrief);
      expect(mbCheck.valid).toBe(true);
    }
  });

  it("renderiza e re-interpreta requisitos_ids e requisitos em src/core/intake/spec-format.ts", () => {
    const doc = renderCanonicalSpecDocument({
      titulo: "API REST de Tarefas (P1)",
      status: "aprovada",
      data: "2026-10-06",
      objetivo: "CRUD de tarefas em memória.",
      stack: ["Next.js", "TypeScript"],
      modulos: [],
      entidades: [],
      arquivosAfetados: [
        "src/lib/tarefas-store.ts",
        "src/app/api/tarefas/route.ts",
        "src/app/api/tarefas/[id]/route.ts",
      ],
      requisitosIds: ["REQ-001", "REQ-002"],
      requisitos: [
        { id: "REQ-001", titulo: "Store em memória", criterio: "Exportar funções CRUD tipadas." },
        { id: "REQ-002", titulo: "GET /api/tarefas", criterio: "Retornar HTTP 200 com array JSON." },
      ],
    });

    const parsed = parseSpecDocument(doc);
    expect(parsed).not.toBeNull();
    expect(parsed!.requisitosIds).toEqual(["REQ-001", "REQ-002"]);
    expect(parsed!.requisitos).toEqual([
      { id: "REQ-001", titulo: "Store em memória", criterio: "Exportar funções CRUD tipadas." },
      { id: "REQ-002", titulo: "GET /api/tarefas", criterio: "Retornar HTTP 200 com array JSON." },
    ]);
  });

  it("detecta violação T8b no Macrobrief: REQ faltando, arquivo duplicado entre Microbriefs e ciclo na DAG", () => {
    const { spec, macrobrief } = buildP1ProjectArtifacts();

    const brokenMacro = structuredClone(macrobrief);
    // Remove REQ-005 e adiciona REQ-999 inventado
    brokenMacro.microbriefs[2].reqs = ["REQ-004", "REQ-999"];
    // Coloca o mesmo arquivo em MB-002 e MB-003 (conflito de escrita T3)
    brokenMacro.microbriefs[2].arquivos = ["src/app/api/tarefas/route.ts"];
    // Cria ciclo MB-001 -> MB-002 -> MB-001
    brokenMacro.microbriefs[0].dependeDe = ["MB-002"];

    const res = validateMacrobriefMechanical(brokenMacro, spec.requisitosIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("REQ-999"))).toBe(true);
    expect(res.errors.some((e) => e.includes("REQ-005"))).toBe(true);
    expect(res.errors.some((e) => e.includes("[TRAVA T3 / T8b]"))).toBe(true);
    expect(res.errors.some((e) => e.includes("[MACROBRIEF DAG] Ciclo"))).toBe(true);
  });

  it("sobrescreve medido_pelo_harness no Relatório do Executor e valida arquivo:linha contra o código real (P12)", () => {
    const { microbriefs } = buildP1ProjectArtifacts();
    const mb2 = structuredClone(microbriefs[1]);

    // Simula modelo tentando mentir que compilou=true antes da medição do harness
    mb2.medidoPeloHarness.compilou = true;
    mb2.statusExecucao = "CONCLUIDO";
    mb2.registroCumprimento = [
      {
        reqId: "REQ-002",
        statusDeclarado: "atendido",
        arquivoLinha: "src/app/api/tarefas/route.ts:1-6",
        comoFoiImplementado: "Handler GET retorna lista de tarefas com status 200.",
      },
      {
        reqId: "REQ-003",
        statusDeclarado: "atendido",
        arquivoLinha: "src/app/api/tarefas/route.ts:8-20",
        comoFoiImplementado: "Handler POST valida titulo e retorna 201 Created.",
      },
    ];

    const stamped = stampHarnessMeasuredFields(mb2, {
      compilou: true,
      testes: { executados: 4, passaram: 4, falharam: 0, comando: "vitest run" },
      arquivosAlterados: [
        {
          caminho: "src/app/api/tarefas/route.ts",
          operacao: "criado",
          linhasAdicionadas: 20,
          linhasRemovidas: 0,
        },
      ],
    });

    const realCode20Lines = Array.from({ length: 20 }, (_, i) => `// linha ${i + 1}`).join("\n");
    const okCheck = validateExecutorReportMechanical(stamped, {
      "src/app/api/tarefas/route.ts": realCode20Lines,
    });
    expect(okCheck.valid).toBe(true);

    // Se o Executor citar linha 99 num arquivo de 20 linhas -> falha de formato do relatório (reportFormatOnlyError = true)
    const badLineReport = structuredClone(stamped);
    badLineReport.registroCumprimento[1].arquivoLinha = "src/app/api/tarefas/route.ts:8-99";
    const badCheck = validateExecutorReportMechanical(badLineReport, {
      "src/app/api/tarefas/route.ts": realCode20Lines,
    });
    expect(badCheck.valid).toBe(false);
    expect(badCheck.reportFormatOnlyError).toBe(true);
    expect(badCheck.errors[0]).toContain("possui 20 linha(s)");
  });

  it("pega divergência plantada na Lente 2 (alucinação do Executor) e força REPROVADO no Veredito", () => {
    const divParcial = classifyLens2Divergence("parcial", "atendido");
    expect(divParcial).toEqual({
      tipoDivergencia: "divergencia_otimista",
      isCriticalHallucination: true,
    });

    const divAusente = classifyLens2Divergence("ausente", "atendido");
    expect(divAusente).toEqual({
      tipoDivergencia: "alucinacao_grave",
      isCriticalHallucination: true,
    });

    const fakeQuarantineFiles = {
      "src/app/api/tarefas/route.ts": Array.from({ length: 45 }, (_, i) => `// L${i + 1}`).join("\n"),
      "src/app/api/tarefas/[id]/route.ts": Array.from({ length: 60 }, (_, i) => `// L${i + 1}`).join("\n"),
    };

    const verdictWithPlantedDivergence: EvaluatorVerdictDocument = {
      documento: "veredito_avaliador",
      idVeredito: "VER-P1-BACKEND-T1",
      idProjeto: "proj-p1-tarefas",
      cluster: "backend",
      tentativaAvaliada: 1,
      microbriefsAvaliados: ["MB-002", "MB-003"],
      modeloExecutor: "deepseek/deepseek-v4-pro",
      modeloAvaliador: "freellmapi/auto:smart",
      modeloDiferenteDoExecutor: true,
      statusTipo1Harness: "aprovado",
      // Mesmo se um LLM distraído tentasse escrever APROVADO, o validador mecânico detecta a divergência e força REPROVADO
      decisao: "APROVADO",
      contagemSeveridade: { critico: 1, importante: 0, menor: 0 },
      lente1: [
        {
          reqId: "REQ-002",
          microbriefId: "MB-002",
          statusLente1: "implementado",
          evidenciaCodigo: "src/app/api/tarefas/route.ts:8-14",
          analiseObjetiva: "GET implementado.",
        },
        {
          reqId: "REQ-003",
          microbriefId: "MB-002",
          statusLente1: "implementado",
          evidenciaCodigo: "src/app/api/tarefas/route.ts:16-39",
          analiseObjetiva: "POST implementado.",
        },
        {
          reqId: "REQ-004",
          microbriefId: "MB-003",
          statusLente1: "parcial",
          evidenciaCodigo: "src/app/api/tarefas/[id]/route.ts:11-34",
          analiseObjetiva: "PATCH ignora campo titulo e retorna 200 para ID inexistente.",
        },
        {
          reqId: "REQ-005",
          microbriefId: "MB-003",
          statusLente1: "implementado",
          evidenciaCodigo: "src/app/api/tarefas/[id]/route.ts:36-52",
          analiseObjetiva: "DELETE implementado.",
        },
      ],
      lente2: [
        {
          reqId: "REQ-002",
          statusLente1: "implementado",
          declaradoPeloExecutor: "atendido",
          tipoDivergencia: "convergente",
          evidenciaDivergencia: "OK",
        },
        {
          reqId: "REQ-003",
          statusLente1: "implementado",
          declaradoPeloExecutor: "atendido",
          tipoDivergencia: "convergente",
          evidenciaDivergencia: "OK",
        },
        {
          reqId: "REQ-004",
          statusLente1: "parcial",
          declaradoPeloExecutor: "atendido",
          tipoDivergencia: "divergencia_otimista",
          evidenciaDivergencia: "Executor alegou atendido, mas falta titulo e 404.",
        },
        {
          reqId: "REQ-005",
          statusLente1: "implementado",
          declaradoPeloExecutor: "atendido",
          tipoDivergencia: "convergente",
          evidenciaDivergencia: "OK",
        },
      ],
      problemas: [
        {
          id: "CRIT-01",
          severidade: "critico",
          reqId: "REQ-004",
          induzidoPeloPlano: false,
          arquivoLinha: "src/app/api/tarefas/[id]/route.ts:28-31",
          descricao: "Retorna 200 em vez de 404.",
          acaoExigida: "Retornar status 404 quando atualizarTarefa retornar null.",
        },
      ],
    };

    const vCheck = validateEvaluatorVerdictMechanical(
      verdictWithPlantedDivergence,
      ["REQ-002", "REQ-003", "REQ-004", "REQ-005"],
      fakeQuarantineFiles
    );
    expect(vCheck.valid).toBe(false);
    expect(vCheck.enforcedDecision).toBe("REPROVADO");
  });
});
