import { describe, it, expect } from "vitest";
import { IncidentReporter, SEMANTIC_HUMAN_ACTION, classifyFailure, formatIncidentClock, presentIncidentMarkdown, FailureAttemptRecord } from "@/core/governance/incident-reporter";

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
    const silencio = classifyFailure(
      "Falha no Validador Tipo 1: [SILENCIO] src/app/api/lojista/onboarding/route.ts:56 import dinâmico com caminho variável."
    );
    expect(silencio.key).toBe("compiler_silence");
    expect(silencio.humanAction).not.toMatch(/truncando|reduza o escopo/i);
    expect(
      classifyFailure(
        "Falha no Validador Tipo 1: [SILENCIO] route.ts:45 as unknown as. [ESCONDIDO] error TS2339: Property 'ultimoUsoEm' does not exist on type '{ id: string; }'."
      ).key
    ).toBe("compiler_silence");
    const timeout = classifyFailure(
      "Falha no Validador Tipo 1: Timeout de resposta excedido no turno #1 da etapa (limite 300s)."
    );
    expect(timeout.key).toBe("turn_timeout");
    expect(timeout.humanAction).not.toMatch(/truncando|reduza o escopo/i);
    expect(classifyFailure("Timeout de resposta excedido na etapa da DAG").key).toBe("turn_timeout");
    const testeQuebrado = classifyFailure(
      "Falha no Validador Tipo 1: teste de aceite falha — .nextcode-repro/aceite-1-req-027-cobrancas-service.test.ts não carregou: Cannot access 'asaasMock' before initialization"
    );
    expect(testeQuebrado.key).toBe("acceptance_test_broken");
    expect(testeQuebrado.humanAction).not.toMatch(/Re-tentar|ajuste o critério/i);
    const semantica = classifyFailure(
      "Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: REQ-027 descarta o QR Pix."
    );
    expect(semantica.key).toBe("semantic");
    expect(semantica.humanAction).toBe(SEMANTIC_HUMAN_ACTION);
    expect(semantica.humanAction).not.toMatch(/divida-o na Spec|ambíguo ou grande/i);
    expect(classifyFailure("Falha no Validador Tipo 1: teste de aceite falha — aceite.test.ts › REQ-027: AssertionError: expected 201").key).toBe("acceptance");
    // Mudança 44 (Gateway 22/10): o contrato do reparo falhando dizia "type-check reprovado, abra os erros TS".
    expect(
      classifyFailure("Verificação empírica (teste do contrato do reparo (bancada)) falhou — promoção desfeita: teste do contrato ainda falha — x.test.ts").key
    ).toBe("repair_contract");
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
    expect(report).not.toContain("A lacuna citada mudou");
  });

  it("auditoria cega que muda a lacuna não manda dividir a Spec, e cada erro tem horário e copiar", () => {
    const report = IncidentReporter.generateIncidentReport("N9", "Etapa 9", "backend", [
      attempt(1, "Falha no Validador Tipo 1: [SILENCIO] src/lib/cobrancas-service.ts:91 import dinâmico"),
      attempt(2, "Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: REQ-050 valor líquido errado"),
      attempt(3, "Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: REQ-027 descarta o QR Pix"),
    ]);
    expect(report).toContain("Nas auditorias cegas, a lacuna citada mudou entre as tentativas. A Spec permanece.");
    expect(report).toContain(SEMANTIC_HUMAN_ACTION);
    expect(report).toContain("A Spec não muda.");
    expect(report).not.toContain("divida-o na Spec");
    expect(report).toContain("```erro " + formatIncidentClock("2026-10-03T00:00:00.000Z"));
    expect(report).not.toContain("2026-10-03T00:00:00.000Z");

    const antigo = presentIncidentMarkdown(`# Relatório de Incidente de Evolução (Política D-RANHO - Trava T6)
> **Data de Registro:** 2026-11-03T23:41:00.733Z
O código compila, mas não implementa o que a Spec pede. Revise as pendências listadas abaixo: se o requisito estiver ambíguo ou grande demais para uma etapa, detalhe-o ou divida-o na Spec Canônica antes de liberar o nó.
- **Data/Hora:** 2026-11-03T23:41:00.300Z
- **Escopo:** \`src/lib/cobrancas-service.ts\`
- **Motivo:** Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: REQ-027
\`\`\`text
Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: REQ-027
\`\`\``);
    expect(antigo).toContain(SEMANTIC_HUMAN_ACTION);
    expect(antigo).toContain("```erro " + formatIncidentClock("2026-11-03T23:41:00.300Z"));
    expect(antigo).not.toContain("2026-11-03T23:41:00.300Z");
    expect(antigo).not.toContain("divida-o na Spec");
  });
});
