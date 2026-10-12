import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST as postChat } from "@/app/api/chat/route";
import * as jevClient from "@/core/decision/jev";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("Chat API — Decisão de Intenção do Usuário com JEV (M1)", () => {
  const SAMPLE_SPEC = `---
titulo: Projeto Teste
status: aguardando_aprovacao
data: 2026-10-10
stack: [Next.js, TypeScript]
modulos:
  - id: mod-core
    nome: Core
    resumo: Store
    arquivos: [src/lib/store.ts]
entidades: []
rotas: []
arquivosAfetados: [src/lib/store.ts]
objetivo: Testar aprovacao
requisitosIds: [REQ-001]
requisitos:
  - id: REQ-001
    titulo: Store basico
    criterio: Criar store
---
# Spec Canônica
Requisitos detalhados.
`;

  const createdSessionIds: string[] = [];
  const createdProjectIds: string[] = [];

  afterEach(async () => {
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

  it("aprova execução no chat via JEV quando o usuário envia aprovação natural ('vamos implementar')", async () => {
    const askJevBatchSpy = vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      intencao_mensagem: {
        type: "choice",
        choice: "aprovar",
        confidence: 0.94,
        probabilities: { aprovar: 0.94, ajustar: 0.04, duvida: 0.01, outro: 0.01 },
      },
      aprovacao_sem_condicoes: {
        type: "noul",
        noul: 0.93,
      },
    });

    const project = await prisma.project.create({
      data: { name: "Test Chat Jev Project", path: "C:/tmp/test-chat-jev" },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        title: "Sessão Chat Jev",
        projectId: project.id,
        phase: "SPEC_REVISAO",
        canonicalSpec: SAMPLE_SPEC,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "vamos implementar",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    if (!data.specApproved) {
      console.error("DEBUG_JEV_INTENT_DATA:", data);
    }

    expect(askJevBatchSpy).toHaveBeenCalled();
    expect(data.specApproved).toBe(true);
    expect(data.phase).toBe("EXECUCAO");
    expect(data.assistantMessage.content).toContain("Spec Canônica aprovada");
  });

  it("NÃO aprova execução no chat quando o JEV classifica como pedido de ajuste ('gostei mas mude X')", async () => {
    const askJevBatchSpy = vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      intencao_mensagem: {
        type: "choice",
        choice: "ajustar",
        confidence: 0.91,
        probabilities: { ajustar: 0.91, aprovar: 0.05, duvida: 0.03, outro: 0.01 },
      },
      aprovacao_sem_condicoes: {
        type: "noul",
        noul: 0.25,
      },
    });

    const project = await prisma.project.create({
      data: { name: "Test Chat Jev Adjust Project", path: "C:/tmp/test-chat-jev-adjust" },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        title: "Sessão Chat Jev Adjust",
        projectId: project.id,
        phase: "SPEC_REVISAO",
        canonicalSpec: SAMPLE_SPEC,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "está excelente, mas antes mude a porta padrão para 8080",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(askJevBatchSpy).toHaveBeenCalled();
    // Não deve aprovar nem avançar para EXECUCAO
    expect(data.specApproved).toBe(false);
    expect(data.phase).not.toBe("EXECUCAO");
  });

  it("recorre ao fallback determinístico de aprovação se o JEV estiver offline", async () => {
    const askJevBatchSpy = vi.spyOn(jevClient, "askJevBatch").mockResolvedValue(null);

    const project = await prisma.project.create({
      data: { name: "Test Chat Fallback Project", path: "C:/tmp/test-chat-fallback" },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        title: "Sessão Chat Fallback",
        projectId: project.id,
        phase: "SPEC_REVISAO",
        canonicalSpec: SAMPLE_SPEC,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Aprovo a spec",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(askJevBatchSpy).toHaveBeenCalled();
    expect(data.specApproved).toBe(true);
    expect(data.phase).toBe("EXECUCAO");
  });
});
