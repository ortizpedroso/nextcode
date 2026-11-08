import { pathInStageScope } from "@/core/decision/jev-execution-checks";
import { normalizeScopePath } from "@/core/governance/dual-lens-auditor";

/**
 * Rejeição crítica que aponta arquivo de uma única etapa já concluída:
 * essa etapa volta à fila uma vez e a tentativa daqui não conta.
 * Vale também quando o texto diz que o modelo não tem o campo e só uma etapa tem schema.prisma.
 * Campo inventado com nome real já existente, dono ambíguo ou a mesma cita de novo seguem o ciclo normal.
 */

export type StageFileOwner = {
  id: string;
  title: string;
  status: string;
  files: string[];
};

export type OwnerReopenRecord = {
  ownerId: string;
  defectKey: string;
};

export type OwnerReopenFixReason =
  | "no_critical"
  | "in_scope"
  | "no_foreign_file"
  | "no_owner"
  | "ambiguous_owner"
  | "split_owners"
  | "owner_not_ready"
  | "already_reopened";

export type OwnerReopenDecision =
  | { kind: "fix_here"; reason: OwnerReopenFixReason }
  | {
      kind: "reopen";
      ownerId: string;
      ownerTitle: string;
      citedFiles: string[];
      defectKey: string;
      defectText: string;
    };

const CRITICAL_SLICE_RE = /\[critico\]([\s\S]*?)(?=\[(?:importante|menor|critico)\]|$)/gi;
const CITATION_RE = /((?:[A-Za-z0-9_$@.()[\]-]+\/)*[A-Za-z0-9_$@.()[\]-]+\.[A-Za-z0-9]+):(\d+)/g;
const BARE_PATH_RE =
  /(?:[A-Za-z0-9_$@.()[\]-]+\/)+[A-Za-z0-9_$@.-]+\.[A-Za-z0-9]+|\b[A-Za-z0-9_$@.-]+\.[A-Za-z0-9]+\b/g;
const PATH_EXT_RE = /\.([A-Za-z0-9]+)$/;
const PATH_EXTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "prisma", "json", "css", "scss", "sql"]);
const LACK_AFTER_PATH_RE = /n[aã]o tem|n[aã]o existe|ausente|inexistente|adicion|acrescent|incluir/i;
const SCHEMA_LACK_RE =
  /n[aã]o (?:tem|existe)[^\n]{0,40}(?:modelo|schema|coluna)|(?:modelo|schema|coluna)[^\n]{0,40}n[aã]o (?:tem|existe)|acrescent\w+[^\n]{0,40}schema|adicion\w+[^\n]{0,60}(?:modelo|schema)|coluna (?:ausente|inexistente|n[aã]o existe)/i;
const USE_EXISTING_RE = /campos? reais|campo existente|campos existentes|j[aá] existe/i;
const MISSING_PROP_RE =
  /Property '([A-Za-z_][A-Za-z0-9_]*)' does not exist|and '([A-Za-z_][A-Za-z0-9_]*)' does not exist in type/g;
const PRISMA_TYPE_RE = /UpdateInput|CreateInput|Delegate|Unchecked|Without</;

function criticalSlices(text: string): string[] {
  if (!/\[critico\]/i.test(text)) return [];
  const slices: string[] = [];
  CRITICAL_SLICE_RE.lastIndex = 0;
  for (const match of text.matchAll(CRITICAL_SLICE_RE)) {
    slices.push(match[1] || "");
  }
  return slices;
}

function acceptedPath(raw: string): string | null {
  const cited = normalizeScopePath(raw);
  const ext = PATH_EXT_RE.exec(cited)?.[1]?.toLowerCase();
  if (!cited || !ext || !PATH_EXTS.has(ext)) return null;
  return cited;
}

function citationsIn(text: string): string[] {
  const found = new Set<string>();
  CITATION_RE.lastIndex = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const cited = acceptedPath(match[1] || "");
    if (cited) found.add(cited);
  }
  BARE_PATH_RE.lastIndex = 0;
  for (const match of text.matchAll(BARE_PATH_RE)) {
    const cited = acceptedPath(match[0] || "");
    if (cited) found.add(cited);
  }
  return Array.from(found);
}

function pathLacksPiece(text: string, cited: string): boolean {
  const haystack = text.toLowerCase();
  const needle = cited.toLowerCase();
  let from = 0;
  while (from < haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return false;
    const window = text.slice(idx + cited.length, idx + cited.length + 32);
    if (LACK_AFTER_PATH_RE.test(window)) return true;
    from = idx + needle.length;
  }
  return false;
}

function schemaOwners(stages: StageFileOwner[], thisStageId: string): StageFileOwner[] {
  return stages.filter(
    (stage) =>
      stage.id !== thisStageId &&
      stage.files.some((file) => /(?:^|\/)schema\.prisma$/i.test(normalizeScopePath(file)))
  );
}

function ownersOf(cited: string, stages: StageFileOwner[], thisStageId: string): StageFileOwner[] {
  return stages.filter((stage) => stage.id !== thisStageId && pathInStageScope(stage.files, cited));
}

function matchingScopePath(files: string[], cited: string): string {
  const normCited = normalizeScopePath(cited);
  for (const scopeEntry of files) {
    const normScope = normalizeScopePath(scopeEntry);
    if (normScope === normCited || normCited.endsWith(`/${normScope}`) || normScope.endsWith(`/${normCited}`)) {
      return normScope;
    }
  }
  return normCited;
}

function missingPrismaProperties(text: string): string[] {
  if (!PRISMA_TYPE_RE.test(text)) return [];
  const found = new Set<string>();
  MISSING_PROP_RE.lastIndex = 0;
  for (const match of text.matchAll(MISSING_PROP_RE)) {
    const name = match[1] || match[2];
    if (name) found.add(name);
  }
  return Array.from(found).sort();
}

/** TS2339/TS2353 num tipo do Prisma: o campo não está no modelo. A etapa do schema é a dona. */
function decideMissingSchemaField(input: {
  rejection: string;
  thisStageId: string;
  thisFiles: string[];
  stages: StageFileOwner[];
  priorReopens: OwnerReopenRecord[];
}): OwnerReopenDecision | null {
  const properties = missingPrismaProperties(input.rejection || "");
  if (properties.length === 0) return null;
  const owners = schemaOwners(input.stages, input.thisStageId);
  if (owners.length !== 1) return null;
  if (input.thisFiles.some((file) => /(?:^|\/)schema\.prisma$/i.test(normalizeScopePath(file)))) return null;
  const owner = owners[0];
  if (owner.status !== "completed") return { kind: "fix_here", reason: "owner_not_ready" };
  const schemaFile = matchingScopePath(owner.files, "schema.prisma");
  const defectKey = [schemaFile, ...properties].join("|");
  if (input.priorReopens.some((prior) => prior.ownerId === owner.id && prior.defectKey === defectKey)) {
    return { kind: "fix_here", reason: "already_reopened" };
  }
  return {
    kind: "reopen",
    ownerId: owner.id,
    ownerTitle: owner.title,
    citedFiles: [schemaFile],
    defectKey,
    defectText: String(input.rejection || "").replace(/\s+/g, " ").trim().slice(0, 1800),
  };
}

export function decideCitedOwnerReopen(input: {
  rejection: string;
  thisStageId: string;
  thisFiles: string[];
  stages: StageFileOwner[];
  priorReopens: OwnerReopenRecord[];
}): OwnerReopenDecision {
  const missingField = decideMissingSchemaField(input);
  if (missingField?.kind === "reopen" || missingField?.reason === "already_reopened") return missingField;

  const slices = criticalSlices(input.rejection || "");
  if (slices.length === 0) return { kind: "fix_here", reason: "no_critical" };
  const criticalText = slices.join("\n");
  const citations = citationsIn(criticalText);

  const inScope: string[] = [];
  const foreign: string[] = [];
  for (const cited of citations) {
    if (pathInStageScope(input.thisFiles, cited)) inScope.push(cited);
    else foreign.push(cited);
  }

  const defectText = slices
    .map((slice) => slice.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);
  const keepExisting = USE_EXISTING_RE.test(criticalText);

  const reopen = (owner: StageFileOwner, files: string[]): OwnerReopenDecision => {
    const citedFiles = Array.from(new Set(files)).sort();
    const defectKey = citedFiles.join("|");
    if (input.priorReopens.some((prior) => prior.ownerId === owner.id && prior.defectKey === defectKey)) {
      return { kind: "fix_here", reason: "already_reopened" };
    }
    return {
      kind: "reopen",
      ownerId: owner.id,
      ownerTitle: owner.title,
      citedFiles,
      defectKey,
      defectText,
    };
  };

  if (foreign.length === 0) {
    if (inScope.length > 0 && !keepExisting && SCHEMA_LACK_RE.test(criticalText)) {
      const owners = schemaOwners(input.stages, input.thisStageId);
      if (owners.length === 1 && owners[0].status === "completed") {
        return reopen(owners[0], [matchingScopePath(owners[0].files, "schema.prisma")]);
      }
      if (owners.length === 1) return { kind: "fix_here", reason: "owner_not_ready" };
    }
    if (inScope.length > 0) return { kind: "fix_here", reason: "in_scope" };
    return { kind: "fix_here", reason: "no_foreign_file" };
  }

  let owner: StageFileOwner | null = null;
  const resolved: string[] = [];
  let sawUnknown = false;
  for (const cited of foreign) {
    const owners = ownersOf(cited, input.stages, input.thisStageId);
    if (owners.length === 0) {
      sawUnknown = true;
      continue;
    }
    if (owners.length > 1) return { kind: "fix_here", reason: "ambiguous_owner" };
    if (owner && owner.id !== owners[0].id) return { kind: "fix_here", reason: "split_owners" };
    owner = owners[0];
    resolved.push(matchingScopePath(owner.files, cited));
  }
  if (!owner) {
    if (inScope.length > 0 && !keepExisting && SCHEMA_LACK_RE.test(criticalText)) {
      const schemas = schemaOwners(input.stages, input.thisStageId);
      if (schemas.length === 1 && schemas[0].status === "completed") {
        return reopen(schemas[0], [matchingScopePath(schemas[0].files, "schema.prisma")]);
      }
    }
    if (inScope.length > 0) return { kind: "fix_here", reason: "in_scope" };
    return { kind: "fix_here", reason: sawUnknown ? "no_owner" : "no_foreign_file" };
  }
  if (owner.status !== "completed") return { kind: "fix_here", reason: "owner_not_ready" };

  if (inScope.length === 0) return reopen(owner, resolved);
  if (keepExisting) return { kind: "fix_here", reason: "in_scope" };
  if (foreign.some((cited) => pathLacksPiece(criticalText, cited))) return reopen(owner, resolved);
  return { kind: "fix_here", reason: "in_scope" };
}

function asPayloadObject(payload: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed = payload ? JSON.parse(payload) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function priorReopensFromPayload(payload: string | null | undefined): OwnerReopenRecord[] {
  const obj = asPayloadObject(payload);
  const list = obj?.reaberturasDono;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is OwnerReopenRecord =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as OwnerReopenRecord).ownerId === "string" &&
      typeof (item as OwnerReopenRecord).defectKey === "string"
  );
}

export function withOwnerReopenHold(
  payload: string | null | undefined,
  decision: Extract<OwnerReopenDecision, { kind: "reopen" }>
): string | null {
  const obj = asPayloadObject(payload);
  if (!obj) return null;
  const prior = priorReopensFromPayload(JSON.stringify(obj));
  const next = prior.some((item) => item.ownerId === decision.ownerId && item.defectKey === decision.defectKey)
    ? prior
    : [...prior, { ownerId: decision.ownerId, defectKey: decision.defectKey }];
  obj.reaberturasDono = next;
  obj.esperaArquivoDono = {
    ownerId: decision.ownerId,
    ownerTitle: decision.ownerTitle,
    citedFiles: decision.citedFiles,
    defectText: decision.defectText,
  };
  return JSON.stringify(obj);
}

export function withOwnerReopenRequest(
  payload: string | null | undefined,
  request: {
    fromStageId: string;
    fromStageTitle: string;
    citedFiles: string[];
    defectKey: string;
    defectText: string;
  }
): string | null {
  const obj = asPayloadObject(payload);
  if (!obj) return null;
  obj.reaberturaPedido = request;
  return JSON.stringify(obj);
}

export function stripOwnerReopenAfterSuccess(payload: string | null | undefined): string | undefined {
  const obj = asPayloadObject(payload);
  if (!obj) return undefined;
  if (!("reaberturaPedido" in obj) && !("esperaArquivoDono" in obj)) return undefined;
  delete obj.reaberturaPedido;
  delete obj.esperaArquivoDono;
  return JSON.stringify(obj);
}

export function appendOwnerDependency(depsJson: string | null | undefined, ownerId: string): string {
  let deps: string[] = [];
  try {
    const parsed = JSON.parse(depsJson || "[]");
    if (Array.isArray(parsed)) deps = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    deps = [];
  }
  if (!deps.includes(ownerId)) deps.push(ownerId);
  return JSON.stringify(deps);
}

export function parseStageFiles(filesScope: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(filesScope || "[]");
    return Array.isArray(parsed) ? parsed.filter((file): file is string => typeof file === "string") : [];
  } catch {
    return [];
  }
}

export function ownerReopenPrompt(payload: string | null | undefined): string | null {
  const obj = asPayloadObject(payload);
  if (!obj) return null;
  const blocks: string[] = [];
  const pedido = obj.reaberturaPedido;
  if (pedido && typeof pedido === "object") {
    const files = Array.isArray((pedido as { citedFiles?: unknown }).citedFiles)
      ? (pedido as { citedFiles: unknown[] }).citedFiles.filter((file): file is string => typeof file === "string")
      : [];
    const fromTitle =
      typeof (pedido as { fromStageTitle?: unknown }).fromStageTitle === "string"
        ? (pedido as { fromStageTitle: string }).fromStageTitle
        : "outra etapa";
    const defect =
      typeof (pedido as { defectText?: unknown }).defectText === "string"
        ? (pedido as { defectText: string }).defectText
        : "";
    blocks.push(
      `[ARQUIVO DESTA ETAPA REABERTO]\nA etapa "${fromTitle}" foi reprovada porque o defeito está em arquivo desta etapa (${files.join(", ")}).\nAcrescente só o que falta. Mantenha o restante do arquivo.\nDefeito:\n${defect}`
    );
  }
  const espera = obj.esperaArquivoDono;
  if (espera && typeof espera === "object") {
    const files = Array.isArray((espera as { citedFiles?: unknown }).citedFiles)
      ? (espera as { citedFiles: unknown[] }).citedFiles.filter((file): file is string => typeof file === "string")
      : [];
    const ownerTitle =
      typeof (espera as { ownerTitle?: unknown }).ownerTitle === "string"
        ? (espera as { ownerTitle: string }).ownerTitle
        : "a etapa dona";
    const defect =
      typeof (espera as { defectText?: unknown }).defectText === "string"
        ? (espera as { defectText: string }).defectText
        : "";
    blocks.push(
      `[ETAPA DONA REABERTA]\nO arquivo ${files.join(", ")} é da etapa "${ownerTitle}", já reexecutada por este defeito.\nImplemente a parte desta etapa.\nDefeito:\n${defect}`
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
