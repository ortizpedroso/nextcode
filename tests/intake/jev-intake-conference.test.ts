import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntakeEngine } from "../../src/core/intake/intake-engine.js";
import { renderCanonicalSpecDocument } from "../../src/core/intake/spec-format.js";
import * as jevExecutionChecks from "../../src/core/decision/jev-execution-checks.js";

describe("IntakeEngine com Conferência do JEV (Trava T8a / T8b)", () => {
  const specValida = renderCanonicalSpecDocument({
    titulo: "Gateway API",
    status: "aprovada",
    data: "2026-10-10",
    stack: ["TypeScript", "Node.js"],
    modulos: [
      {
        id: "mod-gw",
        nome: "Gateway",
        resumo: "Roteamento HTTP",
        arquivos: ["src/lib/gateway.ts"],
      },
    ],
    entidades: [],
    arquivosAfetados: ["src/lib/gateway.ts"],
    objetivo: "Roteador HTTP com fallback e isolamento.",
    requisitosIds: ["REQ-001"],
    requisitos: [
      {
        id: "REQ-001",
        titulo: "Módulo src/lib/gateway.ts",
        criterio: "src/lib/gateway.ts exporta dispatchGateway com timeout e fallback.",
      },
    ],
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deve aprovar ciclo quando o JEV aprovar a conferência do Macrobrief", async () => {
    vi.spyOn(jevExecutionChecks, "verifyMacrobriefCoverageWithJev").mockResolvedValue({
      aprovado: true,
      confiancaMedia: 0.95,
      scores: {
        coberturaRequisitos: 0.95,
        fidelidadeSemContradicao: 0.95,
        semEscopoInventado: 0.95,
        suficienciaArquivos: 0.95,
        ordemDependenciasValida: 0.95,
        isolamentoSeguranca: 0.95,
      },
      apontamentos: [],
      jevDisponivel: true,
    });

    const result = await IntakeEngine.runElicitadorAndAnalistaCycle({
      sessionId: "session-ok",
      initialSpec: specValida,
    });

    expect(result.ok).toBe(true);
    expect(result.finalPhaseContext.phase).toBe("PLANEJAMENTO");
    expect(result.finalPhaseContext.voltasConferencia).toBe(0);
    expect(result.problems).toHaveLength(0);
  });

  it("deve registrar falha da conferência pelo JEV, alimentar onRepairCycle e bloquear na 4ª volta", async () => {
    vi.spyOn(jevExecutionChecks, "verifyMacrobriefCoverageWithJev").mockResolvedValue({
      aprovado: false,
      confiancaMedia: 0.70,
      scores: {
        coberturaRequisitos: 0.60,
        fidelidadeSemContradicao: 0.90,
        semEscopoInventado: 0.90,
        suficienciaArquivos: 0.90,
        ordemDependenciasValida: 0.90,
        isolamentoSeguranca: 0.90,
      },
      apontamentos: [
        "Omissão de requisitos: o Macrobrief não atribui todas as funcionalidades exigidas na Spec (score: 0.60).",
      ],
      jevDisponivel: true,
    });

    let repairCyclesExecuted = 0;
    const onRepairCycle = vi.fn().mockImplementation((cycle, culprit, problems, spec) => {
      repairCyclesExecuted++;
      expect(culprit).toBe("macrobrief");
      expect(problems).toContain(
        "Omissão de requisitos: o Macrobrief não atribui todas as funcionalidades exigidas na Spec (score: 0.60)."
      );
      return spec;
    });

    const result = await IntakeEngine.runElicitadorAndAnalistaCycle({
      sessionId: "session-falha",
      initialSpec: specValida,
      onRepairCycle,
    });

    expect(result.ok).toBe(false);
    expect(result.finalPhaseContext.phase).toBe("BLOQUEADA");
    expect(result.finalPhaseContext.voltasConferencia).toBe(4);
    expect(repairCyclesExecuted).toBe(3); // 3 tentativas de reparo com retorno ao Elicitador
    expect(result.problems[0]).toContain("Omissão de requisitos");
  });
});
