import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { uiCheckFailureGap, uiCheckHarnessAmbienteFailure } from "@/core/execution/ui-check";

describe("ui-check env (reexports T10)", () => {
  it("uiCheckFailureGap detecta NO_SECRET no server.log", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-check-gap-"));
    fs.writeFileSync(path.join(dir, "server.log"), "[next-auth][error][NO_SECRET]\n");
    const gap = uiCheckFailureGap({ ok: false, stage: "browser", outDir: dir });
    expect(gap).toMatch(/Ambiente T10:/);
  });

  it("preflight reprovado é falha de harness", () => {
    expect(
      uiCheckHarnessAmbienteFailure({
        ok: false,
        stage: "preflight",
        error: "falta NEXTAUTH_SECRET",
      })
    ).toBe(true);
  });
});
