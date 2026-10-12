import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST as postChat } from "@/app/api/chat/route";
import * as jevClient from "@/core/decision/jev";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("Pacote E1 — Teste Pesado de Janela Deslizante no Chat (Estanque de Tokens)", () => {
  const SAMPLE_SPEC = `---
titulo: Projeto Teste E1
status: aguardando_aprovacao
data: 2026-10-12
stack: [Next.js, TypeScript]
modulos:
  - id: mod-core
    nome: Core
    resumo: Store
    arquivos: [src/lib/store.ts]
entidades: []
rotas: []
arquivosAfetados: [src/lib/store.ts]
objetivo: Testar janela deslizante
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
    vi.restoreAllMocks();
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

  it("garante que em uma sessão com 25 mensagens históricas, a consulta da janela deslizante limita o histórico recente em exatamente take: 6 mais recentes", async () => {
    // 1. Cria um projeto e uma sessão vinculada
    const project = await prisma.project.create({
      data: { name: "Test Sliding Window Project", path: "C:/tmp/test-sliding-window" },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        title: "Sessão Teste Estresse E1",
        projectId: project.id,
        phase: "SPEC_REVISAO",
        canonicalSpec: SAMPLE_SPEC,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    // 2. Insere 25 mensagens sucessivas simulando conversa extensa
    for (let i = 1; i <= 25; i++) {
      await prisma.message.create({
        data: {
          sessionId: session.id,
          role: i % 2 === 1 ? "user" : "assistant",
          content: `Mensagem Histórica ${i}: ` + "Conteúdo extenso para simular payload pesado ".repeat(15),
          createdAt: new Date(Date.now() - (30 - i) * 1000), // timestamps incrementais passados
        },
      });
    }

    // 3. Mock do Jev para responder intenção como ajuste com ressalva
    vi.spyOn(jevClient, "askJevBatch").mockResolvedValue({
      intencao_mensagem: {
        type: "choice",
        choice: "ajustar",
        confidence: 0.91,
        probabilities: { ajustar: 0.91, aprovar: 0.05, duvida: 0.03, outro: 0.01 },
      },
      aprovacao_sem_condicoes: {
        type: "noul",
        noul: 0.20,
      },
    });

    // 4. Intercepta a query do prisma.message.findMany
    const findManySpy = vi.spyOn(prisma.message, "findMany");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "adicione mais um campo de validação na tela",
      }),
    });

    const res = await postChat(req);
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200) {
      console.error("STATUS_ERRO_500:", body);
    }
    expect(res.status).toBe(200);

    // 5. Prova que a consulta do histórico usou take: 6 e orderBy desc
    const slidingWindowQuery = findManySpy.mock.calls.find((call) => {
      const args = call[0];
      return args?.take === 6 && args?.orderBy && (args.orderBy as any).createdAt === "desc";
    });

    expect(slidingWindowQuery).toBeDefined();
    expect(slidingWindowQuery![0]?.take).toBe(6);
  });
});
