import { exec, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface CommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
}

export class TerminalExecutionEngine {
  /**
   * Executa um comando de terminal (PowerShell / Bash) no sistema local com suporte a timeout e captura de logs.
   */
  public static async runCommand(
    command: string,
    cwd: string = process.cwd(),
    timeoutMs: number = 30000
  ): Promise<CommandResult> {
    const startTime = Date.now();

    // Sanitização de comando básico para segurança
    const sanitizedCmd = command.trim();
    if (!sanitizedCmd) {
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Comando vazio ou inválido.",
        executionTimeMs: 0,
      };
    }

    return new Promise((resolve) => {
      exec(
        sanitizedCmd,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          const executionTimeMs = Date.now() - startTime;
          const exitCode = error ? error.code ?? 1 : 0;
          const success = exitCode === 0;

          resolve({
            success,
            exitCode: typeof exitCode === "number" ? exitCode : 1,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            executionTimeMs,
          });
        }
      );
    });
  }

  /**
   * Grava fisicamente um arquivo no disco, criando diretórios pai automaticamente.
   */
  public static writeFile(filePath: string, content: string, cwd: string = process.cwd()): string {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    const parentDir = path.dirname(absolutePath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content, { encoding: "utf8" });
    return absolutePath;
  }

  /**
   * Remove com segurança arquivos ou diretórios (ex: .next, dist ou binários conflitantes).
   */
  public static purgePath(targetPath: string, cwd: string = process.cwd()): boolean {
    const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
    if (!fs.existsSync(absolutePath)) return false;

    try {
      fs.rmSync(absolutePath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Interrompe processos que estejam ocupando uma determinada porta local (ex: 3000).
   */
  public static killProcessOnPort(port: number): boolean {
    try {
      if (process.platform === "win32") {
        const netstatOutput = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
        const lines = netstatOutput.split("\n").filter((l) => l.includes("LISTENING"));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(Number(pid))) {
            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          }
        }
      } else {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      }
      return true;
    } catch {
      return false;
    }
  }
}
