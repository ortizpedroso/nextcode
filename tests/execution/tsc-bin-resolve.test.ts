import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { resolveTscBin } from "@/core/execution/terminal-execution-engine";

// Mudança 33: dentro do `next dev` o require.resolve devolve um caminho do empacotador.
describe("resolveTscBin — tsc do NextCode com caminho real", () => {
  it("resolução '(instrument)' do next dev → usa o node_modules do cwd, que existe", () => {
    const fakeResolve = () => "(instrument)\node_modules\typescript\package.json";
    const bin = resolveTscBin(fakeResolve, process.cwd());
    expect(bin).toBe(path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc"));
    expect(fs.existsSync(bin!)).toBe(true);
  });

  it("resolução normal (tsx/node) → mantém o caminho resolvido", () => {
    const real = require.resolve("typescript/package.json");
    expect(resolveTscBin(() => real, "C:/nao-existe")).toBe(path.join(path.dirname(real), "bin", "tsc"));
  });

  it("nada existe → null (o chamador cai para npx)", () => {
    const fakeResolve = () => {
      throw new Error("not found");
    };
    expect(resolveTscBin(fakeResolve, "C:/nao-existe")).toBeNull();
  });
});
