/**
 * Quarantine Manager (OpenCode v5)
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
   * Promove as alterações aprovadas da quarentena para o repositório principal do projeto
   */
  public promoteToMainRepo(taskId: string, targetProjectRoot: string, filesScope: string[]): boolean {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    if (!fs.existsSync(workspacePath)) {
      return false;
    }

    for (const fileRel of filesScope) {
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
   * Limpa a quarentena de uma tarefa rejeitada
   */
  public purgeWorkspace(taskId: string): void {
    const workspacePath = path.join(this.baseQuarantineDir, taskId);
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }
}
