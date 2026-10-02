import { describe, it, expect } from "vitest";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { EnvironmentWorkspaceAdapter } from "@/core/execution/environment-adapter";
import * as path from "path";
import * as fs from "fs";

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
});
