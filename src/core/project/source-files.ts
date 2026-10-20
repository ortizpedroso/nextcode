import * as fs from "fs";
import * as path from "path";

/** Extensões que contam como código de verdade (não config, não documentação). */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".php", ".rb",
  ".vue", ".svelte", ".swift", ".c", ".cpp", ".h",
]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", ".nextcode", "graphify-out", "dist", "build", "coverage"]);

/**
 * Mudança 25 (b): conta arquivos-fonte na pasta do projeto, sem Jev. Antes, "a pasta existe" bastava
 * e o Graphify era sugerido num projeto que só tinha `package.json` e `README.md` (teste real `8e2f2052`).
 * Para no `limit` (só interessa "tem código suficiente?").
 */
export function countSourceFiles(root: string, limit = 50): number {
  let count = 0;
  const walk = (dir: string) => {
    if (count >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count >= limit) return;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile() && SOURCE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        count++;
      }
    }
  };
  if (root && fs.existsSync(root)) walk(root);
  return count;
}

/** Mínimo de arquivos-fonte para valer a pena um grafo do projeto. */
export const GRAPHIFY_MIN_SOURCE_FILES = 5;

export function hasExistingSourceCode(root: string | null | undefined): boolean {
  return Boolean(root) && countSourceFiles(root!, GRAPHIFY_MIN_SOURCE_FILES) >= GRAPHIFY_MIN_SOURCE_FILES;
}
