/**
 * Fase 14.2 — Injeção de contexto do projeto local no chat.
 *
 * Quando uma sessão pertence a um Projeto com `path` válido, o backend lê a
 * estrutura da pasta e os arquivos-chave (README, package.json, manifestos)
 * e injeta tudo como mensagem `system` ANTES do histórico, para que a IA
 * responda sobre "o projeto" sem precisar perguntar qual.
 *
 * Segurança (não quebra o que funciona):
 *  - Só aceita caminhos reais: fs.existsSync + isDirectory() (mesmo padrão do
 *    /api/fs/validate-path já existente).
 *  - Nunca segue symlinks fora da raiz do projeto (lstat antes de ler).
 *  - Teto rígido de bytes lidos por arquivo e por snapshot — não estoura o
 *    headroom nem trava o chat em pastas gigantes (node_modules etc.).
 *  - Falhou a leitura? Retorna null e o chat segue exatamente como hoje
 *    (fail-open, zero regressão).
 */

import * as fs from "fs";
import * as path from "path";

export interface ProjectSnapshot {
  projectName: string;
  projectPath: string;
  description?: string | null;
  manifestName?: string; // package.json / requirements.txt / go.mod ...
  manifestContent?: string;
  readmeExcerpt?: string;
  tree: string[]; // linhas de árvore já truncadas
  totalFilesScanned: number;
  truncated: boolean;
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "target",
  "vendor", "__pycache__", ".venv", "venv", "coverage", ".turbo",
  ".prisma", "tmp", ".cache", "bin", "obj", ".idea", ".vscode",
]);

// Arquivos-chave que definem "sobre o que é o projeto"
const MANIFEST_CANDIDATES = [
  "package.json", "requirements.txt", "pyproject.toml", "go.mod",
  "Cargo.toml", "pom.xml", "build.gradle", "composer.json", "Gemfile",
];

const MAX_MANIFEST_BYTES = 6_000;   // ~1.5k tokens
const MAX_README_BYTES = 8_000;     // ~2k tokens
const MAX_TREE_LINES = 120;         // estrutura compacta
const MAX_ENTRIES_PER_DIR = 60;     // evita travar em diretórios enormes
const MAX_TOTAL_SNAPSHOT_CHARS = 24_000; // teto absoluto do bloco <project_context>

function safeReadFile(filePath: string, maxBytes: number): string | null {
  try {
    const stat = fs.lstatSync(filePath); // lstat: NÃO segue symlink (anti-escape)
    if (!stat.isFile()) return null;
    const fd = fs.openSync(filePath, "r");
    try {
      const size = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, 0);
      let text = buffer.toString("utf8");
      if (stat.size > maxBytes) {
        text += `\n[... trancado em ${maxBytes} bytes de um arquivo de ${stat.size} bytes ...]`;
      }
      return text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Caminha a árvore de diretórios com limites duros (profundidade e contagem).
 * Retorna as linhas da árvore e quantos arquivos foram vistos.
 */
function buildTree(
  root: string,
  opts: { maxDepth?: number; depth?: number; counter: { files: number; lines: string[] } }
): void {
  const maxDepth = opts.maxDepth ?? 3;
  const depth = opts.depth ?? 0;
  if (depth > maxDepth || opts.counter.lines.length >= MAX_TREE_LINES) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const shown = entries.slice(0, MAX_ENTRIES_PER_DIR);
  for (const entry of shown) {
    if (opts.counter.lines.length >= MAX_TREE_LINES) break;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;

    const indent = "  ".repeat(depth);
    if (entry.isDirectory()) {
      opts.counter.lines.push(`${indent}${entry.name}/`);
      buildTree(path.join(root, entry.name), {
        maxDepth,
        depth: depth + 1,
        counter: opts.counter,
      });
    } else {
      opts.counter.files += 1;
      opts.counter.lines.push(`${indent}${entry.name}`);
    }
  }

  if (entries.length > MAX_ENTRIES_PER_DIR) {
    opts.counter.lines.push(
      `${"  ".repeat(depth)}[+${entries.length - MAX_ENTRIES_PER_DIR} outros itens omitidos]`
    );
  }
}

/**
 * Gera o snapshot do projeto. Retorna null se o caminho não existir/não for
 * diretório — o chamador deve simplesmente seguir sem contexto (fail-open).
 */
export function buildProjectSnapshot(project: {
  name: string;
  path?: string | null;
  description?: string | null;
}): ProjectSnapshot | null {
  if (!project.path || !project.path.trim()) return null;

  const normalized = path.normalize(project.path.trim());
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  // Manifesto (define stack/objetivo)
  let manifestName: string | undefined;
  let manifestContent: string | undefined;
  for (const candidate of MANIFEST_CANDIDATES) {
    const content = safeReadFile(path.join(normalized, candidate), MAX_MANIFEST_BYTES);
    if (content) {
      manifestName = candidate;
      manifestContent = content;
      break;
    }
  }

  // README (descrição humana do projeto)
  let readmeExcerpt: string | undefined;
  for (const candidate of ["README.md", "readme.md", "README.rst", "README.txt", "LEIA-ME.md"]) {
    const content = safeReadFile(path.join(normalized, candidate), MAX_README_BYTES);
    if (content) {
      readmeExcerpt = content;
      break;
    }
  }

  // Árvore de arquivos
  const counter: { files: number; lines: string[] } = { files: 0, lines: [] };
  buildTree(normalized, { counter });
  const truncated = counter.lines.length >= MAX_TREE_LINES;

  return {
    projectName: project.name,
    projectPath: normalized,
    description: project.description,
    manifestName,
    manifestContent,
    readmeExcerpt,
    tree: counter.lines,
    totalFilesScanned: counter.files,
    truncated,
  };
}

/**
 * Serializa o snapshot no bloco <project_context> enviado como system prompt.
 */
export function formatProjectContext(snapshot: ProjectSnapshot): string {
  const parts: string[] = [];
  parts.push("<project_context>");
  parts.push(`Nome do projeto: ${snapshot.projectName}`);
  parts.push(`Caminho local: ${snapshot.projectPath}`);
  if (snapshot.description) parts.push(`Descrição cadastrada: ${snapshot.description}`);
  parts.push(`Arquivos mapeados na estrutura: ${snapshot.totalFilesScanned}${snapshot.truncated ? " (lista truncada)" : ""}`);

  if (snapshot.manifestName && snapshot.manifestContent) {
    parts.push(`\n--- ${snapshot.manifestName} ---\n${snapshot.manifestContent}`);
  }
  if (snapshot.readmeExcerpt) {
    parts.push(`\n--- README (resumo) ---\n${snapshot.readmeExcerpt}`);
  }
  parts.push(`\n--- Estrutura de arquivos ---\n${snapshot.tree.join("\n")}`);
  parts.push("</project_context>");
  parts.push(
    "\nInstrução: as perguntas do usuário podem se referir a 'o projeto'. Use o contexto acima para responder com conhecimento real dos arquivos. Se faltar informação, peça para abrir arquivos específicos pelo caminho."
  );

  let text = parts.join("\n");
  if (text.length > MAX_TOTAL_SNAPSHOT_CHARS) {
    text = text.slice(0, MAX_TOTAL_SNAPSHOT_CHARS) + "\n[... contexto do projeto truncado ...]\n</project_context>";
  }
  return text;
}

/**
 * Conveniência: snapshot + formatação num passo só. Null-safe.
 */
export function buildProjectContextBlock(project: {
  name: string;
  path?: string | null;
  description?: string | null;
}): string | null {
  const snapshot = buildProjectSnapshot(project);
  if (!snapshot) return null;
  return formatProjectContext(snapshot);
}
