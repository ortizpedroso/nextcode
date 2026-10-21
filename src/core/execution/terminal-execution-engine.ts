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

/**
 * Mudança 33: caminho do `tsc` do próprio NextCode. Dentro do `next dev` o `require.resolve` devolve
 * um caminho do empacotador (`(instrument)\node_modules\...`) que não existe em disco — o portão
 * empírico rodava um `tsc` inexistente. Só aceita caminho real; senão tenta `<cwd>/node_modules`.
 */
export function resolveTscBin(
  resolve?: (id: string) => string,
  cwd: string = process.cwd()
): string | null {
  const candidates: string[] = [];
  try {
    // `require` não existe quando o módulo roda como ESM (tsx): o ReferenceError cai no catch.
    const doResolve = resolve ?? require.resolve;
    candidates.push(path.join(path.dirname(doResolve("typescript/package.json")), "bin", "tsc"));
  } catch {
    /* segue para o node_modules do cwd */
  }
  candidates.push(path.join(cwd, "node_modules", "typescript", "bin", "tsc"));
  return candidates.find((c) => fs.existsSync(c)) ?? null;
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
    const tscBinPath = resolveTscBin();
    const tscCommand = tscBinPath ? `node "${tscBinPath}" --noEmit` : "npx tsc --noEmit";

    return TerminalExecutionEngine.runCommand(tscCommand, projectPath, timeoutMs);
  }

  /**
   * ESLint real nos arquivos promovidos, com o ESLint e a configuração do PRÓPRIO projeto.
   * Retorna os erros (severity 2) como chaves sem linha/coluna (`[ESLINT] arquivo: regra — msg`),
   * para comparar antes vs. depois no portão empírico. Retorna null (verificação não se
   * aplica) quando o projeto não tem ESLint instalado, não há arquivo JS/TS para analisar, a
   * saída não é JSON (config quebrada) ou quando a própria promoção traz um arquivo de
   * configuração do ESLint — config é JavaScript executável, e rodá-la executaria código
   * gerado pela IA fora de sandbox.
   */
  public static async verifyProjectLint(
    projectPath: string,
    relativeFiles: string[],
    timeoutMs: number = 60000
  ): Promise<{ result: CommandResult; errors: string[] } | null> {
    if (!projectPath) return null;
    const eslintBin = path.join(projectPath, "node_modules", "eslint", "bin", "eslint.js");
    if (!fs.existsSync(eslintBin)) return null;

    const normalized = relativeFiles.map((f) => f.replace(/\\/g, "/"));
    if (normalized.some((f) => /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[cm]?js)?)$/i.test(f))) {
      console.warn("[EMPIRICAL_GATE] ESLint ignorado: a promoção altera a configuração do ESLint (código executável).");
      return null;
    }
    const lintable = normalized.filter(
      (f) => /\.(?:[cm]?[jt]sx?)$/i.test(f) && fs.existsSync(path.join(projectPath, f))
    );
    if (lintable.length === 0) return null;

    const quoted = lintable.map((f) => `"${f.replace(/"/g, "")}"`).join(" ");
    const result = await TerminalExecutionEngine.runCommand(
      `node "${eslintBin}" --format json ${quoted}`,
      projectPath,
      timeoutMs
    );

    let report: Array<{ filePath: string; messages: Array<{ ruleId: string | null; severity: number; message: string }> }>;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      console.warn("[EMPIRICAL_GATE] ESLint não produziu JSON válido (config do projeto quebrada?) — etapa ignorada.");
      return null;
    }

    const errors: string[] = [];
    for (const fileReport of report) {
      const rel = path.relative(projectPath, fileReport.filePath).replace(/\\/g, "/");
      for (const msg of fileReport.messages || []) {
        if (msg.severity !== 2) continue;
        errors.push(`[ESLINT] ${rel}: ${msg.ruleId || "parse-error"} — ${msg.message}`);
      }
    }
    return { result, errors: Array.from(new Set(errors)) };
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
