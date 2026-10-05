import prisma from "@/lib/prisma";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { IncidentReporter } from "@/core/governance/incident-reporter";
import {
  executeTaskNode,
  appendFailureAttempt,
  cascadeBlockedNodes,
  reportBlockedNodeToHuman,
  postCompletionMessageIfDone,
  checkSpecCompletenessOnDisk,
} from "@/core/orchestrator/node-executor";
import type { TaskNode } from "@prisma/client";

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
  const staleThresholdMs = (Number(process.env.DAG_STEP_TIMEOUT_MS) || 90000) + 30000;
  const staleRunningTasks = await prisma.taskNode.findMany({
    where: {
      sessionId,
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
    const currentDbTasks = await prisma.taskNode.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });

    const knownIds = new Set(currentDbTasks.map((t) => t.id));

    const dagNodes: DAGNode[] = currentDbTasks.map((t, idx) => {
      const rawDeps: string[] = JSON.parse(t.dependencies || "[]");
      const validDeps = rawDeps.filter((depId) => knownIds.has(depId));
      const hasUnresolvedUnknownDep = rawDeps.some((depId) => !knownIds.has(depId));
      const autoResolvedDeps =
        hasUnresolvedUnknownDep && idx > 0 && currentDbTasks[idx - 1].status === "completed"
          ? [currentDbTasks[idx - 1].id]
          : validDeps;

      return {
        id: t.id,
        title: t.title,
        role: t.role,
        status: t.status as DAGNode["status"],
        dependencies: autoResolvedDeps,
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

    // Execução Concorrente de Subagentes: Processa em lote (máx. 3 nós paralelos sem dependências mútuas)
    const batchToExecute = executableNodes.slice(0, 3);
    const tasksToExecute = batchToExecute
      .map((node) => currentDbTasks.find((t) => t.id === node.id))
      .filter((t): t is typeof currentDbTasks[0] => Boolean(t));

    if (tasksToExecute.length === 0) break;

    const batchResults = await Promise.all(
      tasksToExecute.map(async (taskDb) => {
        // TODO(passo-4): unificar — consulta extra por nó para montar a sessão que executeTaskNode espera (o original usava a sessão já carregada)
        const fullTask = await prisma.taskNode.findUniqueOrThrow({
          where: { id: taskDb.id },
          include: { session: { include: { project: true } } },
        });
        const execResult = await executeTaskNode(fullTask, {
          // TODO(passo-4): unificar — timeout da etapa (90s em process_queue)
          stepTimeoutMs: Number(process.env.DAG_STEP_TIMEOUT_MS) || 90000,
          // TODO(passo-4): unificar — chaves BYOK passadas no despacho do worker (inclui Groq/Nvidia/Deepseek)
          includeCloudByokKeys: true,
          // TODO(passo-4): unificar — incremento de tentativas em sucesso (sempre incrementa)
          alwaysIncrementAttempts: true,
          // TODO(passo-4): unificar — fallback de motivo de rejeição do Tipo 2 ("Divergência semântica." em process_queue)
          type2RejectionFallback: "Divergência semântica.",
        });
        return { id: taskDb.id, finalStatus: execResult.finalStatus };
      })
    );

    processedCount += batchResults.length;

    if (batchResults.some((res) => res.finalStatus === "blocked")) {
      await cascadeBlockedNodes(sessionId);
      for (const res of batchResults) {
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
    // TODO(passo-4): unificar — mensagem de conclusão ("promovidas no servidor")
    completionMessageTargetText: "promovidas no servidor",
  });

  return {
    processedCount,
    allCompleted,
    tasks: finalSessionTasks,
    specCompleteness,
  };
}
