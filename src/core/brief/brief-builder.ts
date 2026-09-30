/**
 * Hybrid Brief Builder & Parser (NextCode v5)
 * Gera e valida Briefs no formato Híbrido (YAML Frontmatter + Markdown Body)
 * Aplica a Trava T2 (Files Scope Lock - impede execução se files_scope for vazio)
 */

export interface BriefMetadata {
  taskId: string;
  cluster: "core" | "backend" | "frontend" | "integration";
  title: string;
  filesScope: string[];
  dependencies: string[];
  maxAttempts: number;
  immutableRules: {
    designSystem?: string;
    securityLevel?: string;
    testCoverageThreshold?: number;
    codeStyle?: string;
  };
}

export interface HybridBrief {
  metadata: BriefMetadata;
  contentMarkdown: string;
  rawYamlFrontmatter: string;
}

export class BriefBuilder {
  /**
   * Constrói um objeto HybridBrief garantindo o cumprimento de travas de governança.
   */
  public static createBrief(
    taskId: string,
    cluster: "core" | "backend" | "frontend" | "integration",
    title: string,
    filesScope: string[],
    dependencies: string[] = [],
    instructionsMarkdown: string = ""
  ): HybridBrief {
    // Trava T2: Scope Lock - Impede a geração do Brief se files_scope estiver vazio
    if (!filesScope || filesScope.length === 0) {
      throw new Error(
        `[TRAVA T2 VIOLADA] A tarefa '${taskId}' não possui 'files_scope' definido. Todo Brief deve delimitar exatamente os arquivos afetados.`
      );
    }

    const metadata: BriefMetadata = {
      taskId,
      cluster,
      title,
      filesScope,
      dependencies,
      maxAttempts: 3,
      immutableRules: {
        designSystem: "Tailwind / Design Tokens v2",
        securityLevel: "Strict OWASP Top 10 / Zero-Trust",
        testCoverageThreshold: 85.0,
        codeStyle: "TypeScript Strict / Clean Architecture",
      },
    };

    const rawYamlFrontmatter = `---
task_id: "${metadata.taskId}"
cluster: "${metadata.cluster}"
title: "${metadata.title}"
files_scope:
${metadata.filesScope.map((f) => `  - "${f}"`).join("\n")}
dependencies:
${metadata.dependencies.length > 0 ? metadata.dependencies.map((d) => `  - "${d}"`).join("\n") : "  []"}
max_attempts: ${metadata.maxAttempts}
immutable_rules:
  design_system: "${metadata.immutableRules.designSystem}"
  security_level: "${metadata.immutableRules.securityLevel}"
  test_coverage_threshold: ${metadata.immutableRules.testCoverageThreshold}
  code_style: "${metadata.immutableRules.codeStyle}"
---`;

    const contentMarkdown = `${rawYamlFrontmatter}

# Brief de Execução: ${title}

## 1. Escopo de Arquivos Permitidos (files_scope)
${metadata.filesScope.map((f) => `- \`${f}\``).join("\n")}

## 2. Instruções Específicas
${instructionsMarkdown || "Executar alterações necessárias mantendo a integridade e padrões do repositório."}

## 3. Diretrizes Imutáveis de Qualidade & Segurança
- **Design System:** ${metadata.immutableRules.designSystem}
- **Segurança:** ${metadata.immutableRules.securityLevel}
- **Padrão de Código:** ${metadata.immutableRules.codeStyle}

## 4. Instruções de Teste Determinístico
\`\`\`bash
npx vitest run ${metadata.filesScope[0] || ""}
\`\`\`
`;

    return {
      metadata,
      contentMarkdown,
      rawYamlFrontmatter,
    };
  }

  /**
   * Valida se um objeto de metadados atende rigorosamente às travas de segurança do Brief.
   */
  public static validateScope(filesScope: string[]): { isValid: boolean; error?: string } {
    if (!filesScope || !Array.isArray(filesScope) || filesScope.length === 0) {
      return {
        isValid: false,
        error: "[TRAVA T2 VIOLADA] files_scope deve ser um array não-vazio contendo caminhos válidos.",
      };
    }
    return { isValid: true };
  }
}
