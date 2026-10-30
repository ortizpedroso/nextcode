/**
 * Paridade de ambiente na entrega (T10): o harness NextCode garante runtime mínimo para
 * `next start` no ui-check (NextAuth, DATABASE_URL, etc.) em `.nextcode/verification.env`,
 * sem exigir que o fundador crie `.env` manualmente.
 */
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export const VERIFICATION_ARTIFACT = ".nextcode/verification.env";
export const T10_POSTGRES_OVERRIDE = ".nextcode/t10-postgres.override.yml";

/** Variáveis repassadas ao contêiner ui-check. */
export const VERIFICATION_RUNTIME_ENV_KEYS = [
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "DATABASE_URL",
  "NEXTAUTH_URL",
  "APP_URL",
] as const;

export type VerificationEnvPreflight =
  | { ok: true; env: Record<string, string>; ensured?: string[] }
  | { ok: false; missing: string[]; message: string };

export function parseDotEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

function formatDotEnv(lines: Record<string, string>): string {
  const body = Object.entries(lines)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v.includes(" ") ? `"${v}"` : v}`)
    .join("\n");
  return `# Gerado pelo NextCode (T10 — verificação de tela). Não commitar.\n${body}\n`;
}

function readEnvFile(projectPath: string, name: string): Record<string, string> {
  const envFile = path.join(projectPath, name);
  if (!fs.existsSync(envFile)) return {};
  try {
    return parseDotEnvFile(fs.readFileSync(envFile, "utf8"));
  } catch {
    return {};
  }
}

/** Mesma ordem que o Next.js usa em `next start` (NODE_ENV=production). `.env.local` não entra. */
export function readNextStartEnv(projectPath: string): Record<string, string> {
  return {
    ...readEnvFile(projectPath, ".env"),
    ...readEnvFile(projectPath, ".env.production"),
    ...readEnvFile(projectPath, ".env.production.local"),
  };
}

export function readVerificationArtifact(projectPath: string): Record<string, string> {
  return readEnvFile(projectPath, VERIFICATION_ARTIFACT);
}

function packageJsonDeps(projectPath: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

export function requiredRuntimeEnvKeys(projectPath: string): string[] {
  const deps = packageJsonDeps(projectPath);
  const keys: string[] = [];
  if (deps["next-auth"]) keys.push("NEXTAUTH_SECRET");
  return keys;
}

function hasAuthSecret(env: Record<string, string>): boolean {
  return Boolean(env.NEXTAUTH_SECRET?.trim() || env.AUTH_SECRET?.trim());
}

function generateAuthSecret(): string {
  return randomBytes(32).toString("base64");
}

function databaseUrlFromCompose(projectPath: string): string | null {
  const composePath = path.join(projectPath, "docker-compose.yml");
  if (!fs.existsSync(composePath)) return null;
  const content = fs.readFileSync(composePath, "utf8");
  const m = content.match(/DATABASE_URL:\s*['"]?(postgresql:\/\/[^\s'"]+)/i);
  if (!m) return null;
  return m[1].replace("@postgres:", "@host.docker.internal:");
}

function composeDefinesPostgres(projectPath: string): boolean {
  const composePath = path.join(projectPath, "docker-compose.yml");
  if (!fs.existsSync(composePath)) return false;
  return /^\s*postgres:\s*$/m.test(fs.readFileSync(composePath, "utf8"));
}

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, out: out + String(err) });
    });
  });
}

/** Sobe Postgres do docker-compose do projeto (porta 5432 via override do harness) para o ui-check. */
export async function ensureT10PostgresIfNeeded(projectPath: string, env: Record<string, string>): Promise<string | null> {
  if (!env.DATABASE_URL?.includes("postgresql")) return null;
  if (!composeDefinesPostgres(projectPath)) return null;
  const nextDir = path.join(projectPath, ".nextcode");
  fs.mkdirSync(nextDir, { recursive: true });
  const overridePath = path.join(projectPath, T10_POSTGRES_OVERRIDE);
  if (!fs.existsSync(overridePath)) {
    fs.writeFileSync(
      overridePath,
      "# Gerado pelo NextCode T10 — publica Postgres só para verificação de tela.\nservices:\n  postgres:\n    ports:\n      - \"5432:5432\"\n",
      "utf8"
    );
  }
  const res = await runCommand(
    "docker",
    ["compose", "-f", "docker-compose.yml", "-f", T10_POSTGRES_OVERRIDE, "up", "-d", "postgres"],
    projectPath,
    120_000
  );
  if (res.code !== 0) {
    return `Postgres do projeto não subiu para T10 (docker compose): ${res.out.slice(-400)}`;
  }
  return null;
}

/**
 * Preenche lacunas de runtime em `.nextcode/verification.env` (idempotente; não sobrescreve `.env` do fundador).
 */
export function ensureVerificationRuntimeEnv(projectPath: string): string[] {
  const ensured: string[] = [];
  const production = readNextStartEnv(projectPath);
  const artifact = readVerificationArtifact(projectPath);
  const local = readEnvFile(projectPath, ".env.local");
  const example = readEnvFile(projectPath, ".env.example");
  const next: Record<string, string> = { ...artifact };

  if (requiredRuntimeEnvKeys(projectPath).includes("NEXTAUTH_SECRET") && !hasAuthSecret(production) && !hasAuthSecret(next)) {
    const promoted =
      local.NEXTAUTH_SECRET?.trim() ||
      local.AUTH_SECRET?.trim() ||
      example.NEXTAUTH_SECRET?.trim() ||
      example.AUTH_SECRET?.trim();
    const secret = promoted || generateAuthSecret();
    next.NEXTAUTH_SECRET = secret;
    next.AUTH_SECRET = secret;
    ensured.push("NEXTAUTH_SECRET");
  }

  const mergedForDb = { ...next, ...production };
  if (!mergedForDb.DATABASE_URL?.trim()) {
    const fromExample = example.DATABASE_URL?.trim();
    const fromCompose = databaseUrlFromCompose(projectPath);
    const url = fromExample || fromCompose;
    if (url) {
      next.DATABASE_URL = url;
      ensured.push("DATABASE_URL");
    }
  }

  if (!mergedForDb.NEXTAUTH_URL?.trim() && !next.NEXTAUTH_URL?.trim()) {
    next.NEXTAUTH_URL = example.NEXTAUTH_URL?.trim() || "http://127.0.0.1:3000";
    ensured.push("NEXTAUTH_URL");
  }
  if (!mergedForDb.APP_URL?.trim() && !next.APP_URL?.trim() && example.APP_URL?.trim()) {
    next.APP_URL = example.APP_URL.trim();
  }

  const artifactPath = path.join(projectPath, VERIFICATION_ARTIFACT);
  const changed = ensured.length > 0 || Object.keys(next).some((k) => next[k] !== artifact[k]);
  if (changed) {
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, formatDotEnv(next), "utf8");
  }
  return ensured;
}

/** Runtime efetivo T10: `.env` de produção do projeto + artefato `.nextcode/verification.env`. */
export function resolveVerificationRuntimeEnv(projectPath: string): VerificationEnvPreflight {
  const ensured = ensureVerificationRuntimeEnv(projectPath);
  const merged = { ...readVerificationArtifact(projectPath), ...readNextStartEnv(projectPath) };
  const required = requiredRuntimeEnvKeys(projectPath);
  const missing: string[] = [];
  for (const key of required) {
    if (key === "NEXTAUTH_SECRET" && hasAuthSecret(merged)) continue;
    if (merged[key]?.trim()) continue;
    missing.push(key);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message:
        `Paridade T10: o harness não conseguiu provisionar ${missing.join(", ")} ` +
        "(sem `.env.example`/compose utilizável). Ajuste o template do projeto ou abra issue no harness.",
    };
  }
  const env: Record<string, string> = {};
  for (const key of VERIFICATION_RUNTIME_ENV_KEYS) {
    const val = merged[key]?.trim();
    if (val) env[key] = val;
  }
  if (hasAuthSecret(merged) && !env.NEXTAUTH_SECRET && merged.AUTH_SECRET) {
    env.NEXTAUTH_SECRET = merged.AUTH_SECRET.trim();
  }
  return { ok: true, env, ensured };
}

/** @deprecated use resolveVerificationRuntimeEnv */
export function verificationEnvPreflight(projectPath: string): VerificationEnvPreflight {
  return resolveVerificationRuntimeEnv(projectPath);
}

export function dockerEnvArgsFromVerificationEnv(env: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [key, val] of Object.entries(env)) {
    if (!val) continue;
    args.push("-e", `${key}=${val}`);
  }
  return args;
}

export function dockerEnvArgsForUiCheckContainer(env: Record<string, string>): string[] {
  const mapped = { ...env };
  const db = mapped.DATABASE_URL;
  if (db && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(db)) {
    mapped.DATABASE_URL = db.replace(/@(localhost|127\.0\.0\.1)/, "@host.docker.internal");
  }
  return dockerEnvArgsFromVerificationEnv(mapped);
}

export interface UiCheckAmbienteDiagnosis {
  harnessAmbiente: boolean;
  causa: string | null;
}

export function uiCheckFailureGapText(report: { stage: string; outDir?: string; error?: string }): string {
  const base = `Verificação de tela reprovada (${report.stage}).`;
  const dx = diagnoseUiCheckAmbiente(report);
  if (dx.harnessAmbiente && dx.causa) return `${base} Ambiente T10: ${dx.causa}`;
  if (report.stage === "preflight" && report.error) return `${base} Ambiente T10: ${report.error}`;
  return base;
}

export function isUiCheckEnvironmentGap(gap: string): boolean {
  return (
    /^Verificação de tela reprovada \((install|docker|copy|start|preflight)\)/.test(gap) ||
    /Ambiente T10:/i.test(gap)
  );
}

export function diagnoseUiCheckAmbiente(report: {
  stage: string;
  outDir?: string;
  error?: string;
}): UiCheckAmbienteDiagnosis {
  if (report.stage === "preflight") {
    return { harnessAmbiente: true, causa: report.error ?? "preflight de ambiente T10 reprovou" };
  }
  if (["install", "docker", "copy", "start"].includes(report.stage)) {
    let causa = report.error ?? `etapa ${report.stage} do ui-check`;
    const installLogDir = report.outDir;
    if (installLogDir && fs.existsSync(path.join(installLogDir, "run.log"))) {
      const log = fs.readFileSync(path.join(installLogDir, "run.log"), "utf8");
      if (/prisma generate falhou|CLI\.UNKNOWN_COMMAND|No command registered for `generate`/i.test(log)) {
        causa =
          "prisma generate no ui-check (CLI errado ou devDependencies omitidas) — harness NextCode ui-check 1.63.6+.";
      }
    }
    return { harnessAmbiente: true, causa };
  }
  const outDir = report.outDir;
  if (outDir && fs.existsSync(path.join(outDir, "server.log"))) {
    const log = fs.readFileSync(path.join(outDir, "server.log"), "utf8");
    if (/NO_SECRET|\[next-auth\]\[error\]\[NO_SECRET\]/i.test(log)) {
      return {
        harnessAmbiente: true,
        causa: "NEXTAUTH_SECRET não chegou ao `next start` do ui-check — falha do harness T10 (verification.env).",
      };
    }
  }
  return { harnessAmbiente: false, causa: null };
}

export function uiCheckHarnessAmbienteFailure(report: {
  ok: boolean;
  stage: string;
  outDir?: string;
  error?: string;
}): boolean {
  if (report.ok) return false;
  return diagnoseUiCheckAmbiente(report).harnessAmbiente;
}
