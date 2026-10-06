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
