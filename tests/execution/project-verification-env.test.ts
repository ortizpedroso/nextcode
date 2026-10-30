import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  ensureVerificationRuntimeEnv,
  resolveVerificationRuntimeEnv,
  dockerEnvArgsForUiCheckContainer,
  diagnoseUiCheckAmbiente,
  uiCheckFailureGapText,
  readVerificationArtifact,
  VERIFICATION_ARTIFACT,
} from "@/core/execution/project-verification-env";

describe("project-verification-env", () => {
  it("NextCode gera .nextcode/verification.env quando falta NEXTAUTH_SECRET", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-env-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { "next-auth": "^4" } })
    );
    fs.writeFileSync(path.join(dir, ".env.example"), "NEXTAUTH_SECRET=\nDATABASE_URL=\n");
    const ensured = ensureVerificationRuntimeEnv(dir);
    expect(ensured).toContain("NEXTAUTH_SECRET");
    const artifact = readVerificationArtifact(dir);
    expect(artifact.NEXTAUTH_SECRET?.length).toBeGreaterThan(10);
    expect(fs.existsSync(path.join(dir, VERIFICATION_ARTIFACT))).toBe(true);
    const pre = resolveVerificationRuntimeEnv(dir);
    expect(pre.ok).toBe(true);
  });

  it("promove secret de .env.local para o artefato T10", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-local-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { "next-auth": "^4" } }));
    fs.writeFileSync(path.join(dir, ".env.local"), "NEXTAUTH_SECRET=from-local-env\n");
    ensureVerificationRuntimeEnv(dir);
    expect(readVerificationArtifact(dir).NEXTAUTH_SECRET).toBe("from-local-env");
  });

  it("DATABASE_URL do docker-compose entra no artefato", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-compose-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "g" }));
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      "services:\n  app:\n    environment:\n      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/gateway_multiplataforma\n  postgres:\n    image: postgres:16\n"
    );
    ensureVerificationRuntimeEnv(dir);
    expect(readVerificationArtifact(dir).DATABASE_URL).toContain("host.docker.internal");
  });

  it("ui-check reescreve localhost em DATABASE_URL para host.docker.internal", () => {
    const args = dockerEnvArgsForUiCheckContainer({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/gateway_multiplataforma",
      NEXTAUTH_SECRET: "x",
    });
    expect(args.join(" ")).toContain("@host.docker.internal:5432");
  });

  it("NO_SECRET no server.log classifica harness ambiente", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-gap-"));
    fs.writeFileSync(path.join(dir, "server.log"), "[next-auth][error][NO_SECRET]\n");
    expect(diagnoseUiCheckAmbiente({ stage: "browser", outDir: dir }).harnessAmbiente).toBe(true);
    expect(uiCheckFailureGapText({ stage: "browser", outDir: dir })).toMatch(/Ambiente T10:/);
  });
});
