import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildBaseManifest,
  ensureProjectBase,
  isValidPackageName,
  missingPackagesFromTsc,
  repairEnvironment,
  type Installer,
} from "@/core/execution/project-base";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-base-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const fakeInstaller = () => {
  const calls: { packages: string[]; dev: boolean }[] = [];
  const install: Installer = async (cwd, packages, dev) => {
    calls.push({ packages, dev });
    fs.mkdirSync(path.join(cwd, "node_modules"), { recursive: true });
    return { success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 };
  };
  return { calls, install };
};

describe("M1 — base do projeto", () => {
  it("dependências a partir da stack da Spec", () => {
    const m = buildBaseManifest(["Next.js", "TypeScript", "Prisma", "Zod"]);
    expect(Object.keys(m.dependencies)).toEqual(expect.arrayContaining(["next", "react", "react-dom", "@prisma/client", "zod"]));
    expect(Object.keys(m.devDependencies)).toEqual(expect.arrayContaining(["typescript", "@types/node", "@types/react", "prisma"]));
    expect(buildBaseManifest(["Node.js", "PostgreSQL"]).dependencies.pg).toBeDefined();
  });

  it("projeto criado pelo NextCode (package.json sem dependências): mescla, cria tsconfig e instala", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "gateway", scripts: { test: "vitest run" } }));
    const { calls, install } = fakeInstaller();
    const res = await ensureProjectBase(dir, ["Next.js", "TypeScript"], install);
    expect(res.ok).toBe(true);
    expect(res.changedFiles).toEqual(expect.arrayContaining(["package.json", "tsconfig.json", "next-env.d.ts"]));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.dependencies.next).toBeDefined();
    const tsconfig = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    expect(calls).toHaveLength(1);
  });

  it("idempotente: segunda execução sem mudança não reinstala nem sobrescreve tsconfig do usuário", async () => {
    const dir = tmp();
    const { calls, install } = fakeInstaller();
    await ensureProjectBase(dir, ["TypeScript"], install);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), '{"meu":"tsconfig"}');
    const res = await ensureProjectBase(dir, ["TypeScript"], install);
    expect(res.changedFiles).toEqual([]);
    expect(res.installed).toBe(false);
    expect(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8")).toBe('{"meu":"tsconfig"}');
    expect(calls).toHaveLength(1);
  });

  it("falha do npm vira resultado com o log, sem exceção", async () => {
    const dir = tmp();
    const res = await ensureProjectBase(dir, ["TypeScript"], async () => ({
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "npm ERR! network",
      executionTimeMs: 1,
    }));
    expect(res.ok).toBe(false);
    expect(res.log).toContain("network");
  });
});

describe("M1 — correção do ambiente a partir do tsc (nunca do código)", () => {
  // Saídas reais do experimento de 06/10.
  const tsc = [
    "src/lib/database.ts(1,22): error TS7016: Could not find a declaration file for module 'pg'.",
    "src/lib/asaas.ts(1,19): error TS2307: Cannot find module 'axios' or its corresponding type declarations.",
    "src/lib/x.ts(2,1): error TS2307: Cannot find module '@/lib/inexistente' or its corresponding type declarations.",
    "src/lib/y.ts(3,1): error TS2307: Cannot find module './local' or its corresponding type declarations.",
    "src/lib/z.ts(4,1): error TS2307: Cannot find module '@scope/pkg/sub' or its corresponding type declarations.",
  ].join("\n");

  it("instala pacotes e tipos que faltam; ignora caminhos locais e o alias @/", () => {
    expect(missingPackagesFromTsc(tsc)).toEqual({ packages: ["axios", "@scope/pkg"], types: ["@types/pg"] });
  });

  it("nomes inválidos ou perigosos nunca chegam ao npm", () => {
    expect(isValidPackageName("axios")).toBe(true);
    expect(isValidPackageName("@types/pg")).toBe(true);
    for (const bad of ["--global", "../x", "http://evil", "a b", "x;rm -rf /", "UPPER"]) {
      expect(isValidPackageName(bad)).toBe(false);
    }
  });

  it("repairEnvironment chama o instalador separando dependências e tipos", async () => {
    const dir = tmp();
    const { calls, install } = fakeInstaller();
    const res = await repairEnvironment(dir, tsc, install);
    expect(res.changed).toBe(true);
    expect(calls).toEqual([
      { packages: ["axios", "@scope/pkg"], dev: false },
      { packages: ["@types/pg"], dev: true },
    ]);
  });
});
