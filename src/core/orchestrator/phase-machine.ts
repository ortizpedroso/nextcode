/**
 * Máquina de Fases da Sessão do NextCode (Módulo Puro)
 *
 * @see docs/ARQUITETURA-ORQUESTRACAO.md §3 (Fases da sessão — revisado pós-auditoria)
 * @see docs/PLANO-ETAPA-0.md (Etapa 0 - Passo 1b)
 */

/**
 * J2.7: as listas do código são a fonte — os tipos saem delas e o teste estrutural confere a tabela
 * contra elas (antes o teste usava listas escritas à mão, que podiam divergir do código).
 */
export const PHASES = [
  'ENTRADA',
  'CONVERSA',
  'INTERVENCAO',
  'ELICITACAO',
  'ELICITACAO_CORRECAO',
  'SPEC_REVISAO',
  'MACROBRIEF',
  'CONFERENCIA',
  'PLANEJAMENTO',
  'EXECUCAO',
  'PAUSADA',
  'BLOQUEADA',
  'VERIFICACAO',
  'ENTREGUE',
] as const;

export type Phase = (typeof PHASES)[number];

export const MESSAGE_INTENTIONS = [
  'criar_novo',
  'corrigir_existente',
  'incerto',
  'duvida_avulsa',
  'mudanca_durante_execucao',
  'status',
] as const;

export type MessageIntention = (typeof MESSAGE_INTENTIONS)[number];

export const INTERVENTION_CHOICES = ['criar', 'corrigir', 'conversar'] as const;

export type InterventionChoice = (typeof INTERVENTION_CHOICES)[number];

export type ConferenceCulprit = 'macrobrief' | 'spec';

export type PhaseEvent =
  | { type: 'MENSAGEM_CLASSIFICADA'; intencao: MessageIntention }
  | { type: 'ESCOLHA_INTERVENCAO'; escolha: InterventionChoice }
  | { type: 'SPEC_PRONTA' }
  | { type: 'AJUSTE_SOLICITADO' }
  | { type: 'SPEC_APROVADA' }
  | { type: 'MACROBRIEF_PRONTO' }
  | { type: 'CONFERENCIA_OK' }
  | { type: 'CONFERENCIA_FALHOU'; culpa: ConferenceCulprit }
  | { type: 'PLANO_PRONTO' }
  | { type: 'PLANO_REPROVADO' }
  | { type: 'AVALIADOR_FORA'; ate: string; pausa: number; motivo: string; definitivo: boolean }
  | { type: 'SEM_PENDENCIAS' }
  | { type: 'SEM_LLM' }
  | { type: 'LLM_VOLTOU' }
  | { type: 'EXECUTOR_BLOQUEADO' }
  | { type: 'TETO_CUSTO' }
  | { type: 'DESBLOQUEIO_HUMANO' }
  | { type: 'VERIFICACAO_COM_LACUNAS' }
  | { type: 'VERIFICACAO_OK' }
  | { type: 'FALHA_AMBIENTE' }
  | { type: 'REPARO_NECESSARIO' }
  | { type: 'REABRIR_ENTREGA' }
  | { type: 'SEM_LLM_PERSISTENTE' }
  | { type: 'FALHA_REPETIDA' }
  | { type: 'SILENCIO_DETECTADO' }
  | { type: 'NOVO_PEDIDO' };

/** J2.7: todos os tipos de evento; o tipo abaixo garante, na compilação, que a lista e a união são iguais. */
export const PHASE_EVENT_TYPES = [
  'MENSAGEM_CLASSIFICADA',
  'ESCOLHA_INTERVENCAO',
  'SPEC_PRONTA',
  'AJUSTE_SOLICITADO',
  'SPEC_APROVADA',
  'MACROBRIEF_PRONTO',
  'CONFERENCIA_OK',
  'CONFERENCIA_FALHOU',
  'PLANO_PRONTO',
  'PLANO_REPROVADO',
  'AVALIADOR_FORA',
  'SEM_PENDENCIAS',
  'SEM_LLM',
  'LLM_VOLTOU',
  'EXECUTOR_BLOQUEADO',
  'TETO_CUSTO',
  'DESBLOQUEIO_HUMANO',
  'VERIFICACAO_COM_LACUNAS',
  'VERIFICACAO_OK',
  'FALHA_AMBIENTE',
  'REPARO_NECESSARIO',
  'REABRIR_ENTREGA',
  'SEM_LLM_PERSISTENTE',
  'FALHA_REPETIDA',
  'SILENCIO_DETECTADO',
  'NOVO_PEDIDO',
] as const satisfies readonly PhaseEvent['type'][];

type MissingEventTypes = Exclude<PhaseEvent['type'], (typeof PHASE_EVENT_TYPES)[number]>;
// Se algum tipo de evento não estiver na lista, esta linha não compila.
export const PHASE_EVENT_TYPES_COMPLETE: [MissingEventTypes] extends [never] ? true : never = true;

export type PhaseEffect =
  | { type: 'RESPONDER_SEM_MUDAR_FASE' }
  | { type: 'MOSTRAR_STATUS' }
  | { type: 'OFERECER_TRES_CAMINHOS' }
  | { type: 'SUSPENDER_EXECUTORES_PENDENTES' }
  | { type: 'INICIAR_EXECUCAO' }
  | { type: 'AVISAR_HUMANO'; motivo: string; acao: HumanAction }
  | { type: 'RETOMAR_EXECUCAO' }
  | { type: 'CONTINUAR_ELICITACAO' }
  | { type: 'RETOMAR_FASE'; fase: Phase }
  | { type: 'SEM_MODELO_DISPONIVEL' };

/**
 * Mudança 36: o que o aviso de bloqueio manda o humano fazer, conforme a causa.
 * retomar = nada a mudar na Spec (ambiente, erro interno, silêncio, avaliador fora);
 * autorizar_verba = teto; retentar_etapa = etapa com 3 tentativas; ajustar_spec = o pedido precisa mudar.
 */
export type HumanAction = 'retomar' | 'autorizar_verba' | 'retentar_etapa' | 'ajustar_spec';

export interface PhaseContext {
  phase: Phase;
  rodadasSemClareza: number;      // regra da 3ª rodada (§3, regra 4)
  voltasConferencia: number;      // idas e voltas CONFERENCIA → MACROBRIEF/SPEC_REVISAO (§3, regra 6)
  faseAntesDaPausa?: Phase;       // para voltar de PAUSADA (§3, regra 9)
  faseAntesDoBloqueio?: Phase;    // para voltar de BLOQUEADA (§3, regras 7 e 8)
  /** Mudança 24: pausa por avaliador fora do ar — o supervisor só retoma depois de `ate` e com o Claude respondendo. */
  pausaAvaliador?: { ate: string; pausa: number; motivo: string };
}

/** Mudança 24: pausas seguidas de 5 min por avaliador fora do ar antes de bloquear. */
export const MAX_PAUSAS_AVALIADOR = 6;

function handleAvaliadorFora(
  ctx: PhaseContext,
  event: Extract<PhaseEvent, { type: 'AVALIADOR_FORA' }>
): TransitionResult {
  if (event.definitivo || event.pausa > MAX_PAUSAS_AVALIADOR) {
    return {
      ok: true,
      ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO', faseAntesDaPausa: undefined, pausaAvaliador: undefined },
      effects: [
        {
          type: 'AVISAR_HUMANO',
          motivo: event.definitivo
            ? `avaliador sem acesso (${event.motivo})`
            : `avaliador fora do ar há ${MAX_PAUSAS_AVALIADOR} pausas seguidas (${event.motivo})`,
          acao: 'retomar',
        },
      ],
    };
  }
  return {
    ok: true,
    ctx: {
      ...ctx,
      phase: 'PAUSADA',
      faseAntesDaPausa: 'EXECUCAO',
      pausaAvaliador: { ate: event.ate, pausa: event.pausa, motivo: event.motivo },
    },
    effects: [],
  };
}

export interface PhaseOptions {
  etapa1Ativa: boolean;           // false na etapa 0: pula MACROBRIEF e CONFERENCIA
}

export type TransitionResult =
  | { ok: true; ctx: PhaseContext; effects: PhaseEffect[] }
  | {
      ok: false;
      reason: string;
      allowedEvents: PhaseEvent['type'][];
      allowedIntents?: MessageIntention[];
    };

/**
 * Retorna o contexto inicial de uma sessão.
 * §3: Fase inicial é ENTRADA com contadores zerados.
 */
export function initialContext(): PhaseContext {
  return {
    phase: 'ENTRADA',
    rodadasSemClareza: 0,
    voltasConferencia: 0,
  };
}

/**
 * Definição da tabela declarativa de fases.
 */
interface PhaseConfig {
  allowedEvents: PhaseEvent['type'][];
  allowedIntents?: MessageIntention[];
  handler: (
    ctx: PhaseContext,
    event: PhaseEvent,
    opts: PhaseOptions
  ) => TransitionResult | null;
}

const PHASE_DECLARATIVE_TABLE: Record<Phase, PhaseConfig> = {
  ENTRADA: {
    allowedEvents: ['MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['criar_novo', 'corrigir_existente', 'incerto', 'duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      // §3, regra 9: ENTRADA sem LLM informa falta de modelo e não altera fase
      if (event.type === 'SEM_LLM') {
        return {
          ok: true,
          ctx: { ...ctx },
          effects: [{ type: 'SEM_MODELO_DISPONIVEL' }],
        };
      }

      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (event.intencao === 'criar_novo') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.intencao === 'corrigir_existente') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO_CORRECAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.intencao === 'incerto') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'CONVERSA', rodadasSemClareza: 1 },
            effects: [],
          };
        }
      }
      return null;
    },
  },

  CONVERSA: {
    allowedEvents: ['MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['criar_novo', 'corrigir_existente', 'incerto', 'duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }

      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (event.intencao === 'criar_novo') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.intencao === 'corrigir_existente') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO_CORRECAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.intencao === 'incerto') {
          const novasRodadas = ctx.rodadasSemClareza + 1;
          // §3, regra 4: 3ª rodada sem clareza leva a INTERVENCAO
          if (novasRodadas >= 3) {
            return {
              ok: true,
              ctx: { ...ctx, phase: 'INTERVENCAO', rodadasSemClareza: novasRodadas },
              effects: [{ type: 'OFERECER_TRES_CAMINHOS' }],
            };
          }
          return {
            ok: true,
            ctx: { ...ctx, phase: 'CONVERSA', rodadasSemClareza: novasRodadas },
            effects: [],
          };
        }
      }
      return null;
    },
  },

  INTERVENCAO: {
    allowedEvents: ['ESCOLHA_INTERVENCAO', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['criar_novo', 'corrigir_existente', 'incerto', 'duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }

      if (event.type === 'ESCOLHA_INTERVENCAO') {
        if (event.escolha === 'criar') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.escolha === 'corrigir') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO_CORRECAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.escolha === 'conversar') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'CONVERSA', rodadasSemClareza: 0 },
            effects: [],
          };
        }
      }

      // §3, regra 4: Intervenção por texto e resposta evasiva
      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (event.intencao === 'criar_novo') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.intencao === 'corrigir_existente') {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO_CORRECAO', rodadasSemClareza: 0 },
            effects: [],
          };
        }
        if (event.intencao === 'incerto') {
          // Resposta evasiva: volta para CONVERSA com contador zerado
          return {
            ok: true,
            ctx: { ...ctx, phase: 'CONVERSA', rodadasSemClareza: 0 },
            effects: [],
          };
        }
      }
      return null;
    },
  },

  ELICITACAO: {
    allowedEvents: ['SPEC_PRONTA', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: [
      'criar_novo',
      'corrigir_existente',
      'incerto',
      'mudanca_durante_execucao',
      'duvida_avulsa',
      'status',
    ],
    handler: (ctx, event) => handleElicitacao(ctx, event),
  },

  ELICITACAO_CORRECAO: {
    allowedEvents: ['SPEC_PRONTA', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: [
      'criar_novo',
      'corrigir_existente',
      'incerto',
      'mudanca_durante_execucao',
      'duvida_avulsa',
      'status',
    ],
    handler: (ctx, event) => handleElicitacao(ctx, event),
  },

  SPEC_REVISAO: {
    allowedEvents: ['AJUSTE_SOLICITADO', 'SPEC_APROVADA', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: [
      'criar_novo',
      'corrigir_existente',
      'incerto',
      'mudanca_durante_execucao',
      'duvida_avulsa',
      'status',
    ],
    handler: (ctx, event, opts) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      if (event.type === 'AJUSTE_SOLICITADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'ELICITACAO' },
          effects: [],
        };
      }
      if (event.type === 'SPEC_APROVADA') {
        const nextPhase: Phase = opts.etapa1Ativa ? 'MACROBRIEF' : 'PLANEJAMENTO';
        return {
          ok: true,
          ctx: { ...ctx, phase: nextPhase },
          effects: [],
        };
      }
      // §3, regra 3: Comentário do usuário em SPEC_REVISAO é pedido de ajuste -> ELICITACAO
      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (
          event.intencao === 'criar_novo' ||
          event.intencao === 'corrigir_existente' ||
          event.intencao === 'incerto' ||
          event.intencao === 'mudanca_durante_execucao'
        ) {
          return {
            ok: true,
            ctx: { ...ctx, phase: 'ELICITACAO' },
            effects: [],
          };
        }
      }
      return null;
    },
  },

  MACROBRIEF: {
    allowedEvents: ['MACROBRIEF_PRONTO', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      if (event.type === 'MACROBRIEF_PRONTO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'CONFERENCIA' },
          effects: [],
        };
      }
      return null;
    },
  },

  CONFERENCIA: {
    allowedEvents: ['CONFERENCIA_OK', 'CONFERENCIA_FALHOU', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      if (event.type === 'CONFERENCIA_OK') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'PLANEJAMENTO', voltasConferencia: 0 },
          effects: [],
        };
      }
      if (event.type === 'CONFERENCIA_FALHOU') {
        const novasVoltas = ctx.voltasConferencia + 1;
        // §3, regra 6: máximo 3 falhas. A 4ª falha bloqueia
        if (novasVoltas > 3) {
          return {
            ok: true,
            ctx: {
              ...ctx,
              phase: 'BLOQUEADA',
              voltasConferencia: novasVoltas,
              faseAntesDoBloqueio: 'CONFERENCIA',
            },
            effects: [
              { type: 'AVISAR_HUMANO', motivo: 'analista e elicitador sem acordo', acao: 'ajustar_spec' },
            ],
          };
        }
        const nextPhase: Phase = event.culpa === 'macrobrief' ? 'MACROBRIEF' : 'SPEC_REVISAO';
        return {
          ok: true,
          ctx: { ...ctx, phase: nextPhase, voltasConferencia: novasVoltas },
          effects: [],
        };
      }
      return null;
    },
  },

  PLANEJAMENTO: {
    allowedEvents: ['PLANO_PRONTO', 'PLANO_REPROVADO', 'SILENCIO_DETECTADO', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      if (event.type === 'SILENCIO_DETECTADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'parada sem atividade há mais de 5 minutos', acao: 'retomar' }],
        };
      }
      // A2.1: plano reprovado na T8b não executa; desbloquear volta à revisão da Spec (replanejar).
      if (event.type === 'PLANO_REPROVADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'SPEC_REVISAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'plano de execução reprovado na conferência (T8b)', acao: 'ajustar_spec' }],
        };
      }
      if (event.type === 'PLANO_PRONTO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'EXECUCAO' },
          effects: [{ type: 'INICIAR_EXECUCAO' }],
        };
      }
      return null;
    },
  },

  EXECUCAO: {
    allowedEvents: ['SEM_PENDENCIAS', 'SEM_LLM', 'AVALIADOR_FORA', 'EXECUTOR_BLOQUEADO', 'TETO_CUSTO', 'FALHA_REPETIDA', 'SILENCIO_DETECTADO', 'MENSAGEM_CLASSIFICADA'],
    allowedIntents: ['mudanca_durante_execucao', 'duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_PENDENCIAS') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'VERIFICACAO' },
          effects: [],
        };
      }
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      if (event.type === 'AVALIADOR_FORA') {
        return handleAvaliadorFora(ctx, event);
      }
      if (event.type === 'EXECUTOR_BLOQUEADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'executor esgotou 3 tentativas', acao: 'retentar_etapa' }],
        };
      }
      // Teto de custo: só sai com autorização humana (DESBLOQUEIO_HUMANO), nunca sozinho.
      if (event.type === 'TETO_CUSTO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'teto de custo do projeto atingido', acao: 'autorizar_verba' }],
        };
      }
      if (event.type === 'FALHA_REPETIDA') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'erro interno repetido na execução', acao: 'retomar' }],
        };
      }
      if (event.type === 'SILENCIO_DETECTADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'parada sem atividade há mais de 5 minutos', acao: 'retomar' }],
        };
      }
      if (
        event.type === 'MENSAGEM_CLASSIFICADA' &&
        event.intencao === 'mudanca_durante_execucao'
      ) {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'SPEC_REVISAO' },
          effects: [{ type: 'SUSPENDER_EXECUTORES_PENDENTES' }],
        };
      }
      return null;
    },
  },

  PAUSADA: {
    allowedEvents: ['LLM_VOLTOU', 'AVALIADOR_FORA', 'SEM_LLM_PERSISTENTE', 'MENSAGEM_CLASSIFICADA'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      // Mudança 42: o gateway responde à sonda mas não atende o executor (crédito, cota, chave) —
      // retomar faria a sessão piscar PAUSADA ↔ EXECUCAO sem fim; para e avisa.
      if (event.type === 'SEM_LLM_PERSISTENTE') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: ctx.faseAntesDaPausa ?? 'EXECUCAO', faseAntesDaPausa: undefined },
          effects: [
            { type: 'AVISAR_HUMANO', motivo: 'o provedor do executor responde mas não atende (crédito, cota ou chave)', acao: 'retomar' },
          ],
        };
      }
      // Mudança 24: o supervisor sondou o Claude e ele continua fora → estende a pausa (ou bloqueia no limite)
      if (event.type === 'AVALIADOR_FORA') {
        return handleAvaliadorFora(ctx, event);
      }
      // §3, regra 9: LLM_VOLTOU volta para faseAntesDaPausa
      if (event.type === 'LLM_VOLTOU') {
        const destino = ctx.faseAntesDaPausa ?? 'EXECUCAO';
        const effects: PhaseEffect[] =
          destino === 'EXECUCAO'
            ? [{ type: 'RETOMAR_EXECUCAO' }]
            : [{ type: 'RETOMAR_FASE', fase: destino }];

        return {
          ok: true,
          ctx: { ...ctx, phase: destino, faseAntesDaPausa: undefined, pausaAvaliador: undefined },
          effects,
        };
      }
      return null;
    },
  },

  BLOQUEADA: {
    allowedEvents: ['DESBLOQUEIO_HUMANO', 'MENSAGEM_CLASSIFICADA'],
    allowedIntents: [
      'mudanca_durante_execucao',
      'criar_novo',
      'corrigir_existente',
      'duvida_avulsa',
      'status',
    ],
    handler: (ctx, event) => {
      // §3, regra 7: DESBLOQUEIO_HUMANO volta para faseAntesDoBloqueio
      if (event.type === 'DESBLOQUEIO_HUMANO') {
        const destino = ctx.faseAntesDoBloqueio ?? 'EXECUCAO';
        // Se a fase de origem do bloqueio for CONFERENCIA, zera o contador de voltasConferencia
        const voltasConferencia = destino === 'CONFERENCIA' ? 0 : ctx.voltasConferencia;
        const effects: PhaseEffect[] =
          destino === 'EXECUCAO'
            ? [{ type: 'RETOMAR_EXECUCAO' }]
            : [{ type: 'RETOMAR_FASE', fase: destino }];

        return {
          ok: true,
          ctx: {
            ...ctx,
            phase: destino,
            voltasConferencia,
            faseAntesDoBloqueio: undefined,
          },
          effects,
        };
      }

      // §3, regra 8: Bloqueio + pedido de ajuste da Spec pelo usuário
      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (
          event.intencao === 'mudanca_durante_execucao' ||
          event.intencao === 'criar_novo' ||
          event.intencao === 'corrigir_existente'
        ) {
          return {
            ok: true,
            ctx: {
              ...ctx,
              phase: 'SPEC_REVISAO',
              voltasConferencia: 0,
              faseAntesDoBloqueio: undefined,
            },
            effects: [{ type: 'SUSPENDER_EXECUTORES_PENDENTES' }],
          };
        }
      }
      return null;
    },
  },

  VERIFICACAO: {
    allowedEvents: ['VERIFICACAO_COM_LACUNAS', 'VERIFICACAO_OK', 'FALHA_AMBIENTE', 'REPARO_NECESSARIO', 'FALHA_REPETIDA', 'SILENCIO_DETECTADO', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      // J2b: entrega reprovada com dono para cada lacuna → volta ao planejamento com etapas de reparo.
      if (event.type === 'REPARO_NECESSARIO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'PLANEJAMENTO' },
          effects: [],
        };
      }
      // J2b: lacuna sem dono ou 3 rodadas de reparo gastas → o pedido precisa mudar.
      if (event.type === 'VERIFICACAO_COM_LACUNAS') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'entrega reprovada na verificação final', acao: 'ajustar_spec' }],
        };
      }
      // Mudança 35: a verificação não julgou o código (processo não abriu) → Retomar, sem mexer na Spec.
      if (event.type === 'FALHA_AMBIENTE') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'falha de ambiente na verificação final', acao: 'retomar' }],
        };
      }
      if (event.type === 'FALHA_REPETIDA') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'erro interno repetido na execução', acao: 'retomar' }],
        };
      }
      if (event.type === 'SILENCIO_DETECTADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'parada sem atividade há mais de 5 minutos', acao: 'retomar' }],
        };
      }
      if (event.type === 'VERIFICACAO_OK') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'ENTREGUE' },
          effects: [],
        };
      }
      return null;
    },
  },

  ENTREGUE: {
    allowedEvents: ['NOVO_PEDIDO', 'REABRIR_ENTREGA', 'MENSAGEM_CLASSIFICADA'],
    allowedIntents: ['criar_novo', 'corrigir_existente', 'incerto', 'duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      // Mudança 40: o humano reabre a entrega sem mudar a Spec; a fila vazia leva direto à verificação
      // final (T10 + revisão final), e o que ela reprovar vira reparo J2b.
      if (event.type === 'REABRIR_ENTREGA') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'EXECUCAO', faseAntesDoBloqueio: undefined },
          effects: [{ type: 'RETOMAR_EXECUCAO' }],
        };
      }
      if (event.type === 'NOVO_PEDIDO') {
        return {
          ok: true,
          ctx: {
            phase: 'ENTRADA',
            rodadasSemClareza: 0,
            voltasConferencia: 0,
            faseAntesDaPausa: undefined,
            faseAntesDoBloqueio: undefined,
          },
          effects: [],
        };
      }

      // §3, regra 10: Novo pedido via mensagem após ENTREGUE
      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (event.intencao === 'criar_novo') {
          return {
            ok: true,
            ctx: {
              phase: 'ELICITACAO',
              rodadasSemClareza: 0,
              voltasConferencia: 0,
              faseAntesDaPausa: undefined,
              faseAntesDoBloqueio: undefined,
            },
            effects: [],
          };
        }
        if (event.intencao === 'corrigir_existente') {
          return {
            ok: true,
            ctx: {
              phase: 'ELICITACAO_CORRECAO',
              rodadasSemClareza: 0,
              voltasConferencia: 0,
              faseAntesDaPausa: undefined,
              faseAntesDoBloqueio: undefined,
            },
            effects: [],
          };
        }
        if (event.intencao === 'incerto') {
          return {
            ok: true,
            ctx: {
              phase: 'CONVERSA',
              rodadasSemClareza: 1,
              voltasConferencia: 0,
              faseAntesDaPausa: undefined,
              faseAntesDoBloqueio: undefined,
            },
            effects: [],
          };
        }
      }
      return null;
    },
  },
};

/** J2.7: o que a tabela declara aceitar em cada fase (para o teste estrutural). */
export function declaredPhaseTable(): Record<Phase, { allowedEvents: PhaseEvent['type'][]; allowedIntents?: MessageIntention[] }> {
  const out = {} as Record<Phase, { allowedEvents: PhaseEvent['type'][]; allowedIntents?: MessageIntention[] }>;
  for (const phase of Object.keys(PHASE_DECLARATIVE_TABLE) as Phase[]) {
    const { allowedEvents, allowedIntents } = PHASE_DECLARATIVE_TABLE[phase];
    out[phase] = { allowedEvents: [...allowedEvents], ...(allowedIntents ? { allowedIntents: [...allowedIntents] } : {}) };
  }
  return out;
}

/**
 * Auxiliar para transitar qualquer fase dependente de LLM para PAUSADA.
 * §3, regra 9.
 */
function handleSemLlm(ctx: PhaseContext): TransitionResult {
  return {
    ok: true,
    ctx: { ...ctx, phase: 'PAUSADA', faseAntesDaPausa: ctx.phase },
    effects: [],
  };
}

/**
 * Auxiliar para a fase ELICITACAO e ELICITACAO_CORRECAO.
 * §3, regra 3: toda mensagem regular do usuário continua a elicitação.
 */
function handleElicitacao(ctx: PhaseContext, event: PhaseEvent): TransitionResult | null {
  if (event.type === 'SEM_LLM') {
    return handleSemLlm(ctx);
  }
  if (event.type === 'SPEC_PRONTA') {
    return {
      ok: true,
      ctx: { ...ctx, phase: 'SPEC_REVISAO' },
      effects: [],
    };
  }
  if (event.type === 'MENSAGEM_CLASSIFICADA') {
    if (
      event.intencao === 'criar_novo' ||
      event.intencao === 'corrigir_existente' ||
      event.intencao === 'incerto' ||
      event.intencao === 'mudanca_durante_execucao'
    ) {
      return {
        ok: true,
        ctx: { ...ctx },
        effects: [{ type: 'CONTINUAR_ELICITACAO' }],
      };
    }
  }
  return null;
}

/**
 * Função pura de transição de fase com tabela declarativa.
 */
export function transition(
  ctx: PhaseContext,
  event: PhaseEvent,
  opts: PhaseOptions
): TransitionResult {
  const config = PHASE_DECLARATIVE_TABLE[ctx.phase];
  const allowedEvents = config?.allowedEvents || [];
  const allowedIntents = config?.allowedIntents;

  // §3, regra 1: Dúvida avulsa em qualquer fase
  if (event.type === 'MENSAGEM_CLASSIFICADA' && event.intencao === 'duvida_avulsa') {
    return {
      ok: true,
      ctx: { ...ctx },
      effects: [{ type: 'RESPONDER_SEM_MUDAR_FASE' }],
    };
  }

  // §3, regra 2: Pedido de status em qualquer fase
  if (event.type === 'MENSAGEM_CLASSIFICADA' && event.intencao === 'status') {
    return {
      ok: true,
      ctx: { ...ctx },
      effects: [{ type: 'MOSTRAR_STATUS' }],
    };
  }

  // Executa o handler declarativo da fase
  if (config) {
    const result = config.handler(ctx, event, opts);
    if (result) {
      return result;
    }
  }

  // §3, regra 14: Transição recusada
  const reason =
    event.type === 'MENSAGEM_CLASSIFICADA'
      ? `Intenção "${event.intencao}" não permitida na fase ${ctx.phase}`
      : `Evento "${event.type}" não permitido na fase ${ctx.phase}`;

  return {
    ok: false,
    reason,
    allowedEvents,
    ...(event.type === 'MENSAGEM_CLASSIFICADA' && allowedIntents ? { allowedIntents } : {}),
  };
}
