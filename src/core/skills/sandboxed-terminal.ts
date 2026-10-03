import { exec, execFile } from "child_process";
import { ContextPruner } from "../headroom/context-pruner";
import { TelemetryLogger } from "../telemetry/telemetry-logger";

export interface TerminalExecutionResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  prunedOutput: string;
  error?: string;
}

/**
 * Fase 5 — Jail do terminal sandboxed.
 *
 * Camadas de defesa (defesa em profundidade):
 * 1. Blacklist ampliada de padrões destrutivos/escape (rm -rf, fork bomb,
 *    acesso a /dev, devices cgroup, docker socket, variáveis sensíveis...);
 * 2. Detecção de Docker no HOST => o comando é executado dentro de um
 *    container efêmero endurecido (cap_drop ALL, no-new-privileges,
 *    read-only, pids-limit, network off, tmpfs) em vez de direto no host;
 * 3. Fora do Docker, mantém execução local com timeout duro + maxBuffer,
 *    com aviso explícito de isolamento reduzido (documentado no README).
 */
export class SandboxedTerminalSkill {
  private static BLACKLIST_PATTERNS = [
    /rm\s+-rf\s+[\/\*]/i,
    /mkfs/i,
    /dd\s+if=/i,
    /:\(\)\s*{\s*:\|:&\s*};\s*:/, // Fork bomb
    />\s*\/dev\/sd[a-z]/i,
    /shutdown/i,
    /reboot/i,
    // --- Fase 5: padrões de escape/privilégio ---
    /\/var\/run\/docker\.sock/i,           // controle do daemon Docker
    /docker\s+(exec|run|build|system)/i,   // anel de fuga para outros containers
    /nsenter|unshare|pivot_root|chroot/i,  // manipulação de namespaces
    /mount\s|umount\s/i,                   // montagem de filesystems
    /ptrace|gdb\s+-p|strace\s+-p/i,        // attach em processos alheios
    /\/proc\/sys\/|\/sys\/fs\/cgroup/i,    // tunelagem via procfs/cgroup
    /iptables|nft|ip\s+link\s+set/i,       // reconfiguração de rede do host
    /crontab|systemctl|service\s+\w+\s+(start|stop)/i,
    /\benv\b.*NEXTCODE_MASTER_KEY|\bprintenv\b/i, // exfiltração de segredos
    /curl[^|;&]*\|\s*(ba)?sh|wget[^|;&]*\|\s*(ba)?sh/i, // pipe-to-shell remoto
  ];

  /** Verifica um comando contra a blacklist sem executá-lo. Retorna o motivo do bloqueio, ou null se liberado. */
  public static checkBlacklist(command: string): string | null {
    for (const pattern of SandboxedTerminalSkill.BLACKLIST_PATTERNS) {
      if (pattern.test(command)) {
        return "COMANDO BLOQUEADO POR POLÍTICA DE SEGURANÇA (POTENCIALMENTE DESTRUTIVO OU DE ESCAPE).";
      }
    }
    return null;
  }

  private static isDockerHost(): boolean {
    try {
      return (
        process.env.IS_DOCKER === "true" ||
        require("fs").existsSync("/.dockerenv")
      );
    } catch {
      return false;
    }
  }

  /**
   * Executa comandos de terminal em ambiente controlado com timeout e filtro de segurança
   */
  public static async execute(
    command: string,
    cwd: string = process.cwd(),
    timeoutMs: number = 30000,
    sessionId?: string
  ): Promise<TerminalExecutionResult> {
    const startedAt = Date.now();
    const result = await SandboxedTerminalSkill.executeUnlogged(command, cwd, timeoutMs);
    // Trava T3 (Audit Trail): todo comando executado (ou bloqueado) fica registrado no SQLite.
    TelemetryLogger.log({
      sessionId,
      action: result.error === "Comando bloqueado por segurança." ? "TERMINAL_COMMAND_BLOCKED" : "TERMINAL_COMMAND_EXECUTED",
      details: { command: command.slice(0, 2000), cwd, success: result.success, exitCode: result.exitCode },
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  private static async executeUnlogged(
    command: string,
    cwd: string,
    timeoutMs: number
  ): Promise<TerminalExecutionResult> {
    // 1. Verificação da lista de bloqueio de segurança (Blacklist)
    const blockReason = SandboxedTerminalSkill.checkBlacklist(command);
    if (blockReason) {
      console.warn(`[SANDBOX] Comando bloqueado pela política de segurança: ${command.slice(0, 120)}`);
      return {
        success: false,
        command,
        stdout: "",
        stderr: blockReason,
        exitCode: 1,
        prunedOutput: "Comando destrutivo/escape detectado e bloqueado pela Sandbox do NextCode.",
        error: "Comando bloqueado por segurança.",
      };
    }

    // 2. Dentro do container NextCode: executa num sub-container efêmero endurecido
    //    quando o docker CLI estiver disponível (jail real, Fase 5).
    if (SandboxedTerminalSkill.isDockerHost() && process.env.NEXTCODE_SANDBOX_JAIL !== "off") {
      const jailed = await SandboxedTerminalSkill.runInJail(command, timeoutMs);
      if (jailed) return jailed;
      // docker indisponível -> segue para modo local (com aviso)
    }

    return SandboxedTerminalSkill.runLocal(command, cwd, timeoutMs);
  }

  private static runInJail(command: string, timeoutMs: number): Promise<TerminalExecutionResult | null> {
    const jailCmd = [
      "docker", "run", "--rm", "-i",
      "--network", "none",                 // sem rede: nem metadados, nem exfiltração
      "--cap-drop", "ALL",                 // nenhuma capability privilegiada
      "--security-opt", "no-new-privileges",
      "--read-only",                       // rootfs imutável
      "--tmpfs", "/tmp:size=64m",          // quota de disco temporário
      "--pids-limit", "128",               // anti fork-bomb
      "--memory", process.env.NEXTCODE_SANDBOX_MEM || "512m",
      "--cpus", process.env.NEXTCODE_SANDBOX_CPUS || "1",
      "alpine:3.20",
      "/bin/sh", "-c", command,
    ];
    return new Promise((resolve) => {
      execFile(
        jailCmd[0],
        jailCmd.slice(1),
        { timeout: timeoutMs + 5000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && (error as any).code === undefined) {
            // docker CLI ausente/falha de spawn -> sinaliza para usar modo local
            resolve(null);
            return;
          }
          const fullOutput = (stdout + "\n" + stderr).trim();
          const prunedOutput = ContextPruner.prune(fullOutput, { maxLines: 80, maxChars: 3000 });
          resolve({
            success: !error,
            command,
            stdout,
            stderr: stderr || (error ? "" : ""),
            exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            prunedOutput,
            error: error ? `Falha no jail: ${error.message}` : undefined,
          });
        }
      );
    });
  }

  /**
   * No Windows, roda via powershell.exe explícito (-Command) em vez do cmd.exe
   * padrão do child_process.exec — parsing de argumentos mais seguro que o cmd
   * (sem as armadilhas clássicas de aspas/escape do cmd.exe) e saída consistente
   * com o resto da stack (Settings, testes manuais). Em hosts POSIX (ex.: dentro
   * do container do runInJail) continua via /bin/sh padrão do exec.
   */
  private static runLocal(
    command: string,
    cwd: string,
    timeoutMs: number
  ): Promise<TerminalExecutionResult> {
    const options = { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 };

    return new Promise((resolve) => {
      const onDone = (error: { message: string; code?: number | string | null } | null, stdout: string, stderr: string) => {
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
            exitCode: typeof error.code === "number" ? error.code : 1,
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
      };

      if (process.platform === "win32") {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], options, onDone);
      } else {
        exec(command, options, onDone);
      }
    });
  }
}
