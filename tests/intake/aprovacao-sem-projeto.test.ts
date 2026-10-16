import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import { POST as postChat } from "@/app/api/chat/route";
import { PATCH } from "@/app/api/sessions/[id]/route";
import * as jevDecisions from "@/core/decision/jev-decisions";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

const MINIMAL_SPEC = `---
titulo: App Teste PJ1
status: aguardando_aprovacao
data: 2026-10-16
stack: [Next.js]
modulos:
  - id: mod-core
    nome: Core
    arquivos: [src/app/page.tsx]
arquivosAfetados: [src/app/page.tsx]
requisitos:
  - id: REQ-001
    descricao: Exibir hello
---
# Spec teste
`;

describe("PJ1.4 — sessão sem projeto não executa até vincular", () => {
  const createdSessionIds: string[] = [];
  const createdProjectIds: string[] = [];
  // Pasta do projeto do teste fora do repositório: aprovar a Spec grava `.nextcode/MEMORY.md`
  // na pasta do projeto, e com process.cwd() isso sujava a raiz do NextCode a cada vitest.
  const projectDirs: string[] = [];

  afterAll(() => {
    for (const dir of projectDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (createdSessionIds.length > 0) {
      await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } });
      createdSessionIds.length = 0;
    }
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
      createdProjectIds.length = 0;
    }
  });

  it("sessão sem projeto pedindo aprovação → SESSAO_SEM_PROJETO, fase não muda, nenhum Job", async () => {
    vi.spyOn(jevDecisions, "evaluateChatFanOutWithJev").mockResolvedValue({
      intencao: "aprovar_spec",
      intencaoRaw: "aprovar",
      confiancaIntencao: 0.9,
      aprovacaoSpec: {
        aprovadoParaFase2: false,
        confianca: 0.1,
        probabilidadeIncondicional: 0.05,
      },
      graphify: { elegivel: false, probabilidade: 0.1, confianca: 0.8, motivo: "mock" },
      guardrailEntrada: { inseguro: false, probabilidadeInseguro: 0.05 },
      perfilUsuario: "desenvolvedor_tecnico",
      source: "fallback",
      latenciaMs: 1,
    } as any);

    const session = await prisma.session.create({
      data: {
        title: "Ad-hoc sem projeto",
        phase: "SPEC_REVISAO",
        canonicalSpec: MINIMAL_SPEC,
      },
    });
    createdSessionIds.push(session.id);

    const res = await postChat(
      new NextRequest("http://localhost:3000/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          prompt: "Aprovo a spec, pode executar.",
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reason).toBe("SESSAO_SEM_PROJETO");
    expect(json.specApproved).toBe(false);

    const after = await prisma.session.findUnique({ where: { id: session.id } });
    expect(after?.phase).toBe("SPEC_REVISAO");
    expect(after?.specApproved).toBe(false);

    const jobs = await prisma.job.count({ where: { sessionId: session.id } });
    expect(jobs).toBe(0);
  });

  it("depois de vincular ao projeto com pasta, PATCH specApproved segue", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Proj PJ1 Exec",
        path: (() => {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nc-pj1-"));
          projectDirs.push(dir);
          return dir;
        })(),
      },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        title: "Ad-hoc vinculada",
        phase: "SPEC_REVISAO",
        canonicalSpec: MINIMAL_SPEC,
      },
    });
    createdSessionIds.push(session.id);

    const linkRes = await PATCH(
      new NextRequest(`http://localhost:3000/api/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id }),
      }),
      { params: Promise.resolve({ id: session.id }) }
    );
    expect(linkRes.status).toBe(200);

    const approveRes = await PATCH(
      new NextRequest(`http://localhost:3000/api/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ specApproved: true }),
      }),
      { params: Promise.resolve({ id: session.id }) }
    );
    const approveJson = await approveRes.json();
    expect(approveJson.ok).toBe(true);

    const after = await prisma.session.findUnique({ where: { id: session.id } });
    expect(after?.specApproved).toBe(true);
    expect(["PLANEJAMENTO", "EXECUCAO", "PAUSADA", "BLOQUEADA", "VERIFICACAO", "ENTREGUE"]).toContain(
      after?.phase
    );
  });
});
