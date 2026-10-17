import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/projects/route";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/projects — POST reabre pasta existente (PJ1.2)", () => {
  let tmpFolder: string;

  beforeEach(() => {
    tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-reopen-test-"));
  });

  afterEach(async () => {
    const ids = (
      await prisma.project.findMany({
        where: { path: tmpFolder },
        select: { id: true },
      })
    ).map((p) => p.id);
    if (ids.length > 0) {
      await prisma.session.deleteMany({ where: { projectId: { in: ids } } });
      await prisma.project.deleteMany({ where: { id: { in: ids } } });
    }
    if (fs.existsSync(tmpFolder)) {
      try {
        fs.rmSync(tmpFolder, { recursive: true, force: true });
      } catch {}
    }
  });

  it("2º POST com a mesma pasta devolve o mesmo id, reopened: true, e desarquiva", async () => {
    fs.writeFileSync(path.join(tmpFolder, "marker.txt"), "keep");

    const req1 = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Proj Reopen", path: tmpFolder }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.success).toBe(true);
    expect(json1.reopened).toBeUndefined();

    await prisma.project.update({
      where: { id: json1.project.id },
      data: { isArchived: true },
    });

    const req2 = new NextRequest("http://localhost:3000/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Proj Reopen", path: tmpFolder }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.success).toBe(true);
    expect(json2.reopened).toBe(true);
    expect(json2.project.id).toBe(json1.project.id);
    expect(json2.project.isArchived).toBe(false);
    expect(fs.existsSync(path.join(tmpFolder, "marker.txt"))).toBe(true);
  });

  it("pasta nova continua criando projeto distinto", async () => {
    const folderA = path.join(tmpFolder, "a");
    const folderB = path.join(tmpFolder, "b");

    const resA = await POST(
      new NextRequest("http://localhost:3000/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Alpha", path: folderA }),
      })
    );
    const resB = await POST(
      new NextRequest("http://localhost:3000/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Beta", path: folderB }),
      })
    );

    const jsonA = await resA.json();
    const jsonB = await resB.json();
    expect(jsonA.project.id).not.toBe(jsonB.project.id);
    expect(fs.existsSync(folderA)).toBe(true);
    expect(fs.existsSync(folderB)).toBe(true);
  });

  describe("PJ1.6b — reabrir só desarquiva e acha a pasta escolhida", () => {
    const post = (body: object) =>
      POST(new NextRequest("http://localhost:3000/api/projects", { method: "POST", body: JSON.stringify(body) }));
    const cleanup = async () => {
      const rows = await prisma.project.findMany({ where: { path: { startsWith: tmpFolder } }, select: { id: true } });
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        await prisma.session.deleteMany({ where: { projectId: { in: ids } } });
        await prisma.project.deleteMany({ where: { id: { in: ids } } });
      }
    };

    it("(a) reabrir com nome diferente mantém o nome, a descrição e o fixado antigos", async () => {
      const folder = path.join(tmpFolder, "meu-proj");
      try {
        const j1 = await (await post({ name: "Meu Proj", description: "desc antiga", path: folder })).json();
        await prisma.project.update({ where: { id: j1.project.id }, data: { isArchived: true, isPinned: true } });
        const j2 = await (await post({ name: "Outro Nome", description: "nova", isPinned: false, path: folder })).json();
        expect(j2.reopened).toBe(true);
        expect(j2.project.id).toBe(j1.project.id);
        expect(j2.project.isArchived).toBe(false);
        expect(j2.project.name).toBe("Meu Proj");
        expect(j2.project.description).toBe("desc antiga");
        expect(j2.project.isPinned).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it("(b) pasta escolhida com nome que não bate com ela → mesmo projeto, reopened, sem criar subpasta", async () => {
      const folder = path.join(tmpFolder, "gateway");
      try {
        const j1 = await (await post({ name: "gateway", path: folder })).json();
        expect(j1.project.path && path.resolve(j1.project.path)).toBe(path.resolve(folder));
        const j2 = await (await post({ name: "Gateway Pagamentos", path: folder })).json();
        expect(j2.reopened).toBe(true);
        expect(j2.project.id).toBe(j1.project.id);
        expect(fs.existsSync(path.join(folder, "gateway-pagamentos"))).toBe(false);
      } finally {
        await cleanup();
      }
    });
  });
});
