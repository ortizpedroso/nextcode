/**
 * Input Preprocessor Engine (NextCode v5)
 * Converte qualquer entrada do chat (HTML, texto ruidoso, links, logs de erro/stacktraces, PDFs, prompts)
 * em um formato otimizado em Markdown com YAML Frontmatter sanitizado antes de enviar à LLM.
 */

export interface ProcessedInput {
  yamlFrontmatter: string;
  markdownBody: string;
  fullFormattedPrompt: string;
  intentType: string;
  extractedUrls: string[];
  videoUrls: string[];
  docUrls: string[];
  detectedFiles: string[];
  hasErrorLog: boolean;
  hasMultimodalAttachments: boolean;
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
   * Sanitiza e simplifica caminhos de sistema ruidosos do Windows / User Temp Data.
   */
  private static sanitizeSystemPaths(text: string): string {
    return text
      // Purga linhas de erros sistêmicos irrelevantes de arquivo de troca do Windows
      .replace(/Watchpack Error \(initial scan\): Error: EINVAL: invalid argument, lstat 'C:\\(?:DumpStack\.log\.tmp|hiberfil\.sys|pagefile\.sys|swapfile\.sys)'\r?\n?/gi, "")
      // Simplifica caminhos de perfis de usuário locais
      .replace(/C:\\Users\\[^\s\\/]+\\/gi, "~/");
  }

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
        videoUrls: [],
        docUrls: [],
        detectedFiles: [],
        hasErrorLog: false,
        hasMultimodalAttachments: false,
        originalLength: 0,
        processedLength: 0,
        tokenReductionPercent: 0,
      };
    }

    const originalLength = rawInput.length;

    // 0. Detecção de Anexos Multimodais
    const hasMultimodalAttachments = rawInput.includes("[ANEXO MULTIMODAL:");
    const multimodalMatch = rawInput.match(/\[ANEXO MULTIMODAL:\s*(\d+)\s*imagem/i);
    const attachmentCount = multimodalMatch ? parseInt(multimodalMatch[1], 10) : 0;

    // 1. Sanitização de Ruídos HTML, Scripts e Estilos
    let cleaned = rawInput
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ");

    // 2. Sanitização de Caminhos Sistêmicos do Windows / Log Noise
    cleaned = InputPreprocessorEngine.sanitizeSystemPaths(cleaned);

    // 3. Extração e Classificação de URLs (Vídeos vs Documentação)
    const urlRegex = /(https?:\/\/[^\s<>'"]+)/gi;
    const rawUrlsMatches = cleaned.match(urlRegex) || [];
    const extractedUrls = Array.from(
      new Set(rawUrlsMatches.map((u) => u.replace(/[.,;)]+$/, "")))
    );

    const videoUrls: string[] = [];
    const docUrls: string[] = [];

    for (const url of extractedUrls) {
      const lowerUrl = url.toLowerCase();
      if (
        lowerUrl.includes("youtube.com") ||
        lowerUrl.includes("youtu.be") ||
        lowerUrl.includes("vimeo.com") ||
        lowerUrl.includes("twitch.tv")
      ) {
        videoUrls.push(url);
      } else if (
        lowerUrl.includes("nextjs.org") ||
        lowerUrl.includes("asaas.com") ||
        lowerUrl.includes("prisma.io") ||
        lowerUrl.includes("tailwindcss.com") ||
        lowerUrl.includes("developer.mozilla.org") ||
        lowerUrl.includes("github.com") ||
        lowerUrl.includes("docs")
      ) {
        docUrls.push(url);
      }
    }

    // 4. Detecção e Agrupamento de Logs de Erro / Stack Traces
    const hasErrorLog =
      cleaned.includes("Syntax error:") ||
      cleaned.includes("TypeError:") ||
      cleaned.includes("Failed to compile") ||
      cleaned.includes("Module not found:") ||
      cleaned.includes("Build Error") ||
      cleaned.includes("at DashboardOrchestrator") ||
      cleaned.includes("webpack-internal://");

    if (hasErrorLog && !cleaned.includes("```log")) {
      // Se houver blocos de erro não formatados, envolve stack traces em blocos ```log
      cleaned = cleaned.replace(
        /((?:(?:⨯|Syntax error:|Failed to compile|Module not found:|TypeError:|at\s+).*?\n?)+)/gi,
        (match) => {
          const trimmedMatch = match.trim();
          if (trimmedMatch.startsWith("```")) return match;
          return `\n\`\`\`log\n${trimmedMatch}\n\`\`\`\n`;
        }
      );
    }

    // 5. Extração de Caminhos de Arquivo Declarados
    const filePathRegex = /(?:[a-zA-Z0-9_\-\.\/]+\/)?([a-zA-Z0-9_\-\.]+\.(?:tsx?|jsx?|json|css|scss|prisma|md|env|yml|yaml|sql|ps1|sh|bat))/gi;
    const fileMatches = cleaned.match(filePathRegex) || [];
    const detectedFiles = Array.from(new Set(fileMatches)).filter(
      (f) => !f.startsWith("http://") && !f.startsWith("https://") && !f.includes("webpack-internal")
    );

    // 6. Normalização de Espaços e Quebras de Linha
    cleaned = cleaned
      .split("\n")
      .map((line) => line.trim())
      .filter((line, idx, arr) => {
        if (!line && idx > 0 && !arr[idx - 1]) return false;
        return true;
      })
      .join("\n")
      .trim();

    // 7. Classificação da Intenção Primária
    const lower = cleaned.toLowerCase();
    let intentType = "GENERAL_INQUIRY";

    if (
      hasErrorLog ||
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

    // 8. Montagem do YAML Frontmatter Estruturado
    const yamlLines: string[] = [
      "---",
      `intent_type: "${intentType}"`,
      `has_error_log: ${hasErrorLog}`,
      `original_chars: ${originalLength}`,
      `processed_chars: ${processedLength}`,
      `token_reduction_ratio: "${reductionRatio}%"`,
    ];

    if (options.projectName) {
      yamlLines.push(`project_name: "${options.projectName}"`);
    }

    if (hasMultimodalAttachments) {
      yamlLines.push(`multimodal_attachments_count: ${attachmentCount}`);
    }

    if (detectedFiles.length > 0) {
      yamlLines.push("target_files:");
      detectedFiles.forEach((file) => yamlLines.push(`  - "${file}"`));
    }

    if (videoUrls.length > 0) {
      yamlLines.push("video_links:");
      videoUrls.forEach((url) => yamlLines.push(`  - "${url}"`));
    }

    if (docUrls.length > 0) {
      yamlLines.push("documentation_links:");
      docUrls.forEach((url) => yamlLines.push(`  - "${url}"`));
    }

    if (extractedUrls.length > 0 && videoUrls.length === 0 && docUrls.length === 0) {
      yamlLines.push("extracted_urls:");
      extractedUrls.forEach((url) => yamlLines.push(`  - "${url}"`));
    }

    yamlLines.push("---");
    const yamlFrontmatter = yamlLines.join("\n");

    // 9. Montagem do Markdown Body
    const markdownBody = `# Requisito Processado\n\n${cleaned}`;

    // 10. Payload Completo Estruturado
    const fullFormattedPrompt = `${yamlFrontmatter}\n\n${markdownBody}`;

    return {
      yamlFrontmatter,
      markdownBody,
      fullFormattedPrompt,
      intentType,
      extractedUrls,
      videoUrls,
      docUrls,
      detectedFiles,
      hasErrorLog,
      hasMultimodalAttachments,
      originalLength,
      processedLength,
      tokenReductionPercent: reductionRatio,
    };
  }
}
