import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/projects/route";
import { checkFolderSafeToDelete, checkFolderSafeToOpen } from "@/core/project/folder-safety";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

const dirs: string[] = [];
const projectIds: string[] = [];
afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  projectIds.length = 0;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-safety-"));
  dirs.push(d);
  return d;
}

describe("P12 (PJ2) — trava de pasta-mãe", () => {
  it("apagar: recusa raiz, pasta do NextCode, pasta de projetos, outro cadastrado e repositório aninhado", () => {
    const root = path.parse(process.cwd()).root;
    expect(checkFolderSafeToDelete(root).ok).toBe(false);
    expect(checkFolderSafeToDelete(process.cwd()).motivo).toContain("NextCode");
    expect(checkFolderSafeToDelete(path.dirname(process.cwd())).ok).toBe(false);
    const d = tmp();
    // Item 7: sem marcador .nextcode, recusa exclusão
    expect(checkFolderSafeToDelete(d).ok).toBe(false);
    expect(checkFolderSafeToDelete(d).motivo).toContain(".nextcode");
    // Com o marcador .nextcode, permite exclusão
    fs.writeFileSync(path.join(d, ".nextcode"), "");
    expect(checkFolderSafeToDelete(d).ok).toBe(true);
    expect(checkFolderSafeToDelete(d, { otherProjectPaths: [path.join(d, "x")] }).motivo).toContain("outro projeto cadastrado");
    fs.mkdirSync(path.join(d, "a", "b", ".git"), { recursive: true });
    expect(checkFolderSafeToDelete(d).motivo).toContain("repositório");
  });

  it("abrir: monorepo (repositório aninhado) pode; pasta com outro projeto cadastrado não", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "packages", "lib"), { recursive: true });
    fs.writeFileSync(path.join(d, "packages", "lib", "package.json"), "{}");
    expect(checkFolderSafeToOpen(d).ok).toBe(true);
    expect(checkFolderSafeToOpen(d, { otherProjectPaths: [path.join(d, "packages", "lib")] }).ok).toBe(false);
    expect(checkFolderSafeToOpen(d, { otherProjectPaths: [d] }).ok).toBe(true);
    expect(checkFolderSafeToOpen(path.dirname(process.cwd())).ok).toBe(false);
  });

  it("POST /api/projects com a pasta que contém outro projeto cadastrado → 409 e nada criado", async () => {
    const mother = tmp();
    const inner = path.join(mother, "filho");
    fs.mkdirSync(inner);
    const child = await prisma.project.create({ data: { name: "filho", path: inner } });
    projectIds.push(child.id);

    const before = await prisma.project.count();
    const res = await POST(
      new NextRequest("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: path.basename(mother), path: mother }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("contém outro projeto cadastrado");
    expect(await prisma.project.count()).toBe(before);
  });
});
