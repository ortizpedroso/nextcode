/**
 * Etapa de base do projeto (M1 — docs/PLANO-ETAPA-0.md, revisão de 06/10): sem IA.
 *
 * Antes do primeiro executor, o projeto-alvo recebe o que é preciso para o código gerado ser
 * COMPILADO de verdade: package.json com as dependências da stack declarada na Spec, tsconfig e
 * `npm install`. Sem isto o portão empírico pulava o type-check e a única verificação era um LLM
 * dando nota (experimento de 06/10: 0 de 3 entregas compilavam; o auditor aprovou uma delas).
 *
 * Depois de cada promoção, `repairEnvironment` corrige o AMBIENTE (nunca o código): instala o
 * pacote ou os tipos que o tsc diz faltar e roda `prisma generate` quando há schema.
 *
 * Instalações usam --ignore-scripts: código gerado por IA pode pedir qualquer pacote, e scripts
 * de instalação são o vetor clássico de ataque de cadeia de suprimentos.
 */
import * as fs from "fs";
import * as path from "path";
import { TerminalExecutionEngine, type CommandResult } from "./terminal-execution-engine";

export interface BaseManifest {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  usesNext: boolean;
  usesPrisma: boolean;
}

/** Instalador injetável (testes não acessam a rede). */
export type Installer = (cwd: string, packages: string[], dev: boolean) => Promise<CommandResult>;

const INSTALL_TIMEOUT_MS = Number(process.env.NEXTCODE_NPM_INSTALL_TIMEOUT_MS) || 600000;

export const npmInstaller: Installer = (cwd, packages, dev) =>
  TerminalExecutionEngine.runCommand(
    `npm install --ignore-scripts --no-audit --no-fund${dev ? " --save-dev" : ""}${packages.length ? " " + packages.join(" ") : ""}`,
    cwd,
    INSTALL_TIMEOUT_MS
  );

/** Nome de pacote npm válido (com escopo opcional) — nada de flags, caminhos ou URLs. */
export function isValidPackageName(name: string): boolean {
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}$/.test(name);
}

/** Dependências a partir da stack da Spec. Só o que o type-check precisa para enxergar os tipos. */
export function buildBaseManifest(stack: string[]): BaseManifest {
  const s = stack.join(" ").toLowerCase();
  const deps: Record<string, string> = {};
  const dev: Record<string, string> = { typescript: "^5", "@types/node": "^22" };
  const usesNext = /next(\.js)?\b/.test(s);
  const usesReact = usesNext || /\breact\b/.test(s);
  const usesPrisma = /prisma/.test(s);

  if (usesNext) deps.next = "^15";
  if (usesReact) {
    deps.react = "^19";
    deps["react-dom"] = "^19";
    dev["@types/react"] = "^19";
    dev["@types/react-dom"] = "^19";
  }
  if (usesPrisma) {
    deps["@prisma/client"] = "^5";
    dev.prisma = "^5";
  }
  if (/\bzod\b/.test(s)) deps.zod = "^3";
  if (!usesPrisma && /postgres/.test(s)) {
    deps.pg = "^8";
    dev["@types/pg"] = "^8";
  }
  return { dependencies: deps, devDependencies: dev, usesNext, usesPrisma };
}

export function buildTsconfig(usesNext: boolean): Record<string, unknown> {
  return {
    compilerOptions: {
      target: "ES2022",
      lib: ["dom", "dom.iterable", "esnext"],
      module: "esnext",
      moduleResolution: "bundler",
      jsx: usesNext ? "preserve" : "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowJs: false,
      paths: { "@/*": ["./src/*"] },
      ...(usesNext ? { plugins: [{ name: "next" }], incremental: true } : {}),
    },
    include: usesNext ? ["next-env.d.ts", "**/*.ts", "**/*.tsx"] : ["**/*.ts", "**/*.tsx"],
    exclude: ["node_modules", ".quarantine"],
  };
}

export interface ProjectBaseResult {
  ok: boolean;
  changedFiles: string[];
  installed: boolean;
  log: string;
}

/**
 * Idempotente: mescla dependências no package.json existente (não remove nada), cria tsconfig
 * só se não existir e roda `npm install` quando algo mudou ou não há node_modules.
 */
export async function ensureProjectBase(
  projectRoot: string,
  stack: string[],
  install: Installer = npmInstaller,
  specFiles: string[] = []
): Promise<ProjectBaseResult> {
  const manifest = buildBaseManifest(stack);
  const changedFiles: string[] = [];
  fs.mkdirSync(projectRoot, { recursive: true });

  const pkgPath = path.join(projectRoot, "package.json");
  let pkg: Record<string, any> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    pkg = { name: path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9_-]/g, "-"), version: "0.1.0", private: true };
  }
  const before = JSON.stringify(pkg);
  pkg.dependencies = { ...manifest.dependencies, ...(pkg.dependencies || {}) };
  pkg.devDependencies = { ...manifest.devDependencies, ...(pkg.devDependencies || {}) };
  pkg.scripts = { typecheck: "tsc --noEmit", ...(pkg.scripts || {}) };
  if (manifest.usesNext) {
    pkg.scripts = { dev: "next dev", build: "next build", start: "next start", ...pkg.scripts };
  }
  if (JSON.stringify(pkg) !== before || !fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    changedFiles.push("package.json");
  }

  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    fs.writeFileSync(tsconfigPath, JSON.stringify(buildTsconfig(manifest.usesNext), null, 2) + "\n", "utf8");
    changedFiles.push("tsconfig.json");
  }
  if (manifest.usesNext && !fs.existsSync(path.join(projectRoot, "next-env.d.ts"))) {
    fs.writeFileSync(
      path.join(projectRoot, "next-env.d.ts"),
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
      "utf8"
    );
    changedFiles.push("next-env.d.ts");
  }

  // App Router: o Next exige um layout raiz para qualquer página. Sem ele o tsc passa, mas o
  // `next build` falha (teste real P2 de 07/10, pego pela verificação de tela em contêiner).
  // É estrutura, não funcionalidade: entra na base (sem IA) se a Spec não declarar o seu.
  if (manifest.usesNext) {
    for (const appDir of appRouterDirsNeedingLayout(specFiles)) {
      const layoutPath = path.join(projectRoot, appDir, "layout.tsx");
      if (!fs.existsSync(layoutPath)) {
        fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
        fs.writeFileSync(layoutPath, ROOT_LAYOUT_TSX, "utf8");
        changedFiles.push(`${appDir}/layout.tsx`);
      }
    }
  }

  const needsInstall = changedFiles.includes("package.json") || !fs.existsSync(path.join(projectRoot, "node_modules"));
  if (!needsInstall) return { ok: true, changedFiles, installed: false, log: "dependências já instaladas" };

  const res = await install(projectRoot, [], false);
  return {
    ok: res.success,
    changedFiles,
    installed: res.success,
    log: res.success ? "npm install concluído" : `npm install falhou: ${(res.stderr || res.stdout).slice(-1500)}`,
  };
}

const ROOT_LAYOUT_TSX = `import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
`;

/** Pastas do App Router (src/app ou app) com páginas na Spec e sem layout raiz declarado. */
export function appRouterDirsNeedingLayout(specFiles: string[]): string[] {
  const out: string[] = [];
  for (const dir of ["src/app", "app"]) {
    const hasPage = specFiles.some((f) => f.startsWith(`${dir}/`) && /\/page\.(tsx|jsx|ts|js)$/.test(f));
    const declaresLayout = specFiles.some((f) => /^layout\.(tsx|jsx|ts|js)$/.test(f.slice(dir.length + 1)) && f.startsWith(`${dir}/`));
    if (hasPage && !declaresLayout) out.push(dir);
  }
  return out;
}

/** Pacotes que o tsc diz faltar: módulo inexistente (TS2307) ou sem tipos (TS7016). */
export function missingPackagesFromTsc(output: string): { packages: string[]; types: string[] } {
  const packages = new Set<string>();
  const types = new Set<string>();
  const root = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
  for (const m of output.matchAll(/error TS2307: Cannot find module '([^']+)'/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("node:")) continue;
    packages.add(root(spec));
  }
  for (const m of output.matchAll(/error TS7016: Could not find a declaration file for module '([^']+)'/g)) {
    const pkg = root(m[1]);
    if (pkg.startsWith(".")) continue;
    types.add(pkg.startsWith("@") ? `@types/${pkg.slice(1).replace("/", "__")}` : `@types/${pkg}`);
  }
  const valid = (list: Set<string>) => [...list].filter(isValidPackageName);
  return { packages: valid(packages), types: valid(types) };
}

/**
 * Corrige o ambiente para o tsc enxergar o que o código usa. Devolve true se mudou algo (vale
 * rodar o tsc de novo). Nunca altera código-fonte.
 */
export async function repairEnvironment(
  projectRoot: string,
  tscOutput: string,
  install: Installer = npmInstaller
): Promise<{ changed: boolean; actions: string[] }> {
  const actions: string[] = [];
  const { packages, types } = missingPackagesFromTsc(tscOutput);
  if (packages.length) {
    const r = await install(projectRoot, packages, false);
    actions.push(`${r.success ? "instalado" : "falha ao instalar"}: ${packages.join(", ")}`);
  }
  if (types.length) {
    const r = await install(projectRoot, types, true);
    actions.push(`${r.success ? "tipos instalados" : "falha ao instalar tipos"}: ${types.join(", ")}`);
  }
  const schema = path.join(projectRoot, "prisma", "schema.prisma");
  if (fs.existsSync(schema) && /@prisma\/client/.test(tscOutput)) {
    const r = await TerminalExecutionEngine.runCommand("npx prisma generate", projectRoot, 180000);
    actions.push(r.success ? "prisma generate" : `prisma generate falhou: ${r.stderr.slice(-300)}`);
  }
  return { changed: actions.length > 0, actions };
}
