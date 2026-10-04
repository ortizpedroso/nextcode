import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { promoteWithEmpiricalGate } from "@/core/governance/empirical-gate";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";

function makeProject(): { root: string; qm: QuarantineManager; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-gate-"));
  const root = path.join(base, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true } })
  );
  const qm = new QuarantineManager(path.join(base, ".quarantine"));
  return { root, qm, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe("Trava T4 — promoção com prova empírica e rollback", () => {
  it("desfaz a promoção quando o type-check real acusa erro novo", async () => {
    const { root, qm, cleanup } = makeProject();
    try {
      fs.writeFileSync(path.join(root, "a.ts"), "export const a: number = 1;\n");
      qm.extractAndWriteCodeBlocks(
        "T-BREAK",
        "```typescript\n// file: a.ts\nexport const a: number = \"texto\";\n```\n```typescript\n// file: novo.ts\nexport const n = 1;\n```",
        ["a.ts", "novo.ts"]
      );

      const gate = await promoteWithEmpiricalGate(qm, "T-BREAK", root, ["a.ts", "novo.ts"]);

      expect(gate.passed).toBe(false);
      expect(gate.rolledBack).toBe(true);
      expect(fs.readFileSync(path.join(root, "a.ts"), "utf-8")).toBe("export const a: number = 1;\n");
      expect(fs.existsSync(path.join(root, "novo.ts"))).toBe(false);
    } finally {
      cleanup();
    }
  }, 90000);

  it("mantém a promoção quando o build já estava quebrado e a mudança não adiciona erros", async () => {
    const { root, qm, cleanup } = makeProject();
    try {
      fs.writeFileSync(path.join(root, "legado.ts"), "export const x: number = \"quebrado\";\n");
      qm.extractAndWriteCodeBlocks("T-OK", "```typescript\n// file: b.ts\nexport const b = 2;\n```", ["b.ts"]);

      const gate = await promoteWithEmpiricalGate(qm, "T-OK", root, ["b.ts"]);

      expect(gate.passed).toBe(true);
      expect(gate.preexistingFailure).toBe(true);
      expect(fs.existsSync(path.join(root, "b.ts"))).toBe(true);
    } finally {
      cleanup();
    }
  }, 90000);

  it("o conteúdo auditado é o mesmo que vai para o disco e nenhum stub é injetado", () => {
    const { root, qm, cleanup } = makeProject();
    try {
      const codeMap = qm.extractAndWriteCodeBlocks(
        "T-STUB",
        "```tsx\n// file: src/app/x/page.tsx\nconst Page = () => null;\n```",
        ["src/app/x/page.tsx"]
      );
      expect(codeMap["src/app/x/page.tsx"]).not.toContain("// file:");
      expect(codeMap["src/app/x/page.tsx"]).not.toContain("Página Gerada");
      // Sem stub, o Tipo 1 reprova a página sem export default.
      expect(DualLensAuditor.validateType1(codeMap).passed).toBe(false);

      qm.promoteToMainRepo("T-STUB", root, ["src/app/x/page.tsx"]);
      expect(fs.readFileSync(path.join(root, "src/app/x/page.tsx"), "utf-8")).toBe(codeMap["src/app/x/page.tsx"]);
    } finally {
      cleanup();
    }
  });
});

/** Projeto sem tsconfig (etapa tsc não se aplica) com um ESLint falso que acusa `debugger`. */
function makeLintProject(): { root: string; qm: QuarantineManager; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-lint-"));
  const root = path.join(base, "project");
  const eslintBin = path.join(root, "node_modules", "eslint", "bin");
  fs.mkdirSync(eslintBin, { recursive: true });
  fs.writeFileSync(
    path.join(eslintBin, "eslint.js"),
    `const fs = require("fs"); const path = require("path");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== "json");
const report = files.map((f) => {
  const abs = path.resolve(process.cwd(), f);
  const src = fs.readFileSync(abs, "utf-8");
  const messages = src.includes("debugger")
    ? [{ ruleId: "no-debugger", severity: 2, message: "Unexpected 'debugger' statement.", line: 1 }]
    : [];
  return { filePath: abs, messages };
});
process.stdout.write(JSON.stringify(report));
process.exit(report.some((r) => r.messages.length) ? 1 : 0);
`
  );
  const qm = new QuarantineManager(path.join(base, ".quarantine"));
  return { root, qm, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe("Trava T5/T4 — ESLint do projeto no portão empírico", () => {
  it("desfaz a promoção quando o ESLint acusa erro novo", async () => {
    const { root, qm, cleanup } = makeLintProject();
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;\n");
      qm.extractAndWriteCodeBlocks("T-LINT", "```typescript\n// file: src/a.ts\nexport const a = 1;\ndebugger;\n```", ["src/a.ts"]);

      const gate = await promoteWithEmpiricalGate(qm, "T-LINT", root, ["src/a.ts"]);

      expect(gate.passed).toBe(false);
      expect(gate.failedStage).toBe("lint");
      expect(gate.rolledBack).toBe(true);
      expect(gate.failureLine).toContain("[ESLINT] src/a.ts: no-debugger");
      expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf-8")).toBe("export const a = 1;\n");
    } finally {
      cleanup();
    }
  }, 60000);

  it("erro de lint que já existia no arquivo não reprova a mudança", async () => {
    const { root, qm, cleanup } = makeLintProject();
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/a.ts"), "debugger;\nexport const a = 1;\n");
      qm.extractAndWriteCodeBlocks("T-LINT-OLD", "```typescript\n// file: src/a.ts\ndebugger;\nexport const a = 2;\n```", ["src/a.ts"]);

      const gate = await promoteWithEmpiricalGate(qm, "T-LINT-OLD", root, ["src/a.ts"]);

      expect(gate.passed).toBe(true);
      expect(gate.preexistingFailure).toBe(true);
      expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf-8")).toContain("export const a = 2;");
    } finally {
      cleanup();
    }
  }, 60000);

  it("não executa o ESLint quando a promoção traz a própria config do ESLint (código executável)", async () => {
    const { root, cleanup } = makeLintProject();
    try {
      fs.writeFileSync(path.join(root, "eslint.config.js"), "module.exports = [];\n");
      fs.writeFileSync(path.join(root, "x.ts"), "debugger;\n");
      expect(await TerminalExecutionEngine.verifyProjectLint(root, ["eslint.config.js", "x.ts"])).toBeNull();
      expect((await TerminalExecutionEngine.verifyProjectLint(root, ["x.ts"]))?.errors.length).toBe(1);
    } finally {
      cleanup();
    }
  }, 60000);

  it("projeto sem ESLint instalado: etapa não se aplica", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-nolint-"));
    try {
      fs.writeFileSync(path.join(base, "x.ts"), "debugger;\n");
      expect(await TerminalExecutionEngine.verifyProjectLint(base, ["x.ts"])).toBeNull();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
