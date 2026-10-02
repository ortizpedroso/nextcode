import * as fs from "fs";
import * as path from "path";
import { TerminalExecutionEngine, CommandResult } from "./terminal-execution-engine";

export type ExecutionEnvironmentMode = "LOCAL" | "CLOUD_QUARANTINE";

export interface WorkspaceExecutionOptions {
  mode?: ExecutionEnvironmentMode;
  taskId: string;
  projectPath: string;
}

export interface WorkspaceWriteResult {
  mode: ExecutionEnvironmentMode;
  writtenFiles: string[];
  quarantinePath?: string;
  targetPath: string;
}

export class EnvironmentWorkspaceAdapter {
  private mode: ExecutionEnvironmentMode;
  private projectPath: string;
  private taskId: string;
  private quarantinePath: string;

  constructor(options: WorkspaceExecutionOptions) {
    // Se estiver explicitamente setado MODO NUVEM ou sem caminho local válido, cai no MODO NUVEM / QUARENTENA
    const isCloudEnv = process.env.NEXTCODE_ENV === "cloud" || options.mode === "CLOUD_QUARANTINE";
    const hasValidLocalPath = options.projectPath && fs.existsSync(options.projectPath);

    this.mode = isCloudEnv || !hasValidLocalPath ? "CLOUD_QUARANTINE" : "LOCAL";
    this.projectPath = options.projectPath;
    this.taskId = options.taskId;
    this.quarantinePath = path.join(process.cwd(), ".quarantine", options.taskId);
  }

  public getMode(): ExecutionEnvironmentMode {
    return this.mode;
  }

  public getEffectiveWorkspacePath(): string {
    return this.mode === "LOCAL" ? this.projectPath : this.quarantinePath;
  }

  /**
   * Grava um conjunto de arquivos no workspace efetivo (Local ou Quarentena/Nuvem).
   */
  public writeFilesToWorkspace(filesMap: Record<string, string>): WorkspaceWriteResult {
    const targetDir = this.getEffectiveWorkspacePath();
    const writtenFiles: string[] = [];

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    for (const [relativePath, content] of Object.entries(filesMap)) {
      const targetFilePath = path.join(targetDir, relativePath);
      TerminalExecutionEngine.writeFile(targetFilePath, content);
      writtenFiles.push(relativePath);
    }

    return {
      mode: this.mode,
      writtenFiles,
      targetPath: targetDir,
      quarantinePath: this.mode === "CLOUD_QUARANTINE" ? this.quarantinePath : undefined,
    };
  }

  /**
   * Executa um comando de terminal no workspace efetivo.
   */
  public async runWorkspaceCommand(command: string, timeoutMs: number = 30000): Promise<CommandResult> {
    const workspaceDir = this.getEffectiveWorkspacePath();
    return TerminalExecutionEngine.runCommand(command, workspaceDir, timeoutMs);
  }
}
