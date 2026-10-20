import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect } from "vitest";
import { countSourceFiles, hasExistingSourceCode } from "@/core/project/source-files";

describe("Mudança 25 (b) — contagem de arquivos-fonte", () => {
  it("ignora config, docs e node_modules; precisa de 5 arquivos-fonte", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-src-"));
    fs.writeFileSync(path.join(d, "package.json"), "{}");
    fs.writeFileSync(path.join(d, "README.md"), "#");
    fs.mkdirSync(path.join(d, "node_modules", "x"), { recursive: true });
    for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(d, "node_modules", "x", `i${i}.js`), "");
    expect(countSourceFiles(d)).toBe(0);
    expect(hasExistingSourceCode(d)).toBe(false);
    fs.mkdirSync(path.join(d, "src"));
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, "src", `a${i}.tsx`), "");
    expect(countSourceFiles(d)).toBe(5);
    expect(hasExistingSourceCode(d)).toBe(true);
    expect(hasExistingSourceCode(null)).toBe(false);
    expect(hasExistingSourceCode(path.join(d, "nao-existe"))).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });
});
