import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";

function makeProject(): { root: string; qm: QuarantineManager; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-scope-"));
  const root = path.join(base, "project");
  fs.mkdirSync(root, { recursive: true });
  const qm = new QuarantineManager(path.join(base, ".quarantine"));
  return { root, qm, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe("Trava T2 — files_scope estrito", () => {
  it("Tipo 1 reprova arquivo gerado fora do files_scope e files_scope vazio", () => {
    const codeMap = { "src/a.ts": "export const a = 1;", "src/fora.ts": "export const f = 1;" };
    const res = DualLensAuditor.validateType1(codeMap, [], undefined, ["./src/a.ts"]);
    expect(res.passed).toBe(false);
    expect(res.securityViolations.join(" ")).toContain("src/fora.ts");
    expect(res.securityViolations.join(" ")).not.toContain("src/a.ts está fora");

    expect(DualLensAuditor.validateType1({ "src/a.ts": "export const a = 1;" }, [], undefined, []).passed).toBe(false);
  });

  it("promoteToMainRepo só copia arquivos do files_scope", () => {
    const { root, qm, cleanup } = makeProject();
    try {
      qm.extractAndWriteCodeBlocks(
        "T-SCOPE",
        "```typescript\n// file: src/a.ts\nexport const a = 1;\n```\n```typescript\n// file: src/fora.ts\nexport const f = 1;\n```",
        ["src/a.ts"]
      );
      qm.promoteToMainRepo("T-SCOPE", root, ["src/a.ts"]);
      expect(fs.existsSync(path.join(root, "src/a.ts"))).toBe(true);
      expect(fs.existsSync(path.join(root, "src/fora.ts"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("modo estrito: bloco sem '// file:' com escopo de vários arquivos é recusado, não adivinhado", () => {
    const { qm, cleanup } = makeProject();
    try {
      const scope = ["src/components/Button.tsx", "src/hooks/useButton.ts"];
      const codeMap = qm.extractAndWriteCodeBlocks(
        "T-AMBIG",
        "```typescript\n// file: src/components/Button.tsx\nexport const B = 1;\n```\n```typescript\nexport const semCaminho = 2;\n```",
        scope,
        { strictPaths: true }
      );
      expect(Object.keys(codeMap)).toEqual(["src/components/Button.tsx"]);
      expect(qm.extractionIssues.join(" ")).toContain("[AMBIGUOUS FILE PATH]");

      const res = DualLensAuditor.validateType1(codeMap, [], undefined, scope, qm.extractionIssues);
      expect(res.passed).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("modo estrito com escopo de 1 arquivo continua usando esse arquivo como destino", () => {
    const { qm, cleanup } = makeProject();
    try {
      const codeMap = qm.extractAndWriteCodeBlocks("T-ONE", "```typescript\nexport const x = 1;\n```", ["src/x.ts"], {
        strictPaths: true,
      });
      expect(Object.keys(codeMap)).toEqual(["src/x.ts"]);
      expect(qm.extractionIssues).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("dois blocos com o mesmo destino não se sobrescrevem em silêncio (também fora do modo estrito)", () => {
    const { qm, cleanup } = makeProject();
    try {
      const codeMap = qm.extractAndWriteCodeBlocks(
        "T-DUP",
        "Arquivo src/a.ts:\n```typescript\nexport const v1 = 1;\n```\n```typescript\nexport const v2 = 2;\n```",
        []
      );
      expect(codeMap["src/a.ts"]).toContain("v1");
      expect(qm.extractionIssues.join(" ")).toContain("[DUPLICATE FILE PATH]");
      expect(DualLensAuditor.validateType1(codeMap, [], undefined, undefined, qm.extractionIssues).passed).toBe(false);
    } finally {
      cleanup();
    }
  });
});
