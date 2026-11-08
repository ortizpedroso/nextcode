import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { QuarantineManager, resolveRealInside } from "@/core/governance/quarantine-manager";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("caminho real dentro da raiz", () => {
  it("atalho para fora da quarentena não recebe o arquivo", () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-contencao-"));
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-fora-"));
    dirs.push(raiz, fora);
    const qm = new QuarantineManager(raiz);
    const workspace = qm.prepareWorkspace("etapa");
    const link = path.join(workspace, "atalho");
    fs.symlinkSync(fora, link, "junction");
    expect(() => qm.writeFile("etapa", "atalho/segredo.txt", "nao")).toThrow(/fora do escopo/);
    expect(fs.existsSync(path.join(fora, "segredo.txt"))).toBe(false);
  });

  it("arquivo citado fora da raiz do projeto não é lido", () => {
    const projeto = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-projeto-"));
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-fora-"));
    dirs.push(projeto, fora);
    fs.writeFileSync(path.join(fora, "segredo.txt"), "chave");
    fs.symlinkSync(fora, path.join(projeto, "atalho"), "junction");
    expect(() => resolveRealInside(projeto, "atalho/segredo.txt")).toThrow(/fora do escopo/);
    expect(resolveRealInside(projeto, "src/lib/a.ts")).toContain(path.resolve(projeto));
  });
});
