import { extractFilePathsFromCriteriaText, pathInStageScope } from "@/core/decision/jev-execution-checks";
import { validateMacrobriefMechanical, type MacrobriefDocument, type MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";

/**
 * A2.1 — Conferência do plano antes de criar as etapas (Trava T8b completa).
 *
 * Além do que `validateMacrobriefMechanical` já confere (REQ inventado/sem etapa, arquivo em 2 etapas,
 * dependência inexistente, ciclo), aqui se confere o que bloqueou o teste real `934939fc`:
 * - cada REQ em **uma** etapa só (REQ repetido faz todas as etapas serem julgadas pelo REQ inteiro);
 * - todo arquivo citado no critério de um REQ, se pertence a alguma etapa do plano, tem de estar
 *   no escopo da etapa do REQ **ou** de uma etapa da qual ela depende (direta ou indiretamente).
 *   Arquivo citado que nenhuma etapa produz é defeito da Spec (SM1), não do plano.
 */

export interface PlanStage {
  id: string;
  arquivos: string[];
  reqs: string[];
  dependeDe: string[];
}

export interface PlanScopeCheckResult {
  valid: boolean;
  errors: string[];
}

function ancestorsOf(stageId: string, byId: Map<string, PlanStage>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(byId.get(stageId)?.dependeDe ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of byId.get(id)?.dependeDe ?? []) stack.push(d);
  }
  return seen;
}

export function checkPlanScope(stages: PlanStage[], textoPorReq: Record<string, string>): PlanScopeCheckResult {
  const errors: string[] = [];
  const byId = new Map(stages.map((s) => [s.id, s]));

  const stagesByReq = new Map<string, string[]>();
  for (const s of stages) {
    for (const r of s.reqs) {
      const list = stagesByReq.get(r) ?? [];
      list.push(s.id);
      stagesByReq.set(r, list);
    }
  }
  for (const [req, ids] of stagesByReq) {
    if (ids.length > 1) {
      errors.push(`[T8b REQ REPETIDO] ${req} está em ${ids.length} etapas (${ids.join(", ")}); cada REQ deve estar em uma etapa só.`);
    }
  }

  for (const s of stages) {
    const allowed = new Set([s.id, ...ancestorsOf(s.id, byId)]);
    for (const req of s.reqs) {
      for (const cited of extractFilePathsFromCriteriaText(textoPorReq[req] ?? "")) {
        const owners = stages.filter((o) => pathInStageScope(o.arquivos, cited));
        if (owners.length === 0) continue;
        if (owners.some((o) => allowed.has(o.id))) continue;
        errors.push(
          `[T8b ESCOPO] ${req} (etapa ${s.id}) exige "${cited}", que pertence a ${owners
            .map((o) => o.id)
            .join(", ")} — fora do escopo desta etapa e das etapas de que ela depende.`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Etapas do plano a partir dos nós decompostos (só os que têm Microbrief; a base sem IA fica de fora). */
export function planStagesFromNodes(
  nodes: { id: string; dependencies?: string[]; payload?: unknown }[]
): { stages: PlanStage[]; microbriefs: MicrobriefAndReportDocument[] } {
  const withMb = nodes
    .map((n) => ({ n, mb: (n.payload as { microbrief?: MicrobriefAndReportDocument } | undefined)?.microbrief }))
    .filter((x): x is { n: (typeof nodes)[number]; mb: MicrobriefAndReportDocument } => Boolean(x.mb));
  const ids = new Set(withMb.map((x) => x.n.id));
  const stages = withMb.map(({ n, mb }) => ({
    id: n.id,
    arquivos: [...mb.arquivosPermitidos.criar, ...mb.arquivosPermitidos.modificar],
    reqs: mb.reqsCobertos,
    dependeDe: (n.dependencies ?? []).filter((d) => ids.has(d)),
  }));
  return { stages, microbriefs: withMb.map((x) => x.mb) };
}

export interface ExportDeclaration {
  name: string;
  header: string;
}

/**
 * F1.1 — Extrai declarações com nomes de export (type, interface, function, class, const, enum).
 * O cabeçalho é o trecho do export até antes de {, ou até o fim da linha, com espaços colapsados.
 * Campo ausente, string vazia ou texto sem a palavra export não gera declaração.
 */
export function extractExportDeclarations(text: string): ExportDeclaration[] {
  if (!text || typeof text !== "string" || !text.includes("export")) {
    return [];
  }
  const results: ExportDeclaration[] = [];
  const lines = text.split(/\r?\n/);
  const exportRegex = /(?:^|\s)export\s+(?:(?:declare|async|abstract)\s+)?(type|interface|function|class|const|enum)\s+([A-Za-z0-9_$]+)/;

  for (const line of lines) {
    if (!line.includes("export")) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }
    const match = line.match(exportRegex);
    if (!match || match.index === undefined) continue;

    const name = match[2];
    const exportIndex = line.indexOf("export", match.index);
    if (exportIndex === -1) continue;

    let raw = line.slice(exportIndex);
    const braceIndex = raw.indexOf("{");
    if (braceIndex !== -1) {
      raw = raw.slice(0, braceIndex);
    }
    const header = raw.trim().replace(/;$/, "").replace(/\s+/g, " ");
    results.push({ name, header });
  }

  return results;
}

function getConsumedDeclarations(mb?: MicrobriefAndReportDocument): ExportDeclaration[] {
  if (!mb || !Array.isArray(mb.interfacesConsome)) return [];
  const decls: ExportDeclaration[] = [];
  for (const item of mb.interfacesConsome) {
    if (typeof item === "string" && item.includes("export")) {
      decls.push(...extractExportDeclarations(item));
    }
  }
  return decls;
}

function getProducedDeclarations(mb?: MicrobriefAndReportDocument): ExportDeclaration[] {
  if (!mb || typeof mb.interfacesProduz !== "string" || !mb.interfacesProduz.includes("export")) {
    return [];
  }
  return extractExportDeclarations(mb.interfacesProduz);
}

/**
 * F1.1 — Confere junção de contratos entre etapas:
 * Para cada etapa, para cada export consumido:
 * - Deve ser produzido por ao menos um ancestral (direto ou indireto).
 * - O cabeçalho deve bater com o cabeçalho produzido.
 */
export function checkExportJunctions(
  stages: PlanStage[],
  microbriefsByStageId: Map<string, MicrobriefAndReportDocument>
): string[] {
  const errors: string[] = [];
  const byId = new Map(stages.map((s) => [s.id, s]));

  const producedByStage = new Map<string, ExportDeclaration[]>();
  for (const stage of stages) {
    const mb = microbriefsByStageId.get(stage.id);
    producedByStage.set(stage.id, getProducedDeclarations(mb));
  }

  for (const stage of stages) {
    const mb = microbriefsByStageId.get(stage.id);
    const consumed = getConsumedDeclarations(mb);
    if (consumed.length === 0) continue;

    const ancestorIds = ancestorsOf(stage.id, byId);

    const producedInAncestors = new Map<string, string[]>();
    for (const ancId of ancestorIds) {
      const decls = producedByStage.get(ancId) ?? [];
      for (const d of decls) {
        const list = producedInAncestors.get(d.name) ?? [];
        list.push(d.header);
        producedInAncestors.set(d.name, list);
      }
    }

    const seenSymbols = new Set<string>();

    for (const { name, header } of consumed) {
      if (name === "Json") continue; // Tipo interno embutido pelo template de contratos do harness
      if (seenSymbols.has(name)) continue;
      seenSymbols.add(name);

      const headersProduced = producedInAncestors.get(name);
      if (!headersProduced || headersProduced.length === 0) {
        errors.push(`[F1 JUNCAO] etapa ${stage.id} consome "${name}", que nenhuma dependência produz.`);
      } else if (!headersProduced.includes(header)) {
        errors.push(`[F1 JUNCAO] etapa ${stage.id} consome "${name}" com declaração diferente da produzida.`);
      }
    }
  }

  return errors;
}

/** T8b inteira sobre o plano final (depois da divisão pelo Jev): regras antigas + as do A2.1 + F1.1 junção. */
export function validateFinalPlan(
  nodes: { id: string; dependencies?: string[]; payload?: unknown }[],
  reqIds: string[],
  textoPorReq: Record<string, string>,
  maxFilesPerStage: number,
  arquivosDaSpec?: string[]
): PlanScopeCheckResult {
  const { stages, microbriefs } = planStagesFromNodes(nodes);
  if (stages.length === 0) return { valid: true, errors: [] };
  const base = validatePlanStages(stages, reqIds, textoPorReq, maxFilesPerStage, arquivosDaSpec);

  const microbriefsByStageId = new Map<string, MicrobriefAndReportDocument>();
  for (let i = 0; i < stages.length; i++) {
    microbriefsByStageId.set(stages[i].id, microbriefs[i]);
  }
  const junctionErrors = checkExportJunctions(stages, microbriefsByStageId);

  const errors = [...base.errors, ...junctionErrors];
  return { valid: errors.length === 0, errors };
}

/**
 * T8b sobre etapas soltas (plano do analista antes de virar nó). Com `arquivosDaSpec`, também confere
 * que todo arquivo da Spec está em alguma etapa e que nenhuma etapa inventa arquivo.
 */
export function validatePlanStages(
  stages: PlanStage[],
  reqIds: string[],
  textoPorReq: Record<string, string>,
  maxFilesPerStage: number,
  arquivosDaSpec?: string[]
): PlanScopeCheckResult {
  const extra: string[] = [];
  if (arquivosDaSpec) {
    const norm = (f: string) => f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim();
    const spec = new Set(arquivosDaSpec.map(norm));
    const planned = new Set(stages.flatMap((s) => s.arquivos.map(norm)));
    for (const f of spec) if (!planned.has(f)) extra.push(`[T8b ARQUIVO SEM ETAPA] "${f}" está na Spec e em nenhuma etapa.`);
    for (const f of planned) if (!spec.has(f)) extra.push(`[T8b ARQUIVO INVENTADO] "${f}" não está na lista de arquivos da Spec.`);
  }
  const macrobrief: MacrobriefDocument = {
    documento: "macrobrief",
    idMacrobrief: "plano-final",
    idProjeto: "plano-final",
    specVersao: 1,
    requisitosTotais: reqIds,
    clustersAtivos: [],
    microbriefs: stages.map((s) => ({ id: s.id, cluster: "core", dependeDe: s.dependeDe, arquivos: s.arquivos, reqs: s.reqs })),
    contratosTypescript: "",
  };
  const base = validateMacrobriefMechanical(macrobrief, reqIds, maxFilesPerStage);
  const scope = checkPlanScope(stages, textoPorReq);
  const errors = [...extra, ...base.errors, ...scope.errors];
  return { valid: errors.length === 0, errors };
}
