import { describe, it, expect } from "vitest";
import { chunkPlanningInputs } from "../../src/core/orchestrator/execution-trigger.js";

// JV1 (mudança 44): o lote inteiro (40 etapas do Gateway, 30 mil caracteres) estourava o estado do Jev
// (24 mil) e todas as etapas caíam no nível de reserva. Agora vai em lotes que cabem.
describe("JV1 — planejamento do Jev em lotes", () => {
  const mb = (i: number, resumo = "x".repeat(700)) => ({ id: `n${i}`, arquivos: [`src/a${i}.ts`], reqsCobertos: [`REQ-${i}`], resumo });

  it("40 Microbriefs do porte do Gateway → lotes de até 8 e até 12 mil caracteres, sem perder nenhum", () => {
    const inputs = Array.from({ length: 40 }, (_, i) => mb(i));
    const lotes = chunkPlanningInputs(inputs);
    expect(lotes.every((l) => l.length <= 8)).toBe(true);
    expect(lotes.every((l) => l.reduce((s, x) => s + x.resumo.length + x.arquivos.join(",").length + 200, 0) <= 12_000)).toBe(true);
    expect(lotes.flat().map((x) => x.id)).toEqual(inputs.map((x) => x.id));
  });

  it("Microbrief maior que o limite vai sozinho (o Jev recusa só esse e ele cai na reserva)", () => {
    const lotes = chunkPlanningInputs([mb(1), mb(2, "y".repeat(20_000)), mb(3)]);
    expect(lotes.map((l) => l.map((x) => x.id))).toEqual([["n1"], ["n2"], ["n3"]]);
  });
});
