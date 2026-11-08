import { describe, expect, it } from "vitest";
import { projectPathsEqual } from "@/core/intake/project-audit-path-policy";
import * as path from "path";

describe("project-audit-path-policy", () => {
  it("projectPathsEqual trata o mesmo caminho resolvido como equivalente", () => {
    const base = path.resolve(process.cwd(), "fixtures", "app-a");
    const again = path.resolve(process.cwd(), "fixtures", "app-a");
    expect(projectPathsEqual(base, again)).toBe(true);
  });

  it("projectPathsEqual distingue pastas diferentes", () => {
    const a = path.resolve("C:", "projetos", "a");
    const b = path.resolve("C:", "projetos", "b");
    expect(projectPathsEqual(a, b)).toBe(false);
  });
});
