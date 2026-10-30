/**
 * Verificação de tela na entrega (T10, decisão do fundador 07/10): projeto com páginas do App Router
 * só vira ENTREGUE se `next build` passar e cada página abrir sem erro no celular e no desktop.
 * Roda o contêiner docker/ui-check (Playwright 1.63): o código gerado só executa lá dentro, com o
 * projeto montado somente leitura e sem privilégios. Prints e relatório ficam em
 * <projeto>/.nextcode/ui-check/.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  dockerEnvArgsForUiCheckContainer,
  uiCheckFailureGapText,
  uiCheckHarnessAmbienteFailure,
  resolveVerificationRuntimeEnv,
  ensureT10PostgresIfNeeded,
} from "@/core/execution/project-verification-env";

export const UI_CHECK_IMAGE = "nextcode-ui-check:1.63.6";
const UI_CHECK_TIMEOUT_MS = Number(process.env.UI_CHECK_TIMEOUT_MS) || 15 * 60_000;

export { isUiCheckEnvironmentGap, uiCheckFailureGapText as uiCheckFailureGap } from "@/core/execution/project-verification-env";
export { uiCheckHarnessAmbienteFailure };

export interface UiCheckReport {
  ok: boolean;
  /** Em que ponto parou: docker, copy, install, build, start, browser. */
  stage: string;
  error?: string;
  problems?: string[];
  results?: { route: string; viewport: string; status: number | null; screenshot: string | null }[];
  /** Pasta com prints e logs. */
  outDir?: string;
  skipped?: boolean;
  /** Erros do `next build` com arquivo e linha (para o reparo J2b achar a etapa dona). */
  buildErrors?: NextBuildError[];
}

export interface NextBuildError {
  arquivo: string;
  linha: number;
  mensagem: string;
}

/**
 * Lê os erros do `next build` no run.log: "./src/app/admin/page.tsx:197:50" seguido de
 * "Type error: …" (ou "Error: …"). Gateway real 22/10: o tsc passou com o client do Prisma velho
 * e só o build da tela pegou o erro — sem arquivo, o reparo não achava dona e a sessão bloqueava.
 */
export function parseNextBuildErrors(log: string): NextBuildError[] {
  const out: NextBuildError[] = [];
  const clean = log.replace(/\u001b\[[0-9;]*m/g, "");
  const re = /^\.?\/?((?:src|app|pages|lib|components|prisma)\/[^\s:]+):(\d+):\d+\s*\r?\n\s*((?:Type error|Error):[^\r\n]+)/gm;
  for (const m of clean.matchAll(re)) {
    out.push({ arquivo: m[1], linha: Number(m[2]), mensagem: m[3].trim().slice(0, 400) });
  }
  const routeRe = /^((?:src|app)\/[^\r\n]+)\r?\nType error: ([^\r\n]+)/gm;
  for (const m of clean.matchAll(routeRe)) {
    const arquivo = m[1].replace(/^\.\//, "");
    if (!out.some((e) => e.arquivo === arquivo)) {
      out.push({ arquivo, linha: 1, mensagem: m[2].trim().slice(0, 400) });
    }
  }
  if (out.length > 0) return out;

  // Webpack "Failed to compile" + import trace (ex.: Prisma client ausente no Linux após install sem generate).
  const traceBlock = /Import trace for requested module:\s*\r?\n((?:\s*\.\/[^\r\n]+\r?\n)+)/i.exec(clean);
  if (traceBlock) {
    const paths = [...traceBlock[1].matchAll(/^\s*(\.\/(?:src|app|lib|components|prisma)\/[^\r\n]+)/gm)].map((m) =>
      m[1].replace(/^\.\//, "")
    );
    const arquivo = paths.at(-1);
    const msgMatch = /((?:Module not found|Can't resolve)[^\r\n]+)/i.exec(clean);
    if (arquivo) {
      out.push({
        arquivo,
        linha: 1,
        mensagem: (msgMatch?.[1] ?? "next build falhou (webpack)").trim().slice(0, 400),
      });
    }
  }
  return out;
}

export type UiCheckRunner = (projectPath: string, pages: string[]) => Promise<UiCheckReport>;

/**
 * Rotas a abrir, a partir dos arquivos da Spec: src/app/x/page.tsx → /x. Grupos "(grupo)" somem;
 * páginas com segmento dinâmico ([id]) ficam de fora (precisariam de um id real).
 */
export function pagesFromSpecFiles(files: string[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const m = f.match(/^(?:src\/)?app\/(.*?)\/?page\.(tsx|jsx|ts|js)$/);
    if (!m) continue;
    const segments = m[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s));
    if (segments.some((s) => s.startsWith("["))) continue;
    out.add("/" + segments.join("/"));
  }
  return [...out];
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, out: out + String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Constrói a imagem na primeira vez (a receita está no repositório: docker/ui-check). */
async function ensureImage(): Promise<string | null> {
  const inspect = await run("docker", ["image", "inspect", UI_CHECK_IMAGE], 30_000);
  if (inspect.code === 0) return null;
  const ctx = path.join(process.cwd(), "docker", "ui-check");
  if (!fs.existsSync(path.join(ctx, "Dockerfile"))) return `receita da imagem ausente em ${ctx}`;
  const build = await run("docker", ["build", "-t", UI_CHECK_IMAGE, ctx], 15 * 60_000);
  return build.code === 0 ? null : `docker build falhou: ${build.out.slice(-600)}`;
}

export const dockerUiCheckRunner: UiCheckRunner = async (projectPath, pages) => {
  const preflight = resolveVerificationRuntimeEnv(projectPath);
  if (!preflight.ok) {
    return { ok: false, stage: "preflight", error: preflight.message };
  }
  const pgErr = await ensureT10PostgresIfNeeded(projectPath, preflight.env);
  if (pgErr) {
    return { ok: false, stage: "preflight", error: pgErr };
  }
  const version = await run("docker", ["version", "--format", "{{.Server.Version}}"], 20_000);
  if (version.code !== 0) {
    return { ok: false, stage: "docker", error: "Docker não está rodando — a tela não pôde ser verificada." };
  }
  const imageError = await ensureImage();
  if (imageError) return { ok: false, stage: "docker", error: imageError };

  const outDir = path.join(projectPath, ".nextcode", "ui-check");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const res = await run(
    "docker",
    [
      "run", "--rm",
      "--memory=3g", "--cpus=2", "--pids-limit=512",
      "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "-v", `${path.resolve(projectPath)}:/project:ro`,
      "-v", `${outDir}:/out`,
      "-e", `UI_CHECK_PAGES=${JSON.stringify(pages)}`,
      ...dockerEnvArgsForUiCheckContainer(preflight.env),
      UI_CHECK_IMAGE,
    ],
    UI_CHECK_TIMEOUT_MS
  );
  try {
    const report = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")) as UiCheckReport;
    if (report.stage === "build" && !report.ok) {
      const log = fs.existsSync(path.join(outDir, "run.log")) ? fs.readFileSync(path.join(outDir, "run.log"), "utf8") : "";
      const buildErrors = parseNextBuildErrors(log);
      if (buildErrors.length > 0) return { ...report, outDir, buildErrors };
    }
    return { ...report, outDir };
  } catch {
    return {
      ok: false,
      stage: "docker",
      error: `o contêiner terminou sem relatório (código ${res.code}): ${res.out.slice(-600)}`,
      outDir,
    };
  }
};

// Nos testes automáticos não sobe contêiner: quem testa a verificação injeta o próprio executor.
const skippedRunner: UiCheckRunner = async () => ({ ok: true, stage: "skipped", skipped: true });
let runner: UiCheckRunner | null = null;

export function setUiCheckRunnerForTests(r: UiCheckRunner | null): void {
  runner = r;
}

export function runUiCheck(projectPath: string, pages: string[]): Promise<UiCheckReport> {
  const r = runner ?? (process.env.VITEST ? skippedRunner : dockerUiCheckRunner);
  return r(projectPath, pages);
}

/** Texto para o chat quando a verificação de tela reprova. */
export function describeUiCheckFailure(report: UiCheckReport): string {
  const stageLabel: Record<string, string> = {
    docker: "o ambiente de verificação",
    copy: "a cópia do projeto",
    install: "a instalação das dependências",
    build: "o build do site (next build)",
    start: "a subida do servidor",
    browser: "a abertura das páginas no navegador",
  };
  const lines = [
    `🖥️ **A verificação de tela reprovou** em ${stageLabel[report.stage] ?? report.stage}. O projeto **não** foi marcado como entregue.`,
  ];
  if (report.error) lines.push(`- ${report.error}`);
  for (const p of (report.problems ?? []).slice(0, 10)) lines.push(`- ${p}`);
  if (report.outDir) lines.push("", `Prints e logs: \`${report.outDir}\``);
  return lines.join("\n");
}
