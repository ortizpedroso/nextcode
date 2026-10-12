import { describe, it, expect, vi, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import { approveSpecAndStart } from "@/core/orchestrator/execution-trigger";
import { POST as postChat } from "@/app/api/chat/route";
import { POST as postDag } from "@/app/api/dag/route";
import { decideGraphifyEligibilityWithJev } from "@/core/decision/jev-decisions";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5)", () => {
  const createdSessionIds: string[] = [];
  const createdProjectIds: string[] = [];
  const tmpDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    for (const d of tmpDirs) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
    tmpDirs.length = 0;

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

  const SPEC_CANONICA_VALIDA = `---
titulo: Sistema Bancario Critico
status: aguardando_aprovacao
data: 2026-10-12
stack: [Next.js, TypeScript, Prisma]
modulos:
  - id: mod-core
    nome: Core Banking
    resumo: Ledger e Conta Corrente
    arquivos: [src/core/ledger.ts]
  - id: mod-transfer
    nome: Transferencias Pix
    resumo: Processamento de PIX
    arquivos: [src/pix/transfer.ts]
entidades:
  - nome: Account
    campos: [{ nome: "id", tipo: "string" }]
rotas: []
arquivosAfetados: [src/core/ledger.ts, src/pix/transfer.ts]
objetivo: Implementar motor bancario robusto e tolerante a falhas.
requisitosIds: [REQ-001, REQ-002]
requisitos:
  - id: REQ-001
    titulo: Ledger de Transacoes
    criterio: Implementar double-entry ledger em src/core/ledger.ts
  - id: REQ-002
    titulo: Processador Pix
    criterio: Validar chaves e assinar mensagens em src/pix/transfer.ts
---
# Spec Canônica do Sistema Bancário
`;

  it("TESTE PESADO 1: Concorrência Extrema (Race Condition) — 10 chamadas de aprovação simultâneas criam exatamente 1 conjunto de nós e 1 Job", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Concorrência 10x",
        phase: "SPEC_REVISAO",
        canonicalSpec: SPEC_CANONICA_VALIDA,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    // Dispara 10 aprovações exatamente no mesmo milissegundo via Promise.all
    const promises = Array.from({ length: 10 }, () => approveSpecAndStart(session.id));
    const results = await Promise.all(promises);

    // Todas as 10 devem reportar sucesso sem quebrar o banco SQLite
    for (const res of results) {
      expect(res.ok).toBe(true);
      expect(["PLANEJAMENTO", "EXECUCAO"]).toContain(res.phase);
    }

    // Exatamente uma chamada deve ter iniciado (alreadyStarted: false)
    // As outras 9 devem ter detectado que já foi iniciada (alreadyStarted: true)
    const freshStarts = results.filter((r) => r.alreadyStarted === false);
    const alreadyStarted = results.filter((r) => r.alreadyStarted === true);
    expect(freshStarts.length).toBe(1);
    expect(alreadyStarted.length).toBe(9);

    // Verifica no banco de dados se não houve nós duplicados
    const tasks = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.length).toBeLessThanOrEqual(4); // Exatamente os nós gerados para os módulos

    // Verifica se há exatamente 1 Job ativo no banco
    const activeJobs = await prisma.job.findMany({
      where: { sessionId: session.id, activeKey: session.id },
    });
    expect(activeJobs.length).toBe(1);
  });

  it("TESTE PESADO 2: Sobrecarga do Chat com 30 Mensagens — Janela Deslizante (E1) preserva limite estrito de 6 turnos", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Estresse Chat 30 Mensagens",
        phase: "CONVERSA",
        canonicalSpec: SPEC_CANONICA_VALIDA,
      },
    });
    createdSessionIds.push(session.id);

    // Insere 24 mensagens históricas prévias no banco
    for (let i = 1; i <= 24; i++) {
      await prisma.message.create({
        data: {
          sessionId: session.id,
          role: i % 2 === 0 ? "assistant" : "user",
          content: `Mensagem cumulativa historica ${i}: ${"X".repeat(500)}`,
          tier: "fast",
        },
      });
    }

    // Monitora a query executada pelo chat route
    const spyFindMany = vi.spyOn(prisma.message, "findMany");

    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Mensagem numero 25: informe o saldo da conta e liste os módulos.",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);

    // Prova irrefutável: a query para construir o contexto do histórico chamou take: 6
    const slidingQuery = spyFindMany.mock.calls.find(
      (call) => call[0]?.take === 6 && call[0]?.orderBy?.createdAt === "desc"
    );
    expect(slidingQuery).toBeDefined();
    expect(slidingQuery![0]?.where?.sessionId).toBe(session.id);
  });

  it("TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65", async () => {
    const mockJev = vi.fn();
    vi.stubGlobal("fetch", mockJev);

    // Caso A: probabilidade 0.64 (abaixo do limiar de 0.65) -> NÃO deve ser elegível
    mockJev.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "jev-1.13.0",
        usage: { input_tokens: 100, output_tokens: 0 },
        answers: {
          precisa_analise_grafo_arquitetura: { type: "noul", noul: 0.64 },
          foco_da_analise: {
            type: "choice",
            choice: "arquitetura_e_dependencias",
            confidence: 0.8,
            probabilities: { arquitetura_e_dependencias: 0.8 },
          },
        },
      }),
      headers: new Headers(),
    });

    const decA = await decideGraphifyEligibilityWithJev({
      prompt: "Explique em detalhes como o código está estruturado.",
      temCodigoExistente: true,
      sessionId: "sess-stress-3a",
    });
    expect(decA.elegivel).toBe(false);

    // Caso B: probabilidade 0.65 (no limiar exato) -> DEVE ser elegível
    mockJev.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "jev-1.13.0",
        usage: { input_tokens: 100, output_tokens: 0 },
        answers: {
          precisa_analise_grafo_arquitetura: { type: "noul", noul: 0.65 },
          foco_da_analise: {
            type: "choice",
            choice: "arquitetura_e_dependencias",
            confidence: 0.8,
            probabilities: { arquitetura_e_dependencias: 0.8 },
          },
        },
      }),
      headers: new Headers(),
    });

    const decB = await decideGraphifyEligibilityWithJev({
      prompt: "Explique em detalhes como o código está estruturado.",
      temCodigoExistente: true,
      sessionId: "sess-stress-3b",
    });
    expect(decB.elegivel).toBe(true);
    expect(decB.motivo).toContain("Mapear arquitetura");
  });

  it("TESTE PESADO 4: Passivação Total da UI (E5) — tentativas espúrias de create_dag em sessão já iniciada são idempotentes e seguras", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Teste Passivação DAG",
        phase: "SPEC_REVISAO",
        canonicalSpec: SPEC_CANONICA_VALIDA,
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    // 1. Aprova a spec formalmente (inicia a orquestração no backend)
    const approveRes = await approveSpecAndStart(session.id);
    expect(approveRes.ok).toBe(true);

    const initialTasksCount = await prisma.taskNode.count({ where: { sessionId: session.id } });
    expect(initialTasksCount).toBeGreaterThan(0);

    // 2. Simula chamada espúria de create_dag (como a UI antiga fazia)
    const dagReq = new NextRequest("http://localhost:3000/api/dag", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create_dag",
        prompt: "tentativa de recriar dag concorrente",
        sessionId: session.id,
      }),
    });

    const dagRes = await postDag(dagReq);
    expect(dagRes.status).toBe(200);

    // 3. Prova: a quantidade de nós não duplicou, permanecendo rigorosamente a mesma!
    const finalTasksCount = await prisma.taskNode.count({ where: { sessionId: session.id } });
    expect(finalTasksCount).toBe(initialTasksCount);
  });
});
