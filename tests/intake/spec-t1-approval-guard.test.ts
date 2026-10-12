import { describe, it, expect, vi, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import { approveSpecAndStart } from "@/core/orchestrator/execution-trigger";
import { NextRequest } from "next/server";
import { POST as postChat } from "@/app/api/chat/route";
import * as jevClient from "@/core/decision/jev";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("Pacote E2 — Testes Pesados da Trava Mecânica T1 (Blindagem de Aprovação de Spec)", () => {
  const createdSessionIds: string[] = [];
  const createdProjectIds: string[] = [];

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

  it("recusa aprovação diretamente em approveSpecAndStart quando a Spec não tem nenhum REQ declarado (SPEC_SEM_REQUISITOS)", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Spec Sem Requisitos",
        phase: "SPEC_REVISAO",
        canonicalSpec: `---
titulo: Projeto Vazio
status: aguardando_aprovacao
data: 2026-10-12
stack: [Next.js]
modulos:
  - id: mod-a
    nome: Modulo A
    arquivos: [src/app/page.tsx]
arquivosAfetados: [src/app/page.tsx]
objetivo: Teste sem REQ
requisitos: []
---
# Spec Sem Requisitos
`,
      },
    });
    createdSessionIds.push(session.id);

    const result = await approveSpecAndStart(session.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SPEC_SEM_REQUISITOS");
    }

    // Garante que o banco continua em SPEC_REVISAO e não virou PLANEJAMENTO ou EXECUCAO
    const sessionAfter = await prisma.session.findUnique({ where: { id: session.id } });
    expect(sessionAfter?.phase).toBe("SPEC_REVISAO");
    expect(sessionAfter?.specApproved).toBe(false);
  });

  it("recusa aprovação quando a Spec contém apenas placeholders ('Especificação pendente')", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Placeholder",
        phase: "SPEC_REVISAO",
        canonicalSpec: "Especificação pendente — Nenhuma Spec foi gerada ainda nesta sessão",
      },
    });
    createdSessionIds.push(session.id);

    const result = await approveSpecAndStart(session.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SPEC_AUSENTE");
    }
  });

  it("bloqueia tentativa de aprovação via chat emitindo mensagem amigável explicativa sem queimar DAG", async () => {
    const project = await prisma.project.create({
      data: { name: "Test T1 Guard Project", path: "C:/tmp/test-t1-guard" },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        title: "Sessão Chat Tentativa Aprovação Vazia",
        projectId: project.id,
        phase: "SPEC_REVISAO",
        canonicalSpec: `---
titulo: App Sem REQ
status: aguardando_aprovacao
modulos:
  - id: core
    arquivos: [src/index.ts]
arquivosAfetados: [src/index.ts]
objetivo: Teste
requisitos: []
---
# Spec
`,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    // Mock Jev dizendo aprovar
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      intencao_mensagem: {
        type: "choice",
        choice: "aprovar",
        confidence: 0.95,
        probabilities: { aprovar: 0.95, ajustar: 0.03, duvida: 0.01, outro: 0.01 },
      },
      aprovacao_sem_condicoes: {
        type: "noul",
        noul: 0.95,
      },
    });

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Aprovado, pode iniciar a implementação",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    // A aprovação foi interceptada e recusada mecanicamente
    expect(data.specApproved).toBe(false);
    expect(data.phase).toBe("SPEC_REVISAO");
    expect(data.assistantMessage.content).toContain("A Spec Canônica não possui requisitos funcionais verificáveis (REQ-001...)");

    // Zero nós criados na DAG
    const nodes = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
    expect(nodes.length).toBe(0);
  });
});
