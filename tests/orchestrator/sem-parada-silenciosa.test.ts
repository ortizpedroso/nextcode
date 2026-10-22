import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import {
  transition,
  PHASES,
  MESSAGE_INTENTIONS,
  INTERVENTION_CHOICES,
  PHASE_EVENT_TYPES,
  type Phase,
  type PhaseContext,
  type PhaseEvent,
  type MessageIntention,
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
import {
  supervisePausedSessions,
  superviseSilentSessions,
} from "../../src/core/orchestrator/job-worker.js";

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

// J2.7: listas do próprio código (antes: listas à mão com intenções e escolhas que não existem).
const ALL_PHASES: Phase[] = [...PHASES];
const ALL_INTENTIONS: MessageIntention[] = [...MESSAGE_INTENTIONS];

export const STRUCTURAL_TEST_EVENTS: PhaseEvent[] = [
  ...ALL_INTENTIONS.map((intencao): PhaseEvent => ({ type: "MENSAGEM_CLASSIFICADA", intencao })),
  ...INTERVENTION_CHOICES.map((escolha): PhaseEvent => ({ type: "ESCOLHA_INTERVENCAO", escolha })),
  { type: "SPEC_PRONTA" },
  { type: "AJUSTE_SOLICITADO" },
  { type: "SPEC_APROVADA" },
  { type: "MACROBRIEF_PRONTO" },
  { type: "CONFERENCIA_OK" },
  { type: "CONFERENCIA_FALHOU", culpa: "macrobrief" },
  { type: "CONFERENCIA_FALHOU", culpa: "spec" },
  { type: "PLANO_PRONTO" },
  { type: "PLANO_REPROVADO" },
  { type: "AVALIADOR_FORA", ate: "2026-10-18T12:05:00.000Z", pausa: 1, motivo: "x", definitivo: false },
  { type: "AVALIADOR_FORA", ate: "2026-10-18T12:05:00.000Z", pausa: 7, motivo: "x", definitivo: false },
  { type: "AVALIADOR_FORA", ate: "2026-10-18T12:05:00.000Z", pausa: 1, motivo: "x", definitivo: true },
  { type: "SEM_PENDENCIAS" },
  { type: "SEM_LLM" },
  { type: "LLM_VOLTOU" },
  { type: "EXECUTOR_BLOQUEADO" },
  { type: "TETO_CUSTO" },
  { type: "DESBLOQUEIO_HUMANO" },
  { type: "VERIFICACAO_COM_LACUNAS" },
  { type: "VERIFICACAO_OK" },
  { type: "FALHA_AMBIENTE" },
  { type: "REPARO_NECESSARIO" },
  { type: "REABRIR_ENTREGA" },
  { type: "FALHA_REPETIDA" },
  { type: "SILENCIO_DETECTADO" },
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

  it("(estrutural, J2.7) os eventos do teste cobrem todos os tipos de evento do código", () => {
    expect(new Set(STRUCTURAL_TEST_EVENTS.map((e) => e.type))).toEqual(new Set(PHASE_EVENT_TYPES));
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
              // Mudança 36: todo aviso diz o que fazer (acao).
              const hasAvisarHumano = res.effects.some((e) => e.type === "AVISAR_HUMANO" && Boolean(e.acao));
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
    // Mudança 36: etapa com 3 tentativas → Re-tentar a etapa (ou ajustar a Spec).
    expect(messages[0].content).toContain("**Re-tentar**");
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

  it("J2.5: supervisePausedSessions posta aviso de pausa longa após 5 minutos, não duplica e não posta antes do prazo", async () => {
    const inicioPausa = new Date("2026-10-14T01:00:00.000Z");

    const session = await prisma.session.create({
      data: {
        title: "Sessão Pausada Longa",
        phase: "PAUSADA",
        phaseContext: JSON.stringify({ faseAntesDaPausa: "EXECUCAO" }),
      },
    });
    createdSessionIds.push(session.id);

    // Grava PHASE_TRANSITION com to: PAUSADA
    await prisma.telemetryLog.create({
      data: {
        sessionId: session.id,
        action: "PHASE_TRANSITION",
        details: JSON.stringify({ from: "EXECUCAO", to: "PAUSADA" }),
        createdAt: inicioPausa,
        durationMs: 0,
      },
    });

    // 1. Com início + 2 minutos -> 0 mensagens
    const doisMinutos = new Date(inicioPausa.getTime() + 2 * 60 * 1000);
    await supervisePausedSessions(async () => false, doisMinutos);
    let msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(msgs.length).toBe(0);

    // 2. Com início + 6 minutos -> 1 mensagem postada
    const seisMinutos = new Date(inicioPausa.getTime() + 6 * 60 * 1000);
    await supervisePausedSessions(async () => false, seisMinutos);
    msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toContain("Execução pausada há mais de 5 minutos");

    // 3. Chamar de novo (com início + 7 minutos) -> continua com 1 mensagem (não duplica)
    const seteMinutos = new Date(inicioPausa.getTime() + 7 * 60 * 1000);
    await supervisePausedSessions(async () => false, seteMinutos);
    msgs = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(msgs.length).toBe(1);
  });

  it("J2.6: superviseSilentSessions detecta parada sem atividade há mais de 5 minutos em fases ativas", async () => {
    const agora = new Date("2026-10-14T02:00:00.000Z");
    const seisMinutosDepois = new Date(agora.getTime() + 6 * 60 * 1000);

    // 1. Sessão VERIFICACAO sem job, parada há 6 minutos -> BLOQUEADA + 1 mensagem
    const sessVerifSilenciosa = await prisma.session.create({
      data: {
        title: "Sessão Verificacao Silenciosa",
        phase: "VERIFICACAO",
        updatedAt: agora,
      },
    });
    createdSessionIds.push(sessVerifSilenciosa.id);

    const bloqueadas1 = await superviseSilentSessions({
      force: true,
      onlySessionIds: [sessVerifSilenciosa.id],
      now: seisMinutosDepois,
    });
    expect(bloqueadas1).toBe(1);

    const updatedVerif = await prisma.session.findUnique({ where: { id: sessVerifSilenciosa.id } });
    expect(updatedVerif?.phase).toBe("BLOQUEADA");

    const msgsVerif = await prisma.message.findMany({ where: { sessionId: sessVerifSilenciosa.id } });
    expect(msgsVerif.length).toBe(1);
    expect(msgsVerif[0].content).toContain("parada sem atividade há mais de 5 minutos");
    expect(msgsVerif[0].content).toContain("Fase em que parou: VERIFICACAO");

    // 2. Sessão EXECUCAO com job queued -> não muda (tem job na fila)
    const sessExecComJob = await prisma.session.create({
      data: {
        title: "Sessão Execucao Com Job",
        phase: "EXECUCAO",
        updatedAt: agora,
      },
    });
    createdSessionIds.push(sessExecComJob.id);

    await prisma.job.create({
      data: {
        sessionId: sessExecComJob.id,
        kind: "session_queue",
        status: "queued",
      },
    });

    const bloqueadas2 = await superviseSilentSessions({
      force: true,
      onlySessionIds: [sessExecComJob.id],
      now: seisMinutosDepois,
    });
    expect(bloqueadas2).toBe(0);
    const updatedExec = await prisma.session.findUnique({ where: { id: sessExecComJob.id } });
    expect(updatedExec?.phase).toBe("EXECUCAO");

    // 3. Sessão ELICITACAO -> não muda (fase de interação do usuário)
    const sessElic = await prisma.session.create({
      data: {
        title: "Sessão Elicitacao",
        phase: "ELICITACAO",
        updatedAt: agora,
      },
    });
    createdSessionIds.push(sessElic.id);

    const bloqueadas3 = await superviseSilentSessions({
      force: true,
      onlySessionIds: [sessElic.id],
      now: seisMinutosDepois,
    });
    expect(bloqueadas3).toBe(0);
    const updatedElic = await prisma.session.findUnique({ where: { id: sessElic.id } });
    expect(updatedElic?.phase).toBe("ELICITACAO");

    // 4. Sessão VERIFICACAO com now = agora (atividade recente) -> não muda
    const sessVerifRecente = await prisma.session.create({
      data: {
        title: "Sessão Verificacao Recente",
        phase: "VERIFICACAO",
        updatedAt: agora,
      },
    });
    createdSessionIds.push(sessVerifRecente.id);

    const bloqueadas4 = await superviseSilentSessions({
      force: true,
      onlySessionIds: [sessVerifRecente.id],
      now: agora,
    });
    expect(bloqueadas4).toBe(0);
    const updatedRecente = await prisma.session.findUnique({ where: { id: sessVerifRecente.id } });
    expect(updatedRecente?.phase).toBe("VERIFICACAO");
  });
});
