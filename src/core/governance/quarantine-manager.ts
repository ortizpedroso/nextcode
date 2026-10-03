/**
 * Quarantine Manager (NextCode v5)
 * Gerencia a criação, isolamento e movimentação de arquivos na Quarentena de Staging.
 * Garante que o Agente Executor só escreva em ambientes protegidos e isolados antes da auditoria cega.
 */

import * as fs from "fs";
import * as path from "path";
import { normalizeScopePath } from "./dual-lens-auditor";

interface PromotionSnapshotEntry {
  destPath: string;
  previous: Buffer | null;
  promoted: Buffer;
}

export class QuarantineManager {
  private baseQuarantineDir: string;
  private promotionSnapshots = new Map<string, PromotionSnapshotEntry[]>();

  constructor(baseDir: string = path.join(process.cwd(), ".quarantine")) {
    this.baseQuarantineDir = baseDir;
    if (!fs.existsSync(this.baseQuarantineDir)) {
      fs.mkdirSync(this.baseQuarantineDir, { recursive: true });
    }
  }

  /**
   * Prepara um workspace de quarentena único para uma tarefa específica
   */
  public prepareWorkspace(taskId: string): string {
    const taskQuarantinePath = path.join(this.baseQuarantineDir, taskId);
    if (fs.existsSync(taskQuarantinePath)) {
      fs.rmSync(taskQuarantinePath, { recursive: true, force: true });
    }
    fs.mkdirSync(taskQuarantinePath, { recursive: true });
    return taskQuarantinePath;
  }

  /**
   * SEGURANÇA: resolve `relativePath` dentro de `baseDir` e garante que o resultado não
   * escapa de `baseDir` via traversal ("..", caminho absoluto, etc). `relativePath` pode
   * vir de conteúdo gerado por LLM (blocos de código/markdown) ou de filesScope fornecido
   * pelo chamador — nenhum dos dois é confiável. Lança erro em vez de escrever/ler fora
   * do diretório de quarentena ou do projeto de destino.
   */
  private static resolveContained(baseDir: string, relativePath: string): string {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(resolvedBase, relativePath);
    if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Caminho fora do escopo permitido (possível path traversal): "${relativePath}"`);
    }
    return resolvedTarget;
  }

  /**
   * Grava um arquivo dentro do escopo de quarentena da tarefa
   */
  public writeFile(taskId: string, relativeFilePath: string, content: string): string {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    const targetPath = QuarantineManager.resolveContained(workspacePath, relativeFilePath);

    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(targetPath, QuarantineManager.sanitizeContent(relativeFilePath, content), "utf-8");
    return targetPath;
  }

  /**
   * Sanitização determinística aplicada ao conteúdo antes de ir para a quarentena. Pública e
   * pura para que o MESMO conteúdo final seja o auditado (Tipo 1/Tipo 2) e o promovido (Trava
   * T4) — antes a auditoria via o texto bruto da IA e o disco recebia a versão modificada.
   */
  public static sanitizeContent(relativeFilePath: string, content: string): string {
    let finalContent = content;
    // Sanitização determinística para todos os tipos de arquivo (remove comentários de cabeçalho no topo como // file: ...)
    finalContent = finalContent
      .replace(/^(?:\/\/|#|\/\*)\s*(?:file|filepath|path):?\s*[^\s\n*]+(?:\s*\*\/)?\r?\n?/gi, "")
      .trim();

    // Auto-correção mecânica para diretivas 'client' malformadas ('client' -> 'use client')
    finalContent = finalContent.replace(/^['"]client['"];?/gm, "'use client';");

    const cleanRelPath = relativeFilePath.toLowerCase().replace(/\\/g, "/");
    const isReactComponent = cleanRelPath.endsWith(".tsx") || cleanRelPath.endsWith(".jsx") || cleanRelPath.endsWith(".js") || cleanRelPath.endsWith(".ts");
    const hasReactHooks = /\b(useState|useEffect|useContext|useRef|useCallback|useMemo|useReducer|useTransition|useDeferredValue|useFormStatus|useActionState)\b/.test(finalContent);
    const hasUseClient = /^\s*['"]use client['"];?/m.test(finalContent);

    if (isReactComponent && hasReactHooks && !hasUseClient) {
      finalContent = `'use client';\n\n${finalContent}`;
    }

    // Se for arquivo JSON, garante remoção de qualquer comentário remanescente
    if (relativeFilePath.toLowerCase().endsWith(".json")) {
      finalContent = finalContent
        .replace(/^(?:\/\/|#|\/\*).*$/gm, "")
        .trim();
    }

    // Trava T4: NÃO injeta mais stubs (page.tsx com "Página Gerada" / route.ts com POST que
    // responde success:true) quando a IA esquece o export obrigatório. Esses stubs mascaravam a
    // falha e iam para o disco sem passar por nenhuma lente. Agora o Tipo 1 reprova o arquivo
    // (export default / método HTTP ausente) e o erro real volta para o loop de autocorreção.

    if (finalContent) {
      finalContent += "\n";
    }

    return finalContent;
  }

  /**
   * Lê um arquivo gravado no workspace da quarentena
   */
  public readFile(taskId: string, relativeFilePath: string): string | null {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    let targetPath: string;
    try {
      targetPath = QuarantineManager.resolveContained(workspacePath, relativeFilePath);
    } catch {
      return null;
    }
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.readFileSync(targetPath, "utf-8");
  }

  /**
   * Helper para filtrar nomes proibidos ou inválidos que não representam arquivos de código-fonte
   */
  private static isInvalidFilePath(pathStr?: string): boolean {
    if (!pathStr || typeof pathStr !== "string") return true;
    const clean = pathStr.trim().replace(/^\\|^\//, "");
    const lower = clean.toLowerCase();

    // Nomes de frameworks/ferramentas conhecidos que não são caminhos de arquivos
    const forbidden = [
      "next.js", "node.js", "react.js", "vue.js", "express.js", "nest.js",
      "nuxt.js", "vite.js", "angular.js", "ember.js", "gatsby.js", "javascript", "typescript"
    ];
    if (forbidden.includes(lower)) return true;

    // URLs e domínios
    if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("www.")) return true;
    if (lower.endsWith(".com") || lower.endsWith(".org") || lower.endsWith(".net") || lower.endsWith(".dev") || lower.endsWith(".io")) return true;

    return false;
  }

  /**
   * Tags de linguagem que indicam INSTRUÇÃO/SAÍDA (comando de terminal, log, texto livre),
   * nunca conteúdo de um arquivo de código-fonte. Sem essa lista, um bloco ```bash\nnpm
   * install\nnpm run dev\n``` explicativo era tratado como candidato a arquivo igual a um
   * bloco ```typescript``` real — e, combinado com o fallback cego (ver nota abaixo), acabava
   * gravado como se fosse um .ts de verdade. Aqui ele só é promovido a arquivo se vier com
   * um caminho EXPLÍCITO (atributo do fence ou cabeçalho "// file: ..." dentro do bloco) —
   * nunca por adivinhação de contexto.
   */
  private static readonly NON_FILE_LANGS = new Set([
    "bash", "sh", "shell", "zsh", "powershell", "ps1", "cmd", "bat",
    "console", "text", "plaintext", "txt", "log", "output", "diff", "",
  ]);

  /**
   * Extrai blocos de código formatados em markdown e grava na quarentena
   */
  public extractAndWriteCodeBlocks(
    taskId: string,
    text: string,
    fallbackFilesScope: string[] = []
  ): Record<string, string> {
    const codeMap: Record<string, string> = {};
    const workspacePath = this.prepareWorkspace(taskId);

    // Regex para encontrar blocos de código ```lang ... ``` (lang capturado separadamente
    // para decidir se o bloco pode ter o destino ADIVINHADO ou exige caminho explícito)
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)(?:\s+(?:file|path|filepath)="?([^"\n\s]+)"?)?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const lang = (match[1] || "").toLowerCase();
      let relativePath: string | undefined = match[2];
      const codeContent = match[3];
      const isInstructionLang = QuarantineManager.NON_FILE_LANGS.has(lang);

      if (relativePath && QuarantineManager.isInvalidFilePath(relativePath)) {
        relativePath = undefined;
      }

      // 1. Procurar declaração explícita no próprio topo do código como // file: src/... ou // filepath: src/...
      if (!relativePath) {
        const explicitHeaderMatch = codeContent.match(/^(?:\/\/|#|\/\*)\s*(?:file|filepath|path):\s*([^\s\n*]+)/i);
        if (explicitHeaderMatch && !QuarantineManager.isInvalidFilePath(explicitHeaderMatch[1])) {
          relativePath = explicitHeaderMatch[1];
        } else {
          // 2. Procurar caminho direto em comentário no topo como // src/..., // app/..., // lib/...
          const directPathMatch = codeContent.match(/^(?:\/\/|#|\/\*)\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/i);
          if (directPathMatch && !QuarantineManager.isInvalidFilePath(directPathMatch[1]) && (directPathMatch[1].includes("/") || directPathMatch[1].includes("\\"))) {
            relativePath = directPathMatch[1];
          }
        }
      }

      // Blocos de instrução/log (bash, shell, powershell, texto puro...) só viram arquivo
      // com caminho EXPLÍCITO (passos 1/2 acima). Sem isso, ficam de fora — permanecem só
      // como prosa explicativa no chat, nunca adivinhados via passos 3/4/5 abaixo.
      if (!relativePath && !isInstructionLang) {
        // 3. Procurar menções a caminhos de arquivos no texto imediatamente anterior ao bloco
        const textBeforeBlock = text.substring(0, match.index);
        const allPathsMatch = textBeforeBlock.match(/([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+)/gi);
        if (allPathsMatch) {
          const validPaths = allPathsMatch.filter((p) => !QuarantineManager.isInvalidFilePath(p));
          if (validPaths.length > 0) {
            relativePath = validPaths[validPaths.length - 1];
          }
        }

        // 4. Procurar em cabeçalhos markdown imediatamente anteriores ao bloco de código
        if (!relativePath) {
          const lastHeadingMatch = textBeforeBlock.match(/(?:###|####|#|\*\*)\s*(?:\[.*\]\s*)?`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?\s*$/m);
          if (lastHeadingMatch && !QuarantineManager.isInvalidFilePath(lastHeadingMatch[1])) {
            relativePath = lastHeadingMatch[1];
          }
        }

        // 5. Se ainda não identificou o caminho, usa o fallbackFilesScope correspondente ao
        // índice ou o primeiro válido. NUNCA inventa um nome sintético (ex.: "generated-N.ts")
        // — se não há nenhum sinal real de destino, o bloco simplesmente NÃO é promovido a
        // arquivo. Escrever em um caminho inventado foi o que causou o incidente em que um
        // bloco de instrução ("npm install / npm run dev") virou um .ts fantasma no disco.
        if (!relativePath) {
          if (fallbackFilesScope.length > index && !QuarantineManager.isInvalidFilePath(fallbackFilesScope[index])) {
            relativePath = fallbackFilesScope[index];
          } else {
            const validFallback = fallbackFilesScope.find((f) => !QuarantineManager.isInvalidFilePath(f));
            if (validFallback) relativePath = validFallback;
          }
        }
      }

      if (relativePath && codeContent && !QuarantineManager.isInvalidFilePath(relativePath)) {
        const cleanPath = relativePath.trim().replace(/^\\|^\//, "");
        this.writeFile(taskId, cleanPath, codeContent);
        codeMap[cleanPath] = QuarantineManager.sanitizeContent(cleanPath, codeContent);
      }
      index++;
    }

    // Fallback: Se nenhum bloco ``` foi extraído, procura por padrões de comando do PowerShell (Set-Content -Path "..." -Value "...")
    if (Object.keys(codeMap).length === 0 && text.includes("Set-Content")) {
      const psRegex = /Set-Content\s+-Path\s+["']([^"']+)["']\s+-Value\s+["']([^"']+)["']/gi;
      let psMatch: RegExpExecArray | null;
      while ((psMatch = psRegex.exec(text)) !== null) {
        const psPath = psMatch[1];
        const psValue = psMatch[2].replace(/;/g, "\n");
        if (psPath && !QuarantineManager.isInvalidFilePath(psPath)) {
          const cleanPath = psPath.trim().replace(/^\\|^\//, "");
          this.writeFile(taskId, cleanPath, psValue);
          codeMap[cleanPath] = QuarantineManager.sanitizeContent(cleanPath, psValue);
        }
      }
    }

    return codeMap;
  }

  /**
   * Promove as alterações aprovadas da quarentena para o repositório principal do projeto
   */
  public promoteToMainRepo(taskId: string, targetProjectRoot: string, filesScope: string[]): boolean {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    if (!fs.existsSync(workspacePath)) {
      return false;
    }

    // Se o diretório alvo do projeto não existir, cria-o fisicamente
    if (!fs.existsSync(targetProjectRoot)) {
      fs.mkdirSync(targetProjectRoot, { recursive: true });
    }

    // Purga arquivos com nomes proibidos/inválidos na raiz do projeto (ex: Next.js) que causam shadow de comandos no Windows
    const invalidRootFiles = ["Next.js", "next.js", "Node.js", "node.js", "React.js", "react.js"];
    for (const badFile of invalidRootFiles) {
      const badPath = path.join(targetProjectRoot, badFile);
      if (fs.existsSync(badPath)) {
        try {
          fs.unlinkSync(badPath);
          console.log(`[QUARANTINE_CLEANUP] Removido arquivo residual de shadow no projeto: ${badPath}`);
        } catch {}
      }
    }

    // Trava T2: só promove arquivos da quarentena que estão no files_scope informado. Antes,
    // tudo o que estivesse na quarentena era copiado e o escopo só era usado se ela estivesse
    // vazia — um "// file: outro/caminho.ts" do worker chegava ao projeto sem restrição.
    const allowedScope = new Set(filesScope.map(normalizeScopePath));
    const targetFiles = this.listFilesInQuarantine(workspacePath).filter(
      (f) => allowedScope.size === 0 || allowedScope.has(normalizeScopePath(f))
    );

    // Trava T4: snapshot do estado anterior de cada destino, para desfazer a promoção caso a
    // prova empírica (type-check real) reprove o projeto mesclado (ver rollbackPromotion).
    const snapshot: PromotionSnapshotEntry[] = [];

    for (const fileRel of targetFiles) {
      // Ignora a promoção se o caminho relativo for um nome de arquivo proibido
      if (QuarantineManager.isInvalidFilePath(fileRel)) {
        continue;
      }
      let sourcePath: string;
      let destPath: string;
      try {
        sourcePath = QuarantineManager.resolveContained(workspacePath, fileRel);
        destPath = QuarantineManager.resolveContained(targetProjectRoot, fileRel);
      } catch {
        continue; // path traversal: ignora o arquivo em vez de escrever fora do projeto
      }
      if (fs.existsSync(sourcePath)) {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        snapshot.push({
          destPath,
          previous: fs.existsSync(destPath) ? fs.readFileSync(destPath) : null,
          promoted: fs.readFileSync(sourcePath),
        });
        fs.copyFileSync(sourcePath, destPath);
      }
    }
    this.promotionSnapshots.set(taskId, snapshot);

    // Limpa a quarentena após promoção bem-sucedida
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return true;
  }

  /**
   * Trava T4: desfaz a última promoção da tarefa — restaura o conteúdo anterior de cada
   * arquivo sobrescrito e remove os que não existiam antes. Retorna os destinos restaurados.
   */
  public rollbackPromotion(taskId: string): string[] {
    const snapshot = this.promotionSnapshots.get(taskId) || [];
    for (const entry of snapshot) {
      if (entry.previous === null) {
        if (fs.existsSync(entry.destPath)) fs.unlinkSync(entry.destPath);
      } else {
        fs.writeFileSync(entry.destPath, entry.previous);
      }
    }
    return snapshot.map((e) => e.destPath);
  }

  /** Reaplica a última promoção desfeita por rollbackPromotion (mesmo conteúdo auditado). */
  public reapplyPromotion(taskId: string): void {
    for (const entry of this.promotionSnapshots.get(taskId) || []) {
      fs.mkdirSync(path.dirname(entry.destPath), { recursive: true });
      fs.writeFileSync(entry.destPath, entry.promoted);
    }
  }

  /**
   * Lista recursivamente arquivos dentro da quarentena
   */
  private listFilesInQuarantine(dir: string, baseDir: string = dir): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(this.listFilesInQuarantine(filePath, baseDir));
      } else {
        results.push(path.relative(baseDir, filePath));
      }
    }
    return results;
  }

  /**
   * Limpa a quarentena de uma tarefa rejeitada
   */
  public purgeWorkspace(taskId: string): void {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }
}
