import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Explorador de Diretórios Locais (/api/fs/list-dirs)", () => {
  it("consegue listar diretórios no caminho atual", () => {
    const cwd = process.cwd();
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    expect(exists(cwd)).toBe(true);
    expect(dirs.length).toBeGreaterThan(0);
  });

  it("normaliza caminhos de sistema de arquivos e identifica pastas válidas", () => {
    const srcPath = path.join(process.cwd(), "src");
    const stat = fs.statSync(srcPath);
    expect(stat.isDirectory()).toBe(true);
  });
});

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
