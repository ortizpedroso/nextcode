import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import * as localAuthModule from "@/core/security/local-auth";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { classifyMessage } from "@/core/orchestrator/message-intent";
import { parseSpecDocument, renderCanonicalSpecDocument } from "@/core/intake/spec-format";
import { POST as postChat } from "@/app/api/chat/route";
import { GET as getDag } from "@/app/api/dag/route";
import { approveSpecAndStart } from "@/core/orchestrator/execution-trigger";
import { processSessionQueue } from "@/core/orchestrator/session-queue";
import { claimJob, executeClaimedJob } from "@/core/orchestrator/job-queue";
import * as nodeExecutorModule from "@/core/orchestrator/node-executor";

function makeFakeDispatchResult(content: string): DispatchResult {
  return {
    response: new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ),
    providerUsed: "omniroute",
    badge: "OmniRoute",
    tierTag: "omniroute",
    modelUsed: "fake-fast-model",
  };
}

const createdSessionIds: string[] = [];
const createdProjectIds: string[] = [];
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-step4b-"));
  tempDirs.push(dir);
  return dir;
}

async function createTestProjectAndSession(opts: {
  title: string;
  phase?: string;
  phaseContext?: string;
  specApproved?: boolean;
  specVersion?: number;
  canonicalSpec?: string | null;
  withTempDir?: boolean;
}) {
  const dir = opts.withTempDir !== false ? createTempDir() : null;
  let projectId: string | null = null;
  if (dir) {
    const project = await prisma.project.create({
      data: {
        name: `Proj-${opts.title}-${Date.now()}`,
        path: dir,
      },
    });
    createdProjectIds.push(project.id);
    projectId = project.id;
  }

  const session = await prisma.session.create({
    data: {
      title: opts.title,
      projectId,
      phase: opts.phase ?? "ENTRADA",
      phaseContext: opts.phaseContext ?? "{}",
      specApproved: opts.specApproved ?? false,
      specVersion: opts.specVersion ?? 0,
      canonicalSpec: opts.canonicalSpec ?? null,
    },
  });
  createdSessionIds.push(session.id);

  return { session, projectDir: dir };
}

function listAllFilesRecursively(dir: string, rootDir: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllFilesRecursively(full, rootDir));
    } else {
      results.push(path.relative(rootDir, full).replace(/\\/g, "/"));
    }
  }
  return results.sort();
}

const SAMPLE_SPEC_TWO_FILES = renderCanonicalSpecDocument({
  titulo: "Gateway de Pagamentos",
  status: "aguardando_aprovacao",
  data: "2026-10-05",
  objetivo: "Implementar gateway com produtos e checkout.",
  stack: ["Next.js", "TypeScript"],
  modulos: [
    { id: "MOD-1", nome: "Produtos", resumo: "Listagem e cadastro de produtos" },
    { id: "MOD-2", nome: "Checkout", resumo: "Fluxo de pagamento" },
  ],
  entidades: [{ nome: "Product", campos: [{ nome: "id", tipo: "string" }] }],
  arquivosAfetados: [
    "src/app/dashboard/products/page.tsx",
    "src/app/dashboard/checkout/page.tsx",
  ],
});

describe("Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção", () => {
  beforeEach(() => {
    vi.spyOn(localAuthModule, "requireAuth").mockReturnValue({ response: null } as any);
    vi.spyOn(localAuthModule, "requireReadAuth").mockReturnValue({ response: null } as any);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (createdSessionIds.length > 0) {
      await prisma.job
        .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
        .catch(() => {});
      await prisma.taskNode
        .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
        .catch(() => {});
      await prisma.message
        .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
        .catch(() => {});
      await prisma.session
        .deleteMany({ where: { id: { in: createdSessionIds } } })
        .catch(() => {});
      createdSessionIds.length = 0;
    }
    if (createdProjectIds.length > 0) {
      await prisma.project
        .deleteMany({ where: { id: { in: createdProjectIds } } })
        .catch(() => {});
      createdProjectIds.length = 0;
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("1. Mensagem 'status' em EXECUCAO → resposta montada sem nenhuma chamada ao SmartRouter (spy com 0 chamadas), citando nós e arquivos faltantes reais de um projeto temporário", async () => {
    const { session, projectDir } = await createTestProjectAndSession({
      title: "Status em EXECUCAO",
      phase: "EXECUCAO",
      specApproved: true,
      canonicalSpec: SAMPLE_SPEC_TWO_FILES,
    });

    // Cria apenas 1 dos 2 arquivos declarados na Spec no projeto temporário
    const existingFile = path.join(projectDir!, "src/app/dashboard/products/page.tsx");
    fs.mkdirSync(path.dirname(existingFile), { recursive: true });
    fs.writeFileSync(existingFile, "export default function ProductsPage() { return null; }\n");

    await prisma.taskNode.createMany({
      data: [
        {
          sessionId: session.id,
          title: "Implementar página de Produtos",
          role: "developer",
          status: "completed",
          attempts: 1,
          maxAttempts: 3,
          filesScope: JSON.stringify(["src/app/dashboard/products/page.tsx"]),
        },
        {
          sessionId: session.id,
          title: "Implementar página de Checkout",
          role: "developer",
          status: "running",
          attempts: 2,
          maxAttempts: 3,
          filesScope: JSON.stringify(["src/app/dashboard/checkout/page.tsx"]),
        },
      ],
    });

    const spy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "qual o status?",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(spy).toHaveBeenCalledTimes(0);
    expect(data.phase).toBe("EXECUCAO");
    const reply: string = data.assistantMessage.content;
    expect(reply).toContain("EXECUCAO");
    expect(reply).toContain("Implementar página de Produtos");
    expect(reply).toContain("completed");
    expect(reply).toContain("Implementar página de Checkout");
    expect(reply).toContain("running");
    expect(reply).toContain("2/3");
    expect(reply).toContain("src/app/dashboard/checkout/page.tsx");
    expect(reply).toContain("faltante no disco");
  });

  it('2. "o que falta implementar?" numa sessão ENTREGUE com 1 arquivo declarado ausente no disco → a resposta lista exatamente esse arquivo. Nenhum arquivo é criado no disco', async () => {
    const { session, projectDir } = await createTestProjectAndSession({
      title: "O que falta implementar em ENTREGUE",
      phase: "ENTREGUE",
      specApproved: true,
      canonicalSpec: SAMPLE_SPEC_TWO_FILES,
    });

    // Cria apenas src/app/dashboard/products/page.tsx; deixa src/app/dashboard/checkout/page.tsx ausente
    const existingFile = path.join(projectDir!, "src/app/dashboard/products/page.tsx");
    fs.mkdirSync(path.dirname(existingFile), { recursive: true });
    fs.writeFileSync(existingFile, "export default function ProductsPage() { return null; }\n");

    const filesBefore = listAllFilesRecursively(projectDir!);
    expect(filesBefore).toEqual(["src/app/dashboard/products/page.tsx"]);

    const spy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "o que falta implementar?",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(spy).toHaveBeenCalledTimes(0);
    const reply: string = data.assistantMessage.content;
    expect(reply).toContain("**Faltam 1 arquivo(s) no disco:** `src/app/dashboard/checkout/page.tsx`");

    const filesAfter = listAllFilesRecursively(projectDir!);
    expect(filesAfter).toEqual(["src/app/dashboard/products/page.tsx"]);
  });

  it("3. Dúvida avulsa → fase inalterada, canonicalSpec inalterada. LLM falso devolvendo uma Spec com frontmatter → nada gravado como Spec", async () => {
    const initialSpec = SAMPLE_SPEC_TWO_FILES;
    const { session } = await createTestProjectAndSession({
      title: "Duvida avulsa com LLM devolvendo frontmatter",
      phase: "SPEC_REVISAO",
      specApproved: false,
      canonicalSpec: initialSpec,
    });

    const rogueSpecResponse = renderCanonicalSpecDocument({
      titulo: "Spec Intrusa",
      status: "aprovada",
      data: "2026-10-05",
      objetivo: "Esta resposta deveria ser só explicação de dúvida.",
      stack: ["Node"],
      modulos: [{ id: "MOD-99", nome: "Intruso", resumo: "Não deve substituir a Spec" }],
      entidades: [],
      arquivosAfetados: ["src/intruso.ts"],
    });

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValueOnce(
      makeFakeDispatchResult(rogueSpecResponse)
    );

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Pode explicar como funciona a validação do checkout?",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.phase).toBe("SPEC_REVISAO");
    expect(dbSession.canonicalSpec).toBe(initialSpec);
    expect(parseSpecDocument(data.assistantMessage.content)).toBeNull();
    expect(data.assistantMessage.content).not.toContain("modulos:");
  });

  it("4. Duas mensagens seguidas em ELICITACAO; o LLM falso devolve na 2ª uma Spec SEM um módulo da 1ª → o rascunho final contém os módulos das duas, e a resposta avisa a reinjeção", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Spec cumulativa com guarda contra perda",
      phase: "ELICITACAO",
      specApproved: false,
      canonicalSpec: null,
    });

    const specTurn1 = renderCanonicalSpecDocument({
      titulo: "Gateway v1",
      status: "aguardando_aprovacao",
      data: "2026-10-05",
      objetivo: "Módulo inicial de produtos.",
      stack: ["Next.js", "TypeScript"],
      modulos: [
        { id: "MOD-PROD", nome: "Produtos", resumo: "Catálogo de produtos", arquivos: ["src/app/dashboard/products/page.tsx"] },
      ],
      entidades: [{ nome: "Product", campos: [{ nome: "id", tipo: "string" }] }],
      arquivosAfetados: ["src/app/dashboard/products/page.tsx"],
    });

    // Na 2ª mensagem, o LLM falso devolve apenas MOD-CHECKOUT e esquece MOD-PROD e seu arquivo
    const specTurn2MissingFirst = renderCanonicalSpecDocument({
      titulo: "Gateway v2",
      status: "aguardando_aprovacao",
      data: "2026-10-05",
      objetivo: "Adicionado checkout.",
      stack: ["Next.js", "TypeScript"],
      modulos: [
        { id: "MOD-CHECKOUT", nome: "Checkout", resumo: "Pagamento e carrinho", arquivos: ["src/app/dashboard/checkout/page.tsx"] },
      ],
      entidades: [{ nome: "Order", campos: [{ nome: "id", tipo: "string" }] }],
      arquivosAfetados: ["src/app/dashboard/checkout/page.tsx"],
    });

    const spy = vi
      .spyOn(SmartRouter.prototype, "dispatchWithFallback")
      .mockResolvedValueOnce(makeFakeDispatchResult(specTurn1))
      .mockResolvedValueOnce(makeFakeDispatchResult(specTurn2MissingFirst));

    // 1ª mensagem em ELICITACAO
    const res1 = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          prompt: "Criar o módulo de produtos no dashboard",
        }),
      })
    );
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.phase).toBe("SPEC_REVISAO");

    // 2ª mensagem pedindo para adicionar o checkout (sem pedir remoção)
    const res2 = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          prompt: "Adicionar também o módulo de checkout no dashboard",
        }),
      })
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();

    // Verifica que na 2ª chamada o prompt enviado ao LLM continha a Spec anterior e a instrução cumulativa
    const secondCallMessages = spy.mock.calls[1][0].messages;
    const systemTexts = secondCallMessages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(systemTexts).toContain("devolva a Spec COMPLETA atualizada");
    expect(systemTexts).toContain("MOD-PROD");

    // Rascunho final gravado no servidor contém os módulos e arquivos das duas mensagens
    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    const parsedFinal = parseSpecDocument(dbSession.canonicalSpec || "");
    expect(parsedFinal).not.toBeNull();
    expect(parsedFinal!.modulos.map((m) => m.id)).toEqual(["MOD-PROD", "MOD-CHECKOUT"]);
    expect(parsedFinal!.arquivosAfetados).toEqual([
      "src/app/dashboard/products/page.tsx",
      "src/app/dashboard/checkout/page.tsx",
    ]);

    // A resposta avisa a reinjeção dos 2 itens perdidos (1 módulo + 1 arquivo)
    expect(data2.assistantMessage.content).toContain(
      "Mantive 2 itens da versão anterior que não apareceram na nova."
    );
  });

  it('5. LLM falso escreve status: "aprovada" → o rascunho gravado tem aguardando_aprovacao', async () => {
    const { session } = await createTestProjectAndSession({
      title: "LLM tenta escrever status aprovada",
      phase: "ELICITACAO",
      specApproved: false,
      canonicalSpec: null,
    });

    const specWithSelfApprovedStatus = renderCanonicalSpecDocument({
      titulo: "Sistema Auto-Aprovado pela IA",
      status: "aprovada",
      data: "2026-10-05",
      objetivo: "Testar sobrescrita de status no servidor.",
      stack: ["TypeScript"],
      modulos: [{ id: "MOD-1", nome: "Core", resumo: "Módulo principal" }],
      entidades: [],
      arquivosAfetados: ["src/core.ts"],
    });

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValueOnce(
      makeFakeDispatchResult(specWithSelfApprovedStatus)
    );

    const res = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          prompt: "Criar o módulo principal em src/core.ts",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.specApproved).toBe(false);
    const parsedDraft = parseSpecDocument(dbSession.canonicalSpec || "");
    expect(parsedDraft).not.toBeNull();
    expect(parsedDraft!.status).toBe("aguardando_aprovacao");

    const parsedMessageSpec = parseSpecDocument(data.assistantMessage.content);
    expect(parsedMessageSpec?.status).toBe("aguardando_aprovacao");
  });

  it('6. Mensagem de mudança em EXECUCAO → fase SPEC_REVISAO; o laço do processSessionQueue para antes do próximo lote (nó pendente continua pending); nova aprovação → nós antigos pendentes "superseded", nova versão com nós novos e 1 Job', async () => {
    const { session } = await createTestProjectAndSession({
      title: "Mudanca durante EXECUCAO",
      phase: "EXECUCAO",
      specApproved: true,
      specVersion: 1,
      canonicalSpec: SAMPLE_SPEC_TWO_FILES,
    });

    // Dois lotes sequenciais na versão 1: node1 sem dependências, node2 depende de node1
    const node1 = await prisma.taskNode.create({
      data: {
        id: `t6-n1-${Date.now()}`,
        sessionId: session.id,
        specVersion: 1,
        title: "Implementar Produtos v1",
        role: "Frontend Engineer",
        status: "pending",
        dependencies: "[]",
        filesScope: JSON.stringify(["src/app/dashboard/products/page.tsx"]),
      },
    });
    const node2 = await prisma.taskNode.create({
      data: {
        id: `t6-n2-${Date.now()}`,
        sessionId: session.id,
        specVersion: 1,
        title: "Implementar Checkout v1",
        role: "Frontend Engineer",
        status: "pending",
        dependencies: JSON.stringify([node1.id]),
        filesScope: JSON.stringify(["src/app/dashboard/checkout/page.tsx"]),
      },
    });

    const specV2Draft = renderCanonicalSpecDocument({
      titulo: "Gateway de Pagamentos v2",
      status: "aguardando_aprovacao",
      data: "2026-10-05",
      objetivo: "Implementar gateway com produtos, checkout e cupons.",
      stack: ["Next.js", "TypeScript"],
      modulos: [
        { id: "MOD-1", nome: "Produtos", resumo: "Listagem e cadastro de produtos" },
        { id: "MOD-2", nome: "Checkout", resumo: "Fluxo de pagamento" },
        { id: "MOD-3", nome: "Cupons", resumo: "Descontos promocionais" },
      ],
      entidades: [{ nome: "Product", campos: [{ nome: "id", tipo: "string" }] }],
      arquivosAfetados: [
        "src/app/dashboard/products/page.tsx",
        "src/app/dashboard/checkout/page.tsx",
        "src/app/dashboard/coupons/page.tsx",
      ],
    });

    let workerCallsForNode2 = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValueOnce(
      makeFakeDispatchResult(specV2Draft)
    );

    vi.spyOn(nodeExecutorModule, "executeTaskNode").mockImplementation(async (taskDb) => {
      if (taskDb.id === node2.id) {
        workerCallsForNode2++;
      }
      if (taskDb.id === node1.id) {
        // Durante a execução do lote 1 (node1), o usuário envia pedido de mudança no chat
        const chatRes = await postChat(
          new NextRequest("http://localhost/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: session.id,
              prompt: "Adicionar também o módulo de cupons de desconto",
            }),
          })
        );
        expect(chatRes.status).toBe(200);
        const chatData = await chatRes.json();
        expect(chatData.phase).toBe("SPEC_REVISAO");
      }

      const updated = await prisma.taskNode.update({
        where: { id: taskDb.id },
        data: { status: "completed", result: JSON.stringify({ success: true }) },
      });
      return {
        success: true,
        claimed: true,
        executedTask: updated,
        finalStatus: "completed",
        promotionTarget: null,
      };
    });

    // Roda processSessionQueue: lote 1 (node1) conclui, mas antes do lote 2 (node2) a fase virou SPEC_REVISAO e o laço para
    const queueResult = await processSessionQueue(session.id);
    expect(queueResult.processedCount).toBe(1);
    expect(workerCallsForNode2).toBe(0);

    const dbNode1BeforeReapproval = await prisma.taskNode.findUniqueOrThrow({
      where: { id: node1.id },
    });
    const dbNode2BeforeReapproval = await prisma.taskNode.findUniqueOrThrow({
      where: { id: node2.id },
    });
    const dbSessionInRevision = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });

    expect(dbSessionInRevision.phase).toBe("SPEC_REVISAO");
    expect(dbSessionInRevision.specApproved).toBe(false);
    expect(dbNode1BeforeReapproval.status).toBe("completed");
    expect(dbNode2BeforeReapproval.status).toBe("pending");

    // Nova aprovação -> specVersion 2, nós pendentes antigos marcados como "superseded", novos nós criados e 1 Job
    const approvalResult = await approveSpecAndStart(
      session.id,
      dbSessionInRevision.canonicalSpec!
    );

    expect(approvalResult.ok).toBe(true);
    if (!approvalResult.ok) throw new Error("approveSpecAndStart failed");
    expect(approvalResult.phase).toBe("EXECUCAO");
    expect(approvalResult.tasks!.length).toBeGreaterThan(0);
    expect(
      approvalResult.tasks!.every((t) => t.specVersion === 2 && t.status === "pending")
    ).toBe(true);

    const dbSessionAfterReapproval = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(dbSessionAfterReapproval.phase).toBe("EXECUCAO");
    expect(dbSessionAfterReapproval.specApproved).toBe(true);
    expect(dbSessionAfterReapproval.specVersion).toBe(2);

    const dbNode1AfterReapproval = await prisma.taskNode.findUniqueOrThrow({
      where: { id: node1.id },
    });
    const dbNode2AfterReapproval = await prisma.taskNode.findUniqueOrThrow({
      where: { id: node2.id },
    });
    expect(dbNode1AfterReapproval.status).toBe("completed");
    expect(dbNode2AfterReapproval.status).toBe("superseded");

    const activeJobs = await prisma.job.findMany({
      where: { sessionId: session.id, activeKey: session.id },
    });
    expect(activeJobs).toHaveLength(1);
    expect(activeJobs[0].id).toBe(approvalResult.jobId);

    // GET /api/dag deve retornar apenas os nós da versão ativa (specVersion === 2)
    const dagGetRes = await getDag(
      new Request(`http://localhost/api/dag?sessionId=${session.id}`)
    );
    const dagGetData = await dagGetRes.json();
    expect(dagGetData.tasks.every((t: { specVersion: number }) => t.specVersion === 2)).toBe(true);
  });

  it("7. ENTREGUE + pedido novo → ELICITACAO; aprovação → specVersion 2, nós novos, os nós da versão 1 intocados (completed), mensagem de conclusão só sobre a versão 2", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Ciclo v1 ENTREGUE para v2",
      phase: "SPEC_REVISAO",
      specApproved: false,
      canonicalSpec: SAMPLE_SPEC_TWO_FILES,
    });

    vi.spyOn(nodeExecutorModule, "executeTaskNode").mockImplementation(async (taskDb) => {
      const updated = await prisma.taskNode.update({
        where: { id: taskDb.id },
        data: { status: "completed", result: JSON.stringify({ success: true }) },
      });
      return {
        success: true,
        claimed: true,
        executedTask: updated,
        finalStatus: "completed",
        promotionTarget: null,
      };
    });

    // Este teste é sobre o ciclo de versões, não sobre a entrega (T10 estrita tem teste próprio):
    // o executor falso não escreve arquivos, então a conferência de entrega é simulada como aprovada.
    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: true, specFilesComplete: true, allReqsApproved: true, buildVerified: true,
      missingFiles: [], unapprovedReqs: [], gaps: [],
    });

    // 1. Aprova e conclui a versão 1 até ENTREGUE
    const v1Start = await approveSpecAndStart(session.id, SAMPLE_SPEC_TWO_FILES);
    expect(v1Start.ok).toBe(true);
    if (!v1Start.ok) throw new Error("v1 approveSpecAndStart failed");
    const v1TaskIds = v1Start.tasks!.map((t) => t.id);
    expect(v1TaskIds.length).toBeGreaterThan(0);

    const claimedV1 = await claimJob(v1Start.jobId!, "test-worker-v1");
    expect(claimedV1).toBe(true);
    await executeClaimedJob(v1Start.jobId!, "test-worker-v1");

    const sessionAfterV1 = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionAfterV1.phase).toBe("ENTREGUE");
    expect(sessionAfterV1.specVersion).toBe(1);

    // 2. Em ENTREGUE, envia pedido novo -> fase vai para ELICITACAO
    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValueOnce(
      makeFakeDispatchResult(
        "Ótimo! Para o novo módulo de relatórios, quais formatos de exportação você deseja?"
      )
    );

    const newReqRes = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          prompt: "Criar um novo módulo de exportação de relatórios financeiros",
        }),
      })
    );
    expect(newReqRes.status).toBe(200);
    const newReqData = await newReqRes.json();
    expect(newReqData.phase).toBe("ELICITACAO");

    const sessionInElicitacao = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(sessionInElicitacao.phase).toBe("ELICITACAO");

    // 3. Aprova a Spec da versão 2 -> specVersion 2, nós novos, nós v1 intocados (completed)
    const specV2 = renderCanonicalSpecDocument({
      titulo: "Relatórios Financeiros v2",
      status: "aguardando_aprovacao",
      data: "2026-10-05",
      objetivo: "Exportação de relatórios financeiros em CSV.",
      stack: ["Next.js", "TypeScript"],
      modulos: [{ id: "MOD-REL-1", nome: "Exportador CSV", resumo: "Gera CSV financeiro" }],
      entidades: [{ nome: "ReportRow", campos: [{ nome: "total", tipo: "number" }] }],
      arquivosAfetados: ["src/reports/csv-exporter.ts"],
    });

    const v2Start = await approveSpecAndStart(session.id, specV2);
    expect(v2Start.ok).toBe(true);
    if (!v2Start.ok) throw new Error("v2 approveSpecAndStart failed");
    expect(v2Start.phase).toBe("EXECUCAO");
    expect(v2Start.tasks!.length).toBeGreaterThan(0);
    expect(v2Start.tasks!.every((t) => t.specVersion === 2)).toBe(true);

    const sessionInV2Exec = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionInV2Exec.specVersion).toBe(2);

    // Verifica que os nós da versão 1 continuam intocados como completed
    const v1TasksInDb = await prisma.taskNode.findMany({
      where: { id: { in: v1TaskIds } },
    });
    expect(v1TasksInDb).toHaveLength(v1TaskIds.length);
    expect(v1TasksInDb.every((t) => t.status === "completed" && t.specVersion === 1)).toBe(true);

    // 4. Executa o Job da versão 2 até ENTREGUE e verifica a mensagem de conclusão da versão 2
    const claimedV2 = await claimJob(v2Start.jobId!, "test-worker-v2");
    expect(claimedV2).toBe(true);
    await executeClaimedJob(v2Start.jobId!, "test-worker-v2");

    const sessionAfterV2 = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionAfterV2.phase).toBe("ENTREGUE");
    expect(sessionAfterV2.specVersion).toBe(2);

    const v2CompletionMessages = await prisma.message.findMany({
      where: {
        sessionId: session.id,
        role: "assistant",
        content: { contains: "Execução Autônoma Concluída! (Spec v2)" },
      },
    });
    expect(v2CompletionMessages).toHaveLength(1);
    const v2CompletionContent = v2CompletionMessages[0].content;

    for (const v2Task of v2Start.tasks!) {
      expect(v2CompletionContent).toContain(v2Task.title);
    }
    const bulletLines = v2CompletionContent
      .split("\n")
      .filter((line) => line.trim().startsWith("• **"));
    expect(bulletLines).toHaveLength(v2Start.tasks!.length);
    expect(v2CompletionContent).toContain("Relatórios Financeiros v2");
    expect(v2CompletionContent).not.toContain("Gateway de Pagamentos");
    expect(v2CompletionContent).not.toContain("src/app/dashboard/products/page.tsx");
  });

  it("8. O /api/chat nunca grava arquivo no projeto, nem com Spec aprovada e resposta com blocos de código (projeto temporário, compare a listagem do diretório antes e depois)", async () => {
    const { session, projectDir } = await createTestProjectAndSession({
      title: "Chat nunca promove codigo para o disco",
      phase: "EXECUCAO",
      specApproved: true,
      canonicalSpec: SAMPLE_SPEC_TWO_FILES,
    });

    const seedFile = path.join(projectDir!, "README.md");
    fs.writeFileSync(seedFile, "# Projeto Teste\n");
    const filesBefore = listAllFilesRecursively(projectDir!);
    expect(filesBefore).toEqual(["README.md"]);

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValueOnce(
      makeFakeDispatchResult(
        [
          "Aqui está um exemplo de como o componente funciona:",
          "```tsx",
          "// filepath: src/app/dashboard/products/page.tsx",
          "export default function ProductsPage() { return <div>Produtos</div>; }",
          "```",
        ].join("\n")
      )
    );

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Como funciona a listagem de produtos?",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);

    const filesAfter = listAllFilesRecursively(projectDir!);
    expect(filesAfter).toEqual(filesBefore);
    expect(
      fs.existsSync(path.join(projectDir!, "src/app/dashboard/products/page.tsx"))
    ).toBe(false);
  });

  it("9. Classificação: mensagem que as regras decidem → 0 chamadas ao LLM; mensagem ambígua com LLM falso que demora 10 s → 'incerto' em menos de 3,5 s", async () => {
    const spy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");

    // 9a. Regras determinísticas: status, criar_novo, corrigir_existente, duvida_avulsa, mudanca_durante_execucao
    expect(await classifyMessage("qual o status?", "EXECUCAO")).toBe("status");
    expect(await classifyMessage("o que falta implementar?", "ENTREGUE")).toBe("status");
    expect(await classifyMessage("Todas as páginas foram concluídas?", "EXECUCAO")).toBe("status");
    expect(await classifyMessage("como está o andamento?", "EXECUCAO")).toBe("status");
    expect(await classifyMessage("terminou?", "EXECUCAO")).toBe("status");
    expect(
      await classifyMessage(
        "Pode detalhar como será feita a validação dos campos do cartão?",
        "SPEC_REVISAO"
      )
    ).toBe("duvida_avulsa");
    expect(await classifyMessage("Criar um módulo de checkout com PIX", "ENTRADA")).toBe(
      "criar_novo"
    );
    expect(await classifyMessage("Corrigir o bug no cálculo de juros", "ENTRADA")).toBe(
      "corrigir_existente"
    );
    expect(
      await classifyMessage("Adicionar também o campo de cupom de desconto", "EXECUCAO")
    ).toBe("mudanca_durante_execucao");

    // Nenhuma chamada ao LLM nas mensagens decididas pelas regras
    expect(spy).toHaveBeenCalledTimes(0);

    // 9b. Mensagem ambígua com LLM falso que demora 10 s -> 'incerto' em menos de 3,5 s
    spy.mockImplementationOnce(async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 10_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        });
      });
      return makeFakeDispatchResult('{"intencao":"criar_novo"}');
    });

    const startedAt = Date.now();
    const resultSlow = await classifyMessage("hmm talvez algo assim", "ENTRADA");
    const elapsedMs = Date.now() - startedAt;

    expect(resultSlow).toBe("incerto");
    expect(elapsedMs).toBeLessThan(3500);
    expect(spy).toHaveBeenCalledTimes(1);

    // 9c. Mensagem ambígua com JSON inválido do LLM -> 'incerto'
    spy.mockImplementationOnce(async () => makeFakeDispatchResult("não sei dizer"));
    expect(await classifyMessage("olá", "ENTRADA")).toBe("incerto");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('10. Regra da 3ª rodada: três mensagens \'incerto\' seguidas a partir de ENTRADA → INTERVENCAO com os três caminhos; responder "criar" → ELICITACAO', async () => {
    const { session } = await createTestProjectAndSession({
      title: "Regra da 3a rodada",
      phase: "ENTRADA",
    });

    const spy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");

    // 1ª mensagem ambígua: 1 chamada para classificar ('incerto') + 1 chamada para conversar (CONVERSA)
    spy
      .mockResolvedValueOnce(makeFakeDispatchResult('{"intencao":"incerto"}'))
      .mockResolvedValueOnce(makeFakeDispatchResult("Olá! Como posso ajudar?"));

    const res1 = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, prompt: "oi tudo bem" }),
      })
    );
    const data1 = await res1.json();
    expect(data1.phase).toBe("CONVERSA");

    // 2ª mensagem ambígua: 1 chamada para classificar ('incerto') + 1 chamada para conversar (CONVERSA)
    spy
      .mockResolvedValueOnce(makeFakeDispatchResult('{"intencao":"incerto"}'))
      .mockResolvedValueOnce(makeFakeDispatchResult("Pode me contar mais sobre o que precisa?"));

    const res2 = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, prompt: "ainda pensando aqui" }),
      })
    );
    const data2 = await res2.json();
    expect(data2.phase).toBe("CONVERSA");

    // 3ª mensagem ambígua: 1 chamada para classificar ('incerto') -> INTERVENCAO com os 3 caminhos (sem LLM para a resposta)
    spy.mockResolvedValueOnce(makeFakeDispatchResult('{"intencao":"incerto"}'));

    const res3 = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, prompt: "não sei por onde começar" }),
      })
    );
    const data3 = await res3.json();
    expect(data3.phase).toBe("INTERVENCAO");
    expect(data3.assistantMessage.content).toContain("criar");
    expect(data3.assistantMessage.content).toContain("corrigir");
    expect(data3.assistantMessage.content).toContain("conversar");

    // Responder "criar" em INTERVENCAO -> ESCOLHA_INTERVENCAO -> ELICITACAO (0 chamadas ao LLM)
    const callsBeforeChoice = spy.mock.calls.length;
    const res4 = await postChat(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, prompt: "criar" }),
      })
    );
    const data4 = await res4.json();
    expect(data4.phase).toBe("ELICITACAO");
    expect(spy.mock.calls.length).toBe(callsBeforeChoice);

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.phase).toBe("ELICITACAO");
  });

  it("11. Mensagem que a fase recusa → resposta lista o que é permitido, sem chamar o LLM", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Fase recusa intencao",
      phase: "VERIFICACAO",
      specApproved: true,
      canonicalSpec: SAMPLE_SPEC_TWO_FILES,
    });

    const spy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");

    // Em VERIFICACAO, allowedIntents = ['duvida_avulsa', 'status'].
    // "Criar um módulo de relatórios" é classificado pelas regras determinísticas como 'criar_novo' (0 chamadas LLM)
    // e recusado por transition() na fase VERIFICACAO (0 chamadas LLM para resposta).
    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Criar um módulo de relatórios agora",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(spy).toHaveBeenCalledTimes(0);
    expect(data.phase).toBe("VERIFICACAO");
    expect(data.assistantMessage.content).toContain("criar_novo");
    expect(data.assistantMessage.content).toContain("VERIFICACAO");
    expect(data.assistantMessage.content).toContain("duvida_avulsa");
    expect(data.assistantMessage.content).toContain("status");
  });
});
