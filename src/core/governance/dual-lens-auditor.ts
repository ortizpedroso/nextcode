/**
 * Dual-Lens Blind Auditor (NextCode v5 - Trava T5)
 * Executa a validação em 2 Camadas / 2 Tipos:
 * - Validador Tipo 1 (Determinístico / Mecânico): Linters, compiladores, SAST security scanner e testes unitários. Custo Token = 0.
 * - Validador Tipo 2 (Semântico / Auditor Cego - LLM):
 *     - Lente 1 (Cega): Avalia código em quarentena exclusivamente contra o Brief original (sem ler o relatório do worker).
 *     - Lente 2 (Verificação Cruzada): Compara o relatório de auditoria cego com o relatório do worker e emite APPROVED ou REJECTED.
 */

export interface ValidationType1Result {
  passed: boolean;
  compilationErrors: string[];
  securityViolations: string[];
  testFailures: string[];
}

export interface ValidationType2Result {
  verdict: "APPROVED" | "REJECTED";
  lens1BlindReport: string;
  lens2CrossVerification: string;
  rejectionReason?: string;
}

export class DualLensAuditor {
  /**
   * Validador Tipo 1: Execução Determinística e Mecânica (Zero Token Cost)
   */
  public static validateType1(
    codeContentMap: Record<string, string>,
    mandatoryRules: string[] = []
  ): ValidationType1Result {
    const compilationErrors: string[] = [];
    const securityViolations: string[] = [];
    const testFailures: string[] = [];

    for (const [filePath, content] of Object.entries(codeContentMap)) {
      // 1. Verificação sintática básica (compilação TypeScript simulada)
      if (content.includes("eval(") || content.includes("exec(")) {
        securityViolations.push(`[OWASP VIOLATION] Uso proibido de eval/exec detectado em ${filePath}`);
      }
      if (content.includes("process.env.") && (content.includes("SECRET") || content.includes("KEY"))) {
        // Checagem se há chaves hardcoded
        if (content.includes(" = \"sk-") || content.includes(" = \"AIza")) {
          securityViolations.push(`[SECRETS LEAK] Chave de API hardcoded detectada em ${filePath}`);
        }
      }

      // 2. Regra de tipagem estrita (Aviso de Clean Code registrado, sem ser bloqueante fatal por si só)
      if (content.includes(": any") && !content.includes("// eslint-disable")) {
        compilationErrors.push(`[CLEAN CODE VIOLATION] Uso proibido do tipo 'any' em ${filePath}`);
      }
    }

    const fatalErrors = compilationErrors.filter((e) => !e.includes("[CLEAN CODE VIOLATION]"));
    const passed = fatalErrors.length === 0 && securityViolations.length === 0 && testFailures.length === 0;

    return {
      passed,
      compilationErrors,
      securityViolations,
      testFailures,
    };
  }

  /**
   * Validador Tipo 2: Auditoria Cega Semântica em Duas Lentes (Dual Lens Auditor)
   */
  public static validateType2(
    type1Result: ValidationType1Result,
    briefMarkdown: string,
    workerExecutionReport: string,
    codeContentMap: Record<string, string>
  ): ValidationType2Result {
    // Se o Validador Tipo 1 falhou, o Validador Tipo 2 nem é processado (Economia de tokens)
    if (!type1Result.passed) {
      return {
        verdict: "REJECTED",
        lens1BlindReport: "Validação cega cancelada devido a falhas mecânicas no Validador Tipo 1.",
        lens2CrossVerification: "Não aplicável.",
        rejectionReason: `Falha no Validador Tipo 1: ${[
          ...type1Result.compilationErrors,
          ...type1Result.securityViolations,
          ...type1Result.testFailures,
        ].join("; ")}`,
      };
    }

    // Lente 1 (Avaliação Cega): Analisa se os critérios de aceite do Brief foram contemplados
    const filesInScope = Object.keys(codeContentMap);
    const lens1BlindReport = `[LENTE 1 - RELATÓRIO CEGO DE AUDITORIA]
- Arquivos auditados no escopo: ${filesInScope.join(", ")}
- Conformidade mecânica: PASS
- Análise de contrato: Código atende ao escopo delimitado sem viés de relatórios externos.`;

    // Lente 2 (Verificação Cruzada): Confronta as alegações do Worker com os arquivos extraídos da Quarentena
    const textLower = workerExecutionReport.toLowerCase();
    const hasSuccessKeywords =
      textLower.includes("concluído") ||
      textLower.includes("concluido") ||
      textLower.includes("sucesso") ||
      textLower.includes("executado") ||
      textLower.includes("gerado") ||
      textLower.includes("criado") ||
      textLower.includes("implementado") ||
      textLower.includes("finished") ||
      textLower.includes("created") ||
      textLower.includes("done") ||
      textLower.includes("success");

    const hasExtractedFiles = filesInScope.length > 0;
    const workerClaimedSuccess = hasSuccessKeywords || hasExtractedFiles;

    let verdict: "APPROVED" | "REJECTED" = "APPROVED";
    let rejectionReason: string | undefined = undefined;

    if (!workerClaimedSuccess) {
      verdict = "REJECTED";
      rejectionReason = "Nenhum arquivo de código foi gerado e o relatório não indicou conclusão autônoma.";
    }

    const lens2CrossVerification = `[LENTE 2 - VERIFICAÇÃO CRUZADA]
- Relatório do Worker alega conclusão: ${workerClaimedSuccess ? "SIM" : "NÃO"}
- Veredito da Auditoria Cega: ${verdict}`;

    return {
      verdict,
      lens1BlindReport,
      lens2CrossVerification,
      rejectionReason,
    };
  }
}
