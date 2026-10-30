import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { PATCH as patchSession } from "@/app/api/sessions/[id]/route";
import { POST as postChat } from "@/app/api/chat/route";
import { POST as postDag } from "@/app/api/dag/route";
import { SmartRouter, type DispatchOptions } from "@/core/router/smart-router";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { startJobWorker, stopJobWorker } from "@/core/orchestrator/job-worker";
import { mockBlindAuditJson } from "../helpers/mock-blind-audit";

const blindAuditHttpContent = mockBlindAuditJson({
  justification: "Código de acordo com o brief.",
  fatoQueGarante: "index.ts:1",
  reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "index.ts:1" }],
});
import { setPaidOnlyRoutingForTests } from "@/core/orchestrator/node-executor";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

let server: http.Server;
let baseUrl: string;
let tempDir: string;
let routerSpy: ReturnType<typeof vi.spyOn>;
let skillMinerAnalyzeSpy: ReturnType<typeof vi.spyOn>;
let skillMinerDetectSpy: ReturnType<typeof vi.spyOn>;
let originalSetting: Awaited<ReturnType<typeof prisma.setting.findUnique>> = null;

let fakeResponseMode: "dag_code" | "chat_text" = "dag_code";
let workerDelayMs = 0;

const savedEnv = {
  OMNIROUTE_URL: process.env.OMNIROUTE_URL,
  OMNIROUTE_MODEL: process.env.OMNIROUTE_MODEL,
  OMNIROUTE_CB_COOLDOWN_MS: process.env.OMNIROUTE_CB_COOLDOWN_MS,
  BLIND_AUDIT_TIMEOUT_MS: process.env.BLIND_AUDIT_TIMEOUT_MS,
  DAG_STEP_TIMEOUT_MS: process.env.DAG_STEP_TIMEOUT_MS,
  NEXTCODE_WORKER_POLL_MS: process.env.NEXTCODE_WORKER_POLL_MS,
};

const createdSessionIds: string[] = [];
const createdProjectIds: string[] = [];

const VALID_CANONICAL_SPEC = `# Spec Canônica — Gateway de Pagamentos

## Objetivo
Implementar validação e processamento de transações.

## Arquivos Afetados
- \`index.ts\`
`;

async function createTestProjectAndSession(opts: {
  title: string;
  specApproved?: boolean;
  canonicalSpec?: string | null;
  phase?: string;
  phaseContext?: string;
}) {
  const project = await prisma.project.create({
    data: {
      name: `Proj ${opts.title}`,
      path: tempDir,
    },
  });
  createdProjectIds.push(project.id);

  const session = await prisma.session.create({
    data: {
      title: opts.title,
      projectId: project.id,
      specApproved: opts.specApproved ?? false,
      canonicalSpec: opts.canonicalSpec !== undefined ? opts.canonicalSpec : VALID_CANONICAL_SPEC,
      ...(opts.phase ? { phase: opts.phase } : {}),
      ...(opts.phaseContext ? { phaseContext: opts.phaseContext } : {}),
    },
  });
  createdSessionIds.push(session.id);

  return { project, session };
}

async function cleanupTestData() {
  await stopJobWorker();
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
}

beforeAll(async () => {
  process.env.OMNIROUTE_CB_COOLDOWN_MS = "1";
  process.env.BLIND_AUDIT_TIMEOUT_MS = "5000";
  process.env.DAG_STEP_TIMEOUT_MS = "5000";
  process.env.OMNIROUTE_MODEL = "auto/best-free";

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-routes-4a-"));

  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;

      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ status: "ok" }));
      }

      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            data: [{ id: "auto" }, { id: "auto/best-free" }],
          })
        );
      }

      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        const messagesStr = JSON.stringify(body?.messages || []);
        const isBlindAudit =
          messagesStr.includes("implemented") ||
          messagesStr.includes("Auditor Cego") ||
          messagesStr.includes("Brief");

        const sendResponse = () => {
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(200, { "content-type": "application/json" });

          if (isBlindAudit) {
            return res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: blindAuditHttpContent,
                    },
                  },
                ],
              })
            );
          }

          if (fakeResponseMode === "chat_text") {
            return res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Entendido. Aqui está o esclarecimento solicitado sobre os requisitos da Spec.",
                    },
                  },
                ],
              })
            );
          }

          return res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "```typescript\n// file: index.ts\nexport const ok = 1;\n```",
                  },
                },
              ],
            })
          );
        };

        if (!isBlindAudit && workerDelayMs > 0) {
          const timer = setTimeout(sendResponse, workerDelayMs);
          res.on("close", () => clearTimeout(timer));
          return;
        }

        return sendResponse();
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;
  process.env.OMNIROUTE_URL = baseUrl;

  originalSetting = await prisma.setting.findUnique({ where: { id: "default" } });
  await prisma.setting.upsert({
    where: { id: "default" },
    update: {
      omniRouteUrl: baseUrl,
      geminiKey: null,
      groqKey: null,
      nvidiaKey: null,
      deepseekKey: null,
      omniRouteKey: null,
      customEndpoint: null,
    },
    create: {
      id: "default",
      omniRouteUrl: baseUrl,
      geminiKey: null,
      groqKey: null,
      nvidiaKey: null,
      deepseekKey: null,
      omniRouteKey: null,
      customEndpoint: null,
    },
  });

  routerSpy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");
  skillMinerAnalyzeSpy = vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue(null as any);
  skillMinerDetectSpy = vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue(null as any);
});

beforeEach(() => {
  setPaidOnlyRoutingForTests(false);
  fakeResponseMode = "dag_code";
  workerDelayMs = 0;
  routerSpy.mockClear();
});

afterEach(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  setPaidOnlyRoutingForTests(null);
  await cleanupTestData();
  routerSpy?.mockRestore();
  skillMinerAnalyzeSpy?.mockRestore();
  skillMinerDetectSpy?.mockRestore();

  if (originalSetting) {
    await prisma.setting.upsert({
      where: { id: "default" },
      update: {
        omniRouteUrl: originalSetting.omniRouteUrl,
        geminiKey: originalSetting.geminiKey,
        groqKey: originalSetting.groqKey,
        nvidiaKey: originalSetting.nvidiaKey,
        deepseekKey: originalSetting.deepseekKey,
        omniRouteKey: originalSetting.omniRouteKey,
        customEndpoint: originalSetting.customEndpoint,
      },
      create: originalSetting,
    });
  }

  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }

  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function separateRouterCalls(calls: DispatchOptions[]) {
  const auditorCalls = calls.filter((opts) =>
    opts.messages.some((m) => m.role === "system" && m.content.includes("Auditor Cego"))
  );
  const workerCalls = calls.filter(
    (opts) => !opts.messages.some((m) => m.role === "system" && m.content.includes("Auditor Cego"))
  );
  return { workerCalls, auditorCalls };
}

describe("Rotas HTTP reais — Aprovação, Concorrência e Retomada Seletiva (Passo 4a-complemento)", () => {
  it("1. Duas chamadas concorrentes de POST /api/dag process_queue na mesma sessão aprovada → 1 Job criado, cada nó despachado ao worker 1 vez e ambas retornam 200", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Sessão process_queue concorrente",
      specApproved: true,
      phase: "EXECUCAO",
    });

    const node1 = await prisma.taskNode.create({
      data: {
        sessionId: session.id,
        title: "Etapa Concorrente Alfa",
        role: "backend",
        status: "pending",
        dependencies: JSON.stringify([]),
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });
    const node2 = await prisma.taskNode.create({
      data: {
        sessionId: session.id,
        title: "Etapa Concorrente Beta",
        role: "backend",
        status: "pending",
        dependencies: JSON.stringify([]),
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });

    workerDelayMs = 60;
    routerSpy.mockClear();

    const makeProcessQueueReq = () =>
      new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
      });

    const [res1, res2] = await Promise.all([
      postDag(makeProcessQueueReq()),
      postDag(makeProcessQueueReq()),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.success).toBe(true);
    expect(body2.success).toBe(true);
    expect(body1.allCompleted).toBe(true);
    expect(body2.allCompleted).toBe(true);

    // Exatamente 1 Job criado para a sessão
    const jobs = await prisma.job.findMany({ where: { sessionId: session.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("done");
    expect(jobs[0].activeKey).toBeNull();

    // Contagem pelo spy do SmartRouter separando worker de Auditor Cego
    const allCalls = routerSpy.mock.calls.map((c) => c[0] as DispatchOptions);
    const { workerCalls, auditorCalls } = separateRouterCalls(allCalls);

    expect(workerCalls).toHaveLength(2);
    expect(auditorCalls).toHaveLength(2);

    const workerCallsForNode1 = workerCalls.filter((opts) =>
      opts.messages.some((m) => m.content.includes(node1.title))
    );
    const workerCallsForNode2 = workerCalls.filter((opts) =>
      opts.messages.some((m) => m.content.includes(node2.title))
    );
    expect(workerCallsForNode1).toHaveLength(1);
    expect(workerCallsForNode2).toHaveLength(1);
  });

  it("2. POST execute_node e POST process_queue concorrentes no mesmo nó → nó despachado ao worker 1 vez e execute_node retorna 200 ou 409", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Sessão execute_node vs process_queue",
      specApproved: true,
      phase: "EXECUCAO",
    });

    const task = await prisma.taskNode.create({
      data: {
        sessionId: session.id,
        title: "Nó Disputado HTTP",
        role: "backend",
        status: "pending",
        dependencies: JSON.stringify([]),
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });

    workerDelayMs = 60;
    routerSpy.mockClear();

    const execNodeReq = new NextRequest("http://localhost/api/dag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "execute_node", nodeId: task.id }),
    });
    const processQueueReq = new NextRequest("http://localhost/api/dag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
    });

    const [execRes, pqRes] = await Promise.all([
      postDag(execNodeReq),
      postDag(processQueueReq),
    ]);

    expect(pqRes.status).toBe(200);
    expect([200, 409]).toContain(execRes.status);

    const outcome =
      execRes.status === 200
        ? "execute_node venceu a reserva atômica (200) e process_queue ignorou o nó já reservado"
        : "process_queue venceu a reserva atômica e execute_node recebeu 409 (perdeu a reserva)";
    console.log(`[Teste 2] Resultado observado: ${outcome} (status execute_node=${execRes.status}, process_queue=${pqRes.status})`);

    if (execRes.status === 200) {
      const execBody = await execRes.json();
      expect(execBody.success).toBe(true);
      expect(execBody.executedTask.id).toBe(task.id);
    } else {
      expect(execRes.status).toBe(409);
      const execBody = await execRes.json();
      expect(execBody.error).toBeDefined();
    }

    const allCalls = routerSpy.mock.calls.map((c) => c[0] as DispatchOptions);
    const { workerCalls, auditorCalls } = separateRouterCalls(allCalls);

    expect(workerCalls).toHaveLength(1);
    expect(auditorCalls).toHaveLength(1);

    const taskAfter = await prisma.taskNode.findUniqueOrThrow({ where: { id: task.id } });
    expect(taskAfter.status).toBe("completed");
  });

  it("3a. PATCH /api/sessions/[id] { specApproved: true, canonicalSpec } → 200, specApproved true, fase EXECUCAO, exatamente 1 conjunto de nós e 1 Job", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Sessão PATCH aprovação 3a",
      specApproved: false,
      canonicalSpec: null,
      phase: "ENTRADA",
    });

    const { nodes: expectedGeneratedNodes } = SpecDecomposerSkill.decompose(
      VALID_CANONICAL_SPEC,
      undefined,
      ["index.ts"]
    );
    expect(expectedGeneratedNodes.length).toBeGreaterThan(0);

    const patchReq = new NextRequest(`http://localhost/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specApproved: true,
        canonicalSpec: VALID_CANONICAL_SPEC,
      }),
    });

    const patchRes = await patchSession(patchReq, { params: Promise.resolve({ id: session.id }) });
    expect(patchRes.status).toBe(200);

    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.session.specApproved).toBe(true);
    expect(patchBody.session.phase).toBe("EXECUCAO");

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.specApproved).toBe(true);
    expect(dbSession.phase).toBe("EXECUCAO");

    const tasksAfterPatch = await prisma.taskNode.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasksAfterPatch).toHaveLength(expectedGeneratedNodes.length);

    const jobsAfterPatch = await prisma.job.findMany({
      where: { sessionId: session.id },
    });
    expect(jobsAfterPatch).toHaveLength(1);
    expect(jobsAfterPatch[0].status).toBe("queued");
    expect(jobsAfterPatch[0].activeKey).toBe(session.id);
  });

  it("3b. POST /api/chat com uma frase de aprovação explícita, numa sessão com canonicalSpec gravada → specApproved true e exatamente 1 conjunto de nós", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Sessão aprovação explícita via POST /api/chat",
      specApproved: false,
      canonicalSpec: VALID_CANONICAL_SPEC,
      phase: "SPEC_REVISAO",
    });

    const { nodes: expectedGeneratedNodes } = SpecDecomposerSkill.decompose(
      VALID_CANONICAL_SPEC,
      undefined,
      ["index.ts"]
    );
    fakeResponseMode = "chat_text";

    const chatReq = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Aprovo a Spec",
      }),
    });

    const chatRes = await postChat(chatReq);
    expect(chatRes.status).toBe(200);

    const chatBody = await chatRes.json();
    expect(chatBody.success).toBe(true);
    expect(chatBody.specApproved).toBe(true);

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.specApproved).toBe(true);
    expect(dbSession.phase).toBe("EXECUCAO");

    const tasks = await prisma.taskNode.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks).toHaveLength(expectedGeneratedNodes.length);

    const jobs = await prisma.job.findMany({
      where: { sessionId: session.id },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].activeKey).toBe(session.id);
  });

  it("3d. Depois do 3a, POST /api/dag create_dag com prompt → 200, nenhum nó novo, e a contagem de nós igual à anterior", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Sessão PATCH aprovação + create_dag inofensivo 3d",
      specApproved: false,
      canonicalSpec: null,
      phase: "ENTRADA",
    });

    // Executa 3a via PATCH /api/sessions/[id]
    const patchReq = new NextRequest(`http://localhost/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specApproved: true,
        canonicalSpec: VALID_CANONICAL_SPEC,
      }),
    });
    const patchRes = await patchSession(patchReq, { params: Promise.resolve({ id: session.id }) });
    expect(patchRes.status).toBe(200);

    const tasksAfterPatch = await prisma.taskNode.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasksAfterPatch.length).toBeGreaterThan(0);

    // 3d: POST /api/dag create_dag com prompt → 200, nenhum nó novo, contagem igual à anterior
    const createDagReq = new NextRequest("http://localhost/api/dag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_dag",
        sessionId: session.id,
        prompt: "Novo pedido tentando recriar ou duplicar a DAG",
      }),
    });

    const createDagRes = await postDag(createDagReq);
    expect(createDagRes.status).toBe(200);

    const createDagBody = await createDagRes.json();
    expect(createDagBody.success).toBe(true);
    expect(createDagBody.tasks).toHaveLength(tasksAfterPatch.length);

    const tasksAfterCreateDag = await prisma.taskNode.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasksAfterCreateDag).toHaveLength(tasksAfterPatch.length);
    expect(tasksAfterCreateDag.map((t) => t.id)).toEqual(tasksAfterPatch.map((t) => t.id));
  });

  it("4c. POST /api/chat com mensagem comum sem aprovação explícita em sessão com canonicalSpec e specApproved false → specApproved false, zero nós, zero Jobs e fase sem PLANEJAMENTO/EXECUCAO", async () => {
    const { session } = await createTestProjectAndSession({
      title: "Sessão mensagem comum sem aprovação",
      specApproved: false,
      canonicalSpec: VALID_CANONICAL_SPEC,
      phase: "SPEC_REVISAO",
    });

    fakeResponseMode = "chat_text";

    const chatReq = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "Pode detalhar como será feita a validação dos campos do cartão?",
      }),
    });

    const chatRes = await postChat(chatReq);
    expect(chatRes.status).toBe(200);

    const chatBody = await chatRes.json();
    expect(chatBody.specApproved).toBe(false);

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(dbSession.specApproved).toBe(false);
    expect(dbSession.phase).toBe("SPEC_REVISAO");
    expect(["PLANEJAMENTO", "EXECUCAO"]).not.toContain(dbSession.phase);

    const tasks = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
    expect(tasks).toHaveLength(0);

    const jobs = await prisma.job.findMany({ where: { sessionId: session.id } });
    expect(jobs).toHaveLength(0);

    const transitionLogs = await prisma.telemetryLog.findMany({
      where: { sessionId: session.id, action: "PHASE_TRANSITION" },
    });
    expect(transitionLogs).toHaveLength(0);
  });

  it("4d. Sessões em ENTRADA, SPEC_REVISAO, BLOQUEADA e ENTREGUE com nós pending e sem Job → startJobWorker não cria Job para elas, mas cria para sessão em EXECUCAO", async () => {
    const nonExecPhases = ["ENTRADA", "SPEC_REVISAO", "BLOQUEADA", "ENTREGUE"] as const;
    const nonExecSessionIds: string[] = [];

    for (const phase of nonExecPhases) {
      const { session } = await createTestProjectAndSession({
        title: `Sessão fase ${phase} com nó pending`,
        specApproved: phase === "BLOQUEADA" || phase === "ENTREGUE",
        canonicalSpec: VALID_CANONICAL_SPEC,
        phase,
      });
      nonExecSessionIds.push(session.id);

      await prisma.taskNode.create({
        data: {
          sessionId: session.id,
          title: `Nó pendente em ${phase}`,
          role: "backend",
          status: "pending",
          dependencies: JSON.stringify([]),
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });
    }

    const { session: execSession } = await createTestProjectAndSession({
      title: "Sessão fase EXECUCAO órfã",
      specApproved: true,
      canonicalSpec: VALID_CANONICAL_SPEC,
      phase: "EXECUCAO",
    });

    await prisma.taskNode.create({
      data: {
        sessionId: execSession.id,
        title: "Nó pendente em EXECUCAO",
        role: "backend",
        status: "pending",
        dependencies: JSON.stringify([]),
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });

    process.env.NEXTCODE_WORKER_POLL_MS = "50";
    try {
      startJobWorker();

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const execJobs = await prisma.job.findMany({
          where: { sessionId: execSession.id },
        });
        if (execJobs.length > 0 && execJobs[0].status === "done") {
          break;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
    } finally {
      await stopJobWorker();
    }

    // Nenhuma das sessões fora de EXECUCAO deve ter ganhado Job
    for (let i = 0; i < nonExecPhases.length; i++) {
      const jobsForNonExec = await prisma.job.findMany({
        where: { sessionId: nonExecSessionIds[i] },
      });
      expect(jobsForNonExec).toHaveLength(0);
    }

    // A sessão em EXECUCAO deve ter ganhado exatamente 1 Job (e concluído)
    const jobsForExec = await prisma.job.findMany({
      where: { sessionId: execSession.id },
    });
    expect(jobsForExec).toHaveLength(1);
    expect(jobsForExec[0].status).toBe("done");
  });
});
