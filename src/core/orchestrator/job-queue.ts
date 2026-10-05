import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import {
  processSessionQueue,
  recoverZombieRunningNodes,
  type SessionQueueResult,
} from "@/core/orchestrator/session-queue";
import type { Job } from "@prisma/client";

export const DEFAULT_JOB_LEASE_MS = 30000;

export function getJobLeaseMs(): number {
  const raw = Number(process.env.NEXTCODE_JOB_LEASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JOB_LEASE_MS;
}

/**
 * Enfileira um Job "session_queue" em status "queued".
 * TODO(passo-4): deduplicar jobs por sessão e garantir gatilho único / trava por sessão.
 */
export async function enqueueSessionQueueJob(sessionId: string): Promise<string> {
  const job = await prisma.job.create({
    data: {
      sessionId,
      kind: "session_queue",
      status: "queued",
    },
  });
  return job.id;
}

/**
 * Reserva atômica de um Job com UM único updateMany.
 * Ganha a reserva apenas quem recebe count === 1.
 * Se o job estava "running" com lease vencido, incrementa reclaims na mesma operação.
 */
export async function claimJob(jobId: string, workerId: string): Promise<boolean> {
  const now = new Date();
  const leaseMs = getJobLeaseMs();
  const lockedUntil = new Date(now.getTime() + leaseMs);

  const prior = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true, lockedUntil: true, startedAt: true },
  });
  if (!prior) {
    return false;
  }

  const wasRunningWithExpiredLease =
    prior.status === "running" &&
    prior.lockedUntil !== null &&
    prior.lockedUntil.getTime() < now.getTime();

  const updated = await prisma.job.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "queued" },
        { status: "running", lockedUntil: { lt: now } },
      ],
    },
    data: {
      status: "running",
      lockedBy: workerId,
      lockedUntil,
      startedAt: prior.startedAt ?? now,
      ...(wasRunningWithExpiredLease ? { reclaims: { increment: 1 } } : {}),
    },
  });

  return updated.count === 1;
}

/**
 * Renova o lease (lockedUntil = now + LEASE) se o worker ainda for o dono (where { id, lockedBy }).
 */
export async function renewJobLease(jobId: string, workerId: string): Promise<boolean> {
  const leaseMs = getJobLeaseMs();
  const lockedUntil = new Date(Date.now() + leaseMs);
  const res = await prisma.job.updateMany({
    where: {
      id: jobId,
      lockedBy: workerId,
    },
    data: {
      lockedUntil,
    },
  });
  return res.count === 1;
}

/**
 * Inicia o heartbeat periódico que renova lockedUntil a cada LEASE/3.
 * Retorna função de parada para ser chamada obrigatoriamente no finally.
 */
export function startJobHeartbeat(jobId: string, workerId: string): () => void {
  const leaseMs = getJobLeaseMs();
  const intervalMs = Math.max(5, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void renewJobLease(jobId, workerId).catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return () => {
    clearInterval(timer);
  };
}

/**
 * Executa um Job já reservado via claimJob:
 * - mantém heartbeat ativo durante a execução (parando no finally);
 * - aplica a regra 3.4 de retomada após queda quando reclaims > 0;
 * - chama processSessionQueue e grava status done (com result) ou failed (com lastError) e finishedAt.
 */
export async function executeClaimedJob(jobId: string, workerId: string): Promise<Job | null> {
  const stopHeartbeat = startJobHeartbeat(jobId, workerId);
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return null;
    }

    // 3.4 Retomada após queda: quando claimJob reservou um job que estava "running" com lease vencido (reclaims > 0)
    if (job.reclaims > 0) {
      if (job.reclaims <= 3) {
        const now = new Date();
        const otherValidJob = await prisma.job.findFirst({
          where: {
            sessionId: job.sessionId,
            id: { not: job.id },
            status: "running",
            lockedUntil: { gt: now },
          },
        });

        if (!otherValidJob) {
          const runningNodes = await prisma.taskNode.findMany({
            where: {
              sessionId: job.sessionId,
              status: "running",
            },
          });

          for (const node of runningNodes) {
            await prisma.taskNode.update({
              where: { id: node.id },
              data: { status: "pending" },
            });
            TelemetryLogger.log({
              sessionId: job.sessionId,
              action: "NODE_RESUMED_AFTER_CRASH",
              details: {
                nodeId: node.id,
                jobId: job.id,
                reclaims: job.reclaims,
              },
            });
          }
        }
      } else {
        // reclaims > 3: o job vai para failed e os nós "running" seguem o caminho de zumbi (consome tentativa, failureHistory, cascata e relatório)
        await recoverZombieRunningNodes(job.sessionId, { ignoreStaleThreshold: true });
        return await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "failed",
            lastError: `Limite de retomadas excedido (reclaims=${job.reclaims}).`,
            finishedAt: new Date(),
          },
        });
      }
    }

    const queueResult: SessionQueueResult = await processSessionQueue(job.sessionId);

    return await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "done",
        result: JSON.stringify(queueResult),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return await prisma.job
      .update({
        where: { id: jobId },
        data: {
          status: "failed",
          lastError: errorMessage,
          finishedAt: new Date(),
        },
      })
      .catch(() => null);
  } finally {
    stopHeartbeat();
  }
}
