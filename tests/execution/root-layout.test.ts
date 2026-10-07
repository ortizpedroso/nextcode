import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { appRouterDirsNeedingLayout, ensureProjectBase } from "@/core/execution/project-base";

describe("Layout raiz do App Router na base do projeto", () => {
  it("página sem layout declarado → precisa; layout declarado ou só API → não", () => {
    expect(appRouterDirsNeedingLayout(["src/app/contatos/page.tsx", "src/app/api/x/route.ts"])).toEqual(["src/app"]);
    expect(appRouterDirsNeedingLayout(["src/app/page.tsx", "src/app/layout.tsx"])).toEqual([]);
    expect(appRouterDirsNeedingLayout(["src/app/api/x/route.ts"])).toEqual([]);
    expect(appRouterDirsNeedingLayout(["app/page.tsx"])).toEqual(["app"]);
  });

  it("a base grava src/app/layout.tsx e não sobrescreve um existente", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "layout-"));
    const noInstall = async () => ({ success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 });
    const res = await ensureProjectBase(root, ["Next.js"], noInstall, ["src/app/contatos/page.tsx"]);
    expect(res.changedFiles).toContain("src/app/layout.tsx");
    const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("<html");
    fs.writeFileSync(path.join(root, "src/app/layout.tsx"), "// meu layout\n");
    await ensureProjectBase(root, ["Next.js"], noInstall, ["src/app/contatos/page.tsx"]);
    expect(fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8")).toBe("// meu layout\n");
  });
});
