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

/** T8b inteira sobre o plano final (depois da divisão pelo Jev): regras antigas + as do A2.1. */
export function validateFinalPlan(
  nodes: { id: string; dependencies?: string[]; payload?: unknown }[],
  reqIds: string[],
  textoPorReq: Record<string, string>,
  maxFilesPerStage: number
): PlanScopeCheckResult {
  const { stages } = planStagesFromNodes(nodes);
  if (stages.length === 0) return { valid: true, errors: [] };
  return validatePlanStages(stages, reqIds, textoPorReq, maxFilesPerStage);
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
