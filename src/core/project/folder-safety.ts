import * as fs from "fs";
import * as path from "path";

/**
 * PJ2 (2) / P12: trava contra apagar (ou abrir como projeto) uma pasta-mãe. Antes só a raiz do disco,
 * a pasta do NextCode e `C:\projetos` exato eram recusados, com comparação sensível a maiúsculas —
 * abrir `C:\projetos` com outra grafia ou uma pasta que contém outros projetos e clicar em "apagar"
 * removeria tudo dentro.
 */

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", ".nextcode", "graphify-out", "dist", "build"]);
/** Marcadores de "aqui dentro mora outro projeto". */
const PROJECT_MARKERS = [".git", "package.json"];
/** Profundidade da busca por projetos aninhados (pasta-mãe típica: projetos 1–2 níveis abaixo). */
const MAX_DEPTH = 3;

export function normalizeForCompare(p: string): string {
  const r = path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** `child` está dentro de `parent` (ou é a mesma pasta), sem diferenciar maiúsculas no Windows. */
export function isSameOrInside(child: string, parent: string): boolean {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + path.sep);
}

function findNestedProject(dir: string, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || IGNORED_DIRS.has(e.name)) continue;
    const sub = path.join(dir, e.name);
    if (PROJECT_MARKERS.some((m) => fs.existsSync(path.join(sub, m)))) return sub;
    const deeper = findNestedProject(sub, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

export interface FolderSafetyResult {
  ok: boolean;
  motivo?: string;
}

/**
 * Pode apagar a pasta inteira deste projeto? Recusa: raiz do disco, pasta do NextCode (ou algo que a
 * contenha), pasta que contém a pasta de OUTRO projeto cadastrado, e pasta com outro projeto dentro
 * (subpasta com `.git` ou `package.json`).
 */
export function checkFolderSafeToDelete(
  target: string,
  opts: { nextcodeRoot?: string; otherProjectPaths?: string[] } = {}
): FolderSafetyResult {
  const resolved = path.resolve(target);
  const nextcodeRoot = opts.nextcodeRoot ?? process.cwd();
  if (normalizeForCompare(resolved) === normalizeForCompare(path.parse(resolved).root)) {
    return { ok: false, motivo: "é a raiz do disco" };
  }
  if (isSameOrInside(nextcodeRoot, resolved)) {
    return { ok: false, motivo: "contém a pasta do próprio NextCode" };
  }
  if (normalizeForCompare(resolved) === normalizeForCompare(path.dirname(nextcodeRoot))) {
    return { ok: false, motivo: "é a pasta onde ficam os projetos" };
  }
  const other = (opts.otherProjectPaths ?? []).find((p) => p && isSameOrInside(p, resolved));
  if (other) {
    return { ok: false, motivo: `contém outro projeto cadastrado (${other})` };
  }
  const nested = fs.existsSync(resolved) ? findNestedProject(resolved, 1) : null;
  if (nested) {
    return { ok: false, motivo: `contém outro projeto ou repositório (${nested})` };
  }
  return { ok: true };
}

/**
 * Pode abrir (cadastrar) esta pasta como projeto? Recusa a raiz do disco, a pasta do NextCode, a
 * pasta de projetos e pasta que contém outro projeto cadastrado. Repositório aninhado (monorepo) pode
 * ser aberto — só não pode ser apagado inteiro (`checkFolderSafeToDelete`).
 */
export function checkFolderSafeToOpen(
  target: string,
  opts: { nextcodeRoot?: string; otherProjectPaths?: string[] } = {}
): FolderSafetyResult {
  const resolved = path.resolve(target);
  const nextcodeRoot = opts.nextcodeRoot ?? process.cwd();
  if (normalizeForCompare(resolved) === normalizeForCompare(path.parse(resolved).root)) {
    return { ok: false, motivo: "é a raiz do disco" };
  }
  if (isSameOrInside(nextcodeRoot, resolved)) {
    return { ok: false, motivo: "contém a pasta do próprio NextCode" };
  }
  if (normalizeForCompare(resolved) === normalizeForCompare(path.dirname(nextcodeRoot))) {
    return { ok: false, motivo: "é a pasta onde ficam os projetos" };
  }
  const other = (opts.otherProjectPaths ?? []).find(
    (p) => p && isSameOrInside(p, resolved) && normalizeForCompare(p) !== normalizeForCompare(resolved)
  );
  if (other) {
    return { ok: false, motivo: `contém outro projeto cadastrado (${other})` };
  }
  return { ok: true };
}
