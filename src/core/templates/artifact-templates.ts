/**
 * Templates Canônicos e Conferências Mecânicas (Princípio P12 / T2 / T3 / T4 / T8b)
 *
 * Implementa os 5 artefatos de `docs/rascunhos/TEMPLATES.md`:
 * 1. Spec com `REQ-001…`
 * 2. Macrobrief (com verificação de cobertura de REQs, partição disjunta de arquivos e DAG sem ciclos)
 * 3. Microbrief enxuto
 * 4. Relatório do Executor (mesmo template do Microbrief; `medido_pelo_harness` é sempre carimbado pelo harness)
 * 5. Veredito do Avaliador (Lente 1 Cega + Lente 2 Verificação Cruzada + coerência matemática da decisão)
 */

import * as fs from "fs";
import * as path from "path";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { routeFileCandidates } from "@/core/intake/spec-check";
import {
  isEvaluatorModelIndependent,
  type ClusterKind,
  type VerdictDecision,
} from "@/core/config/orchestration-policy";

export interface TraceableRequirement {
  id: string;
  titulo: string;
  descricaoECriterio: string;
}

export interface SpecWithReqsDocument {
  documento: "spec";
  projeto: string;
  versao: number;
  status: "rascunho" | "aguardando_aprovacao" | "aprovada";
  criadoEm: string;
  atualizadoEm: string;
  aprovadoEm?: string | null;
  aprovadoPor?: string | null;
  tipoInterface:
    | "nenhuma_somente_api"
    | "publica_landing"
    | "publica_checkout_simples"
    | "dashboard_produto"
    | "wizard_multietapas";
  requisitosIds: string[];
  duvidasEmAberto: string[];
  requisitosTabela: TraceableRequirement[];
}

export interface MacrobriefMicrobriefEntry {
  id: string;
  cluster: ClusterKind;
  dependeDe: string[];
  arquivos: string[];
  reqs: string[];
}

export interface MacrobriefDocument {
  documento: "macrobrief";
  idMacrobrief: string;
  idProjeto: string;
  specVersao: number;
  requisitosTotais: string[];
  clustersAtivos: ClusterKind[];
  microbriefs: MacrobriefMicrobriefEntry[];
  contratosTypescript: string;
}

export interface HarnessMeasuredTestSummary {
  executados: number;
  passaram: number;
  falharam: number;
  comando: string;
}

export interface HarnessMeasuredChangedFile {
  caminho: string;
  operacao: "criado" | "modificado";
  linhasAdicionadas: number;
  linhasRemovidas: number;
}

export interface HarnessMeasuredFields {
  /** Preenchido pelo harness, NUNCA pelo modelo. */
  compilou: boolean | null;
  /** Preenchido pelo harness, NUNCA pelo modelo. */
  testes: HarnessMeasuredTestSummary | null;
  /** Preenchido pelo harness, NUNCA pelo modelo. */
  arquivosAlterados: HarnessMeasuredChangedFile[];
}

export interface ExecutorReqRow {
  reqId: string;
  statusDeclarado: "PENDENTE" | "atendido" | "parcial" | "nao_atendido";
  arquivoLinha: string;
  comoFoiImplementado: string;
}

export interface MicrobriefAndReportDocument {
  documento: "microbrief" | "relatorio_executor";
  idMicrobrief: string;
  idMacrobrief: string;
  idProjeto: string;
  cluster: ClusterKind;
  nivelModeloSugerido: "rapido" | "medio" | "pesado";
  modeloUtilizado?: string;
  dependeDe: string[];
  reqsCobertos: string[];
  arquivosPermitidos: {
    criar: string[];
    modificar: string[];
    lerContratos: string[];
  };
  statusExecucao: "PENDENTE" | "CONCLUIDO" | "FALHOU";
  tentativaAtual: number;
  medidoPeloHarness: HarnessMeasuredFields;
  interfacesConsome: string[];
  interfacesProduz: string;
  criteriosAceitePorReq: Record<string, string[]>;
  registroCumprimento: ExecutorReqRow[];
}

export type Lens1ReqStatus = "implementado" | "parcial" | "ausente";
export type Lens2DivergenceKind =
  | "convergente"
  | "convergente_com_pendencia"
  | "divergencia_conservadora"
  | "divergencia_otimista"
  | "alucinacao_grave";

export interface Lens1EvaluationRow {
  reqId: string;
  microbriefId: string;
  statusLente1: Lens1ReqStatus;
  evidenciaCodigo: string; // arquivo:linha-linha
  analiseObjetiva: string;
}

export interface Lens2EvaluationRow {
  reqId: string;
  statusLente1: Lens1ReqStatus;
  declaradoPeloExecutor: "atendido" | "parcial" | "nao_atendido" | "nao_declarado";
  tipoDivergencia: Lens2DivergenceKind;
  evidenciaDivergencia: string;
}

export interface EvaluatorQualityIssue {
  id: string;
  severidade: "critico" | "importante" | "menor";
  reqId?: string;
  induzidoPeloPlano: boolean;
  arquivoLinha: string;
  descricao: string;
  acaoExigida: string;
}

export interface EvaluatorVerdictDocument {
  documento: "veredito_avaliador";
  idVeredito: string;
  idProjeto: string;
  cluster: ClusterKind;
  tentativaAvaliada: number;
  microbriefsAvaliados: string[];
  modeloExecutor: string;
  modeloAvaliador: string;
  modeloDiferenteDoExecutor: boolean;
  statusTipo1Harness: "aprovado" | "reprovado";
  decisao: VerdictDecision;
  contagemSeveridade: {
    critico: number;
    importante: number;
    menor: number;
  };
  lente1: Lens1EvaluationRow[];
  lente2: Lens2EvaluationRow[];
  problemas: EvaluatorQualityIssue[];
}

export interface MechanicalValidationResult {
  valid: boolean;
  errors: string[];
  /** Para Relatório do Executor: se true, a falha é apenas de formato do relatório (permite até 2 reenvios sem gastar tentativa de código). */
  reportFormatOnlyError?: boolean;
}

const REQ_ID_RE = /^REQ-\d{3}$/;
const FILE_LINE_RE = /^([^:\s]+):(\d+)(?:-(\d+))?$/;

/**
 * Inferência mecânica de cluster a partir do caminho de um arquivo.
 */
export function inferClusterFromFilePath(filePath: string): ClusterKind {
  const norm = filePath.replace(/\\/g, "/").trim().toLowerCase();
  if (
    norm.includes("/webhooks/") ||
    norm.includes("/integrations/") ||
    /(^|\/)(asaas|stripe|mercadopago|oauth|webhook)/i.test(norm)
  ) {
    return "integration";
  }
  if (norm.startsWith("src/app/api/") || norm.includes("/api/") || norm.endsWith("/route.ts")) {
    return "backend";
  }
  if (
    norm.endsWith(".tsx") ||
    norm.endsWith(".jsx") ||
    norm.endsWith(".css") ||
    norm.startsWith("src/components/") ||
    norm.startsWith("src/hooks/")
  ) {
    return "frontend";
  }
  return "core";
}

// ============================================================================
// 1. CONFERÊNCIA MECÂNICA DA SPEC (Com REQ-001... e Trava T2)
// ============================================================================

export function validateSpecMechanical(
  spec: SpecWithReqsDocument,
  options: { requireApprovalForPhase2?: boolean } = {}
): MechanicalValidationResult {
  const errors: string[] = [];

  if (spec.documento !== "spec") {
    errors.push(`[SPEC] Campo 'documento' deve ser 'spec'.`);
  }
  if (!Number.isInteger(spec.versao) || spec.versao < 1) {
    errors.push(`[SPEC] Campo 'versao' deve ser inteiro >= 1.`);
  }
  if (!["rascunho", "aguardando_aprovacao", "aprovada"].includes(spec.status)) {
    errors.push(`[SPEC] Status inválido: "${spec.status}".`);
  }

  if (spec.requisitosIds.length === 0) {
    errors.push(`[SPEC] A Spec deve declarar pelo menos um requisito em 'requisitosIds'.`);
  }

  const seenIds = new Set<string>();
  spec.requisitosIds.forEach((id, idx) => {
    if (!REQ_ID_RE.test(id)) {
      errors.push(`[SPEC] ID de requisito "${id}" não segue o formato REQ-XXX (ex.: REQ-001).`);
    }
    const expectedSequential = `REQ-${String(idx + 1).padStart(3, "0")}`;
    if (id !== expectedSequential) {
      errors.push(`[SPEC] Requisitos fora de sequência: esperado "${expectedSequential}", recebido "${id}".`);
    }
    if (seenIds.has(id)) {
      errors.push(`[SPEC] ID de requisito duplicado: "${id}".`);
    }
    seenIds.add(id);
  });

  const tableIds = new Set(spec.requisitosTabela.map((r) => r.id));
  for (const reqId of spec.requisitosIds) {
    if (!tableIds.has(reqId)) {
      errors.push(`[SPEC] O requisito "${reqId}" do frontmatter não aparece na tabela da seção 8.`);
    }
  }
  for (const row of spec.requisitosTabela) {
    if (!seenIds.has(row.id)) {
      errors.push(`[SPEC] O requisito "${row.id}" da tabela não está listado em 'requisitosIds'.`);
    }
    if (!row.descricaoECriterio || row.descricaoECriterio.trim().length < 20) {
      errors.push(
        `[SPEC] O requisito "${row.id}" possui descrição/critério de aceite vazio ou curto demais (< 20 caracteres).`
      );
    }
  }

  if (options.requireApprovalForPhase2) {
    if (spec.status !== "aprovada") {
      errors.push(`[TRAVA T2] A Spec precisa estar com status "aprovada" antes de avançar ao Planejamento.`);
    }
    if (!spec.aprovadoEm || Number.isNaN(Date.parse(spec.aprovadoEm))) {
      errors.push(`[TRAVA T2] Timestamp 'aprovado_em' ISO 8601 válido é obrigatório para Spec aprovada.`);
    }
    if (spec.duvidasEmAberto.length > 0) {
      errors.push(
        `[TRAVA T2] A seção '7. Dúvidas em aberto' ainda contém ${spec.duvidasEmAberto.length} dúvida(s) pendente(s).`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// 2. CONFERÊNCIA MECÂNICA DO MACROBRIEF (T8b: 100% REQs, Arquivos Disjuntos, Sem Ciclo)
// ============================================================================

export function validateMacrobriefMechanical(
  macrobrief: MacrobriefDocument,
  specRequisitosIds: string[],
  maxFilesPerMicrobrief: number = 3
): MechanicalValidationResult {
  const errors: string[] = [];

  const specSet = new Set(specRequisitosIds);
  const coveredSet = new Set<string>();

  for (const mb of macrobrief.microbriefs) {
    for (const r of mb.reqs) {
      coveredSet.add(r);
      if (!specSet.has(r)) {
        errors.push(`[MACROBRIEF T8b] O Microbrief "${mb.id}" referencia requisito inventado "${r}" que não existe na Spec.`);
      }
    }
  }

  for (const reqId of specRequisitosIds) {
    if (!coveredSet.has(reqId)) {
      errors.push(`[MACROBRIEF T8b] O requisito "${reqId}" da Spec não foi atribuído a nenhum Microbrief.`);
    }
  }

  // Partição estrita de arquivos: cada arquivo em exatamente 1 Microbrief (T3 / T8b)
  const fileOwners = new Map<string, string>();
  for (const mb of macrobrief.microbriefs) {
    if (mb.arquivos.length === 0) {
      errors.push(`[MACROBRIEF] O Microbrief "${mb.id}" não declara nenhum arquivo.`);
    }
    if (mb.arquivos.length > maxFilesPerMicrobrief) {
      errors.push(
        `[MACROBRIEF] O Microbrief "${mb.id}" declara ${mb.arquivos.length} arquivos (máximo permitido: ${maxFilesPerMicrobrief}).`
      );
    }
    for (const rawFile of mb.arquivos) {
      const normFile = rawFile.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim();
      const prevOwner = fileOwners.get(normFile);
      if (prevOwner && prevOwner !== mb.id) {
        errors.push(
          `[TRAVA T3 / T8b] Conflito de propriedade de arquivo: "${normFile}" está atribuído simultaneamente a "${prevOwner}" e "${mb.id}".`
        );
      } else {
        fileOwners.set(normFile, mb.id);
      }
    }
  }

  // Verificação de DAG sem ciclos (DFS com coloração 0=branco, 1=cinza, 2=preto)
  const mbById = new Map(macrobrief.microbriefs.map((m) => [m.id, m]));
  for (const mb of macrobrief.microbriefs) {
    for (const depId of mb.dependeDe) {
      if (!mbById.has(depId)) {
        errors.push(`[MACROBRIEF DAG] O Microbrief "${mb.id}" depende de "${depId}", que não existe no Macrobrief.`);
      }
    }
  }

  const color = new Map<string, 0 | 1 | 2>();
  for (const mb of macrobrief.microbriefs) color.set(mb.id, 0);

  const hasCycleFrom = (nodeId: string, stackPath: string[]): boolean => {
    color.set(nodeId, 1);
    const node = mbById.get(nodeId);
    if (node) {
      for (const depId of node.dependeDe) {
        if (!mbById.has(depId)) continue;
        const c = color.get(depId) ?? 0;
        if (c === 1) {
          errors.push(`[MACROBRIEF DAG] Ciclo de dependência detectado: ${[...stackPath, depId].join(" -> ")}.`);
          return true;
        }
        if (c === 0 && hasCycleFrom(depId, [...stackPath, depId])) {
          return true;
        }
      }
    }
    color.set(nodeId, 2);
    return false;
  };

  for (const mb of macrobrief.microbriefs) {
    if ((color.get(mb.id) ?? 0) === 0) {
      hasCycleFrom(mb.id, [mb.id]);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// 3. CONFERÊNCIA MECÂNICA DO MICROBRIEF ENXUTO
// ============================================================================

export function validateMicrobriefMechanical(
  microbrief: MicrobriefAndReportDocument,
  macrobrief?: MacrobriefDocument
): MechanicalValidationResult {
  const errors: string[] = [];

  const allWriteFiles = [
    ...microbrief.arquivosPermitidos.criar,
    ...microbrief.arquivosPermitidos.modificar,
  ];
  if (allWriteFiles.length === 0) {
    errors.push(`[MICROBRIEF] "${microbrief.idMicrobrief}" precisa ter pelo menos 1 arquivo em criar ou modificar.`);
  }

  for (const f of allWriteFiles) {
    const clean = f.replace(/\\/g, "/").trim();
    if (
      clean.includes("..") ||
      clean.startsWith("/") ||
      clean === ".env" ||
      clean.startsWith(".env.") ||
      clean.endsWith("prisma/dev.db")
    ) {
      errors.push(`[MICROBRIEF T3] Caminho de arquivo proibido ou inseguro em "${microbrief.idMicrobrief}": "${f}".`);
    }
  }

  if (macrobrief) {
    const macroEntry = macrobrief.microbriefs.find((m) => m.id === microbrief.idMicrobrief);
    if (!macroEntry) {
      errors.push(`[MICROBRIEF] "${microbrief.idMicrobrief}" não consta no Macrobrief "${macrobrief.idMacrobrief}".`);
    } else {
      const expectedReqs = [...macroEntry.reqs].sort().join(",");
      const actualReqs = [...microbrief.reqsCobertos].sort().join(",");
      if (expectedReqs !== actualReqs) {
        errors.push(
          `[MICROBRIEF] Divergência de REQs em "${microbrief.idMicrobrief}": Macrobrief=[${expectedReqs}] vs Microbrief=[${actualReqs}].`
        );
      }
    }
  }

  // Tabela inicializada com 1 linha por REQ coberto
  const rowIds = microbrief.registroCumprimento.map((r) => r.reqId);
  for (const reqId of microbrief.reqsCobertos) {
    if (!rowIds.includes(reqId)) {
      errors.push(
        `[MICROBRIEF] O requisito "${reqId}" não possui linha inicializada na seção 4 de "${microbrief.idMicrobrief}".`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// 4. RELATÓRIO DO EXECUTOR: CARIMBO DO HARNESS E CONFERÊNCIA MECÂNICA (P12)
// ============================================================================

/**
 * Carimba os campos `medido_pelo_harness` (`compilou`, `testes`, `arquivos_alterados`)
 * diretamente a partir da medição real do harness na quarentena, descartando qualquer valor
 * que o modelo LLM tenha tentado escrever nesses campos.
 */
export function stampHarnessMeasuredFields(
  reportFromModel: MicrobriefAndReportDocument,
  realHarnessMeasurements: HarnessMeasuredFields
): MicrobriefAndReportDocument {
  return {
    ...reportFromModel,
    documento: "relatorio_executor",
    medidoPeloHarness: {
      compilou: realHarnessMeasurements.compilou,
      testes: realHarnessMeasurements.testes ? { ...realHarnessMeasurements.testes } : null,
      arquivosAlterados: realHarnessMeasurements.arquivosAlterados.map((f) => ({ ...f })),
    },
  };
}

/**
 * Remove blocos `relatorio_executor` (ou blocos yaml com `reqs:`) do texto bruto antes da
 * extração de arquivos da quarentena, para que o relatório nunca seja confundido com código-fonte.
 */
export function stripExecutorReportBlocks(rawOutput: string): string {
  if (!rawOutput) return rawOutput;
  return rawOutput.replace(
    /```(?:(?:ya?ml)[ \t]+relatorio_executor|relatorio_executor|(?:ya?ml))[ \t]*\r?\n([\s\S]*?)```/gi,
    (fullMatch, body: string) => {
      if (/^```(?:ya?ml[ \t]+)?relatorio_executor\b/i.test(fullMatch) || /^\s*reqs\s*:/m.test(body)) {
        return "";
      }
      return fullMatch;
    }
  );
}

function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Extrai o bloco ```yaml relatorio_executor da resposta do executor e monta um
 * `MicrobriefAndReportDocument` (ainda sem o carimbo do harness).
 */
export function parseExecutorReportYamlBlock(
  rawOutput: string,
  microbrief: MicrobriefAndReportDocument
): MicrobriefAndReportDocument | null {
  if (!rawOutput || typeof rawOutput !== "string") return null;

  let yamlBody: string | null = null;
  const fenceRegex = /```([a-zA-Z0-9_-]*(?:[ \t]+relatorio_executor)?)[ \t]*\r?\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(rawOutput)) !== null) {
    const header = (m[1] || "").toLowerCase();
    const body = m[2] || "";
    if (header.includes("relatorio_executor") || ((header === "yaml" || header === "yml" || header === "") && /^\s*reqs\s*:/m.test(body))) {
      yamlBody = body;
    }
  }

  if (!yamlBody && /^\s*reqs\s*:\s*\r?\n/m.test(rawOutput)) {
    yamlBody = rawOutput;
  }

  if (!yamlBody) return null;

  const lines = yamlBody.split(/\r?\n/);
  const rawItems: Array<Record<string, string>> = [];
  let inReqs = false;
  let currentItem: Record<string, string> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (! line.trim() || line.trim().startsWith("#")) continue;

    if (/^\s*reqs\s*:\s*(\[\s*\])?\s*$/i.test(line)) {
      inReqs = true;
      continue;
    }
    if (!inReqs) continue;

    const itemStart = line.match(/^\s*-\s*(.*)$/);
    if (itemStart) {
      if (currentItem) rawItems.push(currentItem);
      currentItem = {};
      const rest = itemStart[1].trim();
      if (rest.startsWith("{") && rest.endsWith("}")) {
        const inner = rest.slice(1, -1);
        for (const pair of inner.split(",")) {
          const kv = pair.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
          if (kv) currentItem[kv[1].toLowerCase()] = unquoteYamlValue(kv[2]);
        }
      } else {
        const kv = rest.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
        if (kv) currentItem[kv[1].toLowerCase()] = unquoteYamlValue(kv[2]);
      }
      continue;
    }

    if (currentItem) {
      const kv = line.match(/^\s+([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
      if (kv) {
        currentItem[kv[1].toLowerCase()] = unquoteYamlValue(kv[2]);
      }
    }
  }
  if (currentItem) rawItems.push(currentItem);

  const rows: ExecutorReqRow[] = rawItems.map((item) => {
    const reqId = (item.id || item.req_id || item.reqid || "").trim().toUpperCase();
    const rawStatus = (item.status || item.status_declarado || item.statusdeclarado || "").trim().toLowerCase();
    const statusDeclarado: ExecutorReqRow["statusDeclarado"] =
      rawStatus === "atendido" || rawStatus === "parcial" || rawStatus === "nao_atendido"
        ? rawStatus
        : ("PENDENTE" as const);
    const arquivoLinha = (item.arquivo_linha || item.arquivolinha || item.evidencia || "")
      .trim()
      .replace(/:L(\d+)(?:-L?(\d+))?$/i, (_all, s, e) => (e ? `:${s}-${e}` : `:${s}`));
    const comoFoiImplementado = (
      item.como ||
      item.como_foi_implementado ||
      item.comofoiimplementado ||
      ""
    ).trim();
    return {
      reqId,
      statusDeclarado,
      arquivoLinha,
      comoFoiImplementado,
    };
  });

  return {
    ...structuredClone(microbrief),
    documento: "relatorio_executor",
    statusExecucao: "CONCLUIDO",
    registroCumprimento: rows,
  };
}

/**
 * Extrai o bloco `relatorio_executor`, carimba `medidoPeloHarness` com `stampHarnessMeasuredFields`
 * e executa a conferência mecânica `validateExecutorReportMechanical` contra o Microbrief da etapa.
 */
export function extractAndValidateExecutorReport(
  rawOutput: string,
  microbrief: MicrobriefAndReportDocument,
  quarantineFilesContentMap: Record<string, string>,
  realHarnessMeasurements?: HarnessMeasuredFields
): {
  valid: boolean;
  report: MicrobriefAndReportDocument | null;
  errors: string[];
  reportFormatOnlyError: boolean;
} {
  const parsed = parseExecutorReportYamlBlock(rawOutput, microbrief);
  if (!parsed) {
    return {
      valid: false,
      report: null,
      errors: [`[RELATÓRIO P12] Bloco \`\`\`yaml relatorio_executor ausente na resposta do executor.`],
      reportFormatOnlyError: true,
    };
  }

  const modSet = new Set(microbrief.arquivosPermitidos.modificar.map((f) => f.replace(/\\/g, "/")));
  const measurements: HarnessMeasuredFields = realHarnessMeasurements ?? {
    compilou: true,
    testes: null,
    arquivosAlterados: Object.entries(quarantineFilesContentMap).map(([caminho, content]) => {
      const norm = caminho.replace(/\\/g, "/");
      return {
        caminho: norm,
        operacao: modSet.has(norm) ? "modificado" : "criado",
        linhasAdicionadas: content.split(/\r?\n/).length,
        linhasRemovidas: 0,
      };
    }),
  };

  const stamped = stampHarnessMeasuredFields(parsed, measurements);
  const validation = validateExecutorReportMechanical(stamped, quarantineFilesContentMap);
  return {
    valid: validation.valid,
    report: validation.valid ? stamped : null,
    errors: validation.errors,
    reportFormatOnlyError: Boolean(validation.reportFormatOnlyError),
  };
}

/**
 * Conferência mecânica do Relatório do Executor (Princípio P12):
 * - Todo `REQ` do Microbrief aparece no Relatório;
 * - Nenhum `REQ` inventado aparece no Relatório;
 * - Nenhuma célula da tabela está como `PENDENTE` ou vazia;
 * - Todo `arquivo:linha` citado existe no mapa de arquivos da quarentena (ou disco) e respeita o total de linhas real.
 */
export function validateExecutorReportMechanical(
  report: MicrobriefAndReportDocument,
  quarantineFilesContentMap: Record<string, string>
): MechanicalValidationResult {
  const errors: string[] = [];

  if (report.medidoPeloHarness.compilou !== true) {
    return {
      valid: false,
      errors: [`[TIPO 1 HARNESS] O código não compilou na quarentena (medido_pelo_harness.compilou !== true).`],
      reportFormatOnlyError: false,
    };
  }

  const allowedFilesSet = new Set(
    [...report.arquivosPermitidos.criar, ...report.arquivosPermitidos.modificar].map((f) =>
      f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim()
    )
  );

  const normalizedContentMap = new Map<string, string>();
  for (const [k, v] of Object.entries(quarantineFilesContentMap)) {
    normalizedContentMap.set(k.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim(), v);
  }

  const expectedReqs = new Set(report.reqsCobertos);
  const reportedReqs = new Set<string>();

  for (const row of report.registroCumprimento) {
    if (reportedReqs.has(row.reqId)) {
      errors.push(`[RELATÓRIO P12] Requisito duplicado na tabela de cumprimento: "${row.reqId}".`);
    }
    reportedReqs.add(row.reqId);

    if (!expectedReqs.has(row.reqId)) {
      errors.push(`[RELATÓRIO P12] Requisito inventado "${row.reqId}" não pertence ao Microbrief "${report.idMicrobrief}".`);
    }

    if (
      row.statusDeclarado === "PENDENTE" ||
      !["atendido", "parcial", "nao_atendido"].includes(row.statusDeclarado)
    ) {
      errors.push(`[RELATÓRIO P12] Status inválido ou PENDENTE para "${row.reqId}": "${row.statusDeclarado}".`);
    }

    if (!row.comoFoiImplementado || row.comoFoiImplementado === "PENDENTE" || row.comoFoiImplementado.trim().length === 0) {
      errors.push(`[RELATÓRIO P12] Descrição de implementação ausente ou PENDENTE para "${row.reqId}".`);
    }

    const lineMatch = row.arquivoLinha.trim().match(FILE_LINE_RE);
    if (!lineMatch) {
      errors.push(
        `[RELATÓRIO P12] Referência Arquivo:Linha inválida para "${row.reqId}": "${row.arquivoLinha}" (esperado caminho:linha ou caminho:inicio-fim).`
      );
      continue;
    }

    const citedFile = lineMatch[1].replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim();
    const startLine = Number(lineMatch[2]);
    const endLine = lineMatch[3] ? Number(lineMatch[3]) : startLine;

    if (!allowedFilesSet.has(citedFile)) {
      errors.push(
        `[RELATÓRIO P12] O requisito "${row.reqId}" cita o arquivo "${citedFile}", que não pertence ao escopo permitido do Microbrief.`
      );
      continue;
    }

    const fileContent = normalizedContentMap.get(citedFile);
    if (fileContent === undefined) {
      errors.push(
        `[RELATÓRIO P12] O requisito "${row.reqId}" cita "${citedFile}", mas esse arquivo não existe na quarentena.`
      );
      continue;
    }

    const totalLines = fileContent.split(/\r?\n/).length;
    if (startLine < 1 || endLine < startLine || endLine > totalLines) {
      errors.push(
        `[RELATÓRIO P12] O requisito "${row.reqId}" cita linhas ${startLine}-${endLine} em "${citedFile}", mas o arquivo possui ${totalLines} linha(s).`
      );
    }
  }

  for (const reqId of expectedReqs) {
    if (!reportedReqs.has(reqId)) {
      errors.push(`[RELATÓRIO P12] O requisito obrigatório "${reqId}" do Microbrief está ausente no Relatório do Executor.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    reportFormatOnlyError: errors.length > 0,
  };
}

// ============================================================================
// 5. VEREDITO DO AVALIADOR: CÁLCULO DA LENTE 2 E CONFERÊNCIA MECÂNICA
// ============================================================================

/**
 * Classifica mecanicamente a divergência na Lente 2 para um `REQ-xxx`,
 * cruzando o status da Lente 1 (Cega) com o que o Executor autodeclarou no relatório.
 */
export function classifyLens2Divergence(
  statusLente1: Lens1ReqStatus,
  declaradoPeloExecutor: "atendido" | "parcial" | "nao_atendido" | "nao_declarado"
): { tipoDivergencia: Lens2DivergenceKind; isCriticalHallucination: boolean } {
  if (declaradoPeloExecutor === "nao_declarado") {
    return {
      tipoDivergencia: statusLente1 === "implementado" ? "convergente" : "convergente_com_pendencia",
      isCriticalHallucination: false,
    };
  }
  if (statusLente1 === "implementado" && declaradoPeloExecutor === "atendido") {
    return { tipoDivergencia: "convergente", isCriticalHallucination: false };
  }
  if (statusLente1 === "ausente" && declaradoPeloExecutor === "atendido") {
    return { tipoDivergencia: "alucinacao_grave", isCriticalHallucination: true };
  }
  if (statusLente1 === "parcial" && declaradoPeloExecutor === "atendido") {
    return { tipoDivergencia: "divergencia_otimista", isCriticalHallucination: true };
  }
  if (statusLente1 === "implementado" && declaradoPeloExecutor !== "atendido") {
    return { tipoDivergencia: "divergencia_conservadora", isCriticalHallucination: false };
  }
  return { tipoDivergencia: "convergente_com_pendencia", isCriticalHallucination: false };
}

/**
 * Conferência mecânica do Veredito do Avaliador:
 * 1. Independência de modelo (Trava T4);
 * 2. Cobertura de 100% dos `REQ-xxx` do cluster nas tabelas da Lente 1 e da Lente 2;
 * 3. Existência física de cada `arquivo:linha` citado na Lente 1 dentro do código da quarentena;
 * 4. Coerência matemática da decisão (`REPROVADO` obrigatório se houver qualquer REQ não implementado,
 *    divergência otimista/alucinação grave na Lente 2 ou problema `critico > 0`).
 */
export function validateEvaluatorVerdictMechanical(
  verdict: EvaluatorVerdictDocument,
  expectedClusterReqs: string[],
  quarantineFilesContentMap: Record<string, string>
): {
  valid: boolean;
  errors: string[];
  enforcedDecision: VerdictDecision;
} {
  const errors: string[] = [];

  if (
    !verdict.modeloDiferenteDoExecutor ||
    !isEvaluatorModelIndependent(verdict.modeloExecutor, verdict.modeloAvaliador)
  ) {
    errors.push(
      `[TRAVA T4 VIOLADA] O Avaliador ("${verdict.modeloAvaliador}") deve usar família de modelo diferente do Executor ("${verdict.modeloExecutor}").`
    );
  }

  const normalizedContentMap = new Map<string, string>();
  for (const [k, v] of Object.entries(quarantineFilesContentMap)) {
    normalizedContentMap.set(k.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim(), v);
  }

  const lens1Map = new Map(verdict.lente1.map((r) => [r.reqId, r]));
  const lens2Map = new Map(verdict.lente2.map((r) => [r.reqId, r]));

  for (const reqId of expectedClusterReqs) {
    if (!lens1Map.has(reqId)) {
      errors.push(`[VEREDITO LENTE 1] O requisito "${reqId}" do cluster não foi avaliado na Lente 1.`);
    }
    if (!lens2Map.has(reqId)) {
      errors.push(`[VEREDITO LENTE 2] O requisito "${reqId}" do cluster não foi cruzado na Lente 2.`);
    }
  }

  for (const row of verdict.lente1) {
    const m = row.evidenciaCodigo.trim().match(FILE_LINE_RE);
    if (!m) {
      errors.push(
        `[VEREDITO LENTE 1] Evidência "${row.evidenciaCodigo}" para "${row.reqId}" não segue o formato arquivo:linha.`
      );
      continue;
    }
    const citedFile = m[1].replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim();
    const startLine = Number(m[2]);
    const endLine = m[3] ? Number(m[3]) : startLine;
    const content = normalizedContentMap.get(citedFile);
    if (content === undefined) {
      errors.push(`[VEREDITO LENTE 1] Arquivo citado "${citedFile}" para "${row.reqId}" não existe na quarentena.`);
      continue;
    }
    const totalLines = content.split(/\r?\n/).length;
    if (startLine < 1 || endLine < startLine || endLine > totalLines) {
      errors.push(
        `[VEREDITO LENTE 1] Linhas ${startLine}-${endLine} citadas em "${citedFile}" (${row.reqId}) fora do limite real do arquivo (${totalLines} linhas).`
      );
    }
  }

  const hasUnimplementedReq = verdict.lente1.some((r) => r.statusLente1 !== "implementado");
  const hasCriticalDivergence = verdict.lente2.some(
    (r) => r.tipoDivergencia === "alucinacao_grave" || r.tipoDivergencia === "divergencia_otimista"
  );
  const actualCriticalCount = verdict.problemas.filter((p) => p.severidade === "critico").length;
  const actualImportantCount = verdict.problemas.filter((p) => p.severidade === "importante").length;

  let enforcedDecision: VerdictDecision = verdict.decisao;
  if (
    hasUnimplementedReq ||
    hasCriticalDivergence ||
    actualCriticalCount > 0 ||
    verdict.contagemSeveridade.critico > 0
  ) {
    enforcedDecision = "REPROVADO";
    if (verdict.decisao !== "REPROVADO") {
      errors.push(
        `[VEREDITO COERÊNCIA] Decisão "${verdict.decisao}" inválida quando há REQ não implementado, divergência crítica na Lente 2 ou item crítico; forçado para "REPROVADO".`
      );
    }
  } else if (actualImportantCount > 0 || verdict.contagemSeveridade.importante > 0) {
    if (verdict.decisao === "APROVADO") {
      enforcedDecision = "APROVADO_COM_RESSALVA";
      errors.push(
        `[VEREDITO COERÊNCIA] Decisão "APROVADO" com itens 'importante' pendentes deve ser "APROVADO_COM_RESSALVA".`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    enforcedDecision,
  };
}

// ============================================================================
// 6. EXEMPLOS CANÔNICOS PREENCHIDOS DO PROJETO P1 (API DE TAREFAS)
// ============================================================================

export function buildP1ProjectArtifacts(): {
  spec: SpecWithReqsDocument;
  macrobrief: MacrobriefDocument;
  microbriefs: [MicrobriefAndReportDocument, MicrobriefAndReportDocument, MicrobriefAndReportDocument];
} {
  const spec: SpecWithReqsDocument = {
    documento: "spec",
    projeto: "API REST de Tarefas (P1)",
    versao: 1,
    status: "aprovada",
    criadoEm: "2026-10-06T12:00:00.000Z",
    atualizadoEm: "2026-10-06T12:15:00.000Z",
    aprovadoEm: "2026-10-06T12:20:00.000Z",
    aprovadoPor: "Fundador (Aprovação Explícita T2)",
    tipoInterface: "nenhuma_somente_api",
    requisitosIds: ["REQ-001", "REQ-002", "REQ-003", "REQ-004", "REQ-005"],
    duvidasEmAberto: [],
    requisitosTabela: [
      {
        id: "REQ-001",
        titulo: "Store em memória de tarefas",
        descricaoECriterio:
          "O módulo src/lib/tarefas-store.ts deve exportar Tarefa, listarTarefas(), criarTarefa(input), atualizarTarefa(id, input) e removerTarefa(id).",
      },
      {
        id: "REQ-002",
        titulo: "Listagem (GET /api/tarefas)",
        descricaoECriterio:
          "GET /api/tarefas em src/app/api/tarefas/route.ts deve retornar status 200 e array JSON com todas as tarefas.",
      },
      {
        id: "REQ-003",
        titulo: "Criação com validação (POST /api/tarefas)",
        descricaoECriterio:
          "POST /api/tarefas em src/app/api/tarefas/route.ts deve validar titulo não vazio (400 se inválido) e retornar 201 com a Tarefa criada.",
      },
      {
        id: "REQ-004",
        titulo: "Atualização parcial (PATCH /api/tarefas/[id])",
        descricaoECriterio:
          "PATCH /api/tarefas/[id] em src/app/api/tarefas/[id]/route.ts deve atualizar titulo/concluida (200) ou retornar 404 se o id não existir.",
      },
      {
        id: "REQ-005",
        titulo: "Remoção (DELETE /api/tarefas/[id])",
        descricaoECriterio:
          "DELETE /api/tarefas/[id] em src/app/api/tarefas/[id]/route.ts deve remover a tarefa retornando 204 ou 404 se não existir.",
      },
    ],
  };

  const macrobrief: MacrobriefDocument = {
    documento: "macrobrief",
    idMacrobrief: "MACRO-P1-001",
    idProjeto: "proj-p1-tarefas",
    specVersao: 1,
    requisitosTotais: ["REQ-001", "REQ-002", "REQ-003", "REQ-004", "REQ-005"],
    clustersAtivos: ["core", "backend"],
    microbriefs: [
      {
        id: "MB-001",
        cluster: "core",
        dependeDe: [],
        arquivos: ["src/lib/tarefas-store.ts"],
        reqs: ["REQ-001"],
      },
      {
        id: "MB-002",
        cluster: "backend",
        dependeDe: ["MB-001"],
        arquivos: ["src/app/api/tarefas/route.ts"],
        reqs: ["REQ-002", "REQ-003"],
      },
      {
        id: "MB-003",
        cluster: "backend",
        dependeDe: ["MB-001"],
        arquivos: ["src/app/api/tarefas/[id]/route.ts"],
        reqs: ["REQ-004", "REQ-005"],
      },
    ],
    contratosTypescript:
      "export interface Tarefa { id: string; titulo: string; concluida: boolean; criadaEm: string; }",
  };

  const emptyHarness: HarnessMeasuredFields = {
    compilou: null,
    testes: null,
    arquivosAlterados: [],
  };

  const mb1: MicrobriefAndReportDocument = {
    documento: "microbrief",
    idMicrobrief: "MB-001",
    idMacrobrief: "MACRO-P1-001",
    idProjeto: "proj-p1-tarefas",
    cluster: "core",
    nivelModeloSugerido: "rapido",
    dependeDe: [],
    reqsCobertos: ["REQ-001"],
    arquivosPermitidos: {
      criar: ["src/lib/tarefas-store.ts"],
      modificar: [],
      lerContratos: [],
    },
    statusExecucao: "PENDENTE",
    tentativaAtual: 0,
    medidoPeloHarness: structuredClone(emptyHarness),
    interfacesConsome: [],
    interfacesProduz: "Tarefa, listarTarefas, criarTarefa, atualizarTarefa, removerTarefa",
    criteriosAceitePorReq: {
      "REQ-001": ["Exportar store em memória tipado com CRUD síncrono"],
    },
    registroCumprimento: [
      {
        reqId: "REQ-001",
        statusDeclarado: "PENDENTE",
        arquivoLinha: "PENDENTE",
        comoFoiImplementado: "PENDENTE",
      },
    ],
  };

  const mb2: MicrobriefAndReportDocument = {
    documento: "microbrief",
    idMicrobrief: "MB-002",
    idMacrobrief: "MACRO-P1-001",
    idProjeto: "proj-p1-tarefas",
    cluster: "backend",
    nivelModeloSugerido: "rapido",
    dependeDe: ["MB-001"],
    reqsCobertos: ["REQ-002", "REQ-003"],
    arquivosPermitidos: {
      criar: ["src/app/api/tarefas/route.ts"],
      modificar: [],
      lerContratos: ["src/lib/tarefas-store.ts"],
    },
    statusExecucao: "PENDENTE",
    tentativaAtual: 0,
    medidoPeloHarness: structuredClone(emptyHarness),
    interfacesConsome: ["src/lib/tarefas-store.ts"],
    interfacesProduz: "GET /api/tarefas, POST /api/tarefas",
    criteriosAceitePorReq: {
      "REQ-002": ["GET retorna 200 com lista de tarefas"],
      "REQ-003": ["POST valida titulo e retorna 201 ou 400"],
    },
    registroCumprimento: [
      {
        reqId: "REQ-002",
        statusDeclarado: "PENDENTE",
        arquivoLinha: "PENDENTE",
        comoFoiImplementado: "PENDENTE",
      },
      {
        reqId: "REQ-003",
        statusDeclarado: "PENDENTE",
        arquivoLinha: "PENDENTE",
        comoFoiImplementado: "PENDENTE",
      },
    ],
  };

  const mb3: MicrobriefAndReportDocument = {
    documento: "microbrief",
    idMicrobrief: "MB-003",
    idMacrobrief: "MACRO-P1-001",
    idProjeto: "proj-p1-tarefas",
    cluster: "backend",
    nivelModeloSugerido: "rapido",
    dependeDe: ["MB-001"],
    reqsCobertos: ["REQ-004", "REQ-005"],
    arquivosPermitidos: {
      criar: ["src/app/api/tarefas/[id]/route.ts"],
      modificar: [],
      lerContratos: ["src/lib/tarefas-store.ts"],
    },
    statusExecucao: "PENDENTE",
    tentativaAtual: 0,
    medidoPeloHarness: structuredClone(emptyHarness),
    interfacesConsome: ["src/lib/tarefas-store.ts"],
    interfacesProduz: "PATCH /api/tarefas/[id], DELETE /api/tarefas/[id]",
    criteriosAceitePorReq: {
      "REQ-004": ["PATCH atualiza titulo/concluida (200) ou retorna 404"],
      "REQ-005": ["DELETE remove tarefa (204) ou retorna 404"],
    },
    registroCumprimento: [
      {
        reqId: "REQ-004",
        statusDeclarado: "PENDENTE",
        arquivoLinha: "PENDENTE",
        comoFoiImplementado: "PENDENTE",
      },
      {
        reqId: "REQ-005",
        statusDeclarado: "PENDENTE",
        arquivoLinha: "PENDENTE",
        comoFoiImplementado: "PENDENTE",
      },
    ],
  };

  return { spec, macrobrief, microbriefs: [mb1, mb2, mb3] };
}

/** Limite do brief da etapa (caracteres). Acima disso o recorte da Spec é encurtado, nunca os critérios. */
export const MICROBRIEF_MAX_CHARS = 6000;

function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * Renderiza o Microbrief da etapa em YAML (frontmatter) + Markdown — o contrato que executor e
 * avaliador recebem. Leva só o que é DESTA etapa: arquivos, REQ com critérios, dependências e o
 * recorte da Spec (módulos e rotas destes arquivos). A Spec inteira não entra: com ela o avaliador
 * cobrava arquivos de outras etapas (teste real P1 de 07/10).
 */
export function renderMicrobriefMarkdown(
  mb: MicrobriefAndReportDocument,
  context: { titulo?: string; spec?: string | null; maxChars?: number } = {}
): string {
  const files = [...mb.arquivosPermitidos.criar, ...mb.arquivosPermitidos.modificar];
  const lines: string[] = [
    "---",
    "documento: microbrief",
    `id: ${yamlQuoted(mb.idMicrobrief)}`,
    `cluster: ${mb.cluster}`,
    `nivel_modelo: ${mb.nivelModeloSugerido}`,
    "reqs_cobertos:",
    ...mb.reqsCobertos.map((r) => `  - ${r}`),
    "arquivos:",
    ...mb.arquivosPermitidos.criar.map((f) => `  - { caminho: ${yamlQuoted(f)}, acao: criar }`),
    ...mb.arquivosPermitidos.modificar.map((f) => `  - { caminho: ${yamlQuoted(f)}, acao: modificar }`),
    "depende_de:",
    ...(mb.dependeDe.length > 0 ? mb.dependeDe.map((d) => `  - ${yamlQuoted(d)}`) : ["  []"]),
    "---",
    "",
    `# Etapa: ${context.titulo || mb.idMicrobrief}`,
    "",
    "## Critérios de aceite (cada REQ é julgado separadamente)",
  ];
  for (const req of mb.reqsCobertos) {
    const criterios = mb.criteriosAceitePorReq[req] ?? [];
    lines.push(`- **${req}**: ${criterios.length > 0 ? criterios.join(" | ") : "(sem critério declarado)"}`);
  }
  lines.push(
    "",
    "## Fora do escopo",
    `Somente ${files.join(", ")} pertencem a esta etapa. Arquivos e REQ de outras etapas NÃO são pendência aqui.`
  );

  // Contrato (YAML + critérios + fora do escopo) nunca é cortado; só o recorte da Spec é encurtado.
  const contract = lines.join("\n");
  const parsed = context.spec ? parseSpecDocument(context.spec) : null;
  if (parsed) {
    const recorte: string[] = [];
    if (parsed.objetivo) recorte.push(`Objetivo do projeto: ${parsed.objetivo.replace(/\s+/g, " ").trim()}`);
    for (const m of parsed.modulos) {
      if ((m.arquivos ?? []).some((f) => files.includes(f))) recorte.push(`Módulo ${m.nome}: ${m.resumo}`);
    }
    for (const r of parsed.rotas) {
      if (routeFileCandidates(r.caminho).some((f) => files.includes(f))) {
        recorte.push(`Rota ${r.caminho}: ${r.descricao}`);
      }
    }
    if (recorte.length > 0) lines.push("", "## Recorte da Spec", ...recorte.map((l) => `- ${l}`));
  }

  const max = context.maxChars ?? MICROBRIEF_MAX_CHARS;
  const out = lines.join("\n");
  if (out.length <= max) return out;
  const room = max - contract.length - 40;
  return room > 200 ? out.slice(0, contract.length + room) + "\n\n[recorte da Spec encurtado]" : contract;
}

/**
 * Renderiza o Macrobrief em YAML (frontmatter) + Markdown estruturado.
 * Representa a visão condensada da arquitetura do projeto e partição dos Microbriefs.
 */
export function renderMacrobriefMarkdown(macrobrief: MacrobriefDocument): string {
  const lines: string[] = [
    "---",
    "documento: macrobrief",
    `id: ${yamlQuoted(macrobrief.idMacrobrief)}`,
    `projeto: ${yamlQuoted(macrobrief.idProjeto)}`,
    `spec_versao: ${macrobrief.specVersao}`,
    "requisitos_totais:",
    ...macrobrief.requisitosTotais.map((r) => `  - ${r}`),
    "clusters_ativos:",
    ...macrobrief.clustersAtivos.map((c) => `  - ${c}`),
    "microbriefs:",
  ];

  for (const mb of macrobrief.microbriefs) {
    lines.push(`  - id: ${yamlQuoted(mb.id)}`);
    lines.push(`    cluster: ${mb.cluster}`);
    lines.push(`    depende_de: [${mb.dependeDe.map((d) => yamlQuoted(d)).join(", ")}]`);
    lines.push(`    arquivos: [${mb.arquivos.map((f) => yamlQuoted(f)).join(", ")}]`);
    lines.push(`    reqs: [${mb.reqs.join(", ")}]`);
  }

  lines.push(
    "---",
    "",
    `# Macrobrief: ${macrobrief.idProjeto} (${macrobrief.idMacrobrief})`,
    "",
    `Versão da Spec: ${macrobrief.specVersao} | Clusters: ${macrobrief.clustersAtivos.join(", ")}`,
    "",
    "## Partição das Etapas (Microbriefs)",
    ""
  );

  for (const mb of macrobrief.microbriefs) {
    const depStr = mb.dependeDe.length > 0 ? ` (depende de: ${mb.dependeDe.join(", ")})` : "";
    lines.push(`### Etapa \`${mb.id}\` [${mb.cluster}]${depStr}`);
    lines.push(`- **Requisitos Cobertos:** ${mb.reqs.join(", ")}`);
    lines.push(`- **Arquivos Atribuídos:** ${mb.arquivos.join(", ")}`);
    lines.push("");
  }

  if (macrobrief.contratosTypescript) {
    lines.push("## Contratos TypeScript e Interfaces", "", "```typescript", macrobrief.contratosTypescript, "```");
  }

  return lines.join("\n");
}

export interface DeliveryAuditGap {
  reqId?: string;
  arquivo?: string;
  categoria:
    | "requisito_faltante"
    | "stub_ou_placeholder"
    | "violacao_regra"
    | "falha_integracao"
    | "risco_seguranca";
  descricao: string;
}

export interface DeliveryAuditReportDocument {
  documento: "laudo_auditoria_entrega";
  idLaudo: string;
  idProjeto: string;
  specVersao: number;
  aprovado: boolean;
  confiancaMedia: number;
  scores: {
    requisitosImplementados: number;
    fidelidadeRegras: number;
    ausenciaStubs: number;
    aderenciaContratos: number;
    isolamentoSeguranca: number;
    integracaoArquivos: number;
  };
  lacunas: DeliveryAuditGap[];
  resumoAuditoria: string;
}

/**
 * Renderiza o Laudo de Auditoria de Entrega do JEV em Markdown + YAML.
 * Fornece a comprovação formal de aderência ou as razões de não-conformidade.
 */
export function renderDeliveryAuditReportMarkdown(report: DeliveryAuditReportDocument): string {
  const lines: string[] = [
    "---",
    "documento: laudo_auditoria_entrega",
    `id: ${yamlQuoted(report.idLaudo)}`,
    `projeto: ${yamlQuoted(report.idProjeto)}`,
    `spec_versao: ${report.specVersao}`,
    `aprovado: ${report.aprovado}`,
    `confianca_media: ${report.confiancaMedia.toFixed(2)}`,
    "scores:",
    `  requisitos_implementados: ${report.scores.requisitosImplementados.toFixed(2)}`,
    `  fidelidade_regras: ${report.scores.fidelidadeRegras.toFixed(2)}`,
    `  ausencia_stubs: ${report.scores.ausenciaStubs.toFixed(2)}`,
    `  aderencia_contratos: ${report.scores.aderenciaContratos.toFixed(2)}`,
    `  isolamento_seguranca: ${report.scores.isolamentoSeguranca.toFixed(2)}`,
    `  integracao_arquivos: ${report.scores.integracaoArquivos.toFixed(2)}`,
    `total_lacunas: ${report.lacunas.length}`,
    "---",
    "",
    `# Laudo de Auditoria Final de Entrega — ${report.idProjeto}`,
    "",
    `**Resultado:** ${report.aprovado ? "✅ APROVADO — CÓDIGO CONFORME À SPEC" : "❌ REPROVADO — LACUNAS DETECTADAS"}`,
    `**Confiança Média:** ${(report.confiancaMedia * 100).toFixed(0)}%`,
    "",
    "## Resumo da Auditoria",
    "",
    report.resumoAuditoria,
    "",
    "## Scores de Conformidade por Dimensão",
    "",
    `- **Requisitos Integralmente Implementados:** ${(report.scores.requisitosImplementados * 100).toFixed(0)}% (limiar: 85%)`,
    `- **Fidelidade às Regras de Negócio:** ${(report.scores.fidelidadeRegras * 100).toFixed(0)}% (limiar: 85%)`,
    `- **Ausência de Stubs / Placeholders:** ${(report.scores.ausenciaStubs * 100).toFixed(0)}% (limiar: 85%)`,
    `- **Aderência aos Contratos e Stack:** ${(report.scores.aderenciaContratos * 100).toFixed(0)}% (limiar: 80%)`,
    `- **Isolamento de Segurança e Segredos:** ${(report.scores.isolamentoSeguranca * 100).toFixed(0)}% (limiar: 80%)`,
    `- **Integração e Consistência entre Arquivos:** ${(report.scores.integracaoArquivos * 100).toFixed(0)}% (limiar: 80%)`,
    "",
  ];

  if (report.lacunas.length > 0) {
    lines.push("## Apontamentos de Não-Conformidade (Lacunas)", "");
    report.lacunas.forEach((lacuna, idx) => {
      const reqStr = lacuna.reqId ? ` [${lacuna.reqId}]` : "";
      const arqStr = lacuna.arquivo ? ` em \`${lacuna.arquivo}\`` : "";
      lines.push(`### ${idx + 1}. [${lacuna.categoria}]${reqStr}${arqStr}`);
      lines.push(lacuna.descricao);
      lines.push("");
    });
  }

  return lines.join("\n");
}

export interface MicrobriefReparoDocument {
  documento: "microbrief_reparo";
  idReparo: string;
  referenciaEtapaOriginal: string;
  versaoReparo: number;
  idProjeto: string;
  filesScope: string[];
  reqsAlvo: string[];
  diretrizCirurgica: string;
  lacunasParaSanar: string[];
  contratosEsperados?: string;
}

/**
 * Renderiza o Microbrief de Reparo em Markdown + YAML.
 * O Executor recebe exclusivamente este artefato delimitado, com foco cirúrgico na correção sem ver a Spec inteira.
 */
export function renderMicrobriefReparoMarkdown(reparo: MicrobriefReparoDocument): string {
  const lines: string[] = [
    "---",
    "documento: microbrief_reparo",
    `id_reparo: ${yamlQuoted(reparo.idReparo)}`,
    `referencia_etapa: ${yamlQuoted(reparo.referenciaEtapaOriginal)}`,
    `versao_reparo: ${reparo.versaoReparo}`,
    `projeto: ${yamlQuoted(reparo.idProjeto)}`,
    "files_scope:",
    ...reparo.filesScope.map((f) => `  - ${yamlQuoted(f)}`),
    "reqs_alvo:",
    ...reparo.reqsAlvo.map((r) => `  - ${r}`),
    "---",
    "",
    `# Microbrief de Reparo: ${reparo.idReparo}`,
    "",
    `**Etapa de Referência:** \`${reparo.referenciaEtapaOriginal}\` (versão de reparo #${reparo.versaoReparo})`,
    `**Arquivos no Escopo:** ${reparo.filesScope.map((f) => `\`${f}\``).join(", ")}`,
    `**Requisitos Alvo:** ${reparo.reqsAlvo.join(", ")}`,
    "",
    "## Diretriz Cirúrgica de Execução",
    "",
    reparo.diretrizCirurgica,
    "",
    "## Lacunas Identificadas pelo JEV que Devem Ser Sanadas",
    "",
    ...reparo.lacunasParaSanar.map((l) => `- ${l}`),
    "",
  ];

  if (reparo.contratosEsperados) {
    lines.push("## Contratos e Critérios Específicos do Reparo", "", "```typescript", reparo.contratosEsperados, "```");
  }

  return lines.join("\n");
}



