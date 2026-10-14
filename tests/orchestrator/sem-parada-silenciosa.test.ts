import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import {
  transition,
  type Phase,
  type PhaseContext,
  type PhaseEvent,
  type MessageIntention,
  type IntervencaoEscolha,
} from "../../src/core/orchestrator/phase-machine.js";
import { applyPhaseEvent } from "../../src/core/orchestrator/session-phase.js";
import {
  enqueueSessionQueueJob,
  claimJob,
  executeClaimedJob,
  handleJobFailureForSession,
} from "../../src/core/orchestrator/job-queue.js";
import { renderCanonicalSpecDocument } from "../../src/core/intake/spec-format.js";
import * as sessionQueueModule from "../../src/core/orchestrator/session-queue.js";
import * as nodeExecutorModule from "../../src/core/orchestrator/node-executor.js";

const createdSessionIds: string[] = [];

async function cleanupTestRecords(): Promise<void> {
  if (createdSessionIds.length > 0) {
    await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    createdSessionIds.length = 0;
  }
}

const ALL_PHASES: Phase[] = [
  "ENTRADA",
  "CONVERSA",
  "INTERVENCAO",
  "ELICITACAO",
  "ELICITACAO_CORRECAO",
  "SPEC_REVISAO",
  "MACROBRIEF",
  "CONFERENCIA",
  "PLANEJAMENTO",
  "EXECUCAO",
  "PAUSADA",
  "BLOQUEADA",
  "VERIFICACAO",
  "ENTREGUE",
];

const ALL_INTENTIONS: MessageIntention[] = [
  "criar_novo",
  "alterar_existente",
  "continuar",
  "duvida_tecnica",
  "duvida_especifica",
  "duvida_negocio",
  "especificacao_direta",
  "pedido_confuso",
  "apenas_conversa",
  "saudacao",
  "ajuste_escopo",
  "incerto",
  "duvida_avulsa",
  "mudanca_durante_execucao",
  "status",
];

const ALL_INTERVENCAO_ESCOLHAS: IntervencaoEscolha[] = [
  "criar",
  "alterar",
  "revisar_especificacao",
  "ajustar_escopo",
  "pausar",
  "cancelar",
];

export const STRUCTURAL_TEST_EVENTS: PhaseEvent[] = [
  ...ALL_INTENTIONS.map((intencao): PhaseEvent => ({ type: "MENSAGEM_CLASSIFICADA", intencao })),
  ...ALL_INTERVENCAO_ESCOLHAS.map((escolha): PhaseEvent => ({ type: "ESCOLHA_INTERVENCAO", escolha })),
  { type: "SPEC_PRONTA" },
  { type: "AJUSTE_SOLICITADO" },
  { type: "SPEC_APROVADA" },
  { type: "MACROBRIEF_PRONTO" },
  { type: "CONFERENCIA_OK" },
  { type: "CONFERENCIA_FALHOU", culpa: "macrobrief" },
  { type: "CONFERENCIA_FALHOU", culpa: "spec" },
  { type: "PLANO_PRONTO" },
  { type: "SEM_PENDENCIAS" },
  { type: "SEM_LLM" },
  { type: "LLM_VOLTOU" },
  { type: "EXECUTOR_BLOQUEADO" },
  { type: "TETO_CUSTO" },
  { type: "DESBLOQUEIO_HUMANO" },
  { type: "VERIFICACAO_COM_LACUNAS" },
  { type: "VERIFICACAO_OK" },
  { type: "FALHA_REPETIDA" },
  { type: "NOVO_PEDIDO" },
];

describe("Sem Parada Silenciosa — Garantia de Comunicação ao Humano (J2)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestRecords();
  });

  afterAll(async () => {
    await cleanupTestRecords();
  });

  it("(estrutural) toda transição que leva a BLOQUEADA a partir de uma fase não-BLOQUEADA deve conter o efeito AVISAR_HUMANO", () => {
    for (const phase of ALL_PHASES) {
      if (phase === "BLOQUEADA") continue;

      const contextsToTest: PhaseContext[] = [
        {
          phase,
          rodadasSemClareza: 0,
          voltasConferencia: 0,
          faseAntesDaPausa: "EXECUCAO",
          faseAntesDoBloqueio: "EXECUCAO",
        },
        {
          phase,
          rodadasSemClareza: 3,
          voltasConferencia: 3, // caso de conferência que estoura limite na 4ª volta
          faseAntesDaPausa: "EXECUCAO",
          faseAntesDoBloqueio: "EXECUCAO",
        },
      ];

      for (const ctx of contextsToTest) {
        for (const etapa1Ativa of [true, false]) {
          for (const event of STRUCTURAL_TEST_EVENTS) {
            const res = transition(ctx, event, { etapa1Ativa });
            if (res.ok && res.ctx.phase === "BLOQUEADA") {
              const hasAvisarHumano = res.effects.some((e) => e.type === "AVISAR_HUMANO");
              expect(
                hasAvisarHumano,
                `Transição da fase ${phase} com evento ${event.type} resultou em BLOQUEADA sem efeito AVISAR_HUMANO`
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it("applyPhaseEvent de EXECUCAO com EXECUTOR_BLOQUEADO sem avisoJaPostado gera exatamente 1 mensagem de aviso ao humano", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Teste Aviso Bloqueado",
        phase: "EXECUCAO",
      },
    });
    createdSessionIds.push(session.id);

    const result = await applyPhaseEvent(session.id, { type: "EXECUTOR_BLOQUEADO" });
    expect(result.ok).toBe(true);

    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toContain("🛑 **Sessão bloqueada — executor esgotou 3 tentativas.**");
    expect(messages[0].content).toContain("Para continuar, responda aqui no chat");
  });

  it("applyPhaseEvent de EXECUCAO com EXECUTOR_BLOQUEADO com avisoJaPostado: true não gera mensagem duplicada", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Teste Aviso Já Postado",
        phase: "EXECUCAO",
      },
    });
    createdSessionIds.push(session.id);

    const result = await applyPhaseEvent(
      session.id,
      { type: "EXECUTOR_BLOQUEADO" },
      { avisoJaPostado: true }
    );
    expect(result.ok).toBe(true);

    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(messages.length).toBe(0);
  });

  it("J2.3: entrega reprovada na verificação final (T10 com gaps) leva a BLOQUEADA e gera aviso com lacunas; desbloqueio volta a EXECUCAO", async () => {
    const spec = renderCanonicalSpecDocument({
      titulo: "App Teste Lacunas",
      status: "aprovada",
      data: "2026-10-13",
      stack: ["TypeScript"],
      modulos: [],
      entidades: [],
      arquivosAfetados: ["src/x.ts"],
      objetivo: "Testar lacuna na entrega.",
      requisitosIds: ["REQ-001"],
      requisitos: [{ id: "REQ-001", titulo: "Req 1", criterio: "Crit 1" }],
    });

    const session = await prisma.session.create({
      data: {
        title: "Sessão Entrega Reprovada T10",
        phase: "EXECUCAO",
        specApproved: true,
        canonicalSpec: spec,
      },
    });
    createdSessionIds.push(session.id);

    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({
      tasks: [],
      allCompleted: true,
      pendingCount: 0,
      runningCount: 0,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      specCompleteness: { complete: false, declaredFiles: ["src/x.ts"], missingFiles: ["src/x.ts"] },
    });

    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: false,
      specFilesComplete: false,
      allReqsApproved: true,
      buildVerified: true,
      missingFiles: ["src/x.ts"],
      unapprovedReqs: [],
      gaps: ["Arquivo faltando: src/x.ts"],
    });

    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "worker-test");
    await executeClaimedJob(jobId, "worker-test");

    const updatedSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(updatedSession?.phase).toBe("BLOQUEADA");

    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toContain("entrega reprovada na verificação final");
    expect(messages[0].content).toContain("Arquivo faltando: src/x.ts");

    // Desbloqueio humano leva de volta a EXECUCAO
    const unblockResult = await applyPhaseEvent(session.id, { type: "DESBLOQUEIO_HUMANO" });
    expect(unblockResult.ok).toBe(true);
    const unblockedSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(unblockedSession?.phase).toBe("EXECUCAO");
  });

  it("J2.4: 3 jobs seguidos com falha em EXECUCAO levam a sessão para BLOQUEADA e avisam no chat", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Sessão Falhas Repetidas",
        phase: "EXECUCAO",
      },
    });
    createdSessionIds.push(session.id);

    vi.spyOn(sessionQueueModule, "processSessionQueue").mockRejectedValue(
      new Error("falha simulada no processSessionQueue")
    );

    // Job 1
    const j1 = await enqueueSessionQueueJob(session.id);
    await claimJob(j1, "w1");
    await executeClaimedJob(j1, "w1");
    let sess = await prisma.session.findUnique({ where: { id: session.id } });
    expect(sess?.phase).toBe("EXECUCAO");

    // Job 2
    const j2 = await enqueueSessionQueueJob(session.id);
    await claimJob(j2, "w1");
    await executeClaimedJob(j2, "w1");
    sess = await prisma.session.findUnique({ where: { id: session.id } });
    expect(sess?.phase).toBe("EXECUCAO");

    // Job 3
    const j3 = await enqueueSessionQueueJob(session.id);
    await claimJob(j3, "w1");
    await executeClaimedJob(j3, "w1");
    sess = await prisma.session.findUnique({ where: { id: session.id } });
    expect(sess?.phase).toBe("BLOQUEADA");

    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toContain("erro interno repetido na execução");
    expect(messages[0].content).toContain("falha simulada no processSessionQueue");
  });

  it("J2.4: handleJobFailureForSession bloqueia imediatamente na 1ª chamada em VERIFICACAO, mas não altera ELICITACAO", async () => {
    // 1. Em VERIFICACAO -> bloqueia na 1ª chamada
    const sessVerif = await prisma.session.create({
      data: {
        title: "Sessão Verificacao Falhou",
        phase: "VERIFICACAO",
      },
    });
    createdSessionIds.push(sessVerif.id);

    await handleJobFailureForSession(sessVerif.id, "erro fatal em verificacao");
    const updatedVerif = await prisma.session.findUnique({ where: { id: sessVerif.id } });
    expect(updatedVerif?.phase).toBe("BLOQUEADA");

    const msgsVerif = await prisma.message.findMany({ where: { sessionId: sessVerif.id } });
    expect(msgsVerif.length).toBe(1);
    expect(msgsVerif[0].content).toContain("erro interno repetido na execução");
    expect(msgsVerif[0].content).toContain("erro fatal em verificacao");

    // 2. Em ELICITACAO -> nada muda
    const sessElic = await prisma.session.create({
      data: {
        title: "Sessão Elicitacao",
        phase: "ELICITACAO",
      },
    });
    createdSessionIds.push(sessElic.id);

    await handleJobFailureForSession(sessElic.id, "erro em elicitacao");
    const updatedElic = await prisma.session.findUnique({ where: { id: sessElic.id } });
    expect(updatedElic?.phase).toBe("ELICITACAO");

    const msgsElic = await prisma.message.findMany({ where: { sessionId: sessElic.id } });
    expect(msgsElic.length).toBe(0);
  });
});
