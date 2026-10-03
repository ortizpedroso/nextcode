/**
 * Dual-Lens Blind Auditor (NextCode v5 - Trava T5)
 * Executa a validação em 2 Camadas / 2 Tipos:
 * - Validador Tipo 1 (Determinístico / Mecânico): Linters, compiladores, SAST security scanner e testes unitários. Custo Token = 0.
 * - Validador Tipo 2 (Semântico / Auditor Cego - LLM):
 *     - Lente 1 (Cega): Avalia código em quarentena exclusivamente contra o Brief original (sem ler o relatório do worker).
 *     - Lente 2 (Verificação Cruzada): Compara o relatório de auditoria cego com o relatório do worker e emite APPROVED ou REJECTED.
 */

import { BriefBuilder } from "../brief/brief-builder";

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
  /**
   * "llm_blind": a Lente 1 leu o código real e comparou contra o Brief via LLM (verificação semântica genuína).
   * "heuristic_fallback": nenhum dispatchFn foi fornecido ou o LLM falhou/não respondeu JSON válido — o
   * veredito caiu de volta no heurístico antigo (apenas checa se houve alegação de sucesso / arquivos extraídos).
   * "n/a": Tipo 1 já reprovou, então a Lente 2 nem chegou a ser avaliada.
   */
  method: "llm_blind" | "heuristic_fallback" | "n/a";
  /**
   * true quando a alegação do worker (claimedSuccess) diverge do veredito independente da
   * Lente Cega (blindVerdict.implemented) — só é calculável no método "llm_blind". O verdict
   * final já é decidido exclusivamente pela Lente Cega (a única leitura real do código), então
   * essa divergência nunca muda o resultado — ela é sinal de telemetria: um worker que relata
   * conclusão de forma recorrentemente desalinhada da realidade do código é o próprio padrão de
   * alucinação que esta trava existe para detectar, mesmo quando o código final acaba aprovado.
   */
  divergenceDetected?: boolean;
}

export interface BlindAuditVerdict {
  implemented: boolean;
  missingRequirements: string[];
  justification: string;
}

/** Função de despacho LLM injetada pelo chamador (desacopla o auditor do SmartRouter/provedores). */
export type LLMDispatchFn = (
  messages: { role: "system" | "user"; content: string }[]
) => Promise<string | null>;

/** Normaliza um caminho relativo para comparação de escopo (separador, "./" e "/" iniciais). */
export function normalizeScopePath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
}

export class DualLensAuditor {
  /**
   * Validador Tipo 1: Execução Determinística e Mecânica (Zero Token Cost)
   */
  public static validateType1(
    codeContentMap: Record<string, string>,
    mandatoryRules: string[] = [],
    projectRoot?: string,
    allowedFilesScope?: string[],
    extractionIssues: string[] = []
  ): ValidationType1Result {
    // Destino ambíguo/duplicado na extração (QuarantineManager.extractionIssues) é erro fatal:
    // o código pode ter ido para o arquivo errado ou sido descartado por sobrescrita.
    const compilationErrors: string[] = [...extractionIssues];
    const securityViolations: string[] = [];
    const testFailures: string[] = [];

    // Trava T2 (Strict Files Scope): quando o chamador declara o files_scope do nó (DAG), todo
    // arquivo gerado fora dele invalida a tentativa — antes o escopo era só um fallback de
    // nomeação na extração e o worker podia gravar qualquer caminho via "// file: ...".
    if (allowedFilesScope) {
      const scopeCheck = BriefBuilder.validateScope(allowedFilesScope);
      if (!scopeCheck.isValid) {
        securityViolations.push(scopeCheck.error!);
      } else {
        const allowed = new Set(allowedFilesScope.map(normalizeScopePath));
        for (const filePath of Object.keys(codeContentMap)) {
          if (!allowed.has(normalizeScopePath(filePath))) {
            securityViolations.push(
              `[TRAVA T2 VIOLADA] ${filePath} está fora do files_scope declarado (${allowedFilesScope.join(", ")}).`
            );
          }
        }
      }
    }

    // Pré-passo: coleta todos os modelos Prisma realmente declarados (lote atual +
    // schema.prisma em disco, quando projectRoot é fornecido) para o guard de alucinação
    // de modelo abaixo (0.8). Só ativa o guard quando existe pelo menos uma fonte de schema
    // para comparar — sem isso, ausência de dado se tornaria falso-positivo.
    const declaredModelAccessors = new Set<string>();
    let hasSchemaSource = false;
    const collectModelAccessors = (schemaContent: string) => {
      hasSchemaSource = true;
      for (const m of schemaContent.matchAll(/model\s+([a-zA-Z0-9_]+)\s*\{/g)) {
        declaredModelAccessors.add(m[1].charAt(0).toLowerCase() + m[1].slice(1));
      }
    };
    // Se o lote reescreve o próprio schema.prisma, ele é a fonte de verdade: somar com a
    // versão em disco deixaria passar código que ainda usa um modelo removido/renomeado.
    let batchReplacesDiskSchema = false;
    for (const [batchPath, batchContent] of Object.entries(codeContentMap)) {
      const normalizedBatchPath = batchPath.replace(/\\/g, "/").toLowerCase();
      if (normalizedBatchPath.endsWith(".prisma")) {
        collectModelAccessors(batchContent);
        if (normalizedBatchPath === "schema.prisma" || normalizedBatchPath.endsWith("prisma/schema.prisma")) {
          batchReplacesDiskSchema = true;
        }
      }
    }
    if (projectRoot && !batchReplacesDiskSchema) {
      const diskSchemaPath = require("path").join(projectRoot, "prisma", "schema.prisma");
      try {
        if (require("fs").existsSync(diskSchemaPath)) {
          collectModelAccessors(require("fs").readFileSync(diskSchemaPath, "utf-8"));
        }
      } catch {
        // Leitura do schema em disco falhou — segue sem essa fonte, sem quebrar a auditoria.
      }
    }

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

      // 4.5 Prisma Model Hallucination Guard: detecta "prisma.<model>." cujo modelo não
      // está declarado em nenhum schema.prisma (lote atual ou disco) — causa raiz do caso
      // original (prisma.transaction.* sem nenhum "model Transaction" declarado em lugar
      // nenhum). "$"-prefixados (ex.: prisma.$transaction) são métodos do Client, não modelos,
      // e não casam com a classe de caracteres do regex abaixo.
      if (hasSchemaSource && (filePath.endsWith(".ts") || filePath.endsWith(".tsx"))) {
        const prismaUsageRegex = /\bprisma\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g;
        const alreadyReported = new Set<string>();
        let usageMatch: RegExpExecArray | null;
        while ((usageMatch = prismaUsageRegex.exec(content)) !== null) {
          const accessor = usageMatch[1];
          if (declaredModelAccessors.has(accessor) || alreadyReported.has(accessor)) continue;
          alreadyReported.add(accessor);
          compilationErrors.push(
            `[PRISMA MODEL HALLUCINATION] ${filePath} usa "prisma.${accessor}." mas nenhum modelo correspondente a "${accessor}" está declarado em schema.prisma.`
          );
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

  /** Chamadas à Lente Cega antes de cair no fallback (que rejeita). */
  private static readonly BLIND_LENS_MAX_CALLS = 2;

  private static readonly SUCCESS_KEYWORDS = [
    "concluído",
    "concluido",
    "sucesso",
    "executado",
    "gerado",
    "criado",
    "implementado",
    "finished",
    "created",
    "done",
    "success",
  ];

  /**
   * Alegação textual de conclusão do worker. Só olha o relatório — antes também retornava
   * true sempre que havia arquivo extraído, o que tornava a alegação constante e a Lente 2
   * (divergência) praticamente incapaz de detectar o worker subestimando o resultado.
   */
  private static workerClaimedSuccess(workerExecutionReport: string): boolean {
    const textLower = workerExecutionReport.toLowerCase();
    return DualLensAuditor.SUCCESS_KEYWORDS.some((k) => textLower.includes(k));
  }

  /**
   * Fallback heurístico (comportamento antigo, NÃO é verificação semântica real): apenas
   * confere se o Worker alegou sucesso em texto livre e/ou se algum arquivo chegou a ser
   * extraído. Usado quando nenhum dispatchFn é fornecido ou quando a Lente 1 (LLM) falha/
   * não responde JSON válido — nunca bloqueia o pipeline, mas o resultado é explicitamente
   * marcado com method: "heuristic_fallback" para quem consome o veredito saber que não
   * houve comparação real contra o Brief.
   */
  private static heuristicFallback(workerExecutionReport: string, filesInScope: string[]): ValidationType2Result {
    const claimedSuccess = DualLensAuditor.workerClaimedSuccess(workerExecutionReport);

    // Trava T5: sem a Lente Cega não houve verificação semântica nenhuma — o fallback NUNCA
    // aprova. Antes ele aprovava sempre que algum arquivo fosse extraído, então qualquer
    // timeout/queda do auditor LLM virava aprovação automática. Rejeitar aqui faz o nó/chat
    // entrar no ciclo normal de retry (e, persistindo, no bloqueio D-RANHO da Trava T6).
    const verdict = "REJECTED" as const;
    const rejectionReason =
      "Auditoria cega (Tipo 2) indisponível — o auditor LLM não respondeu um veredito válido (nem na nova chamada), então não houve verificação semântica do código contra o Brief e nada foi promovido.";

    const lens1BlindReport = `[LENTE 1 - RELATÓRIO CEGO DE AUDITORIA (INDISPONÍVEL)]
- Arquivos no escopo: ${filesInScope.join(", ")}
- AVISO: nenhum classificador LLM disponível/responsivo nesta execução — o código NÃO foi lido contra o Brief, portanto não pode ser aprovado.`;

    const lens2CrossVerification = `[LENTE 2 - VERIFICAÇÃO CRUZADA]
- Relatório do Worker alega conclusão: ${claimedSuccess ? "SIM" : "NÃO"}
- Veredito da Auditoria: ${verdict} (sem leitura semântica)`;

    return {
      verdict,
      lens1BlindReport,
      lens2CrossVerification,
      rejectionReason,
      method: "heuristic_fallback",
    };
  }

  /**
   * Lente 1 real: envia ao LLM APENAS o Brief original e o conteúdo real dos arquivos gerados
   * (NUNCA o relatório do worker) e pede um veredito independente sobre se o código de fato
   * implementa o que foi pedido. Isso é o que torna a auditoria "cega" de verdade — antes, a
   * Lente 1 nunca lia o código nem o Brief, só respondia PASS incondicionalmente.
   */
  private static async runBlindLens(
    briefMarkdown: string,
    codeContentMap: Record<string, string>,
    dispatchFn: LLMDispatchFn
  ): Promise<BlindAuditVerdict | null> {
    const MAX_FILE_CHARS = 2500;
    const MAX_TOTAL_CHARS = 9000;
    let budget = MAX_TOTAL_CHARS;
    const fileBlocks: string[] = [];
    for (const [filePath, content] of Object.entries(codeContentMap)) {
      if (budget <= 0) break;
      const truncated = content.slice(0, Math.min(MAX_FILE_CHARS, budget));
      fileBlocks.push(`--- ${filePath} ---\n${truncated}`);
      budget -= truncated.length;
    }

    const messages: { role: "system" | "user"; content: string }[] = [
      {
        role: "system",
        content:
          "Você é um Auditor Cego de código. Você NÃO viu nenhum relatório de execução do worker, apenas o " +
          "Brief original e o conteúdo real dos arquivos gerados abaixo. Sua única tarefa é verificar, com base " +
          "EXCLUSIVAMENTE na lógica real do código (nunca em nomes de arquivo, comentários ou alegações), se os " +
          "requisitos do Brief foram de fato implementados. Responda SOMENTE com um JSON de uma linha, sem " +
          'markdown e sem texto extra, no formato exato: {"implemented":true|false,"missingRequirements":' +
          '["..."],"justification":"motivo em até 40 palavras"}.',
      },
      {
        role: "user",
        content: `[BRIEF ORIGINAL]\n${briefMarkdown.slice(0, 3000)}\n\n[ARQUIVOS GERADOS]\n${fileBlocks.join("\n\n")}`,
      },
    ];

    try {
      const raw = await dispatchFn(messages);
      if (!raw) return null;
      const match = raw.match(/\{[\s\S]*?"implemented"\s*:\s*(?:true|false)[\s\S]*?\}/i);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.implemented !== "boolean") return null;
      return {
        implemented: parsed.implemented,
        missingRequirements: Array.isArray(parsed.missingRequirements)
          ? parsed.missingRequirements.slice(0, 10).map((r: unknown) => String(r))
          : [],
        justification: String(parsed.justification || "").slice(0, 300),
      };
    } catch {
      return null;
    }
  }

  /**
   * Validador Tipo 2: Auditoria Cega Semântica em Duas Lentes (Dual Lens Auditor).
   *
   * Lente 1 (Cega): se `dispatchFn` for fornecido, lê o Brief + o código real gerado via LLM
   * e emite um veredito independente de implementação — sem nunca ver o relatório do worker.
   * Lente 2 (Verificação Cruzada): confronta esse veredito independente com a alegação do
   * worker e reporta explicitamente qualquer divergência (sinal direto de alucinação).
   *
   * Sem `dispatchFn` (ou se o LLM falhar/timeout/responder algo não-parseável), cai no
   * fallback heurístico, que REJEITA (method: "heuristic_fallback") — sem leitura semântica
   * real não há aprovação; a falha entra no ciclo normal de retry/bloqueio.
   */
  public static async validateType2(
    type1Result: ValidationType1Result,
    briefMarkdown: string,
    workerExecutionReport: string,
    codeContentMap: Record<string, string>,
    dispatchFn?: LLMDispatchFn
  ): Promise<ValidationType2Result> {
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
        method: "n/a",
      };
    }

    const filesInScope = Object.keys(codeContentMap);

    if (dispatchFn) {
      // Sem veredito da Lente Cega o fallback rejeita — então uma instabilidade momentânea do
      // provedor (timeout, JSON truncado) custaria uma tentativa inteira do nó, com nova
      // geração do worker. Uma nova chamada só ao auditor é muito mais barata.
      let blindVerdict: BlindAuditVerdict | null = null;
      for (let call = 1; call <= DualLensAuditor.BLIND_LENS_MAX_CALLS && !blindVerdict; call++) {
        blindVerdict = await DualLensAuditor.runBlindLens(briefMarkdown, codeContentMap, dispatchFn).catch(
          () => null
        );
      }

      if (blindVerdict) {
        const claimedSuccess = DualLensAuditor.workerClaimedSuccess(workerExecutionReport);
        const verdict: "APPROVED" | "REJECTED" = blindVerdict.implemented ? "APPROVED" : "REJECTED";
        const divergence = claimedSuccess !== blindVerdict.implemented;

        const lens1BlindReport = `[LENTE 1 - RELATÓRIO CEGO DE AUDITORIA (LLM)]
- Arquivos auditados: ${filesInScope.join(", ")}
- Veredito independente: ${blindVerdict.implemented ? "IMPLEMENTADO" : "NÃO IMPLEMENTADO"}
- Justificativa: ${blindVerdict.justification}${
          blindVerdict.missingRequirements.length
            ? `\n- Requisitos ausentes: ${blindVerdict.missingRequirements.join("; ")}`
            : ""
        }`;

        const lens2CrossVerification = `[LENTE 2 - VERIFICAÇÃO CRUZADA]
- Relatório do Worker alega conclusão: ${claimedSuccess ? "SIM" : "NÃO"}
- Veredito independente da Lente Cega: ${blindVerdict.implemented ? "SIM" : "NÃO"}
- Divergência detectada: ${divergence ? "SIM — alegação do worker não confere com a leitura real do código" : "NÃO"}`;

        return {
          verdict,
          lens1BlindReport,
          lens2CrossVerification,
          rejectionReason:
            verdict === "REJECTED"
              ? `Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: ${blindVerdict.justification}${
                  blindVerdict.missingRequirements.length
                    ? ` | Pendências: ${blindVerdict.missingRequirements.join("; ")}`
                    : ""
                }`
              : undefined,
          method: "llm_blind",
          divergenceDetected: divergence,
        };
      }
    }

    return DualLensAuditor.heuristicFallback(workerExecutionReport, filesInScope);
  }
}
