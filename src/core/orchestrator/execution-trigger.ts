import prisma from "@/lib/prisma";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { SmartRouter, type AvailableKeys } from "@/core/router/smart-router";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";
import type { Phase } from "@/core/orchestrator/phase-machine";
import type { TaskNode } from "@prisma/client";

export type ApproveSpecResult =
  | {
      ok: true;
      alreadyStarted: boolean;
      phase: Phase;
      jobId?: string;
      tasks?: TaskNode[];
    }
  | {
      ok: false;
      reason: "SPEC_AUSENTE" | "INTERVENCAO_PENDENTE" | "SESSAO_NAO_ENCONTRADA" | string;
    };

const ALREADY_STARTED_PHASES: Phase[] = [
  "PLANEJAMENTO",
  "EXECUCAO",
  "PAUSADA",
  "BLOQUEADA",
  "VERIFICACAO",
  "ENTREGUE",
];

const inFlightBySession = new Map<string, Promise<void>>();

/**
 * Gatilho único de execução a partir de uma Spec Canônica aprovada explicitamente pelo usuário.
 * É o ÚNICO lugar de src/ autorizado a gravar specApproved: true ou criar TaskNode para iniciar uma DAG.
 */
export async function approveSpecAndStart(
  sessionId: string,
  canonicalSpec?: string
): Promise<ApproveSpecResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      phase: true,
      canonicalSpec: true,
    },
  });

  if (!session) {
    return { ok: false, reason: "SESSAO_NAO_ENCONTRADA" };
  }

  const initialPhase = (session.phase as Phase) || "ENTRADA";

  // PLANEJAMENTO | EXECUCAO | PAUSADA | BLOQUEADA | VERIFICACAO | ENTREGUE:
  // a execução já foi iniciada para a Spec atual — retorna idempotente sem chamar transition(),
  // sem criar nós, sem enfileirar e sem gerar PHASE_TRANSITION_REFUSED.
  if (ALREADY_STARTED_PHASES.includes(initialPhase)) {
    const existingWait = inFlightBySession.get(sessionId);
    if (existingWait) {
      await existingWait.catch(() => {});
    }
    const latest = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { phase: true },
    });
    return {
      ok: true,
      alreadyStarted: true,
      phase: ((latest?.phase as Phase) || initialPhase),
    };
  }

  if (initialPhase === "INTERVENCAO") {
    return { ok: false, reason: "INTERVENCAO_PENDENTE" };
  }

  // 1. Se canonicalSpec veio no argumento, grava em Session.canonicalSpec.
  // Se a sessão não tiver canonicalSpec não vazia depois disso, recusa com SPEC_AUSENTE sem alterar nada.
  const effectiveSpec =
    canonicalSpec !== undefined ? String(canonicalSpec) : (session.canonicalSpec ?? "");

  if (!effectiveSpec.trim()) {
    return { ok: false, reason: "SPEC_AUSENTE" };
  }

  if (canonicalSpec !== undefined && canonicalSpec !== session.canonicalSpec) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { canonicalSpec: effectiveSpec },
    });
  }

  // 2. Leva a fase até SPEC_REVISAO com eventos legais
  const currentBeforeAdvance = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true },
  });
  let currentPhase = ((currentBeforeAdvance?.phase as Phase) || "ENTRADA");

  if (ALREADY_STARTED_PHASES.includes(currentPhase)) {
    const existingWait = inFlightBySession.get(sessionId);
    if (existingWait) {
      await existingWait.catch(() => {});
    }
    const latest = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { phase: true },
    });
    return {
      ok: true,
      alreadyStarted: true,
      phase: ((latest?.phase as Phase) || currentPhase),
    };
  }

  if (currentPhase === "INTERVENCAO") {
    return { ok: false, reason: "INTERVENCAO_PENDENTE" };
  }

  if (currentPhase === "ENTRADA" || currentPhase === "CONVERSA") {
    const msgRes = await applyPhaseEvent(
      sessionId,
      { type: "MENSAGEM_CLASSIFICADA", intencao: "criar_novo" },
      {
        stopRetryIfPhaseIn: [
          "ELICITACAO",
          "ELICITACAO_CORRECAO",
          "SPEC_REVISAO",
          ...ALREADY_STARTED_PHASES,
        ],
      }
    );
    if (msgRes.ok) {
      currentPhase = msgRes.ctx.phase;
    } else {
      const refreshed = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { phase: true },
      });
      currentPhase = ((refreshed?.phase as Phase) || currentPhase);
    }
  }

  if (currentPhase === "ELICITACAO" || currentPhase === "ELICITACAO_CORRECAO") {
    const prontaRes = await applyPhaseEvent(
      sessionId,
      { type: "SPEC_PRONTA" },
      {
        stopRetryIfPhaseIn: ["SPEC_REVISAO", ...ALREADY_STARTED_PHASES],
      }
    );
    if (prontaRes.ok) {
      currentPhase = prontaRes.ctx.phase;
    } else {
      const refreshed = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { phase: true },
      });
      currentPhase = ((refreshed?.phase as Phase) || currentPhase);
    }
  }

  if (ALREADY_STARTED_PHASES.includes(currentPhase)) {
    const existingWait = inFlightBySession.get(sessionId);
    if (existingWait) {
      await existingWait.catch(() => {});
    }
    const latest = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { phase: true },
    });
    return {
      ok: true,
      alreadyStarted: true,
      phase: ((latest?.phase as Phase) || currentPhase),
    };
  }

  // 3. Aplica SPEC_APROVADA (SPEC_REVISAO → PLANEJAMENTO).
  // Apenas UMA chamada concorrente pode vencer o updateMany otimista de SPEC_REVISAO → PLANEJAMENTO.
  let resolveInFlight: (() => void) | null = null;
  const inFlightPromise = new Promise<void>((resolve) => {
    resolveInFlight = resolve;
  });
  if (!inFlightBySession.has(sessionId)) {
    inFlightBySession.set(sessionId, inFlightPromise);
  }

  try {
    const specApprovedRes = await applyPhaseEvent(
      sessionId,
      { type: "SPEC_APROVADA" },
      { stopRetryIfPhaseIn: ALREADY_STARTED_PHASES }
    );

    if (!specApprovedRes.ok) {
      if (specApprovedRes.reason === "CONCURRENT_PHASE_CHANGED") {
        const winnerPromise = inFlightBySession.get(sessionId);
        if (winnerPromise && winnerPromise !== inFlightPromise) {
          await winnerPromise.catch(() => {});
        }
        const latest = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { phase: true },
        });
        return {
          ok: true,
          alreadyStarted: true,
          phase: ((latest?.phase as Phase) || "PLANEJAMENTO"),
        };
      }
      return { ok: false, reason: specApprovedRes.reason };
    }

    // Esta chamada venceu a transição SPEC_REVISAO → PLANEJAMENTO
    inFlightBySession.set(sessionId, inFlightPromise);

    // 4. Incrementa specVersion e grava specApproved: true (Passo 4b.4 / 4b.5)
    const sessionBeforeIncrement = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { specVersion: true },
    });
    const priorTasksCount = await prisma.taskNode.count({ where: { sessionId } });
    const baseSpecVersion =
      (sessionBeforeIncrement?.specVersion ?? 0) > 0
        ? sessionBeforeIncrement!.specVersion
        : priorTasksCount > 0
          ? 1
          : 0;
    const currentSpecVersion = baseSpecVersion + 1;

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        specApproved: true,
        specVersion: currentSpecVersion,
      },
    });

    // 4b.4: Nós pendentes da versão anterior viram status "superseded" e nunca mais executam.
    // Os completed ficam intocados como histórico.
    await prisma.taskNode.updateMany({
      where: {
        sessionId,
        specVersion: { lt: currentSpecVersion },
        status: { in: ["pending", "standby"] },
      },
      data: {
        status: "superseded",
      },
    });

    // 5. Idempotência por versão: se ainda não existirem TaskNodes para a specVersion atual,
    // decompõe a canonicalSpec gravada e cria os nós da nova versão
    const existingTasks = await prisma.taskNode.findMany({
      where: { sessionId, specVersion: currentSpecVersion },
      orderBy: { createdAt: "asc" },
    });

    let tasks: TaskNode[] = existingTasks;
    if (existingTasks.length === 0) {
      const setting = await prisma.setting.findUnique({ where: { id: "default" } });
      const availableKeys: AvailableKeys = {
        hasGeminiKey: Boolean(setting?.geminiKey),
        hasClaudeKey: Boolean(setting?.claudeKey),
        hasOpenaiKey: Boolean(setting?.openaiKey),
        hasOmniRouteKey: Boolean(setting?.omniRouteKey),
        customEndpoint: setting?.customEndpoint,
      };

      const smartRouter = new SmartRouter();
      const rawAnalysis = smartRouter.routeTask({ prompt: effectiveSpec });
      const intent = smartRouter.resolveFallback(rawAnalysis, availableKeys);

      const parsedSpec = parseSpecDocument(effectiveSpec);
      const specFilesScope = parsedSpec?.arquivosAfetados;
      // Spec com arquivos declarados → uma etapa por grupo pequeno de arquivos; sem arquivos,
      // o trio legado (heurística de domínio).
      const { nodes: decomposedNodes } =
        specFilesScope && specFilesScope.length > 0
          ? SpecDecomposerSkill.decomposeSpec(effectiveSpec, parsedSpec?.titulo ?? null, specFilesScope, parsedSpec?.stack ?? [])
          : SpecDecomposerSkill.decompose(effectiveSpec, undefined, specFilesScope);

      // Garante IDs únicos por versão para não colidir se duas versões forem aprovadas no mesmo ms
      const idMap = new Map<string, string>();
      for (const node of decomposedNodes) {
        const versionedId =
          currentSpecVersion > 1 ? `${node.id}-v${currentSpecVersion}` : node.id;
        idMap.set(node.id, versionedId);
      }

      const createdTasks: TaskNode[] = [];
      for (const node of decomposedNodes) {
        const nodeId = idMap.get(node.id) ?? node.id;
        const mappedDeps = (node.dependencies || []).map((dep) => idMap.get(dep) ?? dep);
        const dbTask = await prisma.taskNode.create({
          data: {
            id: nodeId,
            sessionId,
            specVersion: currentSpecVersion,
            title: node.title,
            role: node.role,
            status: "pending",
            dependencies: JSON.stringify(mappedDeps),
            filesScope: JSON.stringify(node.filesScope || []),
            mcpScope: node.mcpScope,
            payload: JSON.stringify({
              ...(typeof node.payload === "object" && node.payload !== null
                ? node.payload
                : { data: node.payload }),
              intent,
            }),
          },
        });
        createdTasks.push(dbTask);
      }
      tasks = createdTasks;
    }

    // 6. Aplica PLANO_PRONTO (PLANEJAMENTO → EXECUCAO).
    // Quando result.effects contiver "INICIAR_EXECUCAO", chama enqueueSessionQueueJob(sessionId).
    const planoRes = await applyPhaseEvent(sessionId, { type: "PLANO_PRONTO" });
    let jobId: string | undefined;
    let finalPhase: Phase = "PLANEJAMENTO";

    if (planoRes.ok) {
      finalPhase = planoRes.ctx.phase;
      if (planoRes.effects.some((effect) => effect.type === "INICIAR_EXECUCAO")) {
        jobId = await enqueueSessionQueueJob(sessionId);
      }
    }

    return {
      ok: true,
      alreadyStarted: false,
      phase: finalPhase,
      jobId,
      tasks,
    };
  } finally {
    if (resolveInFlight) {
      (resolveInFlight as () => void)();
    }
    if (inFlightBySession.get(sessionId) === inFlightPromise) {
      inFlightBySession.delete(sessionId);
    }
  }
}
