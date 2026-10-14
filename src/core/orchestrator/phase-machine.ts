/**
 * Máquina de Fases da Sessão do NextCode (Módulo Puro)
 *
 * @see docs/ARQUITETURA-ORQUESTRACAO.md §3 (Fases da sessão — revisado pós-auditoria)
 * @see docs/PLANO-ETAPA-0.md (Etapa 0 - Passo 1b)
 */

export type Phase =
  | 'ENTRADA'
  | 'CONVERSA'
  | 'INTERVENCAO'
  | 'ELICITACAO'
  | 'ELICITACAO_CORRECAO'
  | 'SPEC_REVISAO'
  | 'MACROBRIEF'
  | 'CONFERENCIA'
  | 'PLANEJAMENTO'
  | 'EXECUCAO'
  | 'PAUSADA'
  | 'BLOQUEADA'
  | 'VERIFICACAO'
  | 'ENTREGUE';

export type MessageIntention =
  | 'criar_novo'
  | 'corrigir_existente'
  | 'incerto'
  | 'duvida_avulsa'
  | 'mudanca_durante_execucao'
  | 'status';

export type InterventionChoice = 'criar' | 'corrigir' | 'conversar';

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
  | { type: 'SEM_PENDENCIAS' }
  | { type: 'SEM_LLM' }
  | { type: 'LLM_VOLTOU' }
  | { type: 'EXECUTOR_BLOQUEADO' }
  | { type: 'TETO_CUSTO' }
  | { type: 'DESBLOQUEIO_HUMANO' }
  | { type: 'VERIFICACAO_COM_LACUNAS' }
  | { type: 'VERIFICACAO_OK' }
  | { type: 'FALHA_REPETIDA' }
  | { type: 'NOVO_PEDIDO' };

export type PhaseEffect =
  | { type: 'RESPONDER_SEM_MUDAR_FASE' }
  | { type: 'MOSTRAR_STATUS' }
  | { type: 'OFERECER_TRES_CAMINHOS' }
  | { type: 'SUSPENDER_EXECUTORES_PENDENTES' }
  | { type: 'INICIAR_EXECUCAO' }
  | { type: 'AVISAR_HUMANO'; motivo: string }
  | { type: 'RETOMAR_EXECUCAO' }
  | { type: 'CONTINUAR_ELICITACAO' }
  | { type: 'RETOMAR_FASE'; fase: Phase }
  | { type: 'SEM_MODELO_DISPONIVEL' };

export interface PhaseContext {
  phase: Phase;
  rodadasSemClareza: number;      // regra da 3ª rodada (§3, regra 4)
  voltasConferencia: number;      // idas e voltas CONFERENCIA → MACROBRIEF/SPEC_REVISAO (§3, regra 6)
  faseAntesDaPausa?: Phase;       // para voltar de PAUSADA (§3, regra 9)
  faseAntesDoBloqueio?: Phase;    // para voltar de BLOQUEADA (§3, regras 7 e 8)
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
              { type: 'AVISAR_HUMANO', motivo: 'analista e elicitador sem acordo' },
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
    allowedEvents: ['PLANO_PRONTO', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
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
    allowedEvents: ['SEM_PENDENCIAS', 'SEM_LLM', 'EXECUTOR_BLOQUEADO', 'TETO_CUSTO', 'FALHA_REPETIDA', 'MENSAGEM_CLASSIFICADA'],
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
      if (event.type === 'EXECUTOR_BLOQUEADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'executor esgotou 3 tentativas' }],
        };
      }
      // Teto de custo: só sai com autorização humana (DESBLOQUEIO_HUMANO), nunca sozinho.
      if (event.type === 'TETO_CUSTO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'teto de custo do projeto atingido' }],
        };
      }
      if (event.type === 'FALHA_REPETIDA') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'erro interno repetido na execução' }],
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
    allowedEvents: ['LLM_VOLTOU', 'MENSAGEM_CLASSIFICADA'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      // §3, regra 9: LLM_VOLTOU volta para faseAntesDaPausa
      if (event.type === 'LLM_VOLTOU') {
        const destino = ctx.faseAntesDaPausa ?? 'EXECUCAO';
        const effects: PhaseEffect[] =
          destino === 'EXECUCAO'
            ? [{ type: 'RETOMAR_EXECUCAO' }]
            : [{ type: 'RETOMAR_FASE', fase: destino }];

        return {
          ok: true,
          ctx: { ...ctx, phase: destino, faseAntesDaPausa: undefined },
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
    allowedEvents: ['VERIFICACAO_COM_LACUNAS', 'VERIFICACAO_OK', 'FALHA_REPETIDA', 'MENSAGEM_CLASSIFICADA', 'SEM_LLM'],
    allowedIntents: ['duvida_avulsa', 'status'],
    handler: (ctx, event) => {
      if (event.type === 'SEM_LLM') {
        return handleSemLlm(ctx);
      }
      if (event.type === 'VERIFICACAO_COM_LACUNAS') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'entrega reprovada na verificação final' }],
        };
      }
      if (event.type === 'FALHA_REPETIDA') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'erro interno repetido na execução' }],
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
    allowedEvents: ['NOVO_PEDIDO', 'MENSAGEM_CLASSIFICADA'],
    allowedIntents: ['criar_novo', 'corrigir_existente', 'incerto', 'duvida_avulsa', 'status'],
    handler: (ctx, event) => {
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
