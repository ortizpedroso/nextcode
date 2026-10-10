import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyMacrobriefCoverageWithJev,
  MACROBRIEF_CONFERENCE_QUESTIONS,
} from "../../src/core/decision/jev-execution-checks.js";
import * as jevClient from "../../src/core/decision/jev.js";
import { TelemetryLogger } from "../../src/core/telemetry/telemetry-logger.js";
import type { SpecPadrao } from "../../src/core/types/session.js";
import type { Macrobrief } from "../../src/core/types/briefs.js";

describe("verifyMacrobriefCoverageWithJev (T8a - Bateria Estratégica Fan-Out)", () => {
  const dummySpec: SpecPadrao = {
    versao: "1.0",
    titulo: "Sistema de Gestão de Ordens",
    stack: ["Node.js", "TypeScript", "Fastify", "PostgreSQL"],
    requisitos: [
      { id: "REQ-01", descricao: "Criar ordem de serviço", tipo: "funcional", prioridade: "alta" },
      { id: "REQ-02", descricao: "Listar ordens com paginação", tipo: "funcional", prioridade: "media" },
    ],
    regras: ["Apenas usuários autenticados podem criar ordem"],
  };

  const dummyMacrobrief: Macrobrief = {
    idMacrobrief: "macro-123",
    etapas: [
      {
        idEtapa: "etapa-1",
        titulo: "Modelos e Repositório de Ordens",
        arquivosAlvo: ["src/models/order.ts", "src/repositories/order.repo.ts"],
        dependencias: [],
        requisitosCobertos: ["REQ-01", "REQ-02"],
      },
    ],
    contratosTypescript: "export interface Order { id: string; status: string; }",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deve conter exatamente 6 perguntas estratégicas na bateria", () => {
    const keys = Object.keys(MACROBRIEF_CONFERENCE_QUESTIONS);
    expect(keys).toHaveLength(6);
    expect(keys).toEqual([
      "cobertura_requisitos",
      "fidelidade_sem_contradicao",
      "sem_escopo_inventado",
      "suficiencia_arquivos",
      "ordem_dependencias_valida",
      "isolamento_seguranca",
    ]);
  });

  it("deve aprovar Macrobrief quando todas as 6 perguntas do JEV superarem os limiares", async () => {
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      cobertura_requisitos: { type: "noul", noul: 0.95, confidence: 0.95 },
      fidelidade_sem_contradicao: { type: "noul", noul: 0.92, confidence: 0.92 },
      sem_escopo_inventado: { type: "noul", noul: 0.88, confidence: 0.88 },
      suficiencia_arquivos: { type: "noul", noul: 0.85, confidence: 0.85 },
      ordem_dependencias_valida: { type: "noul", noul: 0.90, confidence: 0.90 },
      isolamento_seguranca: { type: "noul", noul: 0.91, confidence: 0.91 },
    });

    const logSpy = vi.spyOn(TelemetryLogger, "log");

    const result = await verifyMacrobriefCoverageWithJev({
      sessionId: "session-abc",
      spec: dummySpec,
      macrobrief: dummyMacrobrief,
    });

    expect(result.aprovado).toBe(true);
    expect(result.jevDisponivel).toBe(true);
    expect(result.apontamentos).toHaveLength(0);
    expect(result.confiancaMedia).toBeGreaterThan(0.89);
    expect(result.scores.coberturaRequisitos).toBe(0.95);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_MACROBRIEF_CONFERENCE",
        details: expect.objectContaining({
          macrobriefId: "macro-123",
          aprovado: true,
          jevDisponivel: true,
        }),
      })
    );
  });

  it("deve reprovar Macrobrief com apontamentos cirúrgicos quando houver omissão e escopo inventado", async () => {
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      cobertura_requisitos: { type: "noul", noul: 0.70, confidence: 0.70 }, // falha (< 0.85)
      fidelidade_sem_contradicao: { type: "noul", noul: 0.90, confidence: 0.90 },
      sem_escopo_inventado: { type: "noul", noul: 0.65, confidence: 0.65 }, // falha (< 0.80)
      suficiencia_arquivos: { type: "noul", noul: 0.85, confidence: 0.85 },
      ordem_dependencias_valida: { type: "noul", noul: 0.85, confidence: 0.85 },
      isolamento_seguranca: { type: "noul", noul: 0.85, confidence: 0.85 },
    });

    const result = await verifyMacrobriefCoverageWithJev({
      sessionId: "session-abc",
      spec: dummySpec,
      macrobrief: dummyMacrobrief,
    });

    expect(result.aprovado).toBe(false);
    expect(result.jevDisponivel).toBe(true);
    expect(result.apontamentos).toHaveLength(2);
    expect(result.apontamentos[0]).toContain("Omissão de requisitos");
    expect(result.apontamentos[0]).toContain("score: 0.70");
    expect(result.apontamentos[1]).toContain("Invenção de escopo");
    expect(result.apontamentos[1]).toContain("score: 0.65");
  });

  it("deve reprovar se houver inversão de dependências ou violação de isolamento", async () => {
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      cobertura_requisitos: { type: "noul", noul: 0.90, confidence: 0.90 },
      fidelidade_sem_contradicao: { type: "noul", noul: 0.90, confidence: 0.90 },
      sem_escopo_inventado: { type: "noul", noul: 0.90, confidence: 0.90 },
      suficiencia_arquivos: { type: "noul", noul: 0.90, confidence: 0.90 },
      ordem_dependencias_valida: { type: "noul", noul: 0.60, confidence: 0.60 }, // falha (< 0.80)
      isolamento_seguranca: { type: "noul", noul: 0.55, confidence: 0.55 }, // falha (< 0.80)
    });

    const result = await verifyMacrobriefCoverageWithJev({
      sessionId: "session-xyz",
      spec: dummySpec,
      macrobrief: dummyMacrobrief,
    });

    expect(result.aprovado).toBe(false);
    expect(result.apontamentos).toHaveLength(2);
    expect(result.apontamentos[0]).toContain("Ordem de dependências invertida");
    expect(result.apontamentos[1]).toContain("Risco de segurança/isolamento");
  });

  it("deve acionar fallback gracioso quando o JEV estiver indisponível (askJevBatch retornar null)", async () => {
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue(null);

    const logSpy = vi.spyOn(TelemetryLogger, "log");

    const result = await verifyMacrobriefCoverageWithJev({
      sessionId: "session-fallback",
      spec: dummySpec,
      macrobrief: dummyMacrobrief,
    });

    expect(result.aprovado).toBe(true);
    expect(result.jevDisponivel).toBe(false);
    expect(result.apontamentos).toHaveLength(0);
    expect(result.confiancaMedia).toBe(0);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_MACROBRIEF_CONFERENCE",
        details: expect.objectContaining({
          jevDisponivel: false,
          aprovado: true,
          motivo: "fallback_sem_jev",
        }),
      })
    );
  });
});
