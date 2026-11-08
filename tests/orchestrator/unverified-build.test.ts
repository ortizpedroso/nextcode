import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { TaskNode } from "@prisma/client";
import { describeUnverifiedBuild } from "@/core/orchestrator/node-executor";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-unverified-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const task = (filesScope: string[]) => ({ filesScope: JSON.stringify(filesScope) }) as TaskNode;

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("Aviso de código não verificado na mensagem de conclusão", () => {
  it("projeto como o da sessão gateway (package.json sem dependências, sem tsconfig) → aviso explícito", () => {
    const dir = project({ "package.json": JSON.stringify({ name: "gateway", scripts: { test: "vitest run" } }) });
    const block = describeUnverifiedBuild([task(["src/app/api/v1/charges/route.ts"])], dir);
    expect(block).toContain("NÃO compilado");
    expect(block).toContain("`tsconfig.json`");
    expect(block).toContain("`package.json` com dependências");
  });

  it("projeto com tsconfig e dependências → sem aviso", () => {
    const dir = project({
      "tsconfig.json": "{}",
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    });
    expect(describeUnverifiedBuild([task(["src/a.ts"])], dir)).toBe("");
  });

  it("nenhum arquivo TypeScript no escopo → sem aviso", () => {
    const dir = project({});
    expect(describeUnverifiedBuild([task(["docs/a.md"])], dir)).toBe("");
  });
});
