import { exec } from "child_process";
import { ContextPruner } from "../headroom/context-pruner";

export interface TerminalExecutionResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  prunedOutput: string;
  error?: string;
}

export class SandboxedTerminalSkill {
  private static BLACKLIST_PATTERNS = [
    /rm\s+-rf\s+[\/\*]/i,
    /mkfs/i,
    /dd\s+if=/i,
    /:()\s*{\s*:\|:&\s*};\s*:/, // Fork bomb
    />\s*\/dev\/sd[a-z]/i,
    /shutdown/i,
    /reboot/i,
  ];

  /**
   * Executa comandos de terminal em ambiente controlado com timeout e filtro de segurança
   */
  public static async execute(
    command: string,
    cwd: string = process.cwd(),
    timeoutMs: number = 30000
  ): Promise<TerminalExecutionResult> {
    // 1. Verificação da lista de bloqueio de segurança (Blacklist)
    for (const pattern of SandboxedTerminalSkill.BLACKLIST_PATTERNS) {
      if (pattern.test(command)) {
        return {
          success: false,
          command,
          stdout: "",
          stderr: "COMANDO BLOQUEADO POR POLÍTICA DE SEGURANÇA (POTENCIALMENTE DESTRUTIVO).",
          exitCode: 1,
          prunedOutput: "Comando destrutivo detectado e bloqueado pela Sandbox do NextCode.",
          error: "Comando bloqueado por segurança.",
        };
      }
    }

    return new Promise((resolve) => {
      exec(command, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        const fullOutput = (stdout + "\n" + stderr).trim();
        const prunedOutput = ContextPruner.prune(fullOutput, {
          maxLines: 80,
          maxChars: 3000,
        });

        if (error) {
          resolve({
            success: false,
            command,
            stdout,
            stderr,
            exitCode: error.code || 1,
            prunedOutput,
            error: error.message,
          });
        } else {
          resolve({
            success: true,
            command,
            stdout,
            stderr,
            exitCode: 0,
            prunedOutput,
          });
        }
      });
    });
  }
}
