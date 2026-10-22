import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Bancada de testes (mudança 43): roda testes vitest do projeto gerado num contêiner, nunca na máquina.
 * 1ª chamada (com rede) instala as dependências num volume de cache, uma vez por package.json + schema;
 * 2ª chamada (`--network none`, projeto só leitura) roda os testes e devolve o resultado em JSON.
 * Usada pela revisão final para PROVAR um defeito (teste de reprodução que falha) e pelo reparo para
 * conferir que o defeito saiu (o mesmo teste passa). Imagem: `docker/test-bench`.
 */
/** A versão sobe quando o conteúdo de docker/test-bench muda (a imagem nova é construída na 1ª execução). */
export const TEST_BENCH_IMAGE = "nextcode-test-bench:2";
const INSTALL_TIMEOUT_MS = Number(process.env.TEST_BENCH_INSTALL_TIMEOUT_MS) || 15 * 60_000;
const RUN_TIMEOUT_MS = Number(process.env.TEST_BENCH_RUN_TIMEOUT_MS) || 5 * 60_000;
/** Mesma versão do vitest do NextCode (instalada no cache quando o projeto não tem). */
export const TEST_BENCH_VITEST_VERSION = "2.1.9";

export type TestCaseStatus = "passed" | "failed" | "skipped";

export interface TestCaseResult {
  /** Arquivo do teste, relativo ao projeto (testes de reprodução ficam em `.nextcode-repro/`). */
  file: string;
  name: string;
  status: TestCaseStatus;
  /** Mensagem da falha (esperado × recebido, rastro) — cortada. */
  failure?: string;
}

export interface TestFileResult {
  file: string;
  /** "failed" com `loadError` = o arquivo nem carregou (import errado, erro de sintaxe). */
  status: "passed" | "failed";
  loadError?: string;
}

export interface TestBenchReport {
  ok: boolean;
  /** Onde parou: docker, image, install, run, parse, skipped. */
  stage: string;
  error?: string;
  files: TestFileResult[];
  cases: TestCaseResult[];
  durationMs: number;
  skipped?: boolean;
}

export interface TestBenchRequest {
  /** Testes de reprodução: caminho relativo dentro de `.nextcode-repro/` → conteúdo. */
  reproTests?: Record<string, string>;
  /** Arquivos a rodar (relativos ao projeto). Vazio = só os de reprodução, se houver; senão todos. */
  files?: string[];
}

export type TestBenchRunner = (projectPath: string, req: TestBenchRequest) => Promise<TestBenchReport>;

const cut = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Lê o JSON do reporter do vitest (formato compatível com o do Jest). */
export function parseVitestJson(raw: string, root = "/tmp/app"): Pick<TestBenchReport, "files" | "cases"> {
  const data = JSON.parse(raw) as {
    testResults?: Array<{
      name?: string;
      status?: string;
      message?: string;
      assertionResults?: Array<{ fullName?: string; title?: string; status?: string; failureMessages?: string[] }>;
    }>;
  };
  const rel = (p: string) => p.replace(/\\/g, "/").replace(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`), "");
  const files: TestFileResult[] = [];
  const cases: TestCaseResult[] = [];
  for (const tr of data.testResults ?? []) {
    const file = rel(tr.name ?? "");
    const assertions = tr.assertionResults ?? [];
    const loadError = tr.status === "failed" && assertions.length === 0 ? cut(tr.message || "falha ao carregar o arquivo") : undefined;
    files.push({ file, status: tr.status === "passed" ? "passed" : "failed", ...(loadError ? { loadError } : {}) });
    for (const a of assertions) {
      const status: TestCaseStatus = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped";
      cases.push({
        file,
        name: a.fullName || a.title || "(sem nome)",
        status,
        ...(status === "failed" ? { failure: cut((a.failureMessages ?? []).join("\n").replace(/\u001b\[[0-9;]*m/g, "")) } : {}),
      });
    }
  }
  return { files, cases };
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

async function ensureImage(): Promise<string | null> {
  const inspect = await run("docker", ["image", "inspect", TEST_BENCH_IMAGE], 30_000);
  if (inspect.code === 0) return null;
  const ctx = path.join(process.cwd(), "docker", "test-bench");
  if (!fs.existsSync(path.join(ctx, "Dockerfile"))) return `receita da imagem ausente em ${ctx}`;
  const build = await run("docker", ["build", "-t", TEST_BENCH_IMAGE, ctx], 15 * 60_000);
  return build.code === 0 ? null : `docker build falhou: ${build.out.slice(-600)}`;
}

/** Carimbo do cache: muda quando muda o package.json ou o schema do Prisma. */
export function depsStamp(projectPath: string): string {
  const h = crypto.createHash("sha256");
  for (const f of ["package.json", "package-lock.json", path.join("prisma", "schema.prisma")]) {
    const p = path.join(projectPath, f);
    if (fs.existsSync(p)) h.update(f).update(fs.readFileSync(p));
  }
  return h.update(TEST_BENCH_VITEST_VERSION).digest("hex").slice(0, 16);
}

const SANDBOX = ["--memory=3g", "--cpus=2", "--pids-limit=512", "--cap-drop=ALL", "--security-opt=no-new-privileges"];

const readJson = <T>(p: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
};

export const dockerTestBenchRunner: TestBenchRunner = async (projectPath, req) => {
  const t0 = Date.now();
  const empty = (stage: string, error: string): TestBenchReport => ({ ok: false, stage, error, files: [], cases: [], durationMs: Date.now() - t0 });
  const version = await run("docker", ["version", "--format", "{{.Server.Version}}"], 20_000);
  if (version.code !== 0) return empty("docker", "Docker não está rodando — os testes não puderam rodar.");
  const imageError = await ensureImage();
  if (imageError) return empty("image", imageError);

  const root = path.resolve(projectPath);
  // Mudança 44: a pasta de trabalho (testes de reprodução e de aceite — inclusive os ESCONDIDOS) fica fora do
  // projeto: dentro dele o executor poderia ler os escondidos com read_file, e o repositório ficava sujo.
  const base = path.join(os.tmpdir(), "nextcode-test-bench", crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12));
  const outDir = path.join(base, "out");
  const reproDir = path.join(base, "repro");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(reproDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(reproDir, { recursive: true });
  for (const [rel, content] of Object.entries(req.reproTests ?? {})) {
    const clean = rel.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
    if (clean.includes("..")) continue;
    fs.mkdirSync(path.dirname(path.join(reproDir, clean)), { recursive: true });
    fs.writeFileSync(path.join(reproDir, clean), content, "utf8");
  }
  const volume = `nextcode-tb-${crypto.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12)}`;

  const install = await run(
    "docker",
    ["run", "--rm", ...SANDBOX, "-v", `${root}:/project:ro`, "-v", `${volume}:/deps`, "-v", `${outDir}:/out`,
      "-e", `TB_STAMP=${depsStamp(root)}`, "-e", `TB_VITEST_VERSION=${TEST_BENCH_VITEST_VERSION}`,
      TEST_BENCH_IMAGE, "/opt/test-bench/install.sh"],
    INSTALL_TIMEOUT_MS
  );
  const inst = readJson<{ ok: boolean; error?: string }>(path.join(outDir, "install.json"));
  if (!inst?.ok) return empty("install", inst?.error || `instalação sem resultado (código ${install.code}): ${install.out.slice(-400)}`);

  const files = req.files && req.files.length > 0
    ? req.files
    : Object.keys(req.reproTests ?? {}).map((f) => `.nextcode-repro/${f.replace(/\\/g, "/")}`);
  const res = await run(
    "docker",
    ["run", "--rm", "--network", "none", ...SANDBOX, "-v", `${root}:/project:ro`, "-v", `${volume}:/deps:ro`,
      "-v", `${reproDir}:/repro:ro`, "-v", `${outDir}:/out`, "-e", `TB_FILES=${JSON.stringify(files)}`, "-e", "NODE_ENV=test",
      TEST_BENCH_IMAGE, "/opt/test-bench/run.sh"],
    RUN_TIMEOUT_MS
  );
  const runJson = readJson<{ ok: boolean; error?: string }>(path.join(outDir, "run.json"));
  if (!runJson?.ok) return empty("run", runJson?.error || `execução sem resultado (código ${res.code}): ${res.out.slice(-400)}`);
  try {
    const parsed = parseVitestJson(fs.readFileSync(path.join(outDir, "vitest.json"), "utf8"));
    return { ok: true, stage: "run", ...parsed, durationMs: Date.now() - t0 };
  } catch (err) {
    return empty("parse", `resultado do vitest ilegível: ${String(err).slice(0, 200)}`);
  }
};

// Nos testes automáticos não sobe contêiner: quem testa a bancada injeta o próprio executor.
const skippedRunner: TestBenchRunner = async () => ({ ok: false, stage: "skipped", skipped: true, files: [], cases: [], durationMs: 0 });
let runner: TestBenchRunner | null = null;

export function setTestBenchRunnerForTests(r: TestBenchRunner | null): void {
  runner = r;
}

export function runTestBench(projectPath: string, req: TestBenchRequest): Promise<TestBenchReport> {
  const r = runner ?? (process.env.VITEST ? skippedRunner : dockerTestBenchRunner);
  return r(projectPath, req);
}
