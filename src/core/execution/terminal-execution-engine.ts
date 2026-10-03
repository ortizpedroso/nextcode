import { execSync } from "child_process";
import { SandboxedTerminalSkill } from "../skills/sandboxed-terminal";
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

    // Toda execução de comando (incluindo a acionada por tool-calls do agente a
    // partir de saída de LLM, potencialmente influenciada por conteúdo não
    // confiável) passa pela blacklist/jail compartilhada do SandboxedTerminalSkill.
    const result = await SandboxedTerminalSkill.execute(sanitizedCmd, cwd, timeoutMs);
    return {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      executionTimeMs: Date.now() - startTime,
    };
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
   * Verificação empírica real pós-promoção: roda o type-check do TypeScript no projeto já
   * com os arquivos novos mesclados em disco. O Tipo 1 (DualLensAuditor) só analisa cada
   * arquivo isoladamente via regex/parsing estático — não pega problemas que só aparecem na
   * interação entre arquivos (ex.: import quebrado em outro módulo que consome o arquivo
   * novo, assinatura de função incompatível com um chamador existente). Retorna null quando
   * o projeto não tem tsconfig.json (nada para verificar), em vez de forçar um comando que
   * falharia por motivo não relacionado à alteração.
   */
  public static async verifyProjectBuild(
    projectPath: string,
    timeoutMs: number = 60000
  ): Promise<CommandResult | null> {
    if (!projectPath || !fs.existsSync(path.join(projectPath, "tsconfig.json"))) {
      return null;
    }

    // Usa o binário `tsc` do próprio NextCode (via resolução de módulo Node) em vez de
    // `npx tsc`, que tentaria baixar o TypeScript da internet quando o projeto-alvo (ex.: um
    // diretório recém-criado pela IA) ainda não tem node_modules próprio.
    let tscCommand = "npx tsc --noEmit";
    try {
      const tsPackageJsonPath = require.resolve("typescript/package.json");
      const tscBinPath = path.join(path.dirname(tsPackageJsonPath), "bin", "tsc");
      tscCommand = `node "${tscBinPath}" --noEmit`;
    } catch {
      /* fallback para npx se a resolução local falhar */
    }

    return TerminalExecutionEngine.runCommand(tscCommand, projectPath, timeoutMs);
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
