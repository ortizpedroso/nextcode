import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import {
  processSessionQueue,
  recoverZombieRunningNodes,
  type SessionQueueResult,
} from "@/core/orchestrator/session-queue";
import {
  verifyProjectDeliveryT10,
  readProjectFilesContent,
} from "@/core/orchestrator/node-executor";
import { recheckFinalBuild } from "@/core/governance/empirical-gate";
import { reviewFinalDelivery, type FinalDefect } from "@/core/governance/final-reviewer";
import { loadPriorProofs } from "@/core/orchestrator/prior-proofs";
import { officialDocsBlockForSession } from "@/core/intake/official-docs-research";
import { confirmDeliveryTriageWithJev, verifyProjectDeliveryWithJev } from "@/core/decision/jev-execution-checks";
import { humanActionFromTriage, triageDeliveryLacunas, lacunasSoAmbienteOuHarness } from "@/core/orchestrator/delivery-triage";
import { renderDeliveryAuditReportMarkdown } from "@/core/templates/artifact-templates";
import {
  runUiCheck,
  pagesFromSpecFiles,
  describeUiCheckFailure,
  uiCheckFailureGap,
  uiCheckHarnessAmbienteFailure,
  type UiCheckReport,
} from "@/core/execution/ui-check";
import { diagnoseUiCheckAmbiente } from "@/core/execution/project-verification-env";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { tryStartDeliveryRepair } from "@/core/orchestrator/delivery-repair";
import { buildDeliveryDiagnosis, buildDeliveryReport, importantProblemsAsDefects, splitDefectsByEvidence } from "@/core/orchestrator/delivery-diagnosis";
import { loadOrchestrationPolicy } from "@/core/config/orchestration-policy";
import { isHighEntropySecretLiteral } from "@/core/governance/secret-guard";
import type { Job } from "@prisma/client";

export const DEFAULT_JOB_LEASE_MS = 30000;

/** Mudança 43.4: quantos defeitos cada revisão final executada desta sessão achou, em ordem. */
export async function finalReviewProgress(sessionId: string): Promise<number[]> {
  const logs = await prisma.telemetryLog.findMany({
    where: { sessionId, action: "FINAL_REVIEW" },
    orderBy: { createdAt: "asc" },
    select: { details: true },
  });
  const out: number[] = [];
  for (const l of logs) {
    try {
      const d = JSON.parse(l.details || "{}");
      if (d.executado && Array.isArray(d.defeitos)) out.push(d.defeitos.length);
    } catch {
      /* ignora registro ilegível */
    }
  }
  return out;
}

export function getJobLeaseMs(): number {
  const raw = Number(process.env.NEXTCODE_JOB_LEASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JOB_LEASE_MS;
}

/**
 * Enfileira um Job "session_queue" em status "queued" com activeKey = sessionId.
 * Se já houver um job ativo para a sessão (P2002 em activeKey), devolve o id do job existente.
 */
export { loadPriorProofs } from "@/core/orchestrator/prior-proofs";

/** E5: discordâncias teste de aceite × avaliador (etapas que seguiram com ressalva) viram suspeitas da revisão final. */
export async function acceptanceDisagreements(sessionId: string): Promise<Array<{ arquivo: string | null; defeito: string }>> {
  const logs = await prisma.telemetryLog.findMany({ where: { sessionId, action: "ACCEPTANCE_DISAGREEMENT" }, select: { details: true } });
  const out: Array<{ arquivo: string | null; defeito: string }> = [];
  for (const l of logs) {
    try {
      const d = JSON.parse(l.details || "{}") as { nodeId?: string; falhas?: string[] };
      if (!d.nodeId) continue;
      const node = await prisma.taskNode.findUnique({ where: { id: d.nodeId }, select: { title: true, filesScope: true } });
      const escopo = (JSON.parse(node?.filesScope || "[]") as string[]).filter((f) => !/(^|\/)(tests?|__tests__)\//.test(f));
      out.push({
        arquivo: escopo[0] ?? null,
        defeito: `teste de aceite discordou do avaliador em "${node?.title ?? d.nodeId}": ${(d.falhas ?? [])[0]?.slice(0, 400) ?? ""}`,
      });
    } catch {
      // registro ilegível: ignora
    }
  }
  return out.slice(0, 5);
}

export async function enqueueSessionQueueJob(sessionId: string): Promise<string> {
  try {
    const job = await prisma.job.create({
      data: {
        sessionId,
        activeKey: sessionId,
        kind: "session_queue",
        status: "queued",
      },
    });
    return job.id;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2002") {
      const existing = await prisma.job.findUnique({
        where: { activeKey: sessionId },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
      const retryJob = await prisma.job.create({
        data: {
          sessionId,
          activeKey: sessionId,
          kind: "session_queue",
          status: "queued",
        },
      });
      return retryJob.id;
    }
    throw err;
  }
}

/**
 * Reserva atômica de um Job com UM único updateMany.
 * Ganha a reserva apenas quem recebe count === 1.
 * Se o job estava "running" com lease vencido, incrementa reclaims na mesma operação.
 */
export async function claimJob(jobId: string, workerId: string): Promise<boolean> {
  const now = new Date();
  // PJ2b: job de projeto fechado espera na fila até o projeto ser reaberto.
  const owner = await prisma.job.findUnique({ where: { id: jobId }, select: { session: { select: { project: { select: { isArchived: true } } } } } });
  if (owner?.session?.project?.isArchived) return false;
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

async function logJobLeaseLost(
  sessionId: string | null,
  jobId: string,
  workerId: string,
  stage: string
): Promise<void> {
  await prisma.telemetryLog.create({
    data: {
      sessionId,
      action: "JOB_LEASE_LOST",
      details: JSON.stringify({
        jobId,
        workerId,
        stage,
      }),
      durationMs: 0,
    },
  });
}

/**
 * Executa um Job já reservado via claimJob:
 * - mantém heartbeat ativo durante a execução (parando no finally);
 * - aplica a regra 3.4 de retomada após queda quando reclaims > 0 (somente se ainda for o dono);
 * - chama processSessionQueue e grava status done (com result e activeKey: null) ou failed (com lastError e activeKey: null)
 *   somente se where { id: jobId, lockedBy: workerId } confirmar a posse do lease.
 */
export async function executeClaimedJob(jobId: string, workerId: string): Promise<Job | null> {
  const stopHeartbeat = startJobHeartbeat(jobId, workerId);
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return null;
    }

    if (job.lockedBy !== workerId) {
      await logJobLeaseLost(job.sessionId, jobId, workerId, "initial_check");
      return null;
    }

    // 3.4 Retomada após queda: quando claimJob reservou um job que estava "running" com lease vencido (reclaims > 0)
    if (job.reclaims > 0) {
      const stillOwnsBeforeReclaim = await prisma.job.count({
        where: { id: jobId, lockedBy: workerId },
      });
      if (stillOwnsBeforeReclaim === 0) {
        await logJobLeaseLost(job.sessionId, jobId, workerId, "reclaim_recovery");
        return null;
      }

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
          const currentSession = await prisma.session.findUnique({
            where: { id: job.sessionId },
            select: { specVersion: true },
          });
          const runningNodes = await prisma.taskNode.findMany({
            where: {
              sessionId: job.sessionId,
              specVersion: currentSession?.specVersion ?? 0,
              status: "running",
            },
          });

          for (const node of runningNodes) {
            const stillOwnsNodeRevert = await prisma.job.count({
              where: { id: jobId, lockedBy: workerId },
            });
            if (stillOwnsNodeRevert === 0) {
              await logJobLeaseLost(job.sessionId, jobId, workerId, "reclaim_revert_node");
              return null;
            }

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
        // reclaims > 3: o job vai para failed (limpando activeKey) somente se ainda for o dono, e os nós "running" seguem o caminho de zumbi
        const failedReclaimUpdate = await prisma.job.updateMany({
          where: {
            id: jobId,
            lockedBy: workerId,
          },
          data: {
            status: "failed",
            activeKey: null,
            lastError: `Limite de retomadas excedido (reclaims=${job.reclaims}).`,
            finishedAt: new Date(),
          },
        });

        if (failedReclaimUpdate.count === 0) {
          await logJobLeaseLost(job.sessionId, jobId, workerId, "reclaim_limit_exceeded");
          return null;
        }

        await recoverZombieRunningNodes(job.sessionId, { ignoreStaleThreshold: true });
        return await prisma.job.findUnique({ where: { id: jobId } });
      }
    }

    const queueResult: SessionQueueResult = await processSessionQueue(job.sessionId);

    const doneUpdate = await prisma.job.updateMany({
      where: {
        id: jobId,
        lockedBy: workerId,
      },
      data: {
        status: "done",
        activeKey: null,
        result: JSON.stringify(queueResult),
        finishedAt: new Date(),
      },
    });

    if (doneUpdate.count === 0) {
      await logJobLeaseLost(job.sessionId, jobId, workerId, "finalize_done");
      return null;
    }

    const sessionAfterQueue = await prisma.session.findUnique({
      where: { id: job.sessionId },
      include: { project: true },
    });
    // T10: fila vazia com DAG completa — inclusive retomada em VERIFICACAO (ambiente corrigido, ui-check não rodou).
    const runFinalDelivery =
      sessionAfterQueue &&
      queueResult.allCompleted &&
      (sessionAfterQueue.phase === "EXECUCAO" || sessionAfterQueue.phase === "VERIFICACAO");
    if (runFinalDelivery) {
      const hasBlockedNode = queueResult.tasks.some((t) => t.status === "blocked");
      if (hasBlockedNode && sessionAfterQueue.phase === "EXECUCAO") {
        await applyPhaseEvent(job.sessionId, { type: "EXECUTOR_BLOQUEADO" }, { avisoJaPostado: true });
      } else if (!hasBlockedNode) {
        if (sessionAfterQueue.phase === "EXECUCAO") {
          await applyPhaseEvent(job.sessionId, { type: "SEM_PENDENCIAS" });
        }
        const deliveryT10 = verifyProjectDeliveryT10({
          canonicalSpec: sessionAfterQueue.canonicalSpec,
          projectPath: sessionAfterQueue.project?.path,
          tasks: queueResult.tasks,
          // Decisão do fundador (07/10): entrega estrita — todos os REQ aprovados + build conferido.
          requireFullBuild: true,
        });
        // Verificação de tela (decisão do fundador, 07/10): com páginas, só entrega se o site
        // gerar o build e abrir sem erro no celular e no desktop.
        let uiCheck: UiCheckReport | null = null;
        let uiBuildDefects: Array<{ arquivo: string | null; defeito: string }> = [];
        const projectPath = sessionAfterQueue.project?.path;
        let finalBuildErrorLines: string[] = [];
        if (projectPath) {
          const { ensureVerificationRuntimeEnv } = await import("@/core/execution/project-verification-env");
          const ensured = ensureVerificationRuntimeEnv(projectPath);
          if (ensured.length > 0) {
            TelemetryLogger.log({
              sessionId: job.sessionId,
              action: "T10_RUNTIME_ENV_ENSURED",
              details: { ensured, artifact: ".nextcode/verification.env" },
            });
          }
        }
        // Mudança 34: build reprovado só por etapas do meio → confere o projeto final de novo.
        if (!deliveryT10.buildVerified && deliveryT10.specFilesComplete && projectPath) {
          const recheck = await recheckFinalBuild(projectPath);
          TelemetryLogger.log({
            sessionId: job.sessionId,
            action: "FINAL_BUILD_RECHECK",
            details: {
              checked: recheck.checked,
              ok: recheck.ok,
              erros: recheck.errors.length,
              amostra: recheck.errors.slice(0, 5),
              ...(recheck.ambiente ? { ambiente: recheck.ambiente } : {}),
            },
          });
          // Mudança 35: o tsc não rodou — nada no código foi julgado; Retomar, sem reparo nem Spec.
          if (recheck.ambiente) {
            await applyPhaseEvent(
              job.sessionId,
              { type: "FALHA_AMBIENTE" },
              {
                extraDetails: { ambiente: recheck.ambiente },
                detalheAviso:
                  `**Causa:** ${recheck.ambiente}.\n\n` +
                  "Não é erro de código nem da Spec: o NextCode não conseguiu rodar a conferência de tipos do projeto final " +
                  "(no Windows, `0xC0000142` ou saída 1 sem mensagem costuma ser falta de memória — feche contêineres Docker/ui-check pesados se estiverem rodando). Libere memória e **Retome**.",
              }
            );
            return await prisma.job.findUnique({ where: { id: jobId } });
          }
          finalBuildErrorLines = recheck.linhas ?? [];
          if (recheck.checked) {
            deliveryT10.gaps = deliveryT10.gaps.filter(
              (g) => !g.startsWith("Falha na verificação empírica de build") && !g.startsWith("Build do projeto não verificado")
            );
            if (recheck.ok) {
              deliveryT10.buildVerified = true;
              deliveryT10.passed = deliveryT10.specFilesComplete && deliveryT10.allReqsApproved;
            } else {
              const rotulo = recheck.failedNextBuild ? "Build Next (next build) do projeto final" : "Type-check do projeto final";
              deliveryT10.gaps.push(
                `${rotulo} com ${recheck.errors.length} erro(s); primeiros: ${recheck.errors.slice(0, 5).join(" | ")}`
              );
            }
          }
        }
        const uiPages = pagesFromSpecFiles(parseSpecDocument(sessionAfterQueue.canonicalSpec || "")?.arquivosAfetados ?? []);
        if (deliveryT10.passed && projectPath && uiPages.length > 0) {
          uiCheck = await runUiCheck(projectPath, uiPages).catch(
            (err): UiCheckReport => ({ ok: false, stage: "docker", error: String(err) })
          );
          TelemetryLogger.log({
            sessionId: job.sessionId,
            action: uiCheck.ok ? "UI_CHECK_PASSED" : "UI_CHECK_FAILED",
            details: { pages: uiPages, stage: uiCheck.stage, problems: uiCheck.problems ?? [], error: uiCheck.error, skipped: uiCheck.skipped ?? false },
          });
          if (!uiCheck.ok) {
            deliveryT10.passed = false;
            deliveryT10.gaps.push(
              uiCheckFailureGap({
                ...uiCheck,
                outDir: uiCheck.outDir ?? path.join(projectPath, ".nextcode", "ui-check"),
              })
            );
            // Erro do next build com arquivo → defeito da etapa dona (J2b), em vez de lacuna sem dono.
            uiBuildDefects = (uiCheck.buildErrors ?? []).map((e) => ({
              arquivo: e.arquivo,
              defeito: `verificação de tela (next build): ${e.arquivo}:${e.linha}: ${e.mensagem}`,
            }));
            await prisma.message.create({
              data: { sessionId: job.sessionId, role: "assistant", content: describeUiCheckFailure(uiCheck) },
            });
          }
        }

        // J3: revisão final cega (avaliador-final) — Spec inteira × todos os arquivos entregues.
        let finalReviewDefects: FinalDefect[] = [];
        let finalReviewQuestions: string[] = [];
        let finalReviewSummary: Record<string, unknown> | null = null;
        let finalReviewVerdicts: string[] = [];
        let deliveryRessalvas: FinalDefect[] = [];
        // Mudança 44: defeitos da revisão final já vão como fileDefects; não podem virar "lacuna sem dono".
        const finalReviewGaps = new Set<string>();
        const revisaoFinalModo = loadOrchestrationPolicy().execucao.revisaoFinal;
        if (revisaoFinalModo !== "desligado" && deliveryT10.passed && sessionAfterQueue.canonicalSpec) {
          const specFiles = parseSpecDocument(sessionAfterQueue.canonicalSpec)?.arquivosAfetados ?? [];
          let macrobriefTexto = "";
          if (projectPath) {
            try {
              const macroMd = path.join(projectPath, ".nextcode", "macrobrief.md");
              const macroJson = path.join(projectPath, ".nextcode", "macrobrief.json");
              const macroPath = fs.existsSync(macroMd) ? macroMd : macroJson;
              if (fs.existsSync(macroPath)) macrobriefTexto = fs.readFileSync(macroPath, "utf8");
            } catch {
              macrobriefTexto = "";
            }
          }
          const review = await reviewFinalDelivery({
            sessionId: job.sessionId,
            spec: sessionAfterQueue.canonicalSpec,
            macrobrief: macrobriefTexto || undefined,
            files: readProjectFilesContent([...specFiles, "package.json"], projectPath),
            // Mudança 43.2: com a pasta, cada defeito é provado na bancada antes de ir ao reparo.
            projectPath,
            // Mudança 44: o que já foi provado nesta sessão roda de novo (a leitura varia, o teste não).
            priorProofs: await loadPriorProofs(job.sessionId),
            suspeitasExtras: await acceptanceDisagreements(job.sessionId),
            // Mudança 45: dúvida de integração é decidida pela documentação oficial antes de virar pergunta.
            docsOficiais: await officialDocsBlockForSession(
              job.sessionId,
              `${sessionAfterQueue.canonicalSpec ?? ""}\n${(await prisma.message.findMany({ where: { sessionId: job.sessionId, role: "user" }, select: { content: true } })).map((m) => m.content).join("\n")}`
            ).catch(() => null),
          });
          const novasProvas = review.defeitos
            .filter((d) => d.prova === "reproduzido" && d.teste && !d.teste.existente)
            .map((d) => ({ caminho: d.teste!.caminho, conteudo: d.teste!.conteudo, req: d.req, arquivo: d.arquivo, defeito: d.defeito }));
          if (novasProvas.length > 0) {
            try {
              await TelemetryLogger.logAndWait({
                sessionId: job.sessionId,
                action: "FINAL_REVIEW_PROOFS",
                details: { provas: novasProvas },
              });
            } catch {
              /* telemetria não bloqueia entrega */
            }
          }
          finalReviewSummary = {
            modo: revisaoFinalModo,
            executado: review.executado,
            motivoNaoExecutado: review.motivoNaoExecutado,
            aprovado: review.aprovado,
            modelo: review.modelo,
            reqs: review.reqVerdicts.map((v) => `${v.id}=${v.status}`),
            defeitos: review.defeitos.map((d) => `[${d.prova ?? "leitura"}] ${d.defeito}`).slice(0, 30),
            perguntasSpec: review.perguntasSpec ?? [],
            naoReproduzidos: (review.naoReproduzidos ?? []).slice(0, 20),
            importantesSemProva: (review.importantesSemProva ?? []).map((d) => d.defeito).slice(0, 20),
            provasAnteriores: review.provasAnteriores ?? null,
            ressalvas: review.ressalvas.slice(0, 30),
            naoVerificados: review.naoVerificados ?? [],
            citacoesInvalidas: (review.citacoesInvalidas ?? []).slice(0, 10),
            descartes: review.descartes,
          };
          TelemetryLogger.log({ sessionId: job.sessionId, action: "FINAL_REVIEW", details: finalReviewSummary });
          // Mudança 44 (bench 22/10: P3 entregue com a régua 0/12 quando o crédito da Anthropic acabou): com a
          // revisão ativa, revisão que não rodou por falta de modelo ou por respostas descartadas NÃO libera a
          // entrega — é ambiente: para com o motivo e Retomar. "Não coube" (projeto grande demais) segue como antes.
          if (
            revisaoFinalModo === "ativo" &&
            !review.executado &&
            /^(sem modelo|respostas descartadas)/.test(review.motivoNaoExecutado ?? "")
          ) {
            await applyPhaseEvent(
              job.sessionId,
              { type: "FALHA_AMBIENTE" },
              {
                extraDetails: { ambiente: `revisão final não rodou: ${review.motivoNaoExecutado}` },
                detalheAviso:
                  `**Causa:** a revisão final do projeto não rodou (${(review.motivoNaoExecutado ?? "").slice(0, 400)}).\n\n` +
                  "Nada foi entregue sem essa conferência. Confira crédito e chave do avaliador (Anthropic) em Configurações e clique em **Retomar**: a verificação final roda de novo.",
              }
            );
            return await prisma.job.findUnique({ where: { id: jobId } });
          }
          finalReviewVerdicts = review.reqVerdicts.map((v) => `${v.id}=${v.status}`);
          if (revisaoFinalModo === "ativo" && review.executado && review.aprovado) {
            deliveryRessalvas = projectPath ? review.importantesSemProva ?? [] : importantProblemsAsDefects(review.problemas, review.defeitos);
          }
          if (revisaoFinalModo === "ativo" && review.executado && !review.aprovado) {
            finalReviewQuestions = review.perguntasSpec ?? [];
            // Mudança 44: só o que tem prova (teste que falha, crítico, ou sem bancada para provar) reprova;
            // o resto acompanha o reparo, ou vira ressalva da entrega se for tudo o que sobrou.
            const { bloqueiam, leitura: leituraDefeitos } = splitDefectsByEvidence(review.defeitos);
            // Problemas "importante" (bug real que não chega a reprovar: ex.: 500 num cadastro) acompanham o
            // reparo quando há rodada aberta e, na entrega, viram ressalva — antes ficavam só na trilha.
            const leitura = [
              ...leituraDefeitos,
              ...(projectPath ? review.importantesSemProva ?? [] : importantProblemsAsDefects(review.problemas, review.defeitos)),
            ];
            if (bloqueiam.length === 0) {
              deliveryRessalvas = leitura;
              TelemetryLogger.log({
                sessionId: job.sessionId,
                action: "FINAL_REVIEW_RESSALVAS",
                details: { ressalvas: leitura.map((d) => d.defeito).slice(0, 20), perguntasSpec: finalReviewQuestions },
              });
            } else {
              deliveryT10.passed = false;
              // Perguntas de Spec não vão para o reparo de código (sem etapa dona); o aviso as faz ao fundador.
              finalReviewDefects = [...bloqueiam, ...leitura];
              for (const d of review.defeitos) finalReviewGaps.add(d.defeito);
              deliveryT10.gaps.push(...review.defeitos.map((d) => d.defeito));
            }
          }
        }

        // Auditoria Final do JEV (Spec Canônica × Código Real no Disco)
        const auditoriaEntregaModo = loadOrchestrationPolicy().jevExecucao.auditoriaEntrega;
        if (auditoriaEntregaModo !== "desligado" && deliveryT10.passed && sessionAfterQueue.canonicalSpec) {
          const parsedSpec = parseSpecDocument(sessionAfterQueue.canonicalSpec);
          const filesToAudit = parsedSpec?.arquivosAfetados ?? [];
          if (parsedSpec && filesToAudit.length > 0) {
            const codeContentMap = readProjectFilesContent(filesToAudit, projectPath);
            const jevAudit = await verifyProjectDeliveryWithJev({
              sessionId: job.sessionId,
              projetoId: parsedSpec.titulo || job.sessionId,
              spec: {
                titulo: parsedSpec.titulo,
                requisitos: (parsedSpec.requisitos ?? []).map((r) => ({
                  id: r.id,
                  titulo: r.titulo,
                  criterio: r.criterio,
                })),
                stack: parsedSpec.stack,
                regras: parsedSpec.notasImplementacao,
                arquivosAfetados: filesToAudit,
              },
              codeContentMap,
            });

            if (auditoriaEntregaModo === "sombra") {
              TelemetryLogger.log({
                sessionId: job.sessionId,
                action: "JEV_FINAL_DELIVERY_AUDIT_SOMBRA",
                details: {
                  modo: "sombra",
                  aprovadoJev: jevAudit.aprovado,
                  jevDisponivel: jevAudit.jevDisponivel,
                  scores: jevAudit.scores,
                  lacunas: jevAudit.lacunas.map((l) => l.categoria),
                },
              });
            } else {
              if (!jevAudit.aprovado) {
                deliveryT10.passed = false;
                for (const lacuna of jevAudit.lacunas) {
                  deliveryT10.gaps.push(`[JEV Audit: ${lacuna.categoria}] ${lacuna.descricao}`);
                }
                const auditReportDoc = {
                  documento: "laudo_auditoria_entrega" as const,
                  idLaudo: `laudo-entrega-${Date.now()}`,
                  idProjeto: parsedSpec.titulo || job.sessionId,
                  specVersao: 1,
                  aprovado: false,
                  confiancaMedia: jevAudit.confiancaMedia,
                  scores: jevAudit.scores,
                  lacunas: jevAudit.lacunas,
                  resumoAuditoria: jevAudit.resumoAuditoria,
                };
                const reportMarkdown = renderDeliveryAuditReportMarkdown(auditReportDoc);
                await prisma.message.create({
                  data: {
                    sessionId: job.sessionId,
                    role: "assistant",
                    content: reportMarkdown,
                  },
                });
              }
            }
          }
        }
        if (deliveryT10.passed) {
          await prisma.message.create({
            data: {
              sessionId: job.sessionId,
              role: "assistant",
              content: buildDeliveryReport({
                reqs: (parseSpecDocument(sessionAfterQueue.canonicalSpec || "")?.requisitos ?? []).map((r) => r.id),
                revisaoFinal: finalReviewVerdicts,
                telas: uiCheck?.ok ? uiPages : [],
                ressalvas: deliveryRessalvas,
                perguntasSpec: finalReviewQuestions,
              }),
            },
          });
          await applyPhaseEvent(
            job.sessionId,
            { type: "VERIFICACAO_OK" },
            { extraDetails: { specCompleteness: queueResult.specCompleteness, deliveryT10, revisaoFinal: finalReviewSummary } }
          );
        } else {
          // Paridade T10: falha de harness ui-check (Docker, env, NO_SECRET) para antes do reparo LLM —
          // evita rodadas em rotas quando o `next start` do contêiner não espelha o `.env` do projeto.
          if (uiCheck && !uiCheck.ok && uiCheckHarnessAmbienteFailure(uiCheck)) {
            const ambiente = diagnoseUiCheckAmbiente({
              ...uiCheck,
              outDir: uiCheck.outDir ?? (projectPath ? path.join(projectPath, ".nextcode", "ui-check") : undefined),
            }).causa;
            await applyPhaseEvent(
              job.sessionId,
              { type: "FALHA_AMBIENTE" },
              {
                extraDetails: {
                  deliveryT10,
                  uiCheck: { stage: uiCheck.stage, error: uiCheck.error },
                  ambienteT10: ambiente,
                },
                detalheAviso:
                  `${describeUiCheckFailure(uiCheck)}\n\n` +
                  `**Causa:** ${ambiente ?? "verificação de tela (ambiente T10)"} — **não** é defeito de código para reparo automático. ` +
                  "Confira Docker Desktop, `.env` do projeto-alvo e reinicie o NextCode se acabou de atualizar o harness; depois **Retome**.",
              }
            );
            return await prisma.job.findUnique({ where: { id: jobId } });
          }
          // PJ2b: se só há lacunas de ambiente/harness, não gasta rodada de reparo de código.
          if (lacunasSoAmbienteOuHarness({
            buildErrorLines: finalBuildErrorLines,
            outrasLacunas: deliveryT10.gaps.filter(
              (g) =>
                !g.startsWith("Arquivos da Spec ausentes") &&
                !g.startsWith("Requisitos não aprovados") &&
                !g.startsWith("Type-check do projeto final") &&
                !g.startsWith("Falha na verificação empírica de build") &&
                !g.startsWith("revisão final") &&
                !finalReviewGaps.has(g) &&
                !(uiBuildDefects.length > 0 && g.startsWith("Verificação de tela reprovada"))
            ),
            defeitosDeArquivo: [...finalReviewDefects, ...uiBuildDefects].map((d) => d.defeito),
            arquivosAusentes: deliveryT10.missingFiles,
            reqsNaoAprovados: deliveryT10.unapprovedReqs,
          })) {
            TelemetryLogger.log({
              sessionId: job.sessionId,
              action: "DELIVERY_REPAIR_ROUND_CREDITED",
              details: { motivo: "causa dominante ambiente ou harness" },
            });
            await applyPhaseEvent(
              job.sessionId,
              { type: "FALHA_AMBIENTE" },
              {
                detalheAviso:
                  "**Causa:** falhas apenas de ambiente ou harness detectadas.\n" +
                  "Não é defeito de código — a rodada de reparo **não foi consumida**. Corrija o ambiente e **Retome**.",
              }
            );
            return await prisma.job.findUnique({ where: { id: jobId } });
          }
          try {
          // J2b: com dono para cada lacuna (e rodada disponível), volta ao planejamento com etapas de reparo.
          const repair = await tryStartDeliveryRepair(job.sessionId, {
            missingFiles: deliveryT10.missingFiles,
            unapprovedReqs: deliveryT10.unapprovedReqs,
            buildErrorLines: finalBuildErrorLines,
            buildGapWithoutDetail: deliveryT10.gaps.some(
              (g) => g.startsWith("Falha na verificação empírica de build") || (g.startsWith("Type-check do projeto final") && finalBuildErrorLines.length === 0)
            ),
            otherGaps: deliveryT10.gaps.filter(
              (g) =>
                !g.startsWith("Arquivos da Spec ausentes") &&
                !g.startsWith("Requisitos não aprovados") &&
                !g.startsWith("Type-check do projeto final") &&
                !g.startsWith("Falha na verificação empírica de build") &&
                !g.startsWith("revisão final") &&
                !finalReviewGaps.has(g) &&
                !(uiBuildDefects.length > 0 && g.startsWith("Verificação de tela reprovada"))
            ),
            fileDefects: [...finalReviewDefects, ...uiBuildDefects],
          }, { perguntasSpec: finalReviewQuestions });
          const outrasLacunasT10 = deliveryT10.gaps.filter(
            (g) =>
              !g.startsWith("revisão final") &&
              !g.startsWith("teste do projeto falha") &&
              !finalReviewGaps.has(g) &&
              !(uiBuildDefects.length > 0 && g.startsWith("Verificação de tela reprovada"))
          );
          const triagem = triageDeliveryLacunas({
            buildErrorLines: finalBuildErrorLines,
            outrasLacunas: outrasLacunasT10,
            semDonoReparo: !repair.started && repair.tipo === "sem_dono" ? (repair.semDono ?? []) : [],
            perguntasSpecCount: finalReviewQuestions.length,
            reparoTipo: repair.started ? "aberto" : repair.tipo,
            reparoTodosComDono: !repair.started && repair.tipo === "esgotado" ? repair.todosComDono : undefined,
          });
          const triagemEntregaModo = loadOrchestrationPolicy().jevExecucao.triagemEntrega;
          const jevTriage =
            triagemEntregaModo !== "desligado"
              ? await confirmDeliveryTriageWithJev({
                  sessionId: job.sessionId,
                  modo: triagemEntregaModo,
                  dominanteHeuristica: triagem.dominante === "outro" ? "codigo" : triagem.dominante,
                  amostraErros: [
                    ...finalBuildErrorLines.slice(0, 8),
                    ...outrasLacunasT10.slice(0, 4),
                    ...(!repair.started && repair.tipo === "sem_dono" ? (repair.semDono ?? []).slice(0, 4) : []),
                  ],
                  reparoTipo: repair.started ? "aberto" : repair.tipo,
                })
              : null;
          TelemetryLogger.log({
            sessionId: job.sessionId,
            action: "DELIVERY_TRIAGE_SUMMARY",
            details: {
              reparoAberto: repair.started,
              triagem,
              jev: jevTriage,
            },
          });
          if (!repair.started) {
            // Mudança 43.4: aviso montado com o diagnóstico (o que sobrou, com prova; a Spec está certa?;
            // progresso) e o caminho certo — rodada extra autorizada ou a pergunta exata sobre a Spec.
            const progresso = await finalReviewProgress(job.sessionId);
            const diag = buildDeliveryDiagnosis({
              defeitos: [...finalReviewDefects, ...uiBuildDefects],
              perguntasSpec: finalReviewQuestions,
              outrasLacunas: outrasLacunasT10,
              progresso,
              reparo: repair,
              triagem,
            });
            await applyPhaseEvent(
              job.sessionId,
              { type: diag.evento },
              {
                extraDetails: {
                  specCompleteness: queueResult.specCompleteness,
                  deliveryT10,
                  reparo: repair.motivo,
                  diagnostico: diag.evento,
                  triagem,
                },
                detalheAviso: diag.detalhe,
                acaoHumano: humanActionFromTriage(triagem, false),
              }
            );
          }
          } catch (deliveryHandlerErr) {
            const em =
              deliveryHandlerErr instanceof Error ? deliveryHandlerErr.message : String(deliveryHandlerErr);
            TelemetryLogger.log({
              sessionId: job.sessionId,
              action: "T10_DELIVERY_HANDLER_CRASH",
              details: { error: em.slice(0, 500) },
            });
            await applyPhaseEvent(
              job.sessionId,
              { type: "FALHA_REPETIDA" },
              {
                detalheAviso:
                  `**Falha ao processar a verificação final (T10):** \`${em.slice(0, 400)}\`\n\n` +
                  "Se o código do NextCode foi atualizado recentemente, **reinicie o servidor** e clique **Retomar**.",
                acaoHumano: "retomar",
              }
            );
          }
        }
      }
    }

    return await prisma.job.findUnique({ where: { id: jobId } });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const failedUpdate = await prisma.job
      .updateMany({
        where: {
          id: jobId,
          lockedBy: workerId,
        },
        data: {
          status: "failed",
          activeKey: null,
          lastError: errorMessage,
          finishedAt: new Date(),
        },
      })
      .catch(() => ({ count: 0 }));

    if (failedUpdate.count === 0) {
      const currentJob = await prisma.job
        .findUnique({
          where: { id: jobId },
          select: { sessionId: true },
        })
        .catch(() => null);
      await logJobLeaseLost(
        currentJob?.sessionId ?? null,
        jobId,
        workerId,
        "finalize_failed"
      ).catch(() => {});
      return null;
    }

    const jobRecord = await prisma.job
      .findUnique({
        where: { id: jobId },
        select: { sessionId: true },
      })
      .catch(() => null);
    if (jobRecord?.sessionId) {
      await handleJobFailureForSession(jobRecord.sessionId, errorMessage).catch(() => {});
    }

    return await prisma.job.findUnique({ where: { id: jobId } }).catch(() => null);
  } finally {
    stopHeartbeat();
  }
}

/**
 * Trata falhas de jobs para a sessão:
 * - Em VERIFICACAO: bloqueia imediatamente com FALHA_REPETIDA (ninguém retoma VERIFICACAO sozinho).
 * - Em EXECUCAO: busca os 3 jobs mais recentes da sessão; se forem 3 e todos "failed", bloqueia com FALHA_REPETIDA.
 * - Outras fases: não faz nada.
 * - detalheAviso inclui a mensagem de erro com segredos de alta entropia sanitizados para [oculto].
 */
export async function handleJobFailureForSession(
  sessionId: string,
  errorMessage: string
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { phase: true },
  });
  if (!session) return;

  const pedacos = errorMessage.slice(0, 500).split(" ");
  const seguro = pedacos
    .map((pedaco) => (isHighEntropySecretLiteral(pedaco) ? "[oculto]" : pedaco))
    .join(" ");
  const detalheAviso = `**Último erro:** \`${seguro}\``;

  if (session.phase === "VERIFICACAO") {
    await applyPhaseEvent(sessionId, { type: "FALHA_REPETIDA" }, { detalheAviso });
    return;
  }

  if (session.phase === "EXECUCAO") {
    const recentJobs = await prisma.job.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { status: true },
    });
    if (recentJobs.length === 3 && recentJobs.every((j) => j.status === "failed")) {
      await applyPhaseEvent(sessionId, { type: "FALHA_REPETIDA" }, { detalheAviso });
    }
    return;
  }
}
