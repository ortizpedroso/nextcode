import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { IncidentReporter } from "@/core/governance/incident-reporter";
import {
  executeTaskNode,
  appendFailureAttempt,
  cascadeBlockedNodes,
  reportBlockedNodeToHuman,
  postCompletionMessageIfDone,
  checkSpecCompletenessOnDisk,
  getStepTimeoutMs,
} from "@/core/orchestrator/node-executor";
import type { TaskNode } from "@prisma/client";
import { enforceBudgetBeforeBatch } from "@/core/orchestrator/budget-guard";

export interface SessionQueueResult {
  processedCount: number;
  allCompleted: boolean;
  tasks: TaskNode[];
  specCompleteness: ReturnType<typeof checkSpecCompletenessOnDisk>;
}

/**
 * Recupera nós travados em "running" (caminho de zumbi): consome tentativa,
 * acrescenta ao failureHistory, e se atingir maxAttempts bloqueia, faz cascata e
 * envia relatório ao humano.
 */
export async function recoverZombieRunningNodes(
  sessionId: string,
  options: { ignoreStaleThreshold?: boolean } = {}
): Promise<number> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { specVersion: true },
  });
  const currentSpecVersion = session?.specVersion ?? 0;

  const staleThresholdMs = getStepTimeoutMs() + 30000;
  const staleRunningTasks = await prisma.taskNode.findMany({
    where: {
      sessionId,
      specVersion: currentSpecVersion,
      status: "running",
      ...(options.ignoreStaleThreshold
        ? {}
        : { updatedAt: { lt: new Date(Date.now() - staleThresholdMs) } }),
    },
  });
  for (const stale of staleRunningTasks) {
    const staleAttempts = (stale.attempts || 0) + 1;
    const staleStatus: "failed" | "blocked" = staleAttempts >= (stale.maxAttempts || 3) ? "blocked" : "failed";
    const staleRejectionReason = "Nó recuperado após travar em 'running' (processo provavelmente interrompido).";
    const staleFailureHistory = appendFailureAttempt(stale.failureHistory, {
      attemptNumber: staleAttempts,
      rejectionReason: staleRejectionReason,
      filesScope: stale.filesScope ? JSON.parse(stale.filesScope) : [],
      timestamp: new Date().toISOString(),
    });
    const staleIncidentReport =
      staleStatus === "blocked"
        ? IncidentReporter.generateIncidentReport(
            stale.id,
            stale.title,
            stale.cluster,
            JSON.parse(staleFailureHistory)
          )
        : undefined;
    await prisma.taskNode.update({
      where: { id: stale.id },
      data: {
        status: staleStatus,
        attempts: staleAttempts,
        failureHistory: staleFailureHistory,
        result: JSON.stringify({
          success: false,
          auditVerdict: "ERROR",
          rejectionReason: staleRejectionReason,
          incidentReport: staleIncidentReport,
        }),
      },
    });
  }

  await cascadeBlockedNodes(sessionId);
  for (const stale of staleRunningTasks) {
    if ((stale.attempts || 0) + 1 >= (stale.maxAttempts || 3)) {
      await reportBlockedNodeToHuman(sessionId, stale.id);
    }
  }

  return staleRunningTasks.length;
}

export interface DependenciaBloqueio {
  taskId: string;
  idsDesconhecidos: string[];
  erro: string;
}

/**
 * 5c: Resolve dependências de nós da DAG para a fila da sessão.
 * Se uma etapa declara dependência de id inexistente nesta versão da Spec,
 * a etapa entra em bloqueios e não é vinculada silenciosamente à etapa anterior nem tem o id descartado.
 */
export function montarDependenciasDaFila(tasks: Array<{ id: string; status: string; dependencies: string }>): {
  porId: Map<string, string[]>;
  bloqueios: Array<{ taskId: string; idsDesconhecidos: string[]; erro: string }>;
} {
  const knownIds = new Set(tasks.map((t) => t.id));
  const porId = new Map<string, string[]>();
  const bloqueios: Array<{ taskId: string; idsDesconhecidos: string[]; erro: string }> = [];

  for (const t of tasks) {
    const rawStr = (t.dependencies ?? "").trim();
    if (!rawStr || rawStr === "[]") {
      porId.set(t.id, []);
      continue;
    }

    let rawDeps: string[];
    let parseError = false;
    try {
      const parsed = JSON.parse(rawStr);
      if (!Array.isArray(parsed)) {
        parseError = true;
        rawDeps = [];
      } else {
        rawDeps = parsed;
      }
    } catch {
      parseError = true;
      rawDeps = [];
    }

    if (parseError) {
      bloqueios.push({
        taskId: t.id,
        idsDesconhecidos: ["<dependencies ilegível>"],
        erro: "DEPENDENCIA_DESCONHECIDA",
      });
      porId.set(t.id, []);
      continue;
    }

    const idsDesconhecidos = rawDeps.filter((depId) => !knownIds.has(depId));
    const validDeps = rawDeps.filter((depId) => knownIds.has(depId));

    if (idsDesconhecidos.length > 0) {
      bloqueios.push({
        taskId: t.id,
        idsDesconhecidos,
        erro: "DEPENDENCIA_DESCONHECIDA",
      });
    }

    porId.set(t.id, validDeps);
  }

  return { porId, bloqueios };
}

/**
 * Executa a fila de nós da DAG de uma sessão no servidor:
 * recuperação de nós zumbis, laço de lotes (até 3 em paralelo),
 * cascata/relatório por lote e mensagem de conclusão.
 */
export async function processSessionQueue(sessionId: string): Promise<SessionQueueResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { project: true },
  });

  // Recuperação de nós "zumbis": resgata tarefas travadas em "running" após estouro do timeout
  await recoverZombieRunningNodes(sessionId);

  let processedCount = 0;
  let isProcessing = true;

  while (isProcessing) {
    const currentSession = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { project: { select: { isArchived: true } } },
    });
    // PJ2b: projeto fechado no meio da execução → para depois do lote atual; reabrir põe na fila de novo.
    if (currentSession?.project?.isArchived) {
      TelemetryLogger.log({ sessionId, action: "PROJECT_CLOSED_QUEUE_STOPPED", details: { processedCount } });
      isProcessing = false;
      break;
    }
    if (
      !currentSession ||
      (currentSession.phase !== "EXECUCAO" &&
        !(currentSession.phase === "ENTRADA" && currentSession.specApproved))
    ) {
      isProcessing = false;
      break;
    }

    const currentDbTasks = await prisma.taskNode.findMany({
      where: { sessionId, specVersion: currentSession.specVersion },
      orderBy: { createdAt: "asc" },
    });

    const { porId, bloqueios } = montarDependenciasDaFila(currentDbTasks);

    if (bloqueios.length > 0) {
      const tarefasParaBloquear = bloqueios.filter((b) => {
        const task = currentDbTasks.find((t) => t.id === b.taskId);
        return task && task.status !== "blocked";
      });

      for (const b of tarefasParaBloquear) {
        await prisma.taskNode.update({
          where: { id: b.taskId },
          data: {
            status: "blocked",
            result: JSON.stringify({
              erro: "DEPENDENCIA_DESCONHECIDA",
              idsDesconhecidos: b.idsDesconhecidos,
            }),
          },
        });
        const taskObj = currentDbTasks.find((t) => t.id === b.taskId);
        if (taskObj) {
          taskObj.status = "blocked";
        }
        await prisma.message.create({
          data: {
            sessionId,
            role: "assistant",
            content: `🛑 **DEPENDENCIA_DESCONHECIDA: Etapa "${b.taskId}" bloqueada.** A etapa depende de ID(s) inexistente(s) nesta versão da Spec: ${b.idsDesconhecidos.join(", ")}.`,
          },
        });
      }

      if (tarefasParaBloquear.length > 0) {
        const newlyBlocked = await cascadeBlockedNodes(sessionId);
        for (const blockedId of newlyBlocked) {
          const t = currentDbTasks.find((x) => x.id === blockedId);
          if (t) {
            t.status = "blocked";
          }
        }
        for (const b of tarefasParaBloquear) {
          await reportBlockedNodeToHuman(sessionId, b.taskId);
        }
      }
    }

    const dagNodes: DAGNode[] = currentDbTasks.map((t) => {
      return {
        id: t.id,
        title: t.title,
        role: t.role,
        status: t.status as DAGNode["status"],
        dependencies: porId.get(t.id) || [],
        mcpScope: t.mcpScope || undefined,
        filesScope: t.filesScope ? JSON.parse(t.filesScope) : [],
        attempts: t.attempts,
        maxAttempts: t.maxAttempts,
      };
    });

    const dagEngine = new DAGEngine(dagNodes);
    const executableNodes = dagEngine.getExecutableNodes();

    if (executableNodes.length === 0) {
      isProcessing = false;
      break;
    }

    // Teto de custo do projeto: confere antes de gastar com o próximo lote.
    if (!(await enforceBudgetBeforeBatch(sessionId))) {
      isProcessing = false;
      break;
    }

    // Execução Concorrente de Subagentes: Processa em lote (máx. 3 nós paralelos sem dependências mútuas)
    const batchToExecute = executableNodes.slice(0, 3);
    const tasksToExecute = batchToExecute
      .map((node) => currentDbTasks.find((t) => t.id === node.id))
      .filter((t): t is typeof currentDbTasks[0] => Boolean(t));

    if (tasksToExecute.length === 0) break;

    const batchResults = await Promise.all(
      tasksToExecute.map(async (taskDb) => {
        const fullTask = await prisma.taskNode.findUniqueOrThrow({
          where: { id: taskDb.id },
          include: { session: { include: { project: true } } },
        });
        const execResult = await executeTaskNode(fullTask);
        return {
          id: taskDb.id,
          claimed: execResult.claimed !== false,
          finalStatus: execResult.finalStatus,
        };
      })
    );

    const claimedResults = batchResults.filter((res) => res.claimed && res.finalStatus !== "paused");
    processedCount += claimedResults.length;

    if (batchResults.some((res) => res.finalStatus === "paused")) {
      isProcessing = false;
      break;
    }

    if (claimedResults.some((res) => res.finalStatus === "blocked")) {
      await cascadeBlockedNodes(sessionId);
      for (const res of claimedResults) {
        if (res.finalStatus === "blocked") await reportBlockedNodeToHuman(sessionId, res.id);
      }
    }
  }

  const {
    tasks: finalSessionTasks,
    allCompleted,
    specCompleteness,
  } = await postCompletionMessageIfDone(sessionId, {
    canonicalSpec: session?.canonicalSpec,
    projectPath: session?.project?.path,
  });

  return {
    processedCount,
    allCompleted,
    tasks: finalSessionTasks,
    specCompleteness,
  };
}
