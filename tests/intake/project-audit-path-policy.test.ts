import { describe, expect, it, afterEach, vi } from "vitest";
import {
  projectPathsEqual,
  assertRegisteredProjectDirectory,
} from "@/core/intake/project-audit-path-policy";
import { POST as auditSpecPost } from "@/app/api/projects/audit-spec/route";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

const tempDirs: string[] = [];
const createdProjectIds: string[] = [];

afterEach(async () => {
  for (const id of createdProjectIds.splice(0)) {
    try {
      await prisma.project.delete({ where: { id } });
    } catch {
      // ignora
    }
  }

  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignora
    }
  }
});

function createTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nc-policy-${name}-`));
  tempDirs.push(dir);
  return dir;
}

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

  it("assertRegisteredProjectDirectory rejeita pasta não cadastrada no Prisma", async () => {
    const unregistered = createTempDir("unregistered");
    const result = await assertRegisteredProjectDirectory(unregistered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Caminho não corresponde a nenhum projeto cadastrado");
    }
  });

  it("assertRegisteredProjectDirectory aceita pasta cadastrada como Project.path", async () => {
    const registeredDir = createTempDir("registered");
    const project = await prisma.project.create({
      data: {
        name: "Projeto Cadastrado Teste",
        path: registeredDir,
      },
    });
    createdProjectIds.push(project.id);

    const result = await assertRegisteredProjectDirectory(registeredDir);
    expect(result.ok).toBe(true);
  });

  it("POST /api/projects/audit-spec devolve 403 para path não cadastrado", async () => {
    const unregisteredDir = createTempDir("unregistered-api");
    fs.writeFileSync(path.join(unregisteredDir, "package.json"), JSON.stringify({ name: "unreg" }));

    const req = new NextRequest("http://localhost:3000/api/projects/audit-spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: unregisteredDir }),
    });

    const res = await auditSpecPost(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Caminho não corresponde a nenhum projeto cadastrado");
  });

  it("POST /api/projects/audit-spec processa com sucesso (200) para projeto cadastrado", async () => {
    const registeredDir = createTempDir("registered-api");
    fs.writeFileSync(
      path.join(registeredDir, "package.json"),
      JSON.stringify({ name: "reg-api-app" })
    );
    fs.writeFileSync(path.join(registeredDir, "index.ts"), "export const x = 1;");

    const project = await prisma.project.create({
      data: {
        name: "Projeto Cadastrado API",
        path: registeredDir,
      },
    });
    createdProjectIds.push(project.id);

    const req = new NextRequest("http://localhost:3000/api/projects/audit-spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });

    const res = await auditSpecPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.mode).toBe("criar");
    expect(json.gravouSpec).toBe(true);
  });
});
