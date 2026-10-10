/**
 * Dual-Lens Blind Auditor (NextCode v5 - Trava T5)
 * Executa a validação em 2 Camadas / 2 Tipos:
 * - Validador Tipo 1 (Determinístico / Mecânico): Linters, compiladores, SAST security scanner e testes unitários. Custo Token = 0.
 * - Validador Tipo 2 (Semântico / Auditor Cego - LLM):
 *     - Lente 1 (Cega): Avalia código em quarentena exclusivamente contra o Brief original (sem ler o relatório do worker).
 *     - Lente 2 (Verificação Cruzada): Compara o relatório de auditoria cego com o relatório do worker e emite APPROVED ou REJECTED.
 */

import { BriefBuilder } from "../brief/brief-builder";
import { loadRoleSkill, buildSkillSystemPrompt } from "../skills/skill-runtime";
import {
  classifyLens2Divergence,
  type Lens1ReqStatus,
  type Lens2DivergenceKind,
  type MicrobriefAndReportDocument,
} from "../templates/artifact-templates";
import type { ClusterKind } from "../config/orchestration-policy";
import { TelemetryLogger } from "../telemetry/telemetry-logger";
import * as nodeFs from "fs";
import * as nodePath from "path";

export interface ValidationType1Result {
  passed: boolean;
  compilationErrors: string[];
  securityViolations: string[];
  testFailures: string[];
}

export interface ReqBlindVerdictItem {
  id: string;
  status: Lens1ReqStatus;
  evidencia: string;
}

export interface ReqLens2DivergenceItem {
  reqId: string;
  statusLente1: Lens1ReqStatus;
  declaradoPeloExecutor: "atendido" | "parcial" | "nao_atendido";
  tipoDivergencia: Lens2DivergenceKind;
  detalhe: string;
}

export interface ReqLens2ComparisonItem {
  reqId: string;
  statusLente1: Lens1ReqStatus;
  declaradoPeloExecutor: "atendido" | "parcial" | "nao_atendido" | "nao_declarado";
  tipoDivergencia: Lens2DivergenceKind;
}

export interface ValidationType2Result {
  verdict: "APPROVED" | "REJECTED";
  rawVerdict?: "APROVADO" | "APROVADO_COM_RESSALVA" | "REPROVADO";
  ressalvas?: string[];
  reqVerdicts?: ReqBlindVerdictItem[];
  reqDivergences?: ReqLens2DivergenceItem[];
  lens2ByReq?: ReqLens2ComparisonItem[];
  skillUsed?: string;
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
   * true quando a alegação do worker (claimedSuccess ou tabela por REQ) diverge do veredito independente da
   * Lente Cega (blindVerdict.implemented / reqVerdicts) — só é calculável no método "llm_blind".
   */
  divergenceDetected?: boolean;
}

export interface BlindAuditVerdict {
  implemented: boolean;
  missingRequirements: string[];
  justification: string;
  rawVerdict?: "APROVADO" | "APROVADO_COM_RESSALVA" | "REPROVADO";
  ressalvas?: string[];
  reqVerdicts?: ReqBlindVerdictItem[];
}

export interface ValidateType2Options {
  cluster?: ClusterKind;
  expectedReqs?: string[];
  isPublicPage?: boolean;
  includeReactPerf?: boolean;
  nodeId?: string;
  sessionId?: string;
  executorReport?: MicrobriefAndReportDocument | null;
}

/** Função de despacho LLM injetada pelo chamador (desacopla o auditor do SmartRouter/provedores). */
export type LLMDispatchFn = (
  messages: { role: "system" | "user"; content: string }[]
) => Promise<string | null>;

const SCRIPT_FILE_RE = /\.(?:[cm]?[jt]sx?)$/i;

type TypeScriptModule = typeof import("typescript");
let cachedTypeScript: TypeScriptModule | null | undefined;
/** typescript é devDependency: carregado sob demanda; null se não estiver instalado. */
function loadTypeScript(): TypeScriptModule | null {
  if (cachedTypeScript === undefined) {
    try {
      cachedTypeScript = require("typescript") as TypeScriptModule;
    } catch {
      cachedTypeScript = null;
    }
  }
  return cachedTypeScript;
}

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
      const diskSchemaPath = nodePath.join(projectRoot, "prisma", "schema.prisma");
      try {
        if (nodeFs.existsSync(diskSchemaPath)) {
          collectModelAccessors(nodeFs.readFileSync(diskSchemaPath, "utf-8"));
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

      // 2. Validação sintática. Para JS/TS usa o parser real do TypeScript: a contagem de
      // chaves/parênteses dava falso positivo com "{" dentro de strings, template literals,
      // regex e comentários, e não pegava erros com contagem balanceada ("const = 1;").
      const syntaxErrors = SCRIPT_FILE_RE.test(filePath) ? DualLensAuditor.parseScriptSyntax(filePath, content) : null;
      if (syntaxErrors) {
        compilationErrors.push(...syntaxErrors);
      } else if (!/\.(?:md|mdx|txt|ya?ml)$/i.test(filePath)) {
        // Texto/Markdown/YAML: "(" sem ")" é prosa normal ("1) item"); a contagem reprovava
        // documentos por "desbalanceamento de parênteses" (sessão gateway, 06/10).
        // Demais arquivos (ou typescript indisponível): balanço de chaves/parênteses.
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

          const path = nodePath;
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
            const fs = nodeFs;
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

  /**
   * Erros de SINTAXE (não de tipo) de um arquivo JS/TS pelo parser do TypeScript — sem
   * executar o código e sem custo de token. Tipos são verificados depois, contra o projeto
   * inteiro, pelo portão empírico (empirical-gate.ts). Retorna null se o typescript não
   * estiver disponível (o chamador cai na checagem de balanço).
   */
  private static parseScriptSyntax(filePath: string, content: string): string[] | null {
    const ts = loadTypeScript();
    if (!ts) return null;
    const output = ts.transpileModule(content, {
      fileName: filePath,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    return (output.diagnostics || []).slice(0, 5).map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null;
      return `[SYNTAX ERROR] ${filePath}${line ? `:${line}` : ""} — TS${d.code}: ${message}`;
    });
  }

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
   * Extrai alegações por REQ (ex.: "| REQ-001 | atendido | src/lib/x.ts:10 |") do relatório do executor
   * para a Verificação Cruzada da Lente 2.
   */
  public static parseExecutorReqClaims(
    workerExecutionReport: string
  ): Map<string, { statusDeclarado: "atendido" | "parcial" | "nao_atendido"; evidenciaCitada: string }> {
    const map = new Map<string, { statusDeclarado: "atendido" | "parcial" | "nao_atendido"; evidenciaCitada: string }>();
    const lines = workerExecutionReport.split(/\r?\n/);
    for (const line of lines) {
      const reqMatch = line.match(/\b(REQ-\d{3,})\b/i);
      if (!reqMatch) continue;
      const reqId = reqMatch[1].toUpperCase();
      const lower = line.toLowerCase();
      let statusDeclarado: "atendido" | "parcial" | "nao_atendido" = "atendido";
      if (lower.includes("nao_atendido") || lower.includes("não atendido") || lower.includes("ausente")) {
        statusDeclarado = "nao_atendido";
      } else if (lower.includes("parcial")) {
        statusDeclarado = "parcial";
      }
      const fileLineMatch = line.match(/([a-zA-Z0-9_./\[\]-]+\.[a-zA-Z0-9]+):(\d+)/);
      map.set(reqId, {
        statusDeclarado,
        evidenciaCitada: fileLineMatch ? `${fileLineMatch[1]}:${fileLineMatch[2]}` : "",
      });
    }
    return map;
  }

  /**
   * Lente 1 real: envia ao LLM APENAS o Brief original e o conteúdo real dos arquivos gerados
   * (NUNCA o relatório do worker) e pede um veredito independente sobre se o código de fato
   * implementa o que foi pedido, usando a skill declarativa do cluster (`avaliador-<cluster>`).
   */
  private static async runBlindLens(
    briefMarkdown: string,
    codeContentMap: Record<string, string>,
    dispatchFn: LLMDispatchFn,
    options?: ValidateType2Options
  ): Promise<{ verdict: BlindAuditVerdict; skillUsed: string } | null> {
    const MAX_FILE_CHARS = Number(process.env.BLIND_AUDIT_MAX_FILE_CHARS) || 24000;
    const MAX_TOTAL_CHARS = Number(process.env.BLIND_AUDIT_MAX_TOTAL_CHARS) || 80000;
    let budget = MAX_TOTAL_CHARS;
    const fileBlocks: string[] = [];
    for (const [filePath, content] of Object.entries(codeContentMap)) {
      if (budget <= 0) {
        fileBlocks.push(`--- ${filePath} ---\n[NÃO EXIBIDO PELO NEXTCODE POR LIMITE DE TAMANHO — não é defeito do código]`);
        continue;
      }
      const limit = Math.min(MAX_FILE_CHARS, budget);
      const shown = content.slice(0, limit);
      const note =
        content.length > limit
          ? `\n[... ${content.length - limit} caracteres OMITIDOS PELO NEXTCODE por limite de tamanho — o arquivo continua; NÃO reprove por isso]`
          : "";
      fileBlocks.push(`--- ${filePath} ---\n${shown}${note}`);
      budget -= shown.length;
    }

    const cluster = options?.cluster;
    const skillName = cluster ? `avaliador-${cluster}` : "avaliador";
    let skillBlock = "";
    try {
      const loadedSkill = loadRoleSkill(skillName);
      const isPublic = Boolean(options?.isPublicPage);
      const incReact = options?.includeReactPerf ?? true;
      skillBlock =
        "\n\n[INSTRUÇÕES DECLARATIVAS DA SKILL " +
        loadedSkill.name.toUpperCase() +
        "]\n" +
        buildSkillSystemPrompt(loadedSkill, {
          includeLocalReferences: cluster === "frontend",
          includeTasteSkillPublic: isPublic,
          includeReactPerf: incReact,
        });

      const referenciasIncluidas: string[] = [];
      if (cluster === "frontend") {
        for (const refPath of Object.keys(loadedSkill.resolvedReferencesContent)) {
          if (refPath.includes("taste-skill") && !isPublic) continue;
          if (refPath.includes("react-best-practices") && !incReact) continue;
          referenciasIncluidas.push(refPath);
        }
      }

      if (options?.sessionId) {
        TelemetryLogger.log({
          sessionId: options.sessionId,
          action: "EVALUATOR_SKILL_REFS",
          details: {
            nodeId: options.nodeId ?? null,
            skill: skillName,
            referencias: referenciasIncluidas,
            caracteres: skillBlock.length,
          },
        });
      }
    } catch {
      /* fallback silencioso caso o diretório skills/ não esteja presente em algum ambiente isolado */
    }

    const reqsInstruction =
      options?.expectedReqs && options.expectedReqs.length > 0
        ? ` OBRIGATÓRIO: julgue CADA requisito (${options.expectedReqs.join(", ")}) separadamente, contra os critérios de aceite do Brief, no campo "reqVerdicts":[{"id":"REQ-001","status":"implementado"|"parcial"|"ausente","evidencia":"arquivo:linha"}]. Uma resposta sem todos esses REQ é descartada. Julgue só estes REQ e só os arquivos desta etapa.`
        : "";

    const messages: { role: "system" | "user"; content: string }[] = [
      {
        role: "system",
        content:
          "Você é um Auditor Cego de código. Você NÃO viu nenhum relatório de execução do worker, apenas o " +
          "Brief original e o conteúdo real dos arquivos gerados abaixo. Sua única tarefa é verificar, com base " +
          "EXCLUSIVAMENTE na lógica real do código (nunca em nomes de arquivo, comentários ou alegações), se os " +
          "requisitos do Brief foram de fato implementados." +
          reqsInstruction +
          " Responda SOMENTE com um JSON de uma linha, sem " +
          'markdown e sem texto extra, no formato exato: {"implemented":true|false,"missingRequirements":' +
          '["..."],"justification":"motivo em até 40 palavras"' +
          (reqsInstruction ? ',"reqVerdicts":[...]' : "") +
          "}." +
          skillBlock,
      },
      {
        role: "user",
        content: `[BRIEF ORIGINAL]\n${briefMarkdown.slice(0, Number(process.env.BLIND_AUDIT_MAX_BRIEF_CHARS) || 30000)}\n\n[ARQUIVOS GERADOS]\n${fileBlocks.join("\n\n")}`,
      },
    ];

    try {
      const raw = await dispatchFn(messages);
      if (!raw) return null;
      const match = raw.match(/\{[\s\S]*?"implemented"\s*:\s*(?:true|false)[\s\S]*\}/i);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.implemented !== "boolean") return null;

      let reqVerdicts: ReqBlindVerdictItem[] | undefined = Array.isArray(parsed.reqVerdicts || parsed.veredito_por_req)
        ? (parsed.reqVerdicts || parsed.veredito_por_req).map((r: any) => ({
            id: String(r.id || r.reqId || "REQ-001"),
            status: (["implementado", "parcial", "ausente"].includes(r.status) ? r.status : "ausente") as Lens1ReqStatus,
            evidencia: String(r.evidencia || ""),
          }))
        : undefined;

      // Veredito por REQ obrigatório (P12): faltando algum REQ esperado, a resposta é descartada
      // (null → o auditor pergunta de novo; persistindo, a etapa NÃO é aprovada). REQ inventado é ignorado.
      const expected = options?.expectedReqs ?? [];
      if (expected.length > 0) {
        const got = new Set((reqVerdicts ?? []).map((r) => r.id));
        if (!expected.every((id) => got.has(id))) return null;
        reqVerdicts = (reqVerdicts ?? []).filter((r) => expected.includes(r.id));
      }

      const ressalvas: string[] | undefined = Array.isArray(parsed.ressalvas)
        ? parsed.ressalvas.map((s: unknown) => String(s))
        : undefined;

      // Se houver reqVerdicts explícitos e algum estiver parcial ou ausente, implemented é false (P12)
      const hasIncompleteReq = reqVerdicts ? reqVerdicts.some((r) => r.status !== "implementado") : false;
      const effectiveImplemented = hasIncompleteReq ? false : Boolean(parsed.implemented);

      const rawVerdict: "APROVADO" | "APROVADO_COM_RESSALVA" | "REPROVADO" = !effectiveImplemented
        ? "REPROVADO"
        : parsed.rawVerdict === "APROVADO_COM_RESSALVA" ||
            parsed.veredito_final === "APROVADO_COM_RESSALVA" ||
            (ressalvas && ressalvas.length > 0)
          ? "APROVADO_COM_RESSALVA"
          : "APROVADO";

      return {
        skillUsed: skillName,
        verdict: {
          implemented: effectiveImplemented,
          missingRequirements: Array.isArray(parsed.missingRequirements)
            ? parsed.missingRequirements.slice(0, 10).map((r: unknown) => String(r))
            : [],
          justification: String(parsed.justification || "").slice(0, 300),
          rawVerdict,
          ressalvas,
          reqVerdicts,
        },
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
   * worker (inclusive por REQ e citações arquivo:linha) e reporta qualquer divergência.
   */
  public static async validateType2(
    type1Result: ValidationType1Result,
    briefMarkdown: string,
    workerExecutionReport: string,
    codeContentMap: Record<string, string>,
    dispatchFn?: LLMDispatchFn,
    options?: ValidateType2Options
  ): Promise<ValidationType2Result> {
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
      let blindOutcome: { verdict: BlindAuditVerdict; skillUsed: string } | null = null;
      for (let call = 1; call <= DualLensAuditor.BLIND_LENS_MAX_CALLS && !blindOutcome; call++) {
        blindOutcome = await DualLensAuditor.runBlindLens(briefMarkdown, codeContentMap, dispatchFn, options).catch(
          () => null
        );
      }

      if (blindOutcome) {
        const { verdict: blindVerdict, skillUsed } = blindOutcome;
        const claimedSuccess = DualLensAuditor.workerClaimedSuccess(workerExecutionReport);

        // Lente 2: compara o veredito da Lente Cega por REQ com o executorReport validado.
        // Quando há relatório validado (ou quando a etapa usa REQs), NÃO usa a heurística de texto livre.
        // Sem relatório válido: marca "nao_declarado" e NÃO acusa divergência por isso.
        const hasExplicitExecutorReportOption = Boolean(options && "executorReport" in options);
        const validatedReport = options?.executorReport ?? null;
        const executorClaims = new Map<
          string,
          { statusDeclarado: "atendido" | "parcial" | "nao_atendido"; evidenciaCitada: string }
        >();
        if (validatedReport && Array.isArray(validatedReport.registroCumprimento)) {
          for (const row of validatedReport.registroCumprimento) {
            if (
              row.reqId &&
              (row.statusDeclarado === "atendido" ||
                row.statusDeclarado === "parcial" ||
                row.statusDeclarado === "nao_atendido")
            ) {
              executorClaims.set(row.reqId.toUpperCase(), {
                statusDeclarado: row.statusDeclarado,
                evidenciaCitada: row.arquivoLinha || "",
              });
            }
          }
        } else if (!hasExplicitExecutorReportOption) {
          for (const [k, v] of DualLensAuditor.parseExecutorReqClaims(workerExecutionReport)) {
            executorClaims.set(k, v);
          }
        }

        const reqDivergences: ReqLens2DivergenceItem[] = [];
        const lens2ByReq: ReqLens2ComparisonItem[] = [];

        if (blindVerdict.reqVerdicts && blindVerdict.reqVerdicts.length > 0) {
          for (const rv of blindVerdict.reqVerdicts) {
            const claim = executorClaims.get(rv.id);
            if (!claim) {
              const div = classifyLens2Divergence(rv.status, "nao_declarado");
              lens2ByReq.push({
                reqId: rv.id,
                statusLente1: rv.status,
                declaradoPeloExecutor: "nao_declarado",
                tipoDivergencia: div.tipoDivergencia,
              });
              continue;
            }
            const declaredStatus = claim.statusDeclarado;
            let citedLineExists = true;
            if (claim.evidenciaCitada) {
              const lineMatch = claim.evidenciaCitada.trim().match(/^([^:\s]+):(\d+)(?:-(\d+))?$/);
              if (!lineMatch) {
                citedLineExists = false;
              } else {
                const normCited = normalizeScopePath(lineMatch[1]);
                const matchedFileContent = Object.entries(codeContentMap).find(
                  ([k]) => normalizeScopePath(k) === normCited
                )?.[1];
                const startLine = Number(lineMatch[2]);
                const endLine = lineMatch[3] ? Number(lineMatch[3]) : startLine;
                const totalLines = matchedFileContent ? matchedFileContent.split(/\r?\n/).length : 0;
                if (!matchedFileContent || startLine < 1 || endLine < startLine || endLine > totalLines) {
                  citedLineExists = false;
                }
              }
            }
            const baseDiv = classifyLens2Divergence(rv.status, declaredStatus);
            const divType: Lens2DivergenceKind = !citedLineExists ? "alucinacao_grave" : baseDiv.tipoDivergencia;
            lens2ByReq.push({
              reqId: rv.id,
              statusLente1: rv.status,
              declaradoPeloExecutor: declaredStatus,
              tipoDivergencia: divType,
            });
            if (
              divType === "alucinacao_grave" ||
              divType === "divergencia_otimista" ||
              divType === "divergencia_conservadora"
            ) {
              reqDivergences.push({
                reqId: rv.id,
                statusLente1: rv.status,
                declaradoPeloExecutor: declaredStatus,
                tipoDivergencia: divType,
                detalhe: !citedLineExists
                  ? `Executor citou evidência inexistente (${claim.evidenciaCitada}) para ${rv.id}.`
                  : `Executor declarou ${rv.id} como "${declaredStatus}", mas a Lente 1 Cega constatou "${rv.status}" (${rv.evidencia}).`,
              });
            }
          }
        }

        const hasCriticalDivergence = reqDivergences.some(
          (d) => d.tipoDivergencia === "alucinacao_grave" || d.tipoDivergencia === "divergencia_otimista"
        );
        const verdict: "APPROVED" | "REJECTED" =
          blindVerdict.implemented && !hasCriticalDivergence ? "APPROVED" : "REJECTED";
        const effectiveRawVerdict = verdict === "REJECTED" ? "REPROVADO" : blindVerdict.rawVerdict;

        const hasReqContext = Boolean(
          (blindVerdict.reqVerdicts && blindVerdict.reqVerdicts.length > 0) ||
            hasExplicitExecutorReportOption
        );
        const divergence = hasReqContext
          ? reqDivergences.length > 0
          : claimedSuccess !== blindVerdict.implemented || reqDivergences.length > 0;

        const reqsSummaryBlock =
          blindVerdict.reqVerdicts && blindVerdict.reqVerdicts.length > 0
            ? `\n- Veredito por REQ: ${blindVerdict.reqVerdicts.map((r) => `${r.id}=${r.status} (${r.evidencia})`).join(", ")}`
            : "";

        const lens1BlindReport = `[LENTE 1 - RELATÓRIO CEGO DE AUDITORIA (LLM - ${skillUsed})]
- Arquivos auditados: ${filesInScope.join(", ")}
- Veredito independente: ${blindVerdict.implemented ? "IMPLEMENTADO" : "NÃO IMPLEMENTADO"} (${effectiveRawVerdict || verdict})
- Justificativa: ${blindVerdict.justification}${reqsSummaryBlock}${
          blindVerdict.missingRequirements.length
            ? `\n- Requisitos ausentes: ${blindVerdict.missingRequirements.join("; ")}`
            : ""
        }${
          blindVerdict.ressalvas && blindVerdict.ressalvas.length
            ? `\n- Ressalvas: ${blindVerdict.ressalvas.join("; ")}`
            : ""
        }`;

        const reqDivBlock =
          reqDivergences.length > 0
            ? `\n- Divergências por REQ: ${reqDivergences.map((d) => `${d.reqId} [${d.tipoDivergencia}]: ${d.detalhe}`).join(" | ")}`
            : "";
        const lens2DeclaredBlock =
          lens2ByReq.length > 0
            ? `\n- Declaração do Executor por REQ: ${lens2ByReq.map((r) => `${r.reqId}=${r.declaradoPeloExecutor}`).join(", ")}`
            : "";

        const lens2CrossVerification = `[LENTE 2 - VERIFICAÇÃO CRUZADA]
- Relatório do Worker alega conclusão: ${hasReqContext ? (executorClaims.size > 0 ? "SIM (relatório validado)" : "nao_declarado") : claimedSuccess ? "SIM" : "NÃO"}${lens2DeclaredBlock}
- Veredito independente da Lente Cega: ${blindVerdict.implemented ? "SIM" : "NÃO"}
- Divergência detectada: ${divergence ? "SIM — alegação do worker não confere com a leitura real do código" : "NÃO"}${reqDivBlock}`;

        const criticalDivDetails = reqDivergences
          .filter((d) => d.tipoDivergencia === "alucinacao_grave" || d.tipoDivergencia === "divergencia_otimista")
          .map((d) => d.detalhe)
          .join("; ");

        return {
          verdict,
          rawVerdict: effectiveRawVerdict,
          ressalvas: blindVerdict.ressalvas,
          reqVerdicts: blindVerdict.reqVerdicts,
          reqDivergences: reqDivergences.length > 0 ? reqDivergences : undefined,
          lens2ByReq: lens2ByReq.length > 0 ? lens2ByReq : undefined,
          skillUsed,
          lens1BlindReport,
          lens2CrossVerification,
          rejectionReason:
            verdict === "REJECTED"
              ? !blindVerdict.implemented
                ? `Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: ${blindVerdict.justification}${
                    blindVerdict.missingRequirements.length
                      ? ` | Pendências: ${blindVerdict.missingRequirements.join("; ")}`
                      : ""
                  }`
                : `Divergência crítica na Lente 2: ${criticalDivDetails}`
              : undefined,
          method: "llm_blind",
          divergenceDetected: divergence,
        };
      }
    }

    return DualLensAuditor.heuristicFallback(workerExecutionReport, filesInScope);
  }
}
