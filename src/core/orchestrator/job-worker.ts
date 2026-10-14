import crypto from "crypto";
import prisma from "@/lib/prisma";
import { loadGatewayConfigs, isGatewayAnswering } from "@/core/llm/gateways";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import {
  enqueueSessionQueueJob,
  claimJob,
  executeClaimedJob,
} from "@/core/orchestrator/job-queue";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

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
 * Verifica se há ao menos um gateway LLM ativo respondendo de verdade (GET /v1/models com a chave,
 * HTTP 200). Ter uma chave salva não basta: DeepSeek sem crédito ou FreeLLMAPI parado não contam.
 * O resultado fica em cache por 30 s para o supervisor (que roda a cada ciclo) não martelar a rede.
 */
const REACHABILITY_CACHE_MS = 30_000;
let reachabilityCache: { at: number; value: boolean } | null = null;

export async function isAnyLlmGatewayReachable(): Promise<boolean> {
  if (reachabilityCache && Date.now() - reachabilityCache.at < REACHABILITY_CACHE_MS) {
    return reachabilityCache.value;
  }
  const gateways = await loadGatewayConfigs().catch(() => []);
  const checks = await Promise.all(gateways.map((gw) => isGatewayAnswering(gw).catch(() => false)));
  const value = checks.some(Boolean);
  reachabilityCache = { at: Date.now(), value };
  return value;
}

export const LONG_PAUSE_NOTICE_MS = 300_000;

/**
 * Supervisor periódico da fila (Item 1 do PLANO-DE-ACAO):
 * Verifica sessões em `PAUSADA` (que possuem `faseAntesDaPausa` registrada por `SEM_LLM`).
 * Quando um gateway de LLM volta a responder, emite `LLM_VOLTOU` (`PAUSADA -> EXECUCAO`)
 * e reenfileira o Job da sessão sem ter consumido nenhuma tentativa das etapas.
 */
export async function supervisePausedSessions(
  probeGatewayFn: () => Promise<boolean> = isAnyLlmGatewayReachable,
  now: Date = new Date()
): Promise<number> {
  const pausedSessions = await prisma.session.findMany({
    where: {
      phase: "PAUSADA",
      phaseContext: {
        contains: "faseAntesDaPausa",
      },
    },
    select: { id: true },
  });

  if (pausedSessions.length === 0) {
    return 0;
  }

  const reachable = await probeGatewayFn().catch(() => false);
  if (!reachable) {
    for (const session of pausedSessions) {
      const transitionLog = await prisma.telemetryLog.findFirst({
        where: {
          sessionId: session.id,
          action: "PHASE_TRANSITION",
          details: {
            contains: '"to":"PAUSADA"',
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        select: { createdAt: true },
      });

      if (!transitionLog) {
        continue;
      }

      const inicio = transitionLog.createdAt.getTime();
      const agora = now.getTime();

      if (agora - inicio >= LONG_PAUSE_NOTICE_MS) {
        const existingNotice = await prisma.message.findFirst({
          where: {
            sessionId: session.id,
            role: "assistant",
            createdAt: {
              gte: transitionLog.createdAt,
            },
            content: {
              contains: "Execução pausada há mais de 5 minutos",
            },
          },
        });

        if (!existingNotice) {
          await prisma.message.create({
            data: {
              sessionId: session.id,
              role: "assistant",
              content:
                "⏳ **Execução pausada há mais de 5 minutos:** nenhum provedor de modelo respondeu. A sessão continua guardada e retoma sozinha quando um provedor voltar. Confira crédito, cota e chaves dos provedores no painel.",
            },
          });
        }
      }
    }
    return 0;
  }

  let resumedCount = 0;
  for (const session of pausedSessions) {
    const res = await applyPhaseEvent(session.id, { type: "LLM_VOLTOU" });
    if (res.ok && res.ctx.phase === "EXECUCAO") {
      await enqueueSessionQueueJob(session.id);
      resumedCount++;
    }
  }
  return resumedCount;
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

export const DEFAULT_STUCK_NODE_TIMEOUT_MS = 300_000;
const SUPERVISE_INTERVAL_MS = 10_000;
let lastSuperviseExecutionAt = 0;

/**
 * Supervisor Periódico da Fila (Item 1 do PLANO-DE-ACAO / Supervisor M5):
 * 1. Resgata sessões em EXECUCAO sem job ativo (queued/running);
 * 2. Destrava nós presos em 'running' com timeout excedido (zumbis);
 * 3. Registra QUEUE_STALLED na trilha para cada intervenção do supervisor.
 */
export async function superviseExecutionQueue(options?: {
  now?: Date;
  stuckTimeoutMs?: number;
  force?: boolean;
}): Promise<{ orphanSessionsResumed: number; stuckNodesReset: number }> {
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();

  if (!options?.force && nowMs - lastSuperviseExecutionAt < SUPERVISE_INTERVAL_MS) {
    return { orphanSessionsResumed: 0, stuckNodesReset: 0 };
  }
  lastSuperviseExecutionAt = nowMs;

  const stuckTimeoutMs = options?.stuckTimeoutMs ?? DEFAULT_STUCK_NODE_TIMEOUT_MS;
  const stuckThreshold = new Date(nowMs - stuckTimeoutMs);

  let orphanSessionsResumed = 0;
  let stuckNodesReset = 0;

  // 1. Sessões órfãs em EXECUCAO sem Job ativo
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
    orphanSessionsResumed++;
    TelemetryLogger.log({
      sessionId: session.id,
      action: "QUEUE_STALLED",
      details: {
        reason: "orphan_execution_session",
        intervention: "enqueued_job",
      },
    });
  }

  // 2. Nós presos em 'running' além do teto
  const stuckNodes = await prisma.taskNode.findMany({
    where: {
      status: "running",
      updatedAt: { lt: stuckThreshold },
    },
    select: { id: true, sessionId: true, title: true },
  });

  for (const node of stuckNodes) {
    const activeJob = await prisma.job.findFirst({
      where: {
        sessionId: node.sessionId,
        status: "running",
        lockedUntil: { gt: now },
      },
    });

    if (!activeJob) {
      await prisma.taskNode.update({
        where: { id: node.id },
        data: { status: "pending" },
      });
      stuckNodesReset++;
      TelemetryLogger.log({
        sessionId: node.sessionId,
        action: "QUEUE_STALLED",
        details: {
          reason: "stuck_running_node",
          nodeId: node.id,
          title: node.title,
          intervention: "reset_to_pending",
        },
      });
      await enqueueSessionQueueJob(node.sessionId).catch(() => null);
    }
  }

  return { orphanSessionsResumed, stuckNodesReset };
}

/**
 * Busca jobs elegíveis (queued ou running com lease vencido), tenta claimJob
 * e executa até NEXTCODE_WORKER_CONCURRENCY (padrão 2) simultaneamente.
 * Retorna quantos jobs foram reservados e executados neste ciclo.
 */
export async function runOnce(workerId: string = defaultProcessWorkerId): Promise<number> {
  await supervisePausedSessions().catch(() => 0);
  await superviseExecutionQueue().catch(() => ({ orphanSessionsResumed: 0, stuckNodesReset: 0 }));

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
