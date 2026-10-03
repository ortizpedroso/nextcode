import { describe, it, expect } from "vitest";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { EnvironmentWorkspaceAdapter } from "@/core/execution/environment-adapter";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

describe("TerminalExecutionEngine & EnvironmentWorkspaceAdapter", () => {
  it("deve executar comandos simples no SO via TerminalExecutionEngine", async () => {
    const cmd = process.platform === "win32" ? "echo hello_nextcode" : "echo hello_nextcode";
    const res = await TerminalExecutionEngine.runCommand(cmd);

    expect(res.success).toBe(true);
    expect(res.stdout).toContain("hello_nextcode");
    expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("deve adaptar workspace em MODO LOCAL quando o caminho existe", () => {
    const projectPath = process.cwd();
    const adapter = new EnvironmentWorkspaceAdapter({
      taskId: "test-task-1",
      projectPath,
    });

    expect(adapter.getMode()).toBe("LOCAL");
    expect(adapter.getEffectiveWorkspacePath()).toBe(projectPath);
  });

  it("deve isolar em MODO CLOUD_QUARENTENA quando o caminho é nulo ou modo nuvem", () => {
    const adapter = new EnvironmentWorkspaceAdapter({
      taskId: "test-task-2",
      projectPath: "C:\\caminho_inexistente_fake_12345",
      mode: "CLOUD_QUARANTINE",
    });

    expect(adapter.getMode()).toBe("CLOUD_QUARANTINE");
    expect(adapter.getEffectiveWorkspacePath()).toContain(".quarantine");
  });

  describe("verifyProjectBuild (item 7 — prova empírica real pós-promoção)", () => {
    it("retorna null quando o projeto não tem tsconfig.json (nada para verificar)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-build-verify-"));
      try {
        const result = await TerminalExecutionEngine.verifyProjectBuild(tmpDir);
        expect(result).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 20000);

    it("reporta sucesso quando o type-check real do projeto passa sem erros", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-build-verify-"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true } })
        );
        fs.writeFileSync(path.join(tmpDir, "ok.ts"), "export const ok: number = 1;\n");

        const result = await TerminalExecutionEngine.verifyProjectBuild(tmpDir, 30000);
        expect(result).not.toBeNull();
        expect(result!.success).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 35000);

    it("reporta falha quando o type-check real do projeto encontra um erro de tipo", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-build-verify-"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true } })
        );
        fs.writeFileSync(path.join(tmpDir, "broken.ts"), "const x: number = 'não é um número';\n");

        const result = await TerminalExecutionEngine.verifyProjectBuild(tmpDir, 30000);
        expect(result).not.toBeNull();
        expect(result!.success).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 35000);
  });
});
