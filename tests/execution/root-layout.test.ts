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

describe("Tailwind CSS v4 na base (projeto com tela)", () => {
  const noInstall = async () => ({ success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 });

  it("com página: dependências, postcss.config.mjs, globals.css e layout importando o CSS", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-"));
    await ensureProjectBase(root, ["Next.js"], noInstall, ["src/app/contatos/page.tsx"]);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies).toMatchObject({ tailwindcss: "^4", "@tailwindcss/postcss": "^4", postcss: "^8" });
    expect(fs.readFileSync(path.join(root, "postcss.config.mjs"), "utf8")).toContain('"@tailwindcss/postcss": {}');
    expect(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")).toBe('@import "tailwindcss";\n');
    expect(fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").startsWith('import "./globals.css";\n')).toBe(true);
  });

  it("só API (sem página) → sem Tailwind", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-"));
    await ensureProjectBase(root, ["Next.js"], noInstall, ["src/app/api/x/route.ts"]);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies.tailwindcss).toBeUndefined();
    expect(fs.existsSync(path.join(root, "postcss.config.mjs"))).toBe(false);
  });
});

describe("Páginas a verificar, a partir da Spec", () => {
  it("rotas do App Router; grupos somem; dinâmicas e API ficam de fora", async () => {
    const { pagesFromSpecFiles } = await import("@/core/execution/ui-check");
    expect(pagesFromSpecFiles([
      "src/app/page.tsx", "src/app/contatos/page.tsx", "src/app/(painel)/relatorios/page.tsx",
      "src/app/contatos/[id]/page.tsx", "src/app/api/contatos/route.ts", "app/sobre/page.jsx",
    ])).toEqual(["/", "/contatos", "/relatorios", "/sobre"]);
  });
});
