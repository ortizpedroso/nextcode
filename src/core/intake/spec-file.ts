import * as fs from "fs";
import * as path from "path";
import { parseSpecDocument } from "@/core/intake/spec-format";

/** Cópia publicada da Spec canônica. A sessão continua sendo a autoridade. */
export const CANONICAL_SPEC_RELATIVE_PATH = ".nextcode/spec.md";
export const SPEC_GAPS_RELATIVE_PATH = ".nextcode/spec-gaps.md";
export const SPEC_RECONCILE_RELATIVE_PATH = ".nextcode/spec-reconcile.md";

export type SpecFileWrite =
  | { ok: true; relativePath: string; wrote: boolean }
  | { ok: false; reason: "sem_pasta" | "spec_invalida" | "io" };

/** Lê a Spec publicada no projeto. Devolve null se ausente ou inválida. */
export function readCanonicalSpecFile(projectRoot: string): string | null {
  if (!projectRoot || !fs.existsSync(projectRoot)) return null;
  const target = path.resolve(projectRoot, CANONICAL_SPEC_RELATIVE_PATH);
  try {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
    const text = fs.readFileSync(target, "utf8").trim();
    return parseSpecDocument(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Publica a Spec na pasta do projeto. Recusa texto que não parseia, para um ensaio
 * não ocupar o lugar do documento.
 */
export function writeCanonicalSpecFile(projectRoot: string, spec: string): SpecFileWrite {
  if (!parseSpecDocument(spec)) return { ok: false, reason: "spec_invalida" };

  try {
    if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      return { ok: false, reason: "sem_pasta" };
    }

    const root = path.resolve(projectRoot);
    const target = path.resolve(root, CANONICAL_SPEC_RELATIVE_PATH);
    const rel = path.relative(root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, reason: "io" };

    const body = spec.trimEnd() + "\n";
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === body) {
      return { ok: true, relativePath: CANONICAL_SPEC_RELATIVE_PATH, wrote: false };
    }
    fs.writeFileSync(target, body, "utf8");
    return { ok: true, relativePath: CANONICAL_SPEC_RELATIVE_PATH, wrote: true };
  } catch {
    return { ok: false, reason: "io" };
  }
}

/** Linha para o chat. Sem pasta, a pessoa precisa saber que o arquivo não existe. */
export function canonicalSpecFileNotice(result: SpecFileWrite): string | null {
  if (result.ok) return `Spec gravada em \`${result.relativePath}\` na pasta do projeto.`;
  if (result.reason === "sem_pasta") {
    return `A Spec ficou na sessão. Vincule uma pasta de projeto para criar \`${CANONICAL_SPEC_RELATIVE_PATH}\`.`;
  }
  if (result.reason === "spec_invalida") return null;
  return `A Spec ficou na sessão. A gravação de \`${CANONICAL_SPEC_RELATIVE_PATH}\` falhou.`;
}
