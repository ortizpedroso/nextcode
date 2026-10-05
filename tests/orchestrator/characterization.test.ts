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

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

let server: http.Server;
let baseUrl: string;
let fakeLlmMode: "success" | "bad_code" | "bad_code_once" = "success";
let tempDir: string;
let routerSpy: any;

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

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  await prisma.setting.upsert({
    where: { id: "default" },
    update: { omniRouteUrl: baseUrl },
    create: { id: "default", omniRouteUrl: baseUrl },
  });

  process.env.OMNIROUTE_MODEL = "auto/best-free";

  routerSpy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(async (options: DispatchOptions) => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: options.messages }),
    });
    return {
      response: res,
      providerUsed: "omniroute",
      badge: "[OmniRoute]",
      tierTag: "omniroute",
      modelUsed: "auto/best-free",
    };
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  fakeLlmMode = "success";
  await new Promise((resolve) => setTimeout(resolve, 2));

  await prisma.taskNode.deleteMany().catch(() => {});
  await prisma.message.deleteMany().catch(() => {});
  await prisma.session.deleteMany().catch(() => {});
  await prisma.project.deleteMany().catch(() => {});
});

async function setupTestProjectAndSession(title: string) {
  const project = await prisma.project.create({
    data: { name: title, path: tempDir },
  });
  const session = await prisma.session.create({
    data: { title, projectId: project.id, specApproved: true },
  });
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
      const incidentMsg = msgs.find((m) => m.content.includes("intervenção humana necessária"));
      expect(incidentMsg).toBeTruthy();
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
      // Divergência 3: process_queue SEMPRE incrementa attempts (de 0 para 1) mesmo no sucesso
      expect(dbTask?.attempts).toBe(1);
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
      expect(dbTask?.attempts).toBe(2);
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
      const incidentMsg = msgs.find((m) => m.content.includes("intervenção humana necessária"));
      expect(incidentMsg).toBeTruthy();
    });
  });
});
