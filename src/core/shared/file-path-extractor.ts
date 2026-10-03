/**
 * Extração canônica de caminhos de arquivo citados em texto livre (prompts do chat, Specs,
 * Markdown, YAML frontmatter). Fonte única de verdade — antes, `input-preprocessor.ts` e
 * `spec-decomposer.ts` mantinham regexes de extensão/âncora divergentes: a de
 * `input-preprocessor.ts` não exigia fronteira de palavra/aspas antes do caminho, o que
 * fazia trechos de stacktrace de build (ex.: "webpack-internal:///(app-pages-browser)/./src/
 * app/page.tsx:123:35") serem extraídos como arquivo-alvo real, mesmo sem relação com o
 * pedido do usuário.
 */
const FILE_EXTENSIONS = "ts|tsx|js|jsx|json|prisma|md|css|scss|html|env|sql|yml|yaml|config|sh|ps1|bat";

export function extractFilePathsFromText(text: string): string[] {
  const matches = new Set<string>();
  const regex = new RegExp(
    `(?:^|\\s|\`|'|")([a-zA-Z0-9_-]+(?:\\/[a-zA-Z0-9_.-]+)*\\.(?:${FILE_EXTENSIONS}))(?:$|\\s|\`|'|"|:|,|\\.)`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const matchedPath = m[1].replace(/^\.\//, "");
    if (matchedPath && !matchedPath.startsWith("http") && !matchedPath.includes("..")) {
      matches.add(matchedPath);
    }
  }
  return Array.from(matches);
}
