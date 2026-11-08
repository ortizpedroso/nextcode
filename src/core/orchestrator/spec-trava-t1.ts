/**
 * Trava T1 — regras de plataforma (invariantes entre fase, specApproved e replanejamento T8b).
 *
 * Regra de ouro (UI + idempotência): selo “Spec aprovada / execução liberada” **só** na família
 * EXECUCAO. Em PLANEJAMENTO (analista/T8b) o humano **sempre** pode clicar Aprovar de novo.
 */

import prisma from "@/lib/prisma";
import type { Phase, PhaseEvent } from "@/core/orchestrator/phase-machine";

/** Fases em que a execução autônoma já está em curso (aprovar de novo = no-op). */
export const SPEC_T1_EXECUCAO_FAMILIA: Phase[] = ["EXECUCAO", "PAUSADA", "VERIFICACAO", "ENTREGUE"];

/** Spec já saiu da revisão: analista/T8b em curso. Aprovar de novo continua o plano. */
export const SPEC_T1_PLANO_EM_CURSO: Phase[] = ["MACROBRIEF", "CONFERENCIA", "PLANEJAMENTO"];

export function phaseInPlanoEmCurso(phase: string | null | undefined): boolean {
  return SPEC_T1_PLANO_EM_CURSO.includes(phase as Phase);
}

export function phaseInExecucaoFamilia(phase: string | null | undefined): boolean {
  return SPEC_T1_EXECUCAO_FAMILIA.includes(phase as Phase);
}

/** Fases em que o humano deve poder (re)aprovar a Spec T1 na UI. */
export function phaseRequiresSpecReapproval(phase: string | null | undefined): boolean {
  return phase === "SPEC_REVISAO" || phase === "BLOQUEADA";
}

/**
 * Trava T1 pendente na UI = ainda não está em execução autônoma commitada.
 * Não confiar em `specApproved` sozinho fora da família EXECUCAO.
 */
export function specTravaT1Pendente(phase: string | null | undefined, specApproved: boolean): boolean {
  if (!specApproved) return true;
  if (phase == null || phase === "") return true;
  if (phaseRequiresSpecReapproval(phase)) return true;
  if (phase === "PLANEJAMENTO") return true;
  if (!phaseInExecucaoFamilia(phase)) return true;
  return false;
}

export function specEffectivelyApproved(phase: string | null | undefined, specApproved: boolean): boolean {
  return !specTravaT1Pendente(phase, specApproved);
}

/**
 * Selo verde da Trava T1. `travaT1Pendente === false` sozinho não libera:
 * a fase na resposta tem de estar na família EXECUCAO com a flag commitada.
 * `true` explícito mantém o selo pendente mesmo se a flag vier atrasada.
 */
export function specSealLiberado(
  travaT1Pendente: boolean | undefined,
  phase: string | null | undefined,
  specApproved: boolean
): boolean {
  if (travaT1Pendente === true) return false;
  return specEffectivelyApproved(phase, specApproved);
}

export type SpecApprovalHealOpts = {
  faseAntesDoBloqueio?: string | null;
  activeTasksForCurrentVersion?: number;
};

/** Bloqueio no meio da execução já commitada: a flag fica, senão o Retomar volta sem permissão de rodar a fila. */
export function executionBlockKeepsApproval(
  phase: string | null | undefined,
  opts?: SpecApprovalHealOpts
): boolean {
  return (
    phase === "BLOQUEADA" &&
    (opts?.activeTasksForCurrentVersion ?? 0) > 0 &&
    phaseInExecucaoFamilia(opts?.faseAntesDoBloqueio)
  );
}

/** Flag gravada fora da família EXECUCAO é resíduo (analista/T8b ainda não commitou). */
export function specApprovalFlagStuck(
  phase: string | null | undefined,
  specApproved: boolean,
  opts?: SpecApprovalHealOpts
): boolean {
  if (!specApproved) return false;
  if (executionBlockKeepsApproval(phase, opts)) return false;
  return !phaseInExecucaoFamilia(phase);
}

/** O heal antigo apagou a flag ao ver BLOQUEADA. Com etapas da versão atual e volta para execução, ela volta. */
export function specApprovalShouldRestore(
  phase: string | null | undefined,
  specApproved: boolean,
  opts?: SpecApprovalHealOpts
): boolean {
  return !specApproved && executionBlockKeepsApproval(phase, opts);
}

/** PATCH duplicado / sessão já executando — nunca short-circuit em PLANEJAMENTO. */
export function approveSpecCallIsIdempotent(phase: Phase): boolean {
  return phaseInExecucaoFamilia(phase);
}

/**
 * @deprecated Use approveSpecCallIsIdempotent para gates de approveSpecAndStart.
 * Mantido para testes de “há etapas gravadas”.
 */
export async function sessionHasCommittedExecutionPlan(sessionId: string, phase: Phase): Promise<boolean> {
  if (approveSpecCallIsIdempotent(phase)) return true;
  if (phase !== "PLANEJAMENTO") return false;
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { specApproved: true, specVersion: true },
  });
  if (!s?.specApproved) return false;
  const v = s.specVersion ?? 0;
  if (v <= 0) return false;
  const n = await prisma.taskNode.count({ where: { sessionId, specVersion: v } });
  return n > 0;
}

/** Retomar voltou para a execução e o heal tinha apagado a flag ao ver BLOQUEADA. */
export async function restoreSpecApprovalIfExecutionContinues(
  sessionId: string,
  specVersion: number
): Promise<void> {
  const tasksNaVersao = await prisma.taskNode.count({ where: { sessionId, specVersion } });
  if (tasksNaVersao <= 0) return;
  await prisma.session.updateMany({
    where: { id: sessionId, specApproved: false },
    data: { specApproved: true },
  });
}

/** Grava Trava T1 + versão e supersede pendentes antigos — só após T8b OK. */
export async function commitSpecApprovalAfterPlanoT8bOk(sessionId: string, specVersion: number): Promise<void> {
  await prisma.taskNode.updateMany({
    where: {
      sessionId,
      specVersion: { lt: specVersion },
      status: { in: ["pending", "standby"] },
    },
    data: { status: "superseded" },
  });
  await prisma.session.update({
    where: { id: sessionId },
    data: { specApproved: true, specVersion },
  });
}

export async function syncSpecApprovalAfterPhaseTransition(
  sessionId: string,
  from: Phase,
  to: Phase,
  event: PhaseEvent
): Promise<void> {
  const revogar =
    (event.type === "PLANO_REPROVADO" && to === "BLOQUEADA") ||
    (to === "SPEC_REVISAO" && from !== "SPEC_REVISAO");
  if (!revogar) return;
  await prisma.session.updateMany({
    where: { id: sessionId, specApproved: true },
    data: { specApproved: false },
  });
}

export async function healStuckSpecApprovalFlag(session: {
  id: string;
  phase: string | null;
  specApproved: boolean;
  specVersion?: number | null;
  activeTasksForCurrentVersion?: number;
  faseAntesDoBloqueio?: string | null;
}): Promise<boolean> {
  const opts: SpecApprovalHealOpts = {
    activeTasksForCurrentVersion: session.activeTasksForCurrentVersion,
    faseAntesDoBloqueio: session.faseAntesDoBloqueio,
  };
  if (specApprovalShouldRestore(session.phase, session.specApproved, opts)) {
    await prisma.session.update({
      where: { id: session.id },
      data: { specApproved: true },
    });
    return true;
  }
  if (!specApprovalFlagStuck(session.phase, session.specApproved, opts)) {
    return session.specApproved;
  }
  await prisma.session.update({
    where: { id: session.id },
    data: { specApproved: false },
  });
  return false;
}
