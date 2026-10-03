import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { DELETE } from "@/app/api/projects/[id]/route";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/projects/[id] — DELETE (Exclusão Resiliente de Projetos)", () => {
  let tmpFolder: string;

  beforeEach(() => {
    tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-del-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpFolder)) {
      try {
        fs.rmSync(tmpFolder, { recursive: true, force: true });
      } catch {}
    }
  });

  it("deve excluir com sucesso projeto, sessões vinculadas, mensagens e pasta física", async () => {
    // 1. Cria projeto de teste no SQLite
    const proj = await prisma.project.create({
      data: {
        name: "Projeto Teste Exclusão",
        path: tmpFolder,
      },
    });

    // 2. Cria sessão e mensagem filhas para testar cascade
    const sess = await prisma.session.create({
      data: {
        projectId: proj.id,
        title: "Sessão Filha Teste",
      },
    });

    await prisma.message.create({
      data: {
        sessionId: sess.id,
        role: "user",
        content: "Olá teste",
      },
    });

    // Cria arquivo físico na pasta
    fs.writeFileSync(path.join(tmpFolder, "README.md"), "# Teste");

    // 3. Executa DELETE na rota da API
    const req = new NextRequest(`http://localhost:3000/api/projects/${proj.id}`, {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: proj.id }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.physicalDeleted).toBe(true);

    // 4. Verifica que o registro sumiu do banco de dados
    const dbProj = await prisma.project.findUnique({ where: { id: proj.id } });
    expect(dbProj).toBeNull();

    // 5. Verifica que a pasta física foi removida do disco
    expect(fs.existsSync(tmpFolder)).toBe(false);
  });
});
