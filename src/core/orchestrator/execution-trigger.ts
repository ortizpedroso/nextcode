import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import prisma from "@/lib/prisma";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { SmartRouter, type AvailableKeys } from "@/core/router/smart-router";
import { readSecret } from "@/core/security/crypto";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { applyPhaseEvent, parseSessionPhaseContext, patchSessionPhaseContext } from "@/core/orchestrator/session-phase";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";
import type { Phase } from "@/core/orchestrator/phase-machine";
import type { TaskNode } from "@prisma/client";
import {
  decideMicrobriefsPlanningBatch,
  type MicrobriefPlanningDecision,
  type MicrobriefPlanningInput,
} from "@/core/decision/jev-decisions";
import { loadOrchestrationPolicy } from "@/core/config/orchestration-policy";
import { splitNodesByJev } from "@/core/orchestrator/node-split";
import { validateFinalPlan, atribuirInfraAoDono } from "@/core/orchestrator/plan-scope-check";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { clusterNamedByHuman, type ClusterException } from "@/core/intake/cluster-gaps";
import type { ElicitadorMacrobrief } from "@/core/intake/macrobrief-elicitador";
import type { DAGNode } from "@/core/dag/dag-engine";
import type { ContratoProjeto } from "@/core/orchestrator/project-contract";
import { canonicalizeSpecDocument } from "@/core/intake/spec-format";

/** Mesmo teto de arquivos por etapa do decompositor (`FILES_PER_NODE`, spec-decomposer.ts). */
const PLAN_MAX_FILES_PER_STAGE = 4;

/** Spec com arquivos declarados exige plano do analista (exceto em teste sem ENABLE_ANALISTA_LLM). */
export function analistaObrigatorio(specTemArquivos: boolean): boolean {
  if (!specTemArquivos) return false;
  if (process.env.NODE_ENV === "test" && process.env.ENABLE_ANALISTA_LLM !== "true") return false;
  return true;
}

/** Barreira antes do executor: heurística não substitui plano quando o analista era obrigatório. */
export function planoPodeExecutar(
  analistaEraObrigatorio: boolean,
  origemPlano?: "analista" | "heuristica"
): boolean {
  if (analistaEraObrigatorio) return origemPlano === "analista";
  return true;
}

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
      problems?: string[];
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
      phaseContext: true,
      canonicalSpec: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
          path: true,
        },
      },
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

  // 1. Se a sessão já estiver em fase de execução/planejamento ou concluída, retorna idempotente imediatamente
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

  // 2. Se canonicalSpec veio no argumento, grava em Session.canonicalSpec.
  // Se a sessão não tiver canonicalSpec não vazia depois disso, recusa com SPEC_AUSENTE sem alterar nada.
  let effectiveSpec =
    canonicalSpec !== undefined ? String(canonicalSpec) : (session.canonicalSpec ?? "");

  const canon = canonicalizeSpecDocument(effectiveSpec);
  if (canon) effectiveSpec = canon;

  if (
    !effectiveSpec.trim() ||
    effectiveSpec.includes("Especificação pendente") ||
    effectiveSpec.includes("Nenhuma Spec foi gerada ainda")
  ) {
    return { ok: false, reason: "SPEC_AUSENTE" };
  }

  // Trava Mecânica T1 / Pacote E2: Specs estruturadas com frontmatter YAML precisam ser parseáveis
  // e conter módulos e arquivos afetados. Se declararem a seção 'requisitos:', ela não pode ser vazia.
  if (effectiveSpec.trim().startsWith("---")) {
    const parsedForApproval = parseSpecDocument(effectiveSpec);
    if (!parsedForApproval) {
      return { ok: false, reason: "SPEC_INVALIDA_OU_MALFORMATADA" };
    }
    if ((parsedForApproval.requisitos?.length ?? 0) === 0) {
      return { ok: false, reason: "SPEC_SEM_REQUISITOS" };
    }
    if (!parsedForApproval.modulos || parsedForApproval.modulos.length === 0) {
      return { ok: false, reason: "SPEC_SEM_MODULOS" };
    }
    if (!parsedForApproval.arquivosAfetados || parsedForApproval.arquivosAfetados.length === 0) {
      return { ok: false, reason: "SPEC_SEM_ARQUIVOS" };
    }
  }

  if (canonicalSpec !== undefined && canonicalSpec !== session.canonicalSpec) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { canonicalSpec: effectiveSpec },
    });
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

  const policyConf = loadOrchestrationPolicy().jevExecucao.conferenciaEntrada;
  const phaseCtx = parseSessionPhaseContext(session.phase, session.phaseContext);
  let macrobriefAprovado: ElicitadorMacrobrief | undefined;
  let macrobriefTextoAprovado: string | undefined;
  if (policyConf === "ativo" || policyConf === "sombra") {
    try {
      let excecoes: ClusterException[] = (phaseCtx.excecoesCluster ?? []) as ClusterException[];
      if (phaseCtx.clusterGapAguardandoHumano && (phaseCtx.clusterGapDevolvido?.length ?? 0) > 0) {
        const lastUser = await prisma.message.findFirst({
          where: { sessionId, role: "user" },
          orderBy: { createdAt: "desc" },
          select: { content: true },
        });
        const named = lastUser ? clusterNamedByHuman(lastUser.content) : null;
        if (named) {
          const merged = [...excecoes];
          for (const gap of phaseCtx.clusterGapDevolvido ?? []) {
            if (!merged.some((e) => e.gap === gap)) merged.push({ gap: gap as ClusterException["gap"], cluster: named });
          }
          excecoes = merged;
          await patchSessionPhaseContext(sessionId, {
            excecoesCluster: merged,
            clusterGapAguardandoHumano: false,
          });
          TelemetryLogger.log({
            sessionId,
            action: "CLUSTER_EXCECAO_CONFIRMADA",
            details: { cluster: named, gaps: phaseCtx.clusterGapDevolvido },
          });
        }
      }
      const conf = await IntakeEngine.runElicitadorAndAnalistaCycle({
        initialSpec: effectiveSpec,
        sessionId,
        clusterGapsJaDevolvidos: phaseCtx.clusterGapDevolvido ?? [],
        excecoesCluster: excecoes,
      });
      await TelemetryLogger.logAndWait({
        sessionId,
        action: "CONFERENCIA_ENTRADA",
        details: {
          modo: policyConf,
          ok: conf.ok,
          cyclesUsed: conf.cyclesUsed,
          problemas: conf.problems.length,
          pausaSemTentativa: conf.pausaSemTentativa === true,
          perguntaHumana: conf.perguntaHumana === true,
          clusterGaps: conf.clusterGaps ?? [],
        },
      });
      if (!conf.ok) {
        if (conf.clusterGaps?.length) {
          const already = new Set(phaseCtx.clusterGapDevolvido ?? []);
          const novos = conf.clusterGaps.filter((g) => !already.has(g));
          await patchSessionPhaseContext(sessionId, {
            clusterGapDevolvido: [...already, ...conf.clusterGaps],
            clusterGapAguardandoHumano: novos.length === 0,
          });
          TelemetryLogger.log({
            sessionId,
            action: novos.length > 0 ? "CLUSTER_GAP_DEVOLVIDO" : "CLUSTER_GAP_HUMANO",
            details: { gaps: conf.clusterGaps, foraDoContador: true },
          });
        }
        if (conf.pausaSemTentativa) {
          return {
            ok: false,
            reason: "PERGUNTA_AO_HUMANO",
            problems: conf.problems.slice(0, 10),
          };
        }
        if (conf.perguntaHumana) {
          return {
            ok: false,
            reason: "PERGUNTA_AO_HUMANO",
            problems: conf.problems.slice(0, 10),
          };
        }
        return {
          ok: false,
          reason: "CONFERENCIA_REPROVADA",
          problems: conf.problems.slice(0, 10),
        };
      }
      macrobriefAprovado = conf.macrobriefElicitador;
      macrobriefTextoAprovado = conf.macrobriefTexto;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await TelemetryLogger.logAndWait({
        sessionId,
        action: "CONFERENCIA_ENTRADA",
        details: {
          modo: policyConf,
          erro: errMsg.slice(0, 200),
        },
      });
      return {
        ok: false,
        reason: "CONFERENCIA_REPROVADA",
        problems: [`A conferência falhou antes do laudo: ${errMsg.slice(0, 300)}`],
      };
    }
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
      { stopRetryIfPhaseIn: ["MACROBRIEF", "CONFERENCIA", ...ALREADY_STARTED_PHASES] }
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

    // 4b.3b: memória do projeto (.nextcode/MEMORY.md) DESLIGADA — mudança 20 (fundador 17/10). Não grava
    // mais a cópia da Spec a cada aprovação; `consolidateMemoryFromSpec` fica para o conserto após o Gate 1.

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
      // Spec com arquivos declarados → Analista LLM com T8b; reprovação não cai na heurística (só skipModel em teste).
      // Sem arquivos declarados, heurística de domínio.
      const decompResult =
        specFilesScope && specFilesScope.length > 0
          ? await SpecDecomposerSkill.decomposeWithAnalistaSkill({
              specText: effectiveSpec,
              titulo: parsedSpec?.titulo ?? null,
              files: specFilesScope,
              stack: parsedSpec?.stack ?? [],
              sessionId,
              smartRouter,
              geminiKey: readSecret(setting?.geminiKey),
              omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
              omniRouteKey: readSecret(setting?.omniRouteKey),
              skipModel: process.env.NODE_ENV === "test" && process.env.ENABLE_ANALISTA_LLM !== "true",
              notasExcecaoCluster: await notasDeExcecaoCluster(sessionId),
              macrobriefAprovado,
              macrobriefTexto: macrobriefTextoAprovado,
            })
          : SpecDecomposerSkill.decompose(effectiveSpec, undefined, specFilesScope);
      if (decompResult.planoReprovado) {
        const motivo = decompResult.planoReprovado.motivo;
        const detalhe =
          "**Dono:** analista (plano não aprovado).\n\n" +
          `Motivo: \`${motivo}\`. Nenhuma etapa foi criada e nada foi gasto em execução.`;
        const blockRes = await applyPhaseEvent(sessionId, { type: "PLANO_REPROVADO" }, { detalheAviso: detalhe });
        return {
          ok: true,
          alreadyStarted: false,
          phase: blockRes.ok ? blockRes.ctx.phase : "PLANEJAMENTO",
          tasks: [],
        };
      }

      const rawNodes = decompResult.nodes;

      // Jev decide o nível de modelo de cada etapa (uma chamada para todas) e se alguma etapa mistura
      // responsabilidades; nesse caso ela é dividida (uma parte por arquivo). Sem Jev, reserva em código.
      const jevPlan = await planNodeTiers(rawNodes, sessionId);
      const splitRes = splitNodesByJev(rawNodes, (id) => jevPlan.get(id)?.divisaoPorJev === true);
      if (splitRes.split.length > 0 || splitRes.skipped.length > 0) {
        TelemetryLogger.log({
          sessionId,
          action: "JEV_NODE_SPLIT",
          details: { split: splitRes.split, skipped: splitRes.skipped },
        });
      }
      const decomposedNodes =
        decompResult.origemPlano === "analista" ? withNadaAFazer(splitRes.nodes) : splitRes.nodes;

      // A2.1: T8b inteira sobre o plano final (depois da divisão). Plano impossível não vira etapa:
      // a sessão fica BLOQUEADA com o relatório (dono: analista), sem gastar executor nem avaliador.
      const reqsDaSpec = parsedSpec?.requisitos ?? [];
      if (reqsDaSpec.length > 0) {
        const infraRes = atribuirInfraAoDono(decomposedNodes, parsedSpec?.arquivosAfetados ?? []);
        if (infraRes.errors.length > 0) {
          TelemetryLogger.log({
            sessionId,
            action: "PLANO_REPROVADO",
            details: { etapas: decomposedNodes.length, erros: infraRes.errors.length, amostra: infraRes.errors.slice(0, 20) },
          });
          const detalhe =
            "**Dono:** analista (erro do plano).\n\n" +
            `O plano tem ${infraRes.errors.length} problema(s); nenhuma etapa foi criada e nada foi gasto em execução:\n` +
            infraRes.errors.slice(0, 15).map((e) => "- " + e).join("\n") +
            (infraRes.errors.length > 15 ? `\n- … e mais ${infraRes.errors.length - 15}` : "");
          const blockRes = await applyPhaseEvent(sessionId, { type: "PLANO_REPROVADO" }, { detalheAviso: detalhe });
          return {
            ok: true,
            alreadyStarted: false,
            phase: blockRes.ok ? blockRes.ctx.phase : "PLANEJAMENTO",
            tasks: [],
          };
        }

        const textoPorReq = Object.fromEntries(reqsDaSpec.map((r) => [r.id, `${r.titulo} ${r.criterio}`]));
        const planCheck = validateFinalPlan(
          decomposedNodes,
          reqsDaSpec.map((r) => r.id),
          textoPorReq,
          PLAN_MAX_FILES_PER_STAGE,
          parsedSpec?.arquivosAfetados
        );
        TelemetryLogger.log({
          sessionId,
          action: planCheck.valid ? "PLANO_T8B_OK" : "PLANO_REPROVADO",
          details: { etapas: decomposedNodes.length, erros: planCheck.errors.length, amostra: planCheck.errors.slice(0, 20) },
        });
        if (!planCheck.valid) {
          const detalhe =
            "**Dono:** analista (erro do plano).\n\n" +
            `O plano tem ${planCheck.errors.length} problema(s); nenhuma etapa foi criada e nada foi gasto em execução:\n` +
            planCheck.errors.slice(0, 15).map((e) => "- " + e).join("\n") +
            (planCheck.errors.length > 15 ? `\n- … e mais ${planCheck.errors.length - 15}` : "");
          const blockRes = await applyPhaseEvent(sessionId, { type: "PLANO_REPROVADO" }, { detalheAviso: detalhe });
          return {
            ok: true,
            alreadyStarted: false,
            phase: blockRes.ok ? blockRes.ctx.phase : "PLANEJAMENTO",
            tasks: [],
          };
        }
      }
      const planFor = (id: string) => jevPlan.get(id) ?? jevPlan.get(id.replace(/-p\d+$/, ""));

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
            cluster: node.cluster || "core",
            status: "pending",
            dependencies: JSON.stringify(mappedDeps),
            filesScope: JSON.stringify(node.filesScope || []),
            mcpScope: node.mcpScope,
            payload: JSON.stringify(withJevPlan(
              {
                ...(typeof node.payload === "object" && node.payload !== null
                  ? (node.payload as Record<string, unknown>)
                  : { data: node.payload }),
                intent,
                contrato: (node.payload as any)?.contrato ?? decompResult.contrato,
                etapaId: (node.payload as any)?.etapaId ?? node.id,
              },
              planFor(node.id)
            )),
          },
        });
        createdTasks.push(dbTask);
      }

      // A1.3: Quando o plano vira TaskNode, o harness grava src/contracts/index.ts na pasta do projeto
      const targetProjectRoot = session.project?.path;
      if (targetProjectRoot && decompResult.macrobrief?.contratosTypescript) {
        const tsconfigPath = path.join(targetProjectRoot, "tsconfig.json");
        if (fs.existsSync(tsconfigPath)) {
          try {
            const rawTsConfig = fs.readFileSync(tsconfigPath, "utf8");
            let parsedTsConfig: any;
            try {
              parsedTsConfig = JSON.parse(rawTsConfig);
            } catch {
              const stripped = rawTsConfig.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "");
              parsedTsConfig = JSON.parse(stripped);
            }
            if (parsedTsConfig && typeof parsedTsConfig === "object") {
              parsedTsConfig.compilerOptions = parsedTsConfig.compilerOptions || {};
              parsedTsConfig.compilerOptions.paths = parsedTsConfig.compilerOptions.paths || {};
              const paths = parsedTsConfig.compilerOptions.paths;
              const hasAlias = Object.keys(paths).some((k) => k === "@/*" || k === "@/");
              if (!hasAlias) {
                paths["@/*"] = ["./src/*"];
                fs.writeFileSync(tsconfigPath, JSON.stringify(parsedTsConfig, null, 2), "utf8");
              }
            }
          } catch {
            // se o tsconfig não for parseável, prossegue sem travar
          }
        }

        const contractsDir = path.join(targetProjectRoot, "src", "contracts");
        if (!fs.existsSync(contractsDir)) {
          fs.mkdirSync(contractsDir, { recursive: true });
        }
        const contractFilePath = path.join(contractsDir, "index.ts");
        fs.writeFileSync(contractFilePath, decompResult.macrobrief.contratosTypescript, "utf8");

        const rawContract = decompResult.contrato ?? contratoNoPlano(decompResult.nodes);
        const hash = crypto.createHash("sha256").update(decompResult.macrobrief.contratosTypescript).digest("hex");
        TelemetryLogger.log({
          sessionId,
          action: "CONTRATO_GRAVADO",
          details: {
            projectRoot: targetProjectRoot,
            arquivo: "src/contracts/index.ts",
            hash,
            entidades: rawContract?.entidades?.length ?? 0,
            enums: rawContract?.enums?.length ?? 0,
            funcoes: rawContract?.funcoes?.length ?? 0,
            rotas: rawContract?.rotas?.length ?? 0,
          },
        });
      }

      if (targetProjectRoot && macrobriefTextoAprovado) {
        const macroDir = path.join(targetProjectRoot, ".nextcode");
        if (!fs.existsSync(macroDir)) fs.mkdirSync(macroDir, { recursive: true });
        fs.writeFileSync(path.join(macroDir, "macrobrief.md"), macrobriefTextoAprovado, "utf8");
      }

      tasks = createdTasks;
    }

    // 6. MACROBRIEF → CONFERENCIA → PLANEJAMENTO, e só então PLANO_PRONTO.
    // CONFERENCIA_OK só chega aqui com laudo aprovado, ou com a conferência desligada
    // (nesse caso a trilha marca origem conferencia_desligada — não é laudo inventado).
    const unlocked = await abrirPlanejamento(sessionId, policyConf);
    if (!unlocked.ok) {
      return { ok: false, reason: unlocked.reason, problems: unlocked.problems };
    }

    const planoRes = await applyPhaseEvent(sessionId, { type: "PLANO_PRONTO" });
    if (!planoRes.ok) {
      return {
        ok: false,
        reason: planoRes.reason ?? "PLANO_PRONTO_RECUSADO",
        problems: [`PLANO_PRONTO recusado. A sessão ficou em ${unlocked.phase}.`],
      };
    }

    let jobId: string | undefined;
    if (planoRes.effects.some((effect) => effect.type === "INICIAR_EXECUCAO")) {
      jobId = await enqueueSessionQueueJob(sessionId);
    }

    return {
      ok: true,
      alreadyStarted: false,
      phase: planoRes.ctx.phase,
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

type DecomposedNode = { id: string; payload?: unknown; filesScope?: string[] };

/** Pergunta ao Jev o nível de modelo de cada etapa que tem Microbrief (a base sem IA fica de fora). */
async function planNodeTiers(nodes: DecomposedNode[], sessionId: string): Promise<Map<string, MicrobriefPlanningDecision>> {
  const inputs: MicrobriefPlanningInput[] = [];
  for (const node of nodes) {
    const mb = (node.payload as { microbrief?: MicrobriefAndReportDocument } | undefined)?.microbrief;
    if (!mb) continue;
    inputs.push({
      id: node.id,
      arquivos: node.filesScope ?? [],
      reqsCobertos: mb.reqsCobertos,
      resumo: Object.entries(mb.criteriosAceitePorReq)
        .map(([req, c]) => `${req}: ${c.join(" ")}`)
        .join("\n"),
    });
  }
  const out = new Map<string, MicrobriefPlanningDecision>();
  if (inputs.length === 0) return out;
  // JV1 (mudança 44): o lote inteiro do Gateway (40 etapas, 30 mil caracteres) estourava o estado do Jev
  // (24 mil) e TODAS as etapas caíam no nível de reserva — a pergunta existia, a resposta nunca chegava.
  const policy = loadOrchestrationPolicy();
  for (const lote of chunkPlanningInputs(inputs)) {
    const decisions = await decideMicrobriefsPlanningBatch({ microbriefs: lote, sessionId, policy }).catch(() => []);
    for (const d of decisions) out.set(d.id, d);
  }
  return out;
}

/** Lotes de Microbriefs que cabem no estado do Jev: até `maxItens` e `maxChars` de resumo + arquivos por lote. */
export function chunkPlanningInputs(inputs: MicrobriefPlanningInput[], maxChars = 12_000, maxItens = 8): MicrobriefPlanningInput[][] {
  const lotes: MicrobriefPlanningInput[][] = [];
  let atual: MicrobriefPlanningInput[] = [];
  let tamanho = 0;
  for (const mb of inputs) {
    const t = mb.resumo.length + mb.arquivos.join(",").length + 200;
    if (atual.length > 0 && (atual.length >= maxItens || tamanho + t > maxChars)) {
      lotes.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(mb);
    tamanho += t;
  }
  if (atual.length > 0) lotes.push(atual);
  return lotes;
}

/** Grava a decisão no Microbrief (nivel_modelo) e em payload.jevPlan para o executor e a trilha. */
export function withJevPlan(
  payload: Record<string, unknown>,
  decision: MicrobriefPlanningDecision | undefined
): Record<string, unknown> {
  if (!decision) return payload;
  const mb = payload.microbrief as MicrobriefAndReportDocument | undefined;
  return {
    ...payload,
    ...(mb ? { microbrief: { ...mb, nivelModeloSugerido: decision.nivelModelo } } : {}),
    jevPlan: {
      nivelModelo: decision.nivelModelo,
      source: decision.source,
      precisaDividir: decision.precisaDividir,
      clusterSugerido: decision.cluster,
      aplicarTasteSkillPublico: decision.aplicarTasteSkillPublico ?? false,
      aplicarReactPerfCritico: decision.aplicarReactPerfCritico ?? true,
    },
  };
}

const CLUSTER_KINDS = ["core", "backend", "frontend", "integration"] as const;

/** Cluster sem arquivo no plano do analista vira etapa que não chama modelo nem teste. */
function withNadaAFazer(nodes: DAGNode[]): DAGNode[] {
  const present = new Set(nodes.map((n) => n.cluster).filter(Boolean));
  const extra: DAGNode[] = [];
  for (const cluster of CLUSTER_KINDS) {
    if (present.has(cluster)) continue;
    extra.push({
      id: `task-nada-${cluster}-${crypto.randomBytes(3).toString("hex")}`,
      title: `Nada a fazer: ${cluster}`,
      role: "nada_a_fazer",
      cluster,
      status: "pending",
      dependencies: [],
      filesScope: [],
      mcpScope: "",
      payload: { step: "nada_a_fazer", cluster },
    });
  }
  return extra.length ? [...nodes, ...extra] : nodes;
}

function contratoNoPlano(nodes: DAGNode[]): ContratoProjeto | undefined {
  for (const n of nodes) {
    const p = n.payload;
    if (p && typeof p === "object" && "contrato" in p) {
      const c = (p as { contrato?: ContratoProjeto }).contrato;
      if (c && typeof c === "object") return c;
    }
  }
  return undefined;
}

async function notasDeExcecaoCluster(sessionId: string): Promise<string | undefined> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true, phaseContext: true },
  });
  const ctx = parseSessionPhaseContext(session?.phase, session?.phaseContext);
  if (!ctx.excecoesCluster?.length) return undefined;
  return ctx.excecoesCluster
    .map(
      (e) =>
        `Exceção confirmada pelo humano: a lacuna ${e.gap} fica no cluster ${e.cluster}. Não invente arquivo para preencher outro cluster.`
    )
    .join("\n");
}

/**
 * Leva a sessão até PLANEJAMENTO. CONFERENCIA_OK aqui só corre depois de um laudo
 * aprovado, ou quando a conferência está desligada (a trilha registra a origem).
 */
async function abrirPlanejamento(
  sessionId: string,
  modoConferencia: "ativo" | "sombra" | "desligado"
): Promise<{ ok: true; phase: Phase } | { ok: false; reason: string; problems?: string[] }> {
  const readPhase = async (): Promise<Phase> => {
    const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { phase: true } });
    return (s?.phase as Phase) || "ENTRADA";
  };
  let phase = await readPhase();
  if (phase === "SPEC_REVISAO") {
    const a = await applyPhaseEvent(sessionId, { type: "SPEC_APROVADA" });
    if (!a.ok) return { ok: false, reason: a.reason ?? "SPEC_APROVADA_RECUSADA" };
    phase = a.ctx.phase;
  }
  if (phase === "MACROBRIEF") {
    const m = await applyPhaseEvent(sessionId, { type: "MACROBRIEF_PRONTO" });
    if (!m.ok) return { ok: false, reason: m.reason ?? "MACROBRIEF_PRONTO_RECUSADO" };
    phase = m.ctx.phase;
  }
  if (phase === "CONFERENCIA") {
    const c = await applyPhaseEvent(
      sessionId,
      { type: "CONFERENCIA_OK" },
      { extraDetails: { origem: modoConferencia === "desligado" ? "conferencia_desligada" : "laudo_aprovado" } }
    );
    if (!c.ok) return { ok: false, reason: c.reason ?? "CONFERENCIA_OK_RECUSADO" };
    phase = c.ctx.phase;
  }
  if (phase !== "PLANEJAMENTO" && phase !== "EXECUCAO") {
    return {
      ok: false,
      reason: "FASE_INESPERADA",
      problems: [`A sessão está em ${phase} e não entrou em planejamento.`],
    };
  }
  return { ok: true, phase };
}
