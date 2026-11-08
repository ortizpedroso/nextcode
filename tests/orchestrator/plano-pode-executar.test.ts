import { describe, expect, it } from "vitest";
import { analistaObrigatorio, planoPodeExecutar } from "../../src/core/orchestrator/execution-trigger";

describe("barreira do Macrobrief antes do executor", () => {
  it("heurística não executa quando o analista era obrigatório", () => {
    expect(planoPodeExecutar(true, "heuristica")).toBe(false);
    expect(planoPodeExecutar(true, undefined)).toBe(false);
  });

  it("contrato aprovado pelo analista pode executar", () => {
    expect(planoPodeExecutar(true, "analista")).toBe(true);
  });

  it("sem arquivos na Spec, a heurística continua válida", () => {
    expect(planoPodeExecutar(false, "heuristica")).toBe(true);
  });

  it("no teste, com o modelo desligado, o analista não é obrigatório", () => {
    const anterior = process.env.ENABLE_ANALISTA_LLM;
    delete process.env.ENABLE_ANALISTA_LLM;
    expect(analistaObrigatorio(true)).toBe(false);
    if (anterior === undefined) delete process.env.ENABLE_ANALISTA_LLM;
    else process.env.ENABLE_ANALISTA_LLM = anterior;
  });
});
