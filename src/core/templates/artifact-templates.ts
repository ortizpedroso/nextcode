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
  declaradoPeloExecutor: "atendido" | "parcial" | "nao_atendido";
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

    if (!row.comoFoiImplementado || row.comoFoiImplementado === "PENDENTE" || row.comoFoiImplementado.trim().length < 5) {
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
  declaradoPeloExecutor: "atendido" | "parcial" | "nao_atendido"
): { tipoDivergencia: Lens2DivergenceKind; isCriticalHallucination: boolean } {
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
