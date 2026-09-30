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

    fs.writeFileSync(targetPath, content, "utf-8");
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
      let relativePath = match[1];
      const codeContent = match[2];

      // Tenta encontrar anotações no próprio topo do código como // file: src/..., // src/..., # path: src/...
      if (!relativePath) {
        // 1. Procurar declaração explícita como // file: src/... ou // filepath: src/...
        const explicitHeaderMatch = codeContent.match(/^(?:\/\/|#|\/\*)\s*(?:file|filepath|path):\s*([^\s\n*]+)/i);
        if (explicitHeaderMatch) {
          relativePath = explicitHeaderMatch[1];
        } else {
          // 2. Procurar caminho direto em comentário no topo como // src/..., // server/..., // lib/..., // app/...
          const directPathMatch = codeContent.match(/^(?:\/\/|#|\/\*)\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/i);
          if (directPathMatch) {
            relativePath = directPathMatch[1];
          }
        }
      }

      // 3. Procurar em cabeçalhos markdown imediatamente anteriores ao bloco de código
      if (!relativePath) {
        const textBeforeBlock = text.substring(0, match.index);
        const lastHeadingMatch = textBeforeBlock.match(/(?:###|####|#|\*\*)\s*(?:\[.*\]\s*)?`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?\s*$/m);
        if (lastHeadingMatch) {
          relativePath = lastHeadingMatch[1];
        }
      }

      // 4. Se ainda não identificou o caminho, usa o fallbackFilesScope correspondente ao índice
      if (!relativePath && fallbackFilesScope.length > index) {
        relativePath = fallbackFilesScope[index];
      }

      if (relativePath && codeContent) {
        const cleanPath = relativePath.trim().replace(/^\\|^\//, "");
        this.writeFile(taskId, cleanPath, codeContent);
        codeMap[cleanPath] = codeContent;
      }
      index++;
    }

    // Se nenhum bloco com marcação foi encontrado, mas há código e escopo, salva o primeiro escopo
    if (Object.keys(codeMap).length === 0 && fallbackFilesScope.length > 0 && text.trim()) {
      const primaryScopeFile = fallbackFilesScope[0];
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
