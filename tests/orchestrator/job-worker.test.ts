import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, type ChildProcess } from "child_process";
import type { AddressInfo } from "net";
import prisma from "@/lib/prisma";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import * as sessionQueueModule from "@/core/orchestrator/session-queue";
import { enqueueSessionQueueJob, claimJob } from "@/core/orchestrator/job-queue";
import {
  runOnce,
  startJobWorker,
  stopJobWorker,
} from "@/core/orchestrator/job-worker";
import { setPaidOnlyRoutingForTests } from "@/core/orchestrator/node-executor";

let server: http.Server;
let baseUrl: string;
let tempDir: string;
let fakeLlmDelayMs = 0;
let skillMinerAnalyzeSpy: ReturnType<typeof vi.spyOn>;
let skillMinerDetectSpy: ReturnType<typeof vi.spyOn>;

const createdSessionIds: string[] = [];
const createdProjectIds: string[] = [];

const savedEnv = {
  OMNIROUTE_URL: process.env.OMNIROUTE_URL,
  OMNIROUTE_MODEL: process.env.OMNIROUTE_MODEL,
  OMNIROUTE_CB_COOLDOWN_MS: process.env.OMNIROUTE_CB_COOLDOWN_MS,
  BLIND_AUDIT_TIMEOUT_MS: process.env.BLIND_AUDIT_TIMEOUT_MS,
  DAG_STEP_TIMEOUT_MS: process.env.DAG_STEP_TIMEOUT_MS,
  NEXTCODE_JOB_LEASE_MS: process.env.NEXTCODE_JOB_LEASE_MS,
  NEXTCODE_WORKER_POLL_MS: process.env.NEXTCODE_WORKER_POLL_MS,
  NEXTCODE_WORKER_CONCURRENCY: process.env.NEXTCODE_WORKER_CONCURRENCY,
};

let originalSetting: Awaited<ReturnType<typeof prisma.setting.findUnique>> = null;

async function cleanupWorkerTestRecords(): Promise<void> {
  await stopJobWorker();
  if (createdSessionIds.length > 0) {
    await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
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

async function setupProjectAndSession(title: string) {
  const project = await prisma.project.create({
    data: { name: title, path: tempDir },
  });
  createdProjectIds.push(project.id);

  const session = await prisma.session.create({
    data: {
      title,
      projectId: project.id,
      specApproved: true,
      canonicalSpec: `# Spec\n\n## Arquivos Afetados\n- \`index.ts\``,
    },
  });
  createdSessionIds.push(session.id);

  return { project, session };
}

beforeAll(async () => {
  process.env.OMNIROUTE_CB_COOLDOWN_MS = "1";
  process.env.BLIND_AUDIT_TIMEOUT_MS = "5000";
  process.env.DAG_STEP_TIMEOUT_MS = "5000";
  process.env.OMNIROUTE_MODEL = "auto/best-free";

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-worker-test-"));

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

        const respond = () => {
          if (res.writableEnded || res.destroyed) return;
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

        if (!isBlindAudit && fakeLlmDelayMs > 0) {
          const timer = setTimeout(respond, fakeLlmDelayMs);
          req.on("close", () => clearTimeout(timer));
          return;
        }

        return respond();
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

  skillMinerAnalyzeSpy = vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue(null as any);
  skillMinerDetectSpy = vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue(null as any);
}, 30000);

beforeEach(async () => {
  setPaidOnlyRoutingForTests(false);
  fakeLlmDelayMs = 0;
  process.env.OMNIROUTE_URL = baseUrl;
  process.env.NEXTCODE_JOB_LEASE_MS = "30000";
  process.env.NEXTCODE_WORKER_POLL_MS = "2000";
  process.env.NEXTCODE_WORKER_CONCURRENCY = "2";
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
  await cleanupWorkerTestRecords();
});

afterAll(async () => {
  setPaidOnlyRoutingForTests(null);
  await cleanupWorkerTestRecords();
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

describe("Worker de Jobs e Retomada Automática após Queda (Passo 3)", () => {
  it("4. retomada: sessão com nó 'running' (updatedAt recente), job running com lease vencido e LLM falso em sucesso → runOnce → nó completed sem tentativa consumida pela queda, job done e telemetria NODE_RESUMED_AFTER_CRASH registrada", async () => {
    const { session } = await setupProjectAndSession("retomada apos queda");

    const task = await prisma.taskNode.create({
      data: {
        id: "resume-node-1",
        sessionId: session.id,
        title: "Etapa Retomada",
        role: "backend",
        status: "running",
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });

    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "dead-worker-1");
    await prisma.job.update({
      where: { id: jobId },
      data: {
        lockedUntil: new Date(Date.now() - 5000),
      },
    });

    let statusBeforeQueue: string | undefined;
    let attemptsBeforeQueue: number | undefined;
    const origProcessQueue = sessionQueueModule.processSessionQueue;
    const queueSpy = vi.spyOn(sessionQueueModule, "processSessionQueue").mockImplementationOnce(async (sid) => {
      const nodeBefore = await prisma.taskNode.findUnique({ where: { id: task.id } });
      statusBeforeQueue = nodeBefore?.status;
      attemptsBeforeQueue = nodeBefore?.attempts;
      return origProcessQueue(sid);
    });

    try {
      const executedCount = await runOnce("live-worker-2");
      expect(executedCount).toBe(1);

      // Na retomada (3.4) antes de processSessionQueue, o nó voltou para "pending" com attempts inalterado (0)
      expect(statusBeforeQueue).toBe("pending");
      expect(attemptsBeforeQueue).toBe(0);

      const updatedTask = await prisma.taskNode.findUniqueOrThrow({ where: { id: task.id } });
      expect(updatedTask.status).toBe("completed");
      expect(updatedTask.failureHistory).toBe("[]");
      expect(updatedTask.attempts).toBe(0);

      const updatedJob = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      expect(updatedJob.status).toBe("done");
      expect(updatedJob.reclaims).toBe(1);
      expect(updatedJob.lockedBy).toBe("live-worker-2");
      expect(updatedJob.finishedAt).not.toBeNull();
      expect(updatedJob.result).not.toBeNull();

      const parsedResult = JSON.parse(updatedJob.result!);
      expect(parsedResult.processedCount).toBe(1);
      expect(parsedResult.allCompleted).toBe(true);

      await new Promise((r) => setTimeout(r, 30));
      const telemetryLogs = await prisma.telemetryLog.findMany({
        where: {
          sessionId: session.id,
          action: "NODE_RESUMED_AFTER_CRASH",
        },
      });
      expect(telemetryLogs).toHaveLength(1);
      const details = JSON.parse(telemetryLogs[0].details!);
      expect(details).toEqual({
        nodeId: task.id,
        jobId,
        reclaims: 1,
      });
    } finally {
      queueSpy.mockRestore();
    }
  });

  it("5. retomada esgotada: mesmo cenário com reclaims = 3 antes do claim → job failed, nó consome tentativa pelo caminho de zumbi e com attempts 2/3 vira blocked com relatório no chat", async () => {
    const { session } = await setupProjectAndSession("retomada esgotada");

    const taskA = await prisma.taskNode.create({
      data: {
        id: "exhaust-node-A",
        sessionId: session.id,
        title: "Etapa Crash Recorrente",
        role: "backend",
        status: "running",
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 2,
        maxAttempts: 3,
      },
    });

    const taskB = await prisma.taskNode.create({
      data: {
        id: "exhaust-node-B",
        sessionId: session.id,
        title: "Etapa Dependente",
        role: "frontend",
        status: "pending",
        dependencies: JSON.stringify([taskA.id]),
        filesScope: JSON.stringify(["ui.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });

    const jobId = await enqueueSessionQueueJob(session.id);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "running",
        lockedBy: "dead-worker-3",
        lockedUntil: new Date(Date.now() - 5000),
        reclaims: 3,
      },
    });

    const executedCount = await runOnce("live-worker-4");
    expect(executedCount).toBe(1);

    const updatedJob = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(updatedJob.status).toBe("failed");
    expect(updatedJob.reclaims).toBe(4);
    expect(updatedJob.lastError).toContain("reclaims=4");
    expect(updatedJob.finishedAt).not.toBeNull();

    const updatedTaskA = await prisma.taskNode.findUniqueOrThrow({ where: { id: taskA.id } });
    expect(updatedTaskA.status).toBe("blocked");
    expect(updatedTaskA.attempts).toBe(3);
    const historyA = JSON.parse(updatedTaskA.failureHistory);
    expect(historyA).toHaveLength(1);
    expect(historyA[0].attemptNumber).toBe(3);

    const updatedTaskB = await prisma.taskNode.findUniqueOrThrow({ where: { id: taskB.id } });
    expect(updatedTaskB.status).toBe("blocked");

    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    const incidentMsgs = messages.filter((m) => m.content.includes("intervenção humana necessária"));
    expect(incidentMsgs).toHaveLength(1);
  });

  it("6. startJobWorker chamado duas vezes → um único laço; stopJobWorker encerra", async () => {
    process.env.NEXTCODE_WORKER_POLL_MS = "35";

    const handle1 = startJobWorker();
    const handle2 = startJobWorker();

    expect(handle1).toBe(handle2);
    expect((globalThis as any).__nextcodeJobWorker).toBe(handle1);
    expect(handle1.running).toBe(true);

    await new Promise((r) => setTimeout(r, 95));
    expect(handle1.cycles).toBeGreaterThanOrEqual(2);

    await stopJobWorker();
    expect(handle1.running).toBe(false);
    expect((globalThis as any).__nextcodeJobWorker).toBeUndefined();

    const cyclesAtStop = handle1.cycles;
    await new Promise((r) => setTimeout(r, 90));
    expect(handle1.cycles).toBe(cyclesAtStop);
  });

  it("7. exceção dentro de processSessionQueue → job failed com lastError, e o próximo runOnce segue funcionando", async () => {
    const { session: session1 } = await setupProjectAndSession("sessao erro fatal");
    const job1Id = await enqueueSessionQueueJob(session1.id);

    const queueSpy = vi
      .spyOn(sessionQueueModule, "processSessionQueue")
      .mockRejectedValueOnce(new Error("Erro fatal simulado em processSessionQueue"));

    try {
      const count1 = await runOnce("worker-resilient");
      expect(count1).toBe(1);

      const job1Db = await prisma.job.findUniqueOrThrow({ where: { id: job1Id } });
      expect(job1Db.status).toBe("failed");
      expect(job1Db.lastError).toBe("Erro fatal simulado em processSessionQueue");
      expect(job1Db.finishedAt).not.toBeNull();
    } finally {
      queueSpy.mockRestore();
    }

    // Próximo runOnce deve funcionar normalmente
    const { session: session2 } = await setupProjectAndSession("sessao seguinte ok");
    const task2 = await prisma.taskNode.create({
      data: {
        id: "resilient-node-2",
        sessionId: session2.id,
        title: "Etapa Após Exceção",
        role: "backend",
        status: "pending",
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });
    const job2Id = await enqueueSessionQueueJob(session2.id);

    const count2 = await runOnce("worker-resilient");
    expect(count2).toBe(1);

    const job2Db = await prisma.job.findUniqueOrThrow({ where: { id: job2Id } });
    expect(job2Db.status).toBe("done");
    expect(job2Db.lastError).toBeNull();
    expect(job2Db.finishedAt).not.toBeNull();

    const task2Db = await prisma.taskNode.findUniqueOrThrow({ where: { id: task2.id } });
    expect(task2Db.status).toBe("completed");
  });

  it("8. critério de aceite 2 (queda real): processo filho tsx morre com nó em running e segundo processo retoma e conclui", async () => {
    const { session } = await setupProjectAndSession("queda real child process");
    const task = await prisma.taskNode.create({
      data: {
        id: "real-crash-node-1",
        sessionId: session.id,
        title: "Etapa Queda Real",
        role: "backend",
        status: "pending",
        filesScope: JSON.stringify(["index.ts"]),
        attempts: 0,
        maxAttempts: 3,
      },
    });

    const jobId = await enqueueSessionQueueJob(session.id);

    const tsxCli = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const jobWorkerModulePath = path
      .resolve(process.cwd(), "src", "core", "orchestrator", "job-worker.ts")
      .replace(/\\/g, "/");
    const nodeExecutorModulePath = path
      .resolve(process.cwd(), "src", "core", "orchestrator", "node-executor.ts")
      .replace(/\\/g, "/");
    const workerScriptFile = path.join(tempDir, "child-worker.ts");
    fs.writeFileSync(
      workerScriptFile,
      `import { startJobWorker } from "${jobWorkerModulePath}";\nimport { setPaidOnlyRoutingForTests } from "${nodeExecutorModulePath}";\nsetPaidOnlyRoutingForTests(false);\nstartJobWorker();\nsetInterval(() => {}, 1000);\n`,
      "utf-8"
    );

    const spawnWorkerProcess = (): ChildProcess => {
      return spawn(process.execPath, [tsxCli, "--tsconfig", "tsconfig.json", workerScriptFile], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
          OMNIROUTE_URL: baseUrl,
          OMNIROUTE_MODEL: "auto/best-free",
          NEXTCODE_JOB_LEASE_MS: "400",
          NEXTCODE_WORKER_POLL_MS: "50",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    };

    // Etapa 1: inicia o 1º processo filho com o LLM falso atrasando a resposta
    fakeLlmDelayMs = 10000;
    const t0 = Date.now();
    const child1 = spawnWorkerProcess();

    try {
      const waitRunningDeadline = Date.now() + 8000;
      let nodeRunning = false;
      while (Date.now() < waitRunningDeadline) {
        const currentTask = await prisma.taskNode.findUnique({ where: { id: task.id } });
        if (currentTask?.status === "running") {
          nodeRunning = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      const stage1Ms = Date.now() - t0;
      console.log(`[Teste 8] Etapa 1 (1º processo iniciou e colocou nó em 'running'): ${stage1Ms}ms`);
      expect(nodeRunning).toBe(true);

      const jobDuringChild1 = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      expect(jobDuringChild1.status).toBe("running");
      expect(jobDuringChild1.reclaims).toBe(0);

      // Etapa 2: mata o 1º processo filho (child.kill)
      const tKill = Date.now();
      const killed = child1.kill();
      expect(killed).toBe(true);
      await new Promise<void>((resolve) => {
        if (child1.exitCode !== null || child1.signalCode !== null) return resolve();
        child1.once("exit", () => resolve());
      });
      const stage2Ms = Date.now() - tKill;
      console.log(`[Teste 8] Etapa 2 (1º processo morto via child.kill): ${stage2Ms}ms`);
    } finally {
      if (child1.exitCode === null && child1.signalCode === null) {
        child1.kill();
      }
    }

    // Etapa 3: sobe o 2º processo filho (com LLM respondendo imediatamente) e aguarda conclusão após expiração do lease
    fakeLlmDelayMs = 0;
    const tResume = Date.now();
    const child2 = spawnWorkerProcess();

    try {
      const waitDoneDeadline = Date.now() + 10000;
      let completed = false;
      while (Date.now() < waitDoneDeadline) {
        const [currentTask, currentJob] = await Promise.all([
          prisma.taskNode.findUnique({ where: { id: task.id } }),
          prisma.job.findUnique({ where: { id: jobId } }),
        ]);
        if (currentTask?.status === "completed" && currentJob?.status === "done") {
          completed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      const stage3Ms = Date.now() - tResume;
      console.log(`[Teste 8] Etapa 3 (2º processo retomou após lease vencido e concluiu nó/job): ${stage3Ms}ms`);
      expect(completed).toBe(true);

      const finalTask = await prisma.taskNode.findUniqueOrThrow({ where: { id: task.id } });
      expect(finalTask.status).toBe("completed");
      expect(finalTask.failureHistory).toBe("[]");

      const finalJob = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      expect(finalJob.status).toBe("done");
      expect(finalJob.reclaims).toBe(1);
      expect(finalJob.finishedAt).not.toBeNull();

      const crashLogs = await prisma.telemetryLog.findMany({
        where: {
          sessionId: session.id,
          action: "NODE_RESUMED_AFTER_CRASH",
        },
      });
      expect(crashLogs).toHaveLength(1);
    } finally {
      if (child2.exitCode === null && child2.signalCode === null) {
        child2.kill();
        await new Promise<void>((resolve) => {
          if (child2.exitCode !== null || child2.signalCode !== null) return resolve();
          child2.once("exit", () => resolve());
        });
      }
    }
  }, 30000);
});
