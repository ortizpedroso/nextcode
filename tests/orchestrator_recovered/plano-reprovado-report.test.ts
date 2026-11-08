import { describe, it, expect } from "vitest";
import {
  buildPlanoReprovadoDetalhe,
  buildPlanoReprovadoProblems,
} from "@/core/orchestrator/plano-reprovado-report";

describe("plano-reprovado-report", () => {
  it("inclui erros T8b no detalhe e em problems (modal Spec T1)", () => {
    const plano = {
      motivo: "rodadas_esgotadas",
      dono: "analista" as const,
      erros: ["[T8b REQ REPETIDO] REQ-001", "[T8b ARQUIVO INVENTADO] src/x.ts"],
    };
    const detalhe = buildPlanoReprovadoDetalhe(plano, { rodadas: 3 });
    expect(detalhe).toContain("Spec×Macrobrief");
    expect(detalhe).toContain("- [T8b REQ REPETIDO]");
    const problems = buildPlanoReprovadoProblems(plano, { rodadas: 3 });
    expect(problems[0]).toMatch(/validação mecânica T8b/);
    expect(problems).toContain("[T8b REQ REPETIDO] REQ-001");
  });

  it("rodadas esgotadas sem erros → hint de infra/formato", () => {
    const problems = buildPlanoReprovadoProblems({ motivo: "rodadas_esgotadas", dono: "analista" });
    expect(problems.some((p) => /Sem lista de erros|formato YAML/i.test(p))).toBe(true);
  });
});
