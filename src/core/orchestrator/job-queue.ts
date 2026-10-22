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
import { verifyProjectDeliveryWithJev } from "@/core/decision/jev-execution-checks";
import { renderDeliveryAuditReportMarkdown } from "@/core/templates/artifact-templates";
import { runUiCheck, pagesFromSpecFiles, describeUiCheckFailure, type UiCheckReport } from "@/core/execution/ui-check";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { tryStartDeliveryRepair } from "@/core/orchestrator/delivery-repair";
import { loadOrchestrationPolicy } from "@/core/config/orchestration-policy";
import { isHighEntropySecretLiteral } from "@/core/governance/secret-guard";
import type { Job } from "@prisma/client";

export const DEFAULT_JOB_LEASE_MS = 30000;

export function getJobLeaseMs(): number {
  const raw = Number(process.env.NEXTCODE_JOB_LEASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JOB_LEASE_MS;
}

/**
 * Enfileira um Job "session_queue" em status "queued" com activeKey = sessionId.
 * Se já houver um job ativo para a sessão (P2002 em activeKey), devolve o id do job existente.
 */
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
    if (sessionAfterQueue?.phase === "EXECUCAO") {
      const hasBlockedNode = queueResult.tasks.some((t) => t.status === "blocked");
      if (hasBlockedNode) {
        await applyPhaseEvent(job.sessionId, { type: "EXECUTOR_BLOQUEADO" }, { avisoJaPostado: true });
      } else if (queueResult.allCompleted) {
        await applyPhaseEvent(job.sessionId, { type: "SEM_PENDENCIAS" });
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
        const projectPath = sessionAfterQueue.project?.path;
        let finalBuildErrorLines: string[] = [];
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
                  "(no Windows, `0xC0000142` costuma ser falta de memória). Libere memória e retome.",
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
              deliveryT10.gaps.push(
                `Type-check do projeto final com ${recheck.errors.length} erro(s); primeiros: ${recheck.errors.slice(0, 5).join(" | ")}`
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
            deliveryT10.gaps.push(`Verificação de tela reprovada (${uiCheck.stage}).`);
            await prisma.message.create({
              data: { sessionId: job.sessionId, role: "assistant", content: describeUiCheckFailure(uiCheck) },
            });
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
          await applyPhaseEvent(
            job.sessionId,
            { type: "VERIFICACAO_OK" },
            { extraDetails: { specCompleteness: queueResult.specCompleteness, deliveryT10 } }
          );
        } else {
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
                !g.startsWith("Falha na verificação empírica de build")
            ),
          });
          if (!repair.started) {
            await applyPhaseEvent(
              job.sessionId,
              { type: "VERIFICACAO_COM_LACUNAS" },
              {
                extraDetails: { specCompleteness: queueResult.specCompleteness, deliveryT10, reparo: repair.motivo },
                detalheAviso:
                  "**Lacunas encontradas:**\n" +
                  (deliveryT10.gaps.length > 0
                    ? deliveryT10.gaps.map((g) => `- ${g}`).join("\n")
                    : "- (a verificação não detalhou a lacuna)") +
                  `\n\n${repair.motivo}`,
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
