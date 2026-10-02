/**
 * Input Preprocessor Engine (NextCode v5)
 * Converte qualquer entrada do chat (HTML, texto ruidoso, links, logs, PDFs, prompts)
 * em um formato otimizado em Markdown com YAML Frontmatter sanitizado antes de enviar à LLM.
 */

export interface ProcessedInput {
  yamlFrontmatter: string;
  markdownBody: string;
  fullFormattedPrompt: string;
  intentType: string;
  extractedUrls: string[];
  detectedFiles: string[];
  originalLength: number;
  processedLength: number;
  tokenReductionPercent: number;
}

export interface PreprocessOptions {
  projectId?: string | null;
  projectName?: string | null;
}

export class InputPreprocessorEngine {
  /**
   * Processa a entrada bruta e a transforma em YAML Frontmatter + Markdown.
   */
  public static preprocess(rawInput: string, options: PreprocessOptions = {}): ProcessedInput {
    if (!rawInput || typeof rawInput !== "string") {
      return {
        yamlFrontmatter: "---\nintent_type: UNKNOWN\n---\n",
        markdownBody: "",
        fullFormattedPrompt: "",
        intentType: "UNKNOWN",
        extractedUrls: [],
        detectedFiles: [],
        originalLength: 0,
        processedLength: 0,
        tokenReductionPercent: 0,
      };
    }

    const originalLength = rawInput.length;

    // 1. Sanitização de Ruídos (HTML tags, scripts, estilos, comentários HTML)
    let cleaned = rawInput
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ");

    // 2. Extração de URLs
    const urlRegex = /(https?:\/\/[^\s<>'"]+)/gi;
    const urlsMatches = cleaned.match(urlRegex) || [];
    const extractedUrls = Array.from(new Set(urlsMatches));

    // 3. Extração de Caminhos de Arquivo declarados
    const filePathRegex = /(?:[a-zA-Z0-9_\-\.\/]+\/)?([a-zA-Z0-9_\-\.]+\.(?:tsx?|jsx?|json|css|scss|prisma|md|env|yml|yaml|sql|ps1|sh|bat))/gi;
    const fileMatches = cleaned.match(filePathRegex) || [];
    const detectedFiles = Array.from(new Set(fileMatches)).filter(
      (f) => !f.startsWith("http://") && !f.startsWith("https://")
    );

    // 4. Normalização de Espaços e Quebras de Linha
    cleaned = cleaned
      .split("\n")
      .map((line) => line.trim())
      .filter((line, idx, arr) => {
        // Evita múltiplas linhas em branco consecutivas
        if (!line && idx > 0 && !arr[idx - 1]) return false;
        return true;
      })
      .join("\n")
      .trim();

    // 5. Classificação da Intenção Primária
    const lower = cleaned.toLowerCase();
    let intentType = "GENERAL_INQUIRY";

    if (
      lower.includes("erro") ||
      lower.includes("error") ||
      lower.includes("failed") ||
      lower.includes("can't resolve") ||
      lower.includes("corrija") ||
      lower.includes("fix")
    ) {
      intentType = "BUG_FIX";
    } else if (
      lower.includes("implementar") ||
      lower.includes("implemente") ||
      lower.includes("criar") ||
      lower.includes("crie") ||
      lower.includes("desenvolver") ||
      lower.includes("adicionar")
    ) {
      intentType = "FEATURE_IMPLEMENTATION";
    } else if (
      lower.includes("executar") ||
      lower.includes("rodar") ||
      lower.includes("terminal") ||
      lower.includes("command") ||
      lower.includes("npm")
    ) {
      intentType = "CODE_EXECUTION_REQUEST";
    } else if (
      lower.includes("o que é") ||
      lower.includes("como funciona") ||
      lower.includes("explique")
    ) {
      intentType = "CONCEPTUAL_QA";
    }

    const processedLength = cleaned.length;
    const reductionRatio =
      originalLength > 0
        ? Math.max(0, Math.round(((originalLength - processedLength) / originalLength) * 100))
        : 0;

    // 6. Montagem do YAML Frontmatter
    const yamlLines: string[] = [
      "---",
      `intent_type: "${intentType}"`,
      `original_chars: ${originalLength}`,
      `processed_chars: ${processedLength}`,
      `token_reduction_ratio: "${reductionRatio}%"`,
    ];

    if (options.projectName) {
      yamlLines.push(`project_name: "${options.projectName}"`);
    }

    if (detectedFiles.length > 0) {
      yamlLines.push("target_files:");
      detectedFiles.forEach((file) => yamlLines.push(`  - "${file}"`));
    }

    if (extractedUrls.length > 0) {
      yamlLines.push("extracted_urls:");
      extractedUrls.forEach((url) => yamlLines.push(`  - "${url}"`));
    }

    yamlLines.push("---");
    const yamlFrontmatter = yamlLines.join("\n");

    // 7. Montagem do Markdown Body
    const markdownBody = `# Requisito Processado\n\n${cleaned}`;

    // 8. Payload Completo Estruturado
    const fullFormattedPrompt = `${yamlFrontmatter}\n\n${markdownBody}`;

    return {
      yamlFrontmatter,
      markdownBody,
      fullFormattedPrompt,
      intentType,
      extractedUrls,
      detectedFiles,
      originalLength,
      processedLength,
      tokenReductionPercent: reductionRatio,
    };
  }
}
