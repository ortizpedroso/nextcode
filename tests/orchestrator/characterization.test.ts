/**
 * Testes de caracterização para execute_node e process_queue ANTES da refatoração (Passo 2 da Etapa 0).
 * Exercita as rotas reais (POST de src/app/api/dag/route.ts) com gateway LLM falso e projeto temporário.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/dag/route";

import { SmartRouter, type DispatchOptions } from "@/core/router/smart-router";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { DualLensAuditor, type ValidationType2Result } from "@/core/governance/dual-lens-auditor";
import { executeTaskNode, setPaidOnlyRoutingForTests } from "@/core/orchestrator/node-executor";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

let server: http.Server;
let baseUrl: string;
let fakeLlmMode: "success" | "bad_code" | "bad_code_once" = "success";
let tempDir: string;
let routerSpy: ReturnType<typeof vi.spyOn>;
let originalSetting: Awaited<ReturnType<typeof prisma.setting.findUnique>> = null;

beforeAll(async () => {
  process.env.OMNIROUTE_CB_COOLDOWN_MS = "1";
  process.env.BLIND_AUDIT_TIMEOUT_MS = "5000";
  process.env.DAG_STEP_TIMEOUT_MS = "5000";

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-char-test-"));

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

        res.writeHead(200, { "content-type": "application/json" });

        if (isBlindAudit) {
          return res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      implemented: true,
                      missingRequirements: [],
                      justification: "Código de acordo com o brief.",
                    }),
                  },
                },
              ],
            })
          );
        }

        if (fakeLlmMode === "bad_code_once") {
          fakeLlmMode = "success";
          return res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "```typescript\n// file: index.ts\neval('bad code');\n```",
                  },
                },
              ],
            })
          );
        }

        if (fakeLlmMode === "bad_code") {
          return res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "```typescript\n// file: index.ts\neval('bad code');\n```",
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
                  content: "```typescript\n// file: index.ts\nexport const x = 1;\n```",
                },
              },
            ],
          })
        );
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;

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

  process.env.OMNIROUTE_MODEL = "auto/best-free";

  routerSpy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");
  skillMinerAnalyzeSpy = vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue(null as any);
  skillMinerDetectSpy = vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue(null as any);
});

let skillMinerAnalyzeSpy: ReturnType<typeof vi.spyOn>;
let skillMinerDetectSpy: ReturnType<typeof vi.spyOn>;

const createdSessionIds: string[] = [];
const createdProjectIds: string[] = [];
const CHAR_TASK_IDS = [
  "exec-succ-1",
  "exec-fail-1",
  "exec-block-A",
  "exec-block-B",
  "exec-guard-comp",
  "exec-guard-dep",
  "exec-guard-child",
  "exec-done-1",
  "exec-done-2",
  "pq-succ-1",
  "pq-fail-1",
  "pq-block-A",
  "pq-block-B",
  "pq-par-1",
  "pq-par-2",
  "byok-exec-1",
  "byok-pq-1",
  "exec-t2-noreason",
  "pq-t2-noreason",
  "contract-done-1",
  "contract-block-A",
  "contract-block-B",
];

async function cleanupCharTestRecords() {
  await prisma.taskNode.deleteMany({ where: { id: { in: CHAR_TASK_IDS } } }).catch(() => {});
  if (createdSessionIds.length > 0) {
    await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    createdSessionIds.length = 0;
  }
  if (createdProjectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } }).catch(() => {});
    createdProjectIds.length = 0;
  }
}

afterAll(async () => {
  setPaidOnlyRoutingForTests(null);
  await cleanupCharTestRecords();
  routerSpy?.mockRestore();
  skillMinerAnalyzeSpy?.mockRestore();
  skillMinerDetectSpy?.mockRestore();
  if (originalSetting) {
    const { id, ...rest } = originalSetting;
    await prisma.setting.upsert({
      where: { id },
      update: rest,
      create: originalSetting,
    });
  } else {
    await prisma.setting.deleteMany({ where: { id: "default" } }).catch(() => {});
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  setPaidOnlyRoutingForTests(false);
  fakeLlmMode = "success";
  routerSpy?.mockClear();
  await new Promise((resolve) => setTimeout(resolve, 2));
  await cleanupCharTestRecords();
});

async function setupTestProjectAndSession(title: string) {
  const project = await prisma.project.create({
    data: { name: title, path: tempDir },
  });
  createdProjectIds.push(project.id);
  const session = await prisma.session.create({
    data: { title, projectId: project.id, specApproved: true },
  });
  createdSessionIds.push(session.id);
  return { project, session };
}

describe("Testes de Caracterização — execute_node e process_queue (Passo 2)", () => {
  describe("Ação execute_node", () => {
    it("(a) sucesso → completed, (d) attempts mantido em 0 no sucesso", async () => {
      const { session } = await setupTestProjectAndSession("execute_node sucesso");
      const task = await prisma.taskNode.create({
        data: {
          id: "exec-succ-1",
          sessionId: session.id,
          title: "Etapa Sucesso",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "success";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId: task.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const dbTask = await prisma.taskNode.findUnique({ where: { id: task.id } });
      expect(dbTask?.status).toBe("completed");
      // Divergência 3: execute_node NÃO incrementa attempts quando o status é completed
      expect(dbTask?.attempts).toBe(0);
    });

    it("(b) Tipo 1 reprova → failed e failureHistory acrescida", async () => {
      const { session } = await setupTestProjectAndSession("execute_node tipo 1 falha");
      const task = await prisma.taskNode.create({
        data: {
          id: "exec-fail-1",
          sessionId: session.id,
          title: "Etapa Tipo1 Falha",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "bad_code";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId: task.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const dbTask = await prisma.taskNode.findUnique({ where: { id: task.id } });
      expect(dbTask?.status).toBe("failed");
      expect(dbTask?.attempts).toBe(1);
      expect(dbTask?.failureHistory).toBeTruthy();

      const history = JSON.parse(dbTask!.failureHistory!);
      expect(history).toHaveLength(1);
      expect(history[0].attemptNumber).toBe(1);
    });

    it("(c) 3ª falha → blocked, cascata nos dependentes e mensagem de incidente no chat", async () => {
      const { session } = await setupTestProjectAndSession("execute_node 3a falha");
      const taskA = await prisma.taskNode.create({
        data: {
          id: "exec-block-A",
          sessionId: session.id,
          title: "Etapa Principal",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 2,
          maxAttempts: 3,
        },
      });

      const taskB = await prisma.taskNode.create({
        data: {
          id: "exec-block-B",
          sessionId: session.id,
          title: "Etapa Dependente",
          role: "frontend",
          status: "pending",
          dependencies: JSON.stringify(["exec-block-A"]),
          filesScope: JSON.stringify(["ui.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "bad_code";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId: taskA.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const dbTaskA = await prisma.taskNode.findUnique({ where: { id: taskA.id } });
      expect(dbTaskA?.status).toBe("blocked");
      expect(dbTaskA?.attempts).toBe(3);

      const dbTaskB = await prisma.taskNode.findUnique({ where: { id: taskB.id } });
      expect(dbTaskB?.status).toBe("blocked");

      const msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
      const incidentMsgs = msgs.filter((m) => m.content.includes("intervenção humana necessária"));
      expect(incidentMsgs.length).toBe(1);
    });

    it("(e) guardas da divergência 4 (409)", async () => {
      const { session } = await setupTestProjectAndSession("execute_node guardas 409");

      // Guard 1: status não executável
      const taskCompleted = await prisma.taskNode.create({
        data: {
          id: "exec-guard-comp",
          sessionId: session.id,
          title: "Etapa Concluída",
          role: "backend",
          status: "completed",
          attempts: 0,
          maxAttempts: 3,
        },
      });

      const req1 = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId: taskCompleted.id }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(409);

      // Guard 2: dependências não concluídas
      const taskDep = await prisma.taskNode.create({
        data: {
          id: "exec-guard-dep",
          sessionId: session.id,
          title: "Etapa Pai Pendente",
          role: "backend",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
        },
      });

      const taskChild = await prisma.taskNode.create({
        data: {
          id: "exec-guard-child",
          sessionId: session.id,
          title: "Etapa Filho",
          role: "frontend",
          status: "pending",
          dependencies: JSON.stringify(["exec-guard-dep"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      const req2 = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId: taskChild.id }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(409);
      const data2 = await res2.json();
      expect(data2.error).toContain("Dependências não concluídas");
    });

    it("(f) concluir o último nó pendente → exatamente 1 mensagem de conclusão com 'promovidas para o projeto'", async () => {
      const { session } = await setupTestProjectAndSession("execute_node conclusao");
      await prisma.taskNode.create({
        data: {
          id: "exec-done-1",
          sessionId: session.id,
          title: "Etapa 1",
          role: "backend",
          status: "completed",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });
      const lastTask = await prisma.taskNode.create({
        data: {
          id: "exec-done-2",
          sessionId: session.id,
          title: "Etapa Final",
          role: "backend",
          status: "pending",
          dependencies: JSON.stringify(["exec-done-1"]),
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "success";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId: lastTask.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
      const completionMsgs = msgs.filter((m) => m.content.includes("Execução Autônoma Concluída!"));
      expect(completionMsgs.length).toBe(1);
      expect(completionMsgs[0].content).toContain("promovidas para o projeto");
    });
  });

  describe("Ação process_queue", () => {
    it("(a) sucesso → completed, (d) attempts incrementado para 1 no sucesso", async () => {
      const { session } = await setupTestProjectAndSession("process_queue sucesso");
      const task = await prisma.taskNode.create({
        data: {
          id: "pq-succ-1",
          sessionId: session.id,
          title: "Queue Sucesso",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "success";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.processedCount).toBe(1);

      const dbTask = await prisma.taskNode.findUnique({ where: { id: task.id } });
      expect(dbTask?.status).toBe("completed");
      // Divergência 3 unificada (Passo 4a): attempts incrementa só em falha/bloqueio, nunca no sucesso
      expect(dbTask?.attempts).toBe(0);
    });

    it("(b) Tipo 1 reprova → failed e failureHistory acrescida", async () => {
      const { session } = await setupTestProjectAndSession("process_queue tipo 1 falha");
      const task = await prisma.taskNode.create({
        data: {
          id: "pq-fail-1",
          sessionId: session.id,
          title: "Queue Tipo1 Falha",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "bad_code_once";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const dbTask = await prisma.taskNode.findUnique({ where: { id: task.id } });
      expect(dbTask?.status).toBe("completed");
      expect(dbTask?.attempts).toBe(1);
      expect(dbTask?.failureHistory).toBeTruthy();

      const history = JSON.parse(dbTask!.failureHistory!);
      expect(history).toHaveLength(1);
      expect(history[0].attemptNumber).toBe(1);
    });

    it("(c) 3ª falha → blocked, cascata nos dependentes e mensagem de incidente no chat", async () => {
      const { session } = await setupTestProjectAndSession("process_queue 3a falha");
      const taskA = await prisma.taskNode.create({
        data: {
          id: "pq-block-A",
          sessionId: session.id,
          title: "Queue Principal",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 2,
          maxAttempts: 3,
        },
      });

      const taskB = await prisma.taskNode.create({
        data: {
          id: "pq-block-B",
          sessionId: session.id,
          title: "Queue Dependente",
          role: "frontend",
          status: "pending",
          dependencies: JSON.stringify(["pq-block-A"]),
          filesScope: JSON.stringify(["ui.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "bad_code";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const dbTaskA = await prisma.taskNode.findUnique({ where: { id: taskA.id } });
      expect(dbTaskA?.status).toBe("blocked");
      expect(dbTaskA?.attempts).toBe(3);

      const dbTaskB = await prisma.taskNode.findUnique({ where: { id: taskB.id } });
      expect(dbTaskB?.status).toBe("blocked");

      const msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
      const incidentMsgs = msgs.filter((m) => m.content.includes("intervenção humana necessária"));
      expect(incidentMsgs.length).toBe(1);
    });

    it("(e) dois nós sem dependências e ambos com sucesso no mesmo lote → exatamente 1 mensagem 'Execução Autônoma Concluída!'", async () => {
      const { session } = await setupTestProjectAndSession("process_queue 2 nos paralelos");
      await prisma.taskNode.create({
        data: {
          id: "pq-par-1",
          sessionId: session.id,
          title: "Paralelo 1",
          role: "backend",
          status: "pending",
          dependencies: JSON.stringify([]),
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });
      await prisma.taskNode.create({
        data: {
          id: "pq-par-2",
          sessionId: session.id,
          title: "Paralelo 2",
          role: "backend",
          status: "pending",
          dependencies: JSON.stringify([]),
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });

      fakeLlmMode = "success";
      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.allCompleted).toBe(true);
      expect(data.processedCount).toBe(2);

      const msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
      const completionMsgs = msgs.filter((m) => m.content.includes("Execução Autônoma Concluída!"));
      expect(completionMsgs.length).toBe(1);
    });
  });

  describe("Chaves BYOK no despacho (worker vs Auditor Cego)", () => {
    it("AV1.1: Auditor Cego NÃO recebe groqKey, nvidiaKey nem deepseekKey (nunca rota gratuita nem a família do executor); worker segue divergência 2", async () => {
      await prisma.setting.update({
        where: { id: "default" },
        data: {
          omniRouteUrl: baseUrl,
          groqKey: "gsk-test-groq",
          nvidiaKey: "nvapi-test-nvidia",
          deepseekKey: "sk-test-deepseek",
        },
      });

      try {
        // 1. Caminho execute_node
        routerSpy.mockClear();
        const { session: execSession } = await setupTestProjectAndSession("byok execute_node");
        const execTask = await prisma.taskNode.create({
          data: {
            id: "byok-exec-1",
            sessionId: execSession.id,
            title: "Etapa BYOK Exec",
            role: "backend",
            status: "pending",
            filesScope: JSON.stringify(["index.ts"]),
            attempts: 0,
            maxAttempts: 3,
          },
        });

        const execReq = new NextRequest("http://localhost/api/dag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "execute_node", nodeId: execTask.id }),
        });
        const execRes = await POST(execReq);
        expect(execRes.status).toBe(200);

        const execCalls = routerSpy.mock.calls.map((c) => c[0] as DispatchOptions);
        const execAuditorCall = execCalls.find((opts) =>
          opts.messages.some((m) => m.role === "system" && m.content.includes("Auditor Cego"))
        );
        const execWorkerCall = execCalls.find(
          (opts) => !opts.messages.some((m) => m.role === "system" && m.content.includes("Auditor Cego"))
        );

        expect(execWorkerCall).toBeDefined();
        expect(execAuditorCall).toBeDefined();

        // Worker em execute_node recebe todas as chaves BYOK (divergência 2 unificada no Passo 4a)
        expect(execWorkerCall!.groqKey).toBe("gsk-test-groq");
        expect(execWorkerCall!.nvidiaKey).toBe("nvapi-test-nvidia");
        expect(execWorkerCall!.deepseekKey).toBe("sk-test-deepseek");

        // AV1.1: o avaliador é Claude pela Anthropic; nunca recebe chave de rota gratuita nem da DeepSeek
        expect(execAuditorCall!.groqKey).toBeUndefined();
        expect(execAuditorCall!.nvidiaKey).toBeUndefined();
        expect(execAuditorCall!.deepseekKey).toBeUndefined();

        // 2. Caminho process_queue
        routerSpy.mockClear();
        const { session: pqSession } = await setupTestProjectAndSession("byok process_queue");
        await prisma.taskNode.create({
          data: {
            id: "byok-pq-1",
            sessionId: pqSession.id,
            title: "Etapa BYOK Queue",
            role: "backend",
            status: "pending",
            filesScope: JSON.stringify(["index.ts"]),
            attempts: 0,
            maxAttempts: 3,
          },
        });

        const pqReq = new NextRequest("http://localhost/api/dag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process_queue", sessionId: pqSession.id }),
        });
        const pqRes = await POST(pqReq);
        expect(pqRes.status).toBe(200);

        const pqCalls = routerSpy.mock.calls.map((c) => c[0] as DispatchOptions);
        const pqAuditorCall = pqCalls.find((opts) =>
          opts.messages.some((m) => m.role === "system" && m.content.includes("Auditor Cego"))
        );
        const pqWorkerCall = pqCalls.find(
          (opts) => !opts.messages.some((m) => m.role === "system" && m.content.includes("Auditor Cego"))
        );

        expect(pqWorkerCall).toBeDefined();
        expect(pqAuditorCall).toBeDefined();

        // Worker em process_queue recebe as chaves (divergência 2)
        expect(pqWorkerCall!.groqKey).toBe("gsk-test-groq");
        expect(pqWorkerCall!.nvidiaKey).toBe("nvapi-test-nvidia");
        expect(pqWorkerCall!.deepseekKey).toBe("sk-test-deepseek");

        // AV1.1: idem no process_queue
        expect(pqAuditorCall!.groqKey).toBeUndefined();
        expect(pqAuditorCall!.nvidiaKey).toBeUndefined();
        expect(pqAuditorCall!.deepseekKey).toBeUndefined();
      } finally {
        await prisma.setting.update({
          where: { id: "default" },
          data: {
            omniRouteUrl: baseUrl,
            groqKey: null,
            nvidiaKey: null,
            deepseekKey: null,
          },
        });
      }
    });
  });

  // O DualLensAuditor atual nunca devolve REJECTED sem motivo (dual-lens-auditor.ts:396, 499, 544),
  // mas a interface permite (rejectionReason?: string). Estes testes fixam como cada caminho reage
  // a esse retorno — a divergência do fallback do Tipo 2 só se manifesta se o contrato do auditor mudar.
  describe("Fallback do motivo de rejeição do Tipo 2 (divergência 3 de motivo)", () => {
    const rejectedWithoutReason: ValidationType2Result = {
      verdict: "REJECTED",
      lens1BlindReport: "",
      lens2CrossVerification: "",
      rejectionReason: undefined,
      method: "llm_blind",
    };

    it("(b2) execute_node: Tipo 2 reprova sem motivo → sem fallback no result, 'Falha não especificada.' no histórico", async () => {
      const validateType2Spy = vi
        .spyOn(DualLensAuditor, "validateType2")
        .mockResolvedValueOnce(rejectedWithoutReason);
      try {
        const { session } = await setupTestProjectAndSession("execute_node tipo 2 sem motivo");
        const task = await prisma.taskNode.create({
          data: {
            id: "exec-t2-noreason",
            sessionId: session.id,
            title: "Etapa Tipo2 Sem Motivo",
            role: "backend",
            status: "pending",
            filesScope: JSON.stringify(["index.ts"]),
            attempts: 0,
            maxAttempts: 3,
          },
        });

        fakeLlmMode = "success";
        const req = new NextRequest("http://localhost/api/dag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "execute_node", nodeId: task.id }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(validateType2Spy).toHaveBeenCalledTimes(1);

        const dbTask = await prisma.taskNode.findUnique({ where: { id: task.id } });
        expect(dbTask?.status).toBe("failed");
        const result = JSON.parse(dbTask!.result!);
        expect(result.auditVerdict).toBe("REJECTED");
        expect(result.rejectionReason).toBe("Divergência semântica.");
        const history = JSON.parse(dbTask!.failureHistory!);
        expect(history).toHaveLength(1);
        expect(history[0].rejectionReason).toBe("Divergência semântica.");
      } finally {
        validateType2Spy.mockRestore();
      }
    });

    it("(b2) process_queue: Tipo 2 reprova sem motivo → 'Divergência semântica.' no result e no histórico", async () => {
      const validateType2Spy = vi
        .spyOn(DualLensAuditor, "validateType2")
        .mockResolvedValueOnce(rejectedWithoutReason);
      try {
        const { session } = await setupTestProjectAndSession("process_queue tipo 2 sem motivo");
        await prisma.taskNode.create({
          data: {
            id: "pq-t2-noreason",
            sessionId: session.id,
            title: "Etapa Tipo2 Sem Motivo",
            role: "backend",
            status: "pending",
            filesScope: JSON.stringify(["index.ts"]),
            attempts: 2,
            maxAttempts: 3,
          },
        });

        // attempts=2/maxAttempts=3: a reprovação bloqueia o nó e o lote termina sem reexecutá-lo.
        fakeLlmMode = "success";
        const req = new NextRequest("http://localhost/api/dag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(validateType2Spy).toHaveBeenCalledTimes(1);

        const dbTask = await prisma.taskNode.findUnique({ where: { id: "pq-t2-noreason" } });
        expect(dbTask?.status).toBe("blocked");
        const result = JSON.parse(dbTask!.result!);
        expect(result.auditVerdict).toBe("REJECTED");
        expect(result.rejectionReason).toBe("Divergência semântica.");
        const history = JSON.parse(dbTask!.failureHistory!);
        expect(history).toHaveLength(1);
        expect(history[0].rejectionReason).toBe("Divergência semântica.");
      } finally {
        validateType2Spy.mockRestore();
      }
    });
  });

  // Contrato do serviço único: executeTaskNode só executa o nó. Cascata, relatório ao chat e
  // mensagem de conclusão ficam com o chamador (uma vez por nó em execute_node, uma vez por lote
  // ou por fila em process_queue) — senão nós paralelos do mesmo lote duplicam essas mensagens.
  describe("Contrato de executeTaskNode (sem efeitos de sessão)", () => {
    it("(g1) último nó pendente concluído → nenhuma mensagem de conclusão criada pelo executor", async () => {
      const { session } = await setupTestProjectAndSession("contrato conclusao");
      await prisma.taskNode.create({
        data: {
          id: "contract-done-1",
          sessionId: session.id,
          title: "Etapa Única",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });
      const fullTask = await prisma.taskNode.findUniqueOrThrow({
        where: { id: "contract-done-1" },
        include: { session: { include: { project: true } } },
      });

      fakeLlmMode = "success";
      const execResult = await executeTaskNode(fullTask, {});
      expect(execResult.finalStatus).toBe("completed");

      const msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
      expect(msgs.filter((m) => m.content.includes("Execução Autônoma Concluída!"))).toHaveLength(0);
    });

    it("(g2) 3ª falha → blocked sem cascata nos dependentes e sem mensagem de incidente criada pelo executor", async () => {
      const { session } = await setupTestProjectAndSession("contrato bloqueio");
      await prisma.taskNode.create({
        data: {
          id: "contract-block-A",
          sessionId: session.id,
          title: "Etapa Principal",
          role: "backend",
          status: "pending",
          filesScope: JSON.stringify(["index.ts"]),
          attempts: 2,
          maxAttempts: 3,
        },
      });
      await prisma.taskNode.create({
        data: {
          id: "contract-block-B",
          sessionId: session.id,
          title: "Etapa Dependente",
          role: "frontend",
          status: "pending",
          dependencies: JSON.stringify(["contract-block-A"]),
          filesScope: JSON.stringify(["ui.ts"]),
          attempts: 0,
          maxAttempts: 3,
        },
      });
      const fullTask = await prisma.taskNode.findUniqueOrThrow({
        where: { id: "contract-block-A" },
        include: { session: { include: { project: true } } },
      });

      fakeLlmMode = "bad_code";
      const execResult = await executeTaskNode(fullTask, {});
      expect(execResult.finalStatus).toBe("blocked");

      const dependent = await prisma.taskNode.findUnique({ where: { id: "contract-block-B" } });
      expect(dependent?.status).toBe("pending");

      const msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
      expect(msgs.filter((m) => m.content.includes("intervenção humana necessária"))).toHaveLength(0);
    });
  });
});
