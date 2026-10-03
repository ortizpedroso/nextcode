import { describe, it, expect } from "vitest";
import { IncidentReporter, classifyFailure, FailureAttemptRecord } from "@/core/governance/incident-reporter";

const attempt = (n: number, reason: string): FailureAttemptRecord => ({
  attemptNumber: n,
  rejectionReason: reason,
  filesScope: ["src/a.ts"],
  timestamp: "2026-10-03T00:00:00.000Z",
});

describe("Trava T6 — relatório ao humano direcionado ao erro", () => {
  it("classifica a causa real de cada rejeição", () => {
    expect(classifyFailure("[TRAVA T2 VIOLADA] src/x.ts está fora do files_scope").key).toBe("scope");
    expect(classifyFailure("Verificação empírica (type-check real pós-promoção) falhou — promoção desfeita: a.ts(1,1): error TS2322").key).toBe("build");
    expect(classifyFailure("Auditoria cega (Tipo 2) indisponível — o auditor LLM não respondeu").key).toBe("auditor_unavailable");
    expect(classifyFailure("Falha no Validador Tipo 1: [MISSING MODULE ERROR] ...").key).toBe("missing_module");
    expect(classifyFailure("Timeout de resposta excedido na etapa da DAG").key).toBe("runtime");
  });

  it("aponta erro persistente, erro exato, ação específica e dependentes bloqueados", () => {
    const err = "Verificação empírica (type-check real pós-promoção) falhou — promoção desfeita: src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.";
    const report = IncidentReporter.generateIncidentReport(
      "N1",
      "Implementar API",
      "backend",
      [attempt(1, err), attempt(2, err.replace("(3,7)", "(4,7)")), attempt(3, err)],
      { maxAttempts: 3, blockedDependents: ["Testes"] }
    );

    expect(report).toContain("(3/3)");
    expect(report).toContain("Type-check real do projeto reprovado");
    expect(report).toContain("O MESMO erro se repetiu em todas as 3 tentativas");
    expect(report).toContain("error TS2322");
    expect(report).toContain("Abra os arquivos citados nos erros");
    expect(report).toContain('"Testes"');
    expect(report).toContain("Desbloquear / Re-tentar Etapa");
  });

  it("indica causas diferentes quando as tentativas falharam por motivos distintos", () => {
    const report = IncidentReporter.generateIncidentReport("N2", "X", "core", [
      attempt(1, "Timeout de resposta excedido na etapa da DAG"),
      attempt(2, "[TRAVA T2 VIOLADA] src/b.ts está fora do files_scope"),
    ]);
    expect(report).toContain("falharam por causas diferentes");
    expect(report).toContain("Violação de escopo (Trava T2)");
  });
});
