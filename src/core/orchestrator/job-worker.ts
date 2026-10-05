import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  enqueueSessionQueueJob,
  claimJob,
  executeClaimedJob,
} from "@/core/orchestrator/job-queue";

export const DEFAULT_WORKER_CONCURRENCY = 2;
export const DEFAULT_WORKER_POLL_MS = 2000;

export function getWorkerConcurrency(): number {
  const raw = Number(process.env.NEXTCODE_WORKER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WORKER_CONCURRENCY;
}

export function getWorkerPollMs(): number {
  const raw = Number(process.env.NEXTCODE_WORKER_POLL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WORKER_POLL_MS;
}

const defaultProcessWorkerId = `worker-${crypto.randomUUID()}`;

export function getProcessWorkerId(): string {
  return defaultProcessWorkerId;
}

/**
 * Busca sessões órfãs em EXECUCAO com nós pending/failed/running e sem Job ativo (queued/running),
 * enfileirando um Job para cada uma na partida do worker.
 */
export async function recoverOrphanExecutionSessions(): Promise<number> {
  const orphanSessions = await prisma.session.findMany({
    where: {
      phase: "EXECUCAO",
      tasks: {
        some: {
          status: { in: ["pending", "failed", "running"] },
        },
      },
      jobs: {
        none: {
          status: { in: ["queued", "running"] },
        },
      },
    },
    select: { id: true },
  });

  for (const session of orphanSessions) {
    await enqueueSessionQueueJob(session.id);
  }

  return orphanSessions.length;
}

/**
 * Busca jobs elegíveis (queued ou running com lease vencido), tenta claimJob
 * e executa até NEXTCODE_WORKER_CONCURRENCY (padrão 2) simultaneamente.
 * Retorna quantos jobs foram reservados e executados neste ciclo.
 */
export async function runOnce(workerId: string = defaultProcessWorkerId): Promise<number> {
  const concurrency = getWorkerConcurrency();
  const now = new Date();

  const eligibleJobs = await prisma.job.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "running", lockedUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const claimedJobIds: string[] = [];
  for (const candidate of eligibleJobs) {
    if (claimedJobIds.length >= concurrency) {
      break;
    }
    const won = await claimJob(candidate.id, workerId);
    if (won) {
      claimedJobIds.push(candidate.id);
    }
  }

  if (claimedJobIds.length === 0) {
    return 0;
  }

  await Promise.all(
    claimedJobIds.map(async (jobId) => {
      try {
        await executeClaimedJob(jobId, workerId);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await prisma.job
          .updateMany({
            where: { id: jobId, lockedBy: workerId },
            data: {
              status: "failed",
              activeKey: null,
              lastError: errorMessage,
              finishedAt: new Date(),
            },
          })
          .catch(() => {});
      }
    })
  );

  return claimedJobIds.length;
}

export interface JobWorkerHandle {
  workerId: string;
  running: boolean;
  cycles: number;
  timer: ReturnType<typeof setTimeout> | null;
  wakeSleep: (() => void) | null;
  loopPromise: Promise<void> | null;
}

const globalForJobWorker = globalThis as unknown as {
  __nextcodeJobWorker?: JobWorkerHandle;
};

/**
 * Inicia o worker em laço contínuo de forma idempotente via globalThis.__nextcodeJobWorker.
 * Não sobrepõe ciclos de runOnce e respeita o intervalo NEXTCODE_WORKER_POLL_MS.
 */
export function startJobWorker(): JobWorkerHandle {
  if (globalForJobWorker.__nextcodeJobWorker && globalForJobWorker.__nextcodeJobWorker.running) {
    return globalForJobWorker.__nextcodeJobWorker;
  }

  const handle: JobWorkerHandle = {
    workerId: `worker-${crypto.randomUUID()}`,
    running: true,
    cycles: 0,
    timer: null,
    wakeSleep: null,
    loopPromise: null,
  };

  globalForJobWorker.__nextcodeJobWorker = handle;

  handle.loopPromise = (async () => {
    try {
      await recoverOrphanExecutionSessions();
    } catch (err) {
      console.error("[JobWorker] Erro ao recuperar sessões órfãs em EXECUCAO no boot:", err);
    }

    while (handle.running) {
      handle.cycles += 1;
      try {
        await runOnce(handle.workerId);
      } catch (err) {
        console.error("[JobWorker] Erro inesperado no ciclo runOnce:", err);
      }

      if (!handle.running) {
        break;
      }

      const pollMs = getWorkerPollMs();
      await new Promise<void>((resolve) => {
        handle.wakeSleep = resolve;
        handle.timer = setTimeout(() => {
          handle.timer = null;
          handle.wakeSleep = null;
          resolve();
        }, pollMs);
        if (typeof handle.timer.unref === "function") {
          handle.timer.unref();
        }
      });
    }
  })();

  return handle;
}

/**
 * Encerra o laço do worker ativo (para uso em testes e desligamento limpo).
 */
export async function stopJobWorker(): Promise<void> {
  const handle = globalForJobWorker.__nextcodeJobWorker;
  if (!handle) {
    return;
  }

  handle.running = false;
  if (handle.timer) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
  if (handle.wakeSleep) {
    const wake = handle.wakeSleep;
    handle.wakeSleep = null;
    wake();
  }

  if (handle.loopPromise) {
    await handle.loopPromise.catch(() => {});
  }

  if (globalForJobWorker.__nextcodeJobWorker === handle) {
    globalForJobWorker.__nextcodeJobWorker = undefined;
  }
}
