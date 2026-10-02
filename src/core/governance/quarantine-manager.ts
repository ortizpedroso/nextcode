/**
 * Quarantine Manager (NextCode v5)
 * Gerencia a criação, isolamento e movimentação de arquivos na Quarentena de Staging.
 * Garante que o Agente Executor só escreva em ambientes protegidos e isolados antes da auditoria cega.
 */

import * as fs from "fs";
import * as path from "path";

export class QuarantineManager {
  private baseQuarantineDir: string;

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
   * Grava um arquivo dentro do escopo de quarentena da tarefa
   */
  public writeFile(taskId: string, relativeFilePath: string, content: string): string {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    const targetPath = path.join(workspacePath, relativeFilePath);
    
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let finalContent = content;
    // Sanitização determinística para arquivos JSON (remove comentários no topo como // file: ...)
    if (relativeFilePath.toLowerCase().endsWith(".json")) {
      finalContent = finalContent
        .replace(/^(?:\/\/|#|\/\*)\s*(?:file|filepath|path)?.*$/gm, "")
        .trim();
    }

    fs.writeFileSync(targetPath, finalContent, "utf-8");
    return targetPath;
  }

  /**
   * Lê um arquivo gravado no workspace da quarentena
   */
  public readFile(taskId: string, relativeFilePath: string): string | null {
    const targetPath = path.join(this.baseQuarantineDir, taskId, relativeFilePath);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.readFileSync(targetPath, "utf-8");
  }

  /**
   * Extrai blocos de código formatados em markdown e grava na quarentena
   */
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
   * Extrai blocos de código formatados em markdown e grava na quarentena
   */
  public extractAndWriteCodeBlocks(
    taskId: string,
    text: string,
    fallbackFilesScope: string[] = []
  ): Record<string, string> {
    const codeMap: Record<string, string> = {};
    const workspacePath = this.prepareWorkspace(taskId);

    // Regex para encontrar blocos de código ```lang ... ```
    const codeBlockRegex = /```(?:[a-zA-Z0-9_-]+)?(?:\s+(?:file|path|filepath)="?([^"\n\s]+)"?)?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      let relativePath: string | undefined = match[1];
      const codeContent = match[2];

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

      // 3. Procurar menções a caminhos de arquivos no texto imediatamente anterior ao bloco (pega o último caminho válido antes do bloco)
      if (!relativePath) {
        const textBeforeBlock = text.substring(0, match.index);
        const allPathsMatch = textBeforeBlock.match(/([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+)/gi);
        if (allPathsMatch) {
          const validPaths = allPathsMatch.filter((p) => !QuarantineManager.isInvalidFilePath(p));
          if (validPaths.length > 0) {
            relativePath = validPaths[validPaths.length - 1];
          }
        }
      }

      // 4. Procurar em cabeçalhos markdown imediatamente anteriores ao bloco de código
      if (!relativePath) {
        const textBeforeBlock = text.substring(0, match.index);
        const lastHeadingMatch = textBeforeBlock.match(/(?:###|####|#|\*\*)\s*(?:\[.*\]\s*)?`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?\s*$/m);
        if (lastHeadingMatch && !QuarantineManager.isInvalidFilePath(lastHeadingMatch[1])) {
          relativePath = lastHeadingMatch[1];
        }
      }

      // 5. Se ainda não identificou o caminho, usa o fallbackFilesScope correspondente ao índice ou primário
      if (!relativePath) {
        const validFallback = fallbackFilesScope.find(f => !QuarantineManager.isInvalidFilePath(f));
        if (fallbackFilesScope.length > index && !QuarantineManager.isInvalidFilePath(fallbackFilesScope[index])) {
          relativePath = fallbackFilesScope[index];
        } else if (validFallback) {
          relativePath = validFallback;
        } else {
          relativePath = `src/generated-${index + 1}.ts`;
        }
      }

      if (relativePath && codeContent && !QuarantineManager.isInvalidFilePath(relativePath)) {
        const cleanPath = relativePath.trim().replace(/^\\|^\//, "");
        this.writeFile(taskId, cleanPath, codeContent);
        codeMap[cleanPath] = codeContent;
      }
      index++;
    }

    // Se nenhum bloco com marcação foi encontrado, mas há texto, salva no escopo primário válido ou padrão
    if (Object.keys(codeMap).length === 0 && text.trim()) {
      const primaryScopeFile = fallbackFilesScope.find(f => !QuarantineManager.isInvalidFilePath(f)) || "src/output.ts";
      this.writeFile(taskId, primaryScopeFile, text);
      codeMap[primaryScopeFile] = text;
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

    // Garante a cópia de todos os arquivos gerados na quarentena para a pasta do projeto
    const filesInQuarantine = this.listFilesInQuarantine(workspacePath);
    const targetFiles = filesInQuarantine.length > 0 ? filesInQuarantine : filesScope;

    for (const fileRel of targetFiles) {
      const sourcePath = path.join(workspacePath, fileRel);
      if (fs.existsSync(sourcePath)) {
        const destPath = path.join(targetProjectRoot, fileRel);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(sourcePath, destPath);
      }
    }

    // Limpa a quarentena após promoção bem-sucedida
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return true;
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
