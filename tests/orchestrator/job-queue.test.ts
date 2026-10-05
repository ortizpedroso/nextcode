import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  enqueueSessionQueueJob,
  claimJob,
  renewJobLease,
  startJobHeartbeat,
} from "@/core/orchestrator/job-queue";

const createdSessionIds: string[] = [];
const savedLeaseEnv = process.env.NEXTCODE_JOB_LEASE_MS;

const moduleLoadedAt = new Date(Date.now() - 2000);

function isCharacterizationInCurrentRun(): boolean {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-") && a !== "run" && !a.includes("vitest"));
  if (args.length === 0) return true;
  return args.some((a) => a.includes("characterization") || a.endsWith("orchestrator") || a.endsWith("orchestrator/"));
}

async function isCharacterizationServerActive(): Promise<boolean> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const url = setting?.omniRouteUrl;
  if (!url || url.includes(":20128")) {
    return false;
  }
  try {
    const res = await fetch(`${url.replace(/\/v1\/?$/, "")}/healthz`, {
      signal: AbortSignal.timeout(150),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCharacterizationToComplete(): Promise<void> {
  const mustWaitForCharCompletion = isCharacterizationInCurrentRun();
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (mustWaitForCharCompletion) {
      const charLastLog = await prisma.telemetryLog.findFirst({
        where: {
          action: "NODE_EXECUTION_BLOCKED",
          details: { contains: "contract-block-A" },
          createdAt: { gte: moduleLoadedAt },
        },
      });
      if (!charLastLog) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
    }
    if (!(await isCharacterizationServerActive())) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function cleanupTestRecords(): Promise<void> {
  if (createdSessionIds.length > 0) {
    await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    createdSessionIds.length = 0;
  }
}

async function createTestSession(title: string) {
  const session = await prisma.session.create({
    data: {
      title,
      specApproved: true,
    },
  });
  createdSessionIds.push(session.id);
  return session;
}

beforeAll(async () => {
  await waitForCharacterizationToComplete();
}, 30000);

beforeEach(async () => {
  process.env.NEXTCODE_JOB_LEASE_MS = "30000";
  await cleanupTestRecords();
});

afterAll(async () => {
  if (savedLeaseEnv === undefined) {
    delete process.env.NEXTCODE_JOB_LEASE_MS;
  } else {
    process.env.NEXTCODE_JOB_LEASE_MS = savedLeaseEnv;
  }
  await cleanupTestRecords();
});

describe("Fila de Jobs no banco — reserva atômica e heartbeat (Passo 3)", () => {
  it("1. duas chamadas concorrentes de claimJob no mesmo job → exatamente uma ganha", async () => {
    const session = await createTestSession("claim concorrente");
    const jobId = await enqueueSessionQueueJob(session.id);

    const [wonA, wonB] = await Promise.all([
      claimJob(jobId, "worker-A"),
      claimJob(jobId, "worker-B"),
    ]);

    expect([wonA, wonB].filter(Boolean)).toHaveLength(1);
    expect(wonA !== wonB).toBe(true);

    const expectedWinner = wonA ? "worker-A" : "worker-B";
    const jobDb = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(jobDb.status).toBe("running");
    expect(jobDb.lockedBy).toBe(expectedWinner);
    expect(jobDb.reclaims).toBe(0);
    expect(jobDb.lockedUntil).not.toBeNull();
    expect(jobDb.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("2. job running com lease válido não é reservável; com lease vencido é reservável e reclaims vira 1", async () => {
    const session = await createTestSession("lease valido vs vencido");
    const jobId = await enqueueSessionQueueJob(session.id);

    const firstClaim = await claimJob(jobId, "worker-1");
    expect(firstClaim).toBe(true);

    // Enquanto o lease está válido, outro worker não consegue reservar
    const claimWhileValid = await claimJob(jobId, "worker-2");
    expect(claimWhileValid).toBe(false);

    const jobStillOwned = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(jobStillOwned.lockedBy).toBe("worker-1");
    expect(jobStillOwned.reclaims).toBe(0);

    // Expira o lease no banco
    const expiredDate = new Date(Date.now() - 2000);
    await prisma.job.update({
      where: { id: jobId },
      data: { lockedUntil: expiredDate },
    });

    // Com lease vencido, worker-2 consegue reservar e reclaims incrementa para 1 na mesma operação
    const claimAfterExpired = await claimJob(jobId, "worker-2");
    expect(claimAfterExpired).toBe(true);

    const jobReclaimed = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(jobReclaimed.status).toBe("running");
    expect(jobReclaimed.lockedBy).toBe("worker-2");
    expect(jobReclaimed.reclaims).toBe(1);
    expect(jobReclaimed.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("3. heartbeat renova lockedUntil; um worker que perdeu a reserva (lockedBy diferente) não renova", async () => {
    process.env.NEXTCODE_JOB_LEASE_MS = "90";
    const session = await createTestSession("heartbeat lease");
    const jobId = await enqueueSessionQueueJob(session.id);

    const claimed = await claimJob(jobId, "worker-owner");
    expect(claimed).toBe(true);

    const beforeHeartbeat = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const initialLockedUntilMs = beforeHeartbeat.lockedUntil!.getTime();

    const stopHeartbeat = startJobHeartbeat(jobId, "worker-owner");
    try {
      await new Promise((r) => setTimeout(r, 95));
    } finally {
      stopHeartbeat();
    }

    const afterHeartbeat = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(afterHeartbeat.lockedUntil!.getTime()).toBeGreaterThan(initialLockedUntilMs);

    // Simula perda da reserva para outro worker (lockedBy diferente)
    const fixedLockedUntil = new Date(Date.now() + 5000);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        lockedBy: "worker-other",
        lockedUntil: fixedLockedUntil,
      },
    });

    const renewedByStaleOwner = await renewJobLease(jobId, "worker-owner");
    expect(renewedByStaleOwner).toBe(false);

    const stopStaleHeartbeat = startJobHeartbeat(jobId, "worker-owner");
    try {
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      stopStaleHeartbeat();
    }

    const afterStaleAttempt = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(afterStaleAttempt.lockedBy).toBe("worker-other");
    expect(afterStaleAttempt.lockedUntil!.getTime()).toBe(fixedLockedUntil.getTime());
  });
});
