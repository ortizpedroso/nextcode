import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  classifyProviderOutage,
  isUpstreamTransportOrServerOutage,
  loadGatewayConfigs,
  isGatewayAnswering,
  providerResetWaitMs,
  type GatewayConfig,
} from "@/core/llm/gateways";
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

/** PJ2b: projeto fechado (arquivado) não é retomado, vigiado nem posto na fila pelo supervisor. */
export const OPEN_PROJECT_SESSION = { OR: [{ projectId: null }, { project: { is: { isArchived: false } } }] };

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

/**
 * SUP1 (mudança 28): só o executor pausa com `SEM_LLM`. Com `somente_pago` ele só sai pelo FreeLLMAPI
 * (`loadPaidGatewaysForTier`); retomar porque o DeepSeek direto responde fazia a sessão piscar
 * PAUSADA ↔ EXECUCAO sem avançar (teste pesado `314176ef`: 132 pausas, 1/57 etapas).
 */
export function gatewaysToProbeForExecutor(gateways: GatewayConfig[], paidOnly: boolean): GatewayConfig[] {
  return paidOnly ? gateways.filter((gw) => gw.id === "freellmapi") : gateways;
}

export interface ReachabilityDeps {
  loader?: () => Promise<GatewayConfig[]>;
  probe?: (gw: GatewayConfig) => Promise<boolean>;
  paidOnly?: () => Promise<boolean>;
}

async function executorIsPaidOnly(): Promise<boolean> {
  const { loadOrchestrationPolicy } = await import("@/core/config/orchestration-policy");
  const { isPaidOnlyRouting } = await import("@/core/orchestrator/node-executor");
  return isPaidOnlyRouting(loadOrchestrationPolicy());
}

export async function isAnyLlmGatewayReachable(deps: ReachabilityDeps = {}): Promise<boolean> {
  const useCache = !deps.loader && !deps.probe && !deps.paidOnly;
  if (useCache && reachabilityCache && Date.now() - reachabilityCache.at < REACHABILITY_CACHE_MS) {
    return reachabilityCache.value;
  }
  const gateways = await (deps.loader ?? loadGatewayConfigs)().catch(() => []);
  const paidOnly = await (deps.paidOnly ?? executorIsPaidOnly)().catch(() => false);
  const probe = deps.probe ?? ((gw: GatewayConfig) => isGatewayAnswering(gw));
  const candidates = gatewaysToProbeForExecutor(gateways, paidOnly);
  const checks = await Promise.all(candidates.map((gw) => probe(gw).catch(() => false)));
  const value = checks.some(Boolean);
  if (useCache) reachabilityCache = { at: Date.now(), value };
  return value;
}

export const LONG_PAUSE_NOTICE_MS = 300_000;

/** Mudança 24: sonda de poucos tokens no avaliador de produção (Claude). Falhas vão para o motivo da pausa. */
export async function probeEvaluator(): Promise<{ ok: boolean; motivo: string; definitivo: boolean }> {
  const { dispatchStrongEvaluator } = await import("@/core/llm/evaluator-models");
  const { isEvaluatorAccessFailure } = await import("@/core/orchestrator/node-executor");
  const r = await dispatchStrongEvaluator([{ role: "user", content: 'Responda só: {"ok":true}' }], {
    executorFamily: "deepseek",
    timeoutMs: 20_000,
  }).catch((err) => ({ content: null, failures: [String(err).slice(0, 140)] }));
  if (r.content) return { ok: true, motivo: "", definitivo: false };
  return { ok: false, motivo: (r.failures[0] ?? "sem resposta").slice(0, 200), definitivo: isEvaluatorAccessFailure(r.failures) };
}

/**
 * Mudança 24: sessões pausadas por avaliador fora do ar. Antes de `ate`, não faz nada; depois, sonda o
 * Claude: respondeu → `LLM_VOLTOU` e reenfileira; não respondeu → nova pausa de 5 min (ou bloqueia no
 * limite / em falha de chave ou crédito), com aviso no chat. Retorna as sessões retomadas.
 */
export async function superviseEvaluatorPauses(
  probeFn: () => Promise<{ ok: boolean; motivo: string; definitivo: boolean }> = probeEvaluator,
  now: Date = new Date()
): Promise<number> {
  const sessions = await prisma.session.findMany({
    where: { phase: "PAUSADA", phaseContext: { contains: "pausaAvaliador" }, ...OPEN_PROJECT_SESSION },
    select: { id: true, phaseContext: true },
  });
  let resumed = 0;
  for (const session of sessions) {
    let pausa: { ate: string; pausa: number; motivo: string } | undefined;
    try {
      pausa = JSON.parse(session.phaseContext || "{}").pausaAvaliador;
    } catch {
      pausa = undefined;
    }
    if (!pausa || now.getTime() < new Date(pausa.ate).getTime()) continue;
    const probe = await probeFn().catch(() => ({ ok: false, motivo: "sonda falhou", definitivo: false }));
    if (probe.ok) {
      const res = await applyPhaseEvent(session.id, { type: "LLM_VOLTOU" });
      if (res.ok && res.ctx.phase === "EXECUCAO") {
        await enqueueSessionQueueJob(session.id);
        resumed++;
      }
      TelemetryLogger.log({ sessionId: session.id, action: "EVALUATOR_OUTAGE_RESUMED", details: { pausa: pausa.pausa } });
      continue;
    }
    const proxima = pausa.pausa + 1;
    const ate = new Date(now.getTime() + 5 * 60_000);
    const res = await applyPhaseEvent(
      session.id,
      { type: "AVALIADOR_FORA", ate: ate.toISOString(), pausa: proxima, motivo: probe.motivo, definitivo: probe.definitivo },
      { detalheAviso: `**Dono:** ambiente (avaliador fora do ar).\nÚltima sonda: ${probe.motivo}` }
    );
    if (res.ok && res.ctx.phase === "PAUSADA") {
      await prisma.message.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content:
            `⏸️ **Avaliador ainda fora do ar (pausa ${proxima}).** Nova tentativa a partir de ` +
            `${ate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Motivo: ${probe.motivo}`,
        },
      });
    }
    TelemetryLogger.log({
      sessionId: session.id,
      action: res.ok && res.ctx.phase === "BLOQUEADA" ? "EVALUATOR_OUTAGE_BLOCKED" : "EVALUATOR_OUTAGE_PAUSED",
      details: { pausa: proxima, definitivo: probe.definitivo, motivo: probe.motivo },
    });
  }
  return resumed;
}

export const PAUSE_FLAP_WINDOW_MS = 10 * 60_000;
export const PAUSE_FLAP_LIMIT = 3;
/** Cooldown sem prazo no texto: espera curta e retoma. Não vira bloqueio de chave. */
export const ESPERA_HOLD_MS = 6 * 60_000;
/** Acima disso o aviso diz o prazo e a sessão espera, sem pedir troca de chave. */
export const ESPERA_LONG_MS = 15 * 60_000;

/** Quantas vezes a sessão foi para PAUSADA por `SEM_LLM` na janela. */
export async function countRecentNoLlmPauses(sessionId: string, now: Date = new Date()): Promise<number> {
  return prisma.telemetryLog.count({
    where: {
      sessionId,
      action: "PHASE_TRANSITION",
      createdAt: { gte: new Date(now.getTime() - PAUSE_FLAP_WINDOW_MS) },
      AND: [{ details: { contains: '"to":"PAUSADA"' } }, { details: { contains: '"type":"SEM_LLM"' } }],
    },
  });
}

/**
 * Supervisor periódico da fila (Item 1 do PLANO-DE-ACAO):
 * Verifica sessões em `PAUSADA` (que possuem `faseAntesDaPausa` registrada por `SEM_LLM`).
 * Quando um gateway de LLM volta a responder, emite `LLM_VOLTOU` (`PAUSADA -> EXECUCAO`)
 * e reenfileira o Job da sessão sem ter consumido nenhuma tentativa das etapas.
 */
export async function supervisePausedSessions(
  probeGatewayFn: () => Promise<boolean> = isAnyLlmGatewayReachable,
  now: Date = new Date(),
  /** Restringe às sessões dadas (testes em paralelo no mesmo banco não retomam a sessão um do outro). */
  options?: { onlySessionIds?: string[] }
): Promise<number> {
  // Pausas por avaliador fora do ar têm supervisor próprio (superviseEvaluatorPauses): a sonda genérica
  // de "algum gateway responde" as retomaria na hora com o DeepSeek de pé.
  const pausedSessions = await prisma.session.findMany({
    where: {
      phase: "PAUSADA",
      phaseContext: {
        contains: "faseAntesDaPausa",
      },
      NOT: { phaseContext: { contains: "pausaAvaliador" } },
      ...OPEN_PROJECT_SESSION,
      ...(options?.onlySessionIds?.length ? { id: { in: options.onlySessionIds } } : {}),
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
    // Mudança 42: pausou por falta de LLM 3× em 10 min com o gateway "de pé" → o provedor não atende
    // (Gateway 22/10: DeepSeek out_of_credits; a sessão piscava a cada 25 s). Bloqueia em vez de retomar.
    // Cooldown/limite não é chave ruim: a sonda passa e a rota volta sozinha. Segurar evita o pisca.
    const since = new Date(now.getTime() - PAUSE_FLAP_WINDOW_MS);
    const lastFailure =
      (await prisma.telemetryLog.findFirst({
        where: { action: "llm.gateway_failure", sessionId: session.id, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { details: true, createdAt: true },
      })) ??
      (await prisma.telemetryLog.findFirst({
        where: { action: "llm.gateway_failure", sessionId: null, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { details: true, createdAt: true },
      }));
    let failureDetail = "";
    let failureStatus: number | undefined;
    try {
      const d = lastFailure?.details ? JSON.parse(lastFailure.details) : null;
      if (d) {
        failureDetail = String(d.detail ?? "");
        if (typeof d.status === "number") failureStatus = d.status;
      }
    } catch {
      failureDetail = "";
    }
    const outage = classifyProviderOutage(failureDetail, failureStatus);
    if (outage === "espera" && lastFailure) {
      const resetMs = providerResetWaitMs(failureDetail);
      const holdMs = resetMs == null ? ESPERA_HOLD_MS : resetMs + 2_000;
      const ageMs = now.getTime() - lastFailure.createdAt.getTime();
      if (ageMs < holdMs) {
        const existing = await prisma.message.findFirst({
          where: {
            sessionId: session.id,
            role: "assistant",
            createdAt: { gte: lastFailure.createdAt },
            content: { contains: "rota do executor está em espera" },
          },
        });
        if (!existing) {
          const causaEspera = isUpstreamTransportOrServerOutage(failureDetail, failureStatus)
            ? "instabilidade ou falha transitória de rede no provedor upstream"
            : "limite ou cooldown do gateway";
          const prazo =
            resetMs == null
              ? "A sessão continua pausada e segue sozinha quando a rota atender."
              : holdMs > ESPERA_LONG_MS
                ? `O gateway pediu espera de cerca de ${Math.round(resetMs / 60_000)} min. A sessão segue sozinha depois disso.`
                : `O gateway pediu espera de cerca de ${Math.max(1, Math.round(resetMs / 1000))} s. A sessão segue sozinha depois disso.`;
          await prisma.message.create({
            data: {
              sessionId: session.id,
              role: "assistant",
              content: `⏸️ **A rota do executor está em espera** (${causaEspera}). ${prazo}`,
            },
          });
        }
        continue;
      }
    }
    const flap = await countRecentNoLlmPauses(session.id, now);
    if (outage === "credito" || outage === "chave") {
      const acao =
        outage === "credito"
          ? "Confira o crédito do provedor do executor."
          : "A chave do provedor foi recusada. Confira a chave no painel do gateway.";
      await applyPhaseEvent(session.id, { type: "SEM_LLM_PERSISTENTE" }, {
        detalheAviso:
          `A sonda do gateway responde, mas a última falha foi ${outage === "credito" ? "falta de crédito/cota" : "chave recusada"}.` +
          (failureDetail ? `\n\n**Detalhe:** \`${failureDetail.slice(0, 400)}\`` : "") +
          `\n\n${acao}`,
      });
      continue;
    }
    if (outage === "espera") {
      const res = await applyPhaseEvent(session.id, { type: "LLM_VOLTOU" });
      if (res.ok && res.ctx.phase === "EXECUCAO") {
        await enqueueSessionQueueJob(session.id);
        resumedCount++;
      }
      continue;
    }
    if (flap >= PAUSE_FLAP_LIMIT) {
      let detalhe = "";
      try {
        const d = lastFailure?.details ? JSON.parse(lastFailure.details) : null;
        if (d) detalhe = `${d.gateway ?? "gateway"}: ${d.kind ?? ""}${d.status ? ` HTTP ${d.status}` : ""} — ${String(d.detail ?? "").slice(0, 400)}`;
      } catch {
        detalhe = "";
      }
      const acao = "Confira crédito, cota e chaves do provedor do executor (ex.: DeepSeek no FreeLLMAPI).";
      await applyPhaseEvent(session.id, { type: "SEM_LLM_PERSISTENTE" }, {
        detalheAviso:
          `A sessão pausou ${flap} vezes em ${PAUSE_FLAP_WINDOW_MS / 60_000} minutos: o gateway responde à sonda, mas nenhum modelo do executor atendeu.` +
          (detalhe ? `\n\n**Último erro do gateway:** \`${detalhe}\`` : "") +
          `\n\n${acao}`,
      });
      continue;
    }
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
      ...OPEN_PROJECT_SESSION,
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
 * 2. Nó running preso: recoverZombieRunningNodes na fila da sessão (não aqui).
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

  let orphanSessionsResumed = 0;
  let stuckNodesReset = 0;

  // 1. Sessões órfãs em EXECUCAO sem Job ativo
  const orphanSessions = await prisma.session.findMany({
    where: {
      phase: "EXECUCAO",
      ...OPEN_PROJECT_SESSION,
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

  // Nó preso em running: só recoverZombieRunningNodes (timeout da etapa + margem) gasta tentativa.

  return { orphanSessionsResumed, stuckNodesReset };
}

export const SILENCE_NOTICE_MS = 300_000;
const SUPERVISE_SILENCE_INTERVAL_MS = 60_000;
let lastSuperviseSilenceAt = 0;

/**
 * Vigia de Silêncio (J2.6):
 * Detecta sessões em PLANEJAMENTO, EXECUCAO ou VERIFICACAO que ficaram sem jobs/nós ativos
 * e sem nenhuma atividade (mensagens, telemetria, update) há mais de 5 minutos,
 * transicionando para BLOQUEADA e avisando o humano no chat para não ficarem paradas caladas.
 */
export async function superviseSilentSessions(options?: {
  now?: Date;
  silenceMs?: number;
  force?: boolean;
  onlySessionIds?: string[];
}): Promise<number> {
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();

  if (!options?.force && nowMs - lastSuperviseSilenceAt < SUPERVISE_SILENCE_INTERVAL_MS) {
    return 0;
  }
  lastSuperviseSilenceAt = nowMs;

  const silenceMs = options?.silenceMs ?? SILENCE_NOTICE_MS;

  const whereClause: {
    phase: { in: string[] };
    jobs: { none: { status: { in: string[] } } };
    tasks: { none: { status: string } };
    id?: { in: string[] };
    OR: typeof OPEN_PROJECT_SESSION.OR;
  } = {
    ...OPEN_PROJECT_SESSION,
    phase: { in: ["PLANEJAMENTO", "EXECUCAO", "VERIFICACAO"] },
    jobs: {
      none: {
        status: { in: ["queued", "running"] },
      },
    },
    tasks: {
      none: {
        status: "running",
      },
    },
  };

  if (options?.onlySessionIds && options.onlySessionIds.length > 0) {
    whereClause.id = { in: options.onlySessionIds };
  }

  const silentCandidates = await prisma.session.findMany({
    where: whereClause,
    select: {
      id: true,
      phase: true,
      updatedAt: true,
    },
  });

  let blockedCount = 0;

  for (const session of silentCandidates) {
    const lastMessage = await prisma.message.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const lastTelemetry = await prisma.telemetryLog.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const timestamps: number[] = [session.updatedAt.getTime()];
    if (lastMessage) timestamps.push(lastMessage.createdAt.getTime());
    if (lastTelemetry) timestamps.push(lastTelemetry.createdAt.getTime());

    const ultimaAtividadeMs = Math.max(...timestamps);
    const ultimaAtividade = new Date(ultimaAtividadeMs);

    if (nowMs - ultimaAtividadeMs >= silenceMs) {
      const res = await applyPhaseEvent(
        session.id,
        { type: "SILENCIO_DETECTADO" },
        {
          detalheAviso: `Fase em que parou: ${session.phase}. Última atividade: ${ultimaAtividade.toISOString()}.`,
        }
      );

      if (res.ok) {
        TelemetryLogger.log({
          sessionId: session.id,
          action: "QUEUE_STALLED",
          details: { reason: "silent_session", phase: session.phase },
        });
        blockedCount++;
      }
    }
  }

  return blockedCount;
}

/**
 * Busca jobs elegíveis (queued ou running com lease vencido), tenta claimJob
 * e executa até NEXTCODE_WORKER_CONCURRENCY (padrão 2) simultaneamente.
 * Retorna quantos jobs foram reservados e executados neste ciclo.
 */
export async function runOnce(
  workerId: string = defaultProcessWorkerId,
  /** Restringe supervisores e fila às sessões dadas (testes em paralelo no mesmo banco). */
  options?: { onlySessionIds?: string[] }
): Promise<number> {
  const only = options?.onlySessionIds?.length ? options.onlySessionIds : undefined;
  await supervisePausedSessions(undefined, undefined, only ? { onlySessionIds: only } : undefined).catch(() => 0);
  if (!only) await superviseEvaluatorPauses().catch(() => 0);
  if (!only) await superviseExecutionQueue().catch(() => ({ orphanSessionsResumed: 0, stuckNodesReset: 0 }));
  await superviseSilentSessions(only ? { onlySessionIds: only } : undefined).catch(() => 0);

  const concurrency = getWorkerConcurrency();
  const now = new Date();

  const eligibleJobs = await prisma.job.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "running", lockedUntil: { lt: now } },
      ],
      ...(only ? { sessionId: { in: only } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
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
