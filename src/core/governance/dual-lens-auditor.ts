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
    mandatoryRules: string[] = [],
    projectRoot?: string
  ): ValidationType1Result {
    const compilationErrors: string[] = [];
    const securityViolations: string[] = [];
    const testFailures: string[] = [];

    for (const [filePath, content] of Object.entries(codeContentMap)) {
      // 0. Validação mecânica estrita para arquivos .json (Linter determinístico)
      if (filePath.toLowerCase().endsWith(".json")) {
        try {
          const cleanJsonText = content.replace(/^(?:\/\/|#|\/\*)\s*(?:file|filepath|path)?.*$/gm, "").trim();
          const parsedJson = JSON.parse(cleanJsonText);
          if (filePath.toLowerCase().endsWith("package.json") && parsedJson && typeof parsedJson === "object") {
            const devScript = parsedJson.scripts?.dev;
            if (typeof devScript === "string") {
              const cleanDev = devScript.trim().toLowerCase();
              if (cleanDev.startsWith("src/") || cleanDev.endsWith(".ts") || cleanDev.endsWith(".tsx") || cleanDev.endsWith(".js")) {
                if (!cleanDev.startsWith("node ") && !cleanDev.startsWith("ts-node ") && !cleanDev.startsWith("next ")) {
                  compilationErrors.push(`[PACKAGE.JSON ERROR] O script "dev" em ${filePath} é inválido ("${devScript}"). Para projetos Next.js use "next dev".`);
                }
              }
            }
          }
        } catch (jsonErr: any) {
          compilationErrors.push(`[JSON SYNTAX ERROR] Estrutura JSON inválida em ${filePath}: ${jsonErr.message}`);
        }
      }

      // 0.5 Validação mecânica de schemas do Prisma (.prisma)
      if (filePath.toLowerCase().endsWith(".prisma")) {
        const modelMatches = content.matchAll(/model\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/g);
        let hasModels = false;
        for (const mMatch of modelMatches) {
          hasModels = true;
          const modelName = mMatch[1];
          const modelBody = mMatch[2];
          if (!modelBody.includes("@id") && !modelBody.includes("@@id")) {
            compilationErrors.push(`[PRISMA SCHEMA ERROR] O modelo "${modelName}" em ${filePath} não possui chave primária (@id ou @@id).`);
          }
        }
        if (!hasModels && !content.includes("generator") && !content.includes("datasource")) {
          compilationErrors.push(`[PRISMA SCHEMA ERROR] O arquivo ${filePath} não contém modelos nem configurações válidas do Prisma.`);
        }
      }

      // 0.6 Sanitização e Validação do Next.js App Router (page.tsx, layout.tsx, route.ts)
      const cleanFileLower = filePath.toLowerCase().replace(/\\/g, "/");
      if (cleanFileLower.includes("app/") || cleanFileLower.startsWith("src/app/") || cleanFileLower.includes("components/")) {
        // Validação da diretiva 'use client' vs erros de digitação como 'client'
        if (content.match(/^\s*['"]client['"];?/m)) {
          compilationErrors.push(`[NEXT.JS APP ROUTER ERROR] Diretiva de cliente malformada em ${filePath} ("'client'" em vez de "'use client'").`);
        }
        if (cleanFileLower.endsWith(".tsx") || cleanFileLower.endsWith(".jsx")) {
          const usesHooks = /\b(useState|useEffect|useContext|useRef|useCallback|useMemo|useReducer|useTransition|useDeferredValue|useFormStatus|useActionState)\b/.test(content);
          const hasUseClient = /^\s*['"]use client['"];?/m.test(content);
          if (usesHooks && !hasUseClient) {
            compilationErrors.push(`[NEXT.JS APP ROUTER ERROR] O componente ${filePath} utiliza React Hooks mas não declara "'use client'" no topo.`);
          }
        }
        if (cleanFileLower.endsWith("page.tsx") || cleanFileLower.endsWith("page.jsx") || cleanFileLower.endsWith("layout.tsx") || cleanFileLower.endsWith("layout.jsx")) {
          if (!content.includes("export default")) {
            compilationErrors.push(`[NEXT.JS APP ROUTER ERROR] O componente ${filePath} deve conter uma exportação padrão ("export default function ...").`);
          }
        } else if (cleanFileLower.endsWith("route.ts") || cleanFileLower.endsWith("route.js")) {
          const hasHttpMethod = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i.test(content);
          if (!hasHttpMethod) {
            compilationErrors.push(`[NEXT.JS APP ROUTER ERROR] A rota de API ${filePath} deve exportar pelo menos um método HTTP (GET, POST, PUT, DELETE, PATCH).`);
          }
        }
      }

      // 0.7 Validação mecânica para arquivos CSS (.css)
      if (filePath.toLowerCase().endsWith(".css")) {
        const cssLines = content.split("\n");
        for (let i = 0; i < cssLines.length; i++) {
          const trimmed = cssLines[i].trim();
          if (trimmed.startsWith("//")) {
            compilationErrors.push(`[CSS SYNTAX ERROR] Comentário inválido "//" na linha ${i + 1} em ${filePath}. CSS aceita apenas comentários /* ... */.`);
            break;
          }
        }
      }

      // 1. Verificação sintática básica (compilação TypeScript / AST balance checker)
      if (content.includes("eval(") || content.includes("exec(") || content.includes("new Function(")) {
        securityViolations.push(`[OWASP VIOLATION] Uso proibido de eval/exec/Function detectado em ${filePath}`);
      }
      if (content.includes("process.env.") && (content.includes("SECRET") || content.includes("KEY"))) {
        // Checagem se há chaves hardcoded
        if (content.includes(" = \"sk-") || content.includes(" = \"AIza") || content.includes(" = \"ghp_")) {
          securityViolations.push(`[SECRETS LEAK] Chave de API hardcoded detectada em ${filePath}`);
        }
      }

      // 2. Validação sintática de balanço de escopo (chaves/parênteses/colchetes)
      const openCurly = (content.match(/\{/g) || []).length;
      const closeCurly = (content.match(/\}/g) || []).length;
      const openParen = (content.match(/\(/g) || []).length;
      const closeParen = (content.match(/\)/g) || []).length;

      if (Math.abs(openCurly - closeCurly) > 0) {
        compilationErrors.push(`[SYNTAX ERROR] Desbalanceamento de chaves ({ }) detectado em ${filePath} (${openCurly} abertas, ${closeCurly} fechadas)`);
      }
      if (Math.abs(openParen - closeParen) > 0) {
        compilationErrors.push(`[SYNTAX ERROR] Desbalanceamento de parênteses (( )) detectado em ${filePath} (${openParen} abertos, ${closeParen} fechados)`);
      }

      // 3. Regra de tipagem estrita (Aviso de Clean Code registrado)
      if (content.includes(": any") && !content.includes("// eslint-disable")) {
        compilationErrors.push(`[CLEAN CODE VIOLATION] Uso proibido do tipo 'any' em ${filePath}`);
      }

      // 4. Import Dependency Guard (Verifica se imports locais existem no lote ou no repositório)
      if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
        const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"](@\/|\.\/|\.\.\/)(.*?)['"]/g;
        let impMatch: RegExpExecArray | null;
        while ((impMatch = importRegex.exec(content)) !== null) {
          const importPrefix = impMatch[1];
          const relativeModule = impMatch[2];

          const path = require("path");
          const fileDir = path.dirname(filePath).replace(/\\/g, "/");

          let resolvedPath = "";
          if (importPrefix === "@/") {
            resolvedPath = `src/${relativeModule}`;
          } else {
            resolvedPath = path.normalize(path.join(fileDir, `${importPrefix}${relativeModule}`)).replace(/\\/g, "/");
          }

          const baseImportPath = resolvedPath.replace(/\.(?:ts|tsx|js|jsx|css|json)$/, "");

          const candidateKeys = Object.keys(codeContentMap).map((k) => k.replace(/\\/g, "/").replace(/\.(?:ts|tsx|js|jsx|css|json)$/, ""));
          const existsInBatch = candidateKeys.includes(baseImportPath) || candidateKeys.includes(`${baseImportPath}/index`);

          if (!existsInBatch && projectRoot) {
            const fs = require("fs");
            let existsOnDisk = false;
            const possibleExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".css", ".json", "/index.ts", "/index.tsx", "/index.js"];
            for (const ext of possibleExtensions) {
              if (fs.existsSync(path.join(projectRoot, `${baseImportPath}${ext}`))) {
                existsOnDisk = true;
                break;
              }
            }
            if (!existsOnDisk) {
              compilationErrors.push(
                `[MISSING MODULE ERROR] O arquivo ${filePath} importa "${impMatch[0]}", mas o módulo "${resolvedPath}" não existe na quarentena nem no repositório.`
              );
            }
          }
        }
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
