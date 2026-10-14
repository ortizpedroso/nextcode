import { describe, it, expect, beforeEach, afterAll } from "vitest";
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
  { type: "NOVO_PEDIDO" },
];

describe("Sem Parada Silenciosa — Garantia de Comunicação ao Humano (J2)", () => {
  beforeEach(async () => {
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
});
