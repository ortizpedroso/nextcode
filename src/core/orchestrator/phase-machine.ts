/**
 * Máquina de Fases da Sessão do NextCode (Módulo Puro)
 *
 * @see docs/ARQUITETURA-ORQUESTRACAO.md §3 (Fases da sessão)
 * @see docs/PLANO-ETAPA-0.md (Etapa 0 - Passo 1)
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
  | { type: 'DESBLOQUEIO_HUMANO' }
  | { type: 'VERIFICACAO_COM_LACUNAS' }
  | { type: 'VERIFICACAO_OK' }
  | { type: 'NOVO_PEDIDO' };

export type PhaseEffect =
  | { type: 'RESPONDER_SEM_MUDAR_FASE' }
  | { type: 'MOSTRAR_STATUS' }
  | { type: 'OFERECER_TRES_CAMINHOS' }
  | { type: 'SUSPENDER_EXECUTORES_PENDENTES' }
  | { type: 'INICIAR_EXECUCAO' }
  | { type: 'AVISAR_HUMANO'; motivo: string }
  | { type: 'RETOMAR_EXECUCAO' };

export interface PhaseContext {
  phase: Phase;
  rodadasSemClareza: number;      // regra da 3ª rodada (§3, 4.2)
  voltasConferencia: number;      // idas e voltas CONFERENCIA → MACROBRIEF/SPEC_REVISAO (§3, regra 3)
  faseAntesDaPausa?: Phase;       // para voltar de PAUSADA (§3, P6, D4)
  faseAntesDoBloqueio?: Phase;    // para voltar de BLOQUEADA (§3, P6)
}

export interface PhaseOptions {
  etapa1Ativa: boolean;           // false na etapa 0: pula MACROBRIEF e CONFERENCIA
}

export type TransitionResult =
  | { ok: true; ctx: PhaseContext; effects: PhaseEffect[] }
  | { ok: false; reason: string; allowedEvents: PhaseEvent['type'][] };

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
 * Tabela declarativa que mapeia cada Fase aos tipos de eventos permitidos.
 */
const ALLOWED_EVENTS_PER_PHASE: Record<Phase, PhaseEvent['type'][]> = {
  ENTRADA: ['MENSAGEM_CLASSIFICADA'],
  CONVERSA: ['MENSAGEM_CLASSIFICADA'],
  INTERVENCAO: ['ESCOLHA_INTERVENCAO', 'MENSAGEM_CLASSIFICADA'],
  ELICITACAO: ['SPEC_PRONTA', 'MENSAGEM_CLASSIFICADA'],
  ELICITACAO_CORRECAO: ['SPEC_PRONTA', 'MENSAGEM_CLASSIFICADA'],
  SPEC_REVISAO: ['AJUSTE_SOLICITADO', 'SPEC_APROVADA', 'MENSAGEM_CLASSIFICADA'],
  MACROBRIEF: ['MACROBRIEF_PRONTO', 'MENSAGEM_CLASSIFICADA'],
  CONFERENCIA: ['CONFERENCIA_OK', 'CONFERENCIA_FALHOU', 'MENSAGEM_CLASSIFICADA'],
  PLANEJAMENTO: ['PLANO_PRONTO', 'MENSAGEM_CLASSIFICADA'],
  EXECUCAO: ['SEM_PENDENCIAS', 'SEM_LLM', 'EXECUTOR_BLOQUEADO', 'MENSAGEM_CLASSIFICADA'],
  PAUSADA: ['LLM_VOLTOU', 'MENSAGEM_CLASSIFICADA'],
  BLOQUEADA: ['DESBLOQUEIO_HUMANO', 'MENSAGEM_CLASSIFICADA'],
  VERIFICACAO: ['VERIFICACAO_COM_LACUNAS', 'VERIFICACAO_OK', 'MENSAGEM_CLASSIFICADA'],
  ENTREGUE: ['NOVO_PEDIDO', 'MENSAGEM_CLASSIFICADA'],
};

/**
 * Função pura de transição de fase.
 *
 * Regras (§3):
 * 1. ENTRADA: criar_novo -> ELICITACAO, corrigir_existente -> ELICITACAO_CORRECAO, incerto -> CONVERSA (rodadasSemClareza = 1).
 * 2. CONVERSA: incerto incrementa rodadasSemClareza (3ª rodada -> INTERVENCAO + OFERECER_TRES_CAMINHOS).
 * 3. INTERVENCAO: escolhas criar, corrigir ou conversar (reseta contador).
 * 4. Dúvida avulsa em QUALQUER fase: fase não muda + RESPONDER_SEM_MUDAR_FASE (§3, regra 1).
 * 5. status em QUALQUER fase: fase não muda + MOSTRAR_STATUS.
 * 6. ELICITACAO / ELICITACAO_CORRECAO + SPEC_PRONTA -> SPEC_REVISAO; SPEC_REVISAO + AJUSTE_SOLICITADO -> ELICITACAO.
 * 7. SPEC_REVISAO + SPEC_APROVADA: etapa1Ativa ? MACROBRIEF : PLANEJAMENTO.
 * 8. MACROBRIEF + MACROBRIEF_PRONTO -> CONFERENCIA; CONFERENCIA_OK -> PLANEJAMENTO (zera voltasConferencia);
 *    CONFERENCIA_FALHOU -> incrementa voltasConferencia (se > 3 -> BLOQUEADA + AVISAR_HUMANO).
 * 9. PLANEJAMENTO + PLANO_PRONTO -> EXECUCAO + INICIAR_EXECUCAO.
 * 10. EXECUCAO: SEM_PENDENCIAS -> VERIFICACAO; SEM_LLM -> PAUSADA; EXECUTOR_BLOQUEADO -> BLOQUEADA; mudanca_durante_execucao -> SPEC_REVISAO + SUSPENDER_EXECUTORES_PENDENTES.
 * 11. PAUSADA + LLM_VOLTOU -> volta para faseAntesDaPausa + RETOMAR_EXECUCAO (não consome tentativa; P6, D4).
 * 12. BLOQUEADA + DESBLOQUEIO_HUMANO -> volta para faseAntesDoBloqueio + RETOMAR_EXECUCAO (§10.2).
 * 13. VERIFICACAO: VERIFICACAO_COM_LACUNAS -> PLANEJAMENTO (volta ao Analista; §3, regra 6); VERIFICACAO_OK -> ENTREGUE.
 * 14. ENTREGUE + NOVO_PEDIDO -> ENTRADA com contadores zerados.
 * 15. Combinações inválidas -> ok: false + allowedEvents.
 */
export function transition(
  ctx: PhaseContext,
  event: PhaseEvent,
  opts: PhaseOptions
): TransitionResult {
  const allowedEvents = ALLOWED_EVENTS_PER_PHASE[ctx.phase] || [];

  // §3, regra 1: Dúvida avulsa em qualquer fase não muda a fase e responde sem alterar contexto
  if (event.type === 'MENSAGEM_CLASSIFICADA' && event.intencao === 'duvida_avulsa') {
    return {
      ok: true,
      ctx: { ...ctx },
      effects: [{ type: 'RESPONDER_SEM_MUDAR_FASE' }],
    };
  }

  // §3, 4.2: status em qualquer fase exibe o status sem alterar a fase
  if (event.type === 'MENSAGEM_CLASSIFICADA' && event.intencao === 'status') {
    return {
      ok: true,
      ctx: { ...ctx },
      effects: [{ type: 'MOSTRAR_STATUS' }],
    };
  }

  // Resolução baseada na fase atual
  switch (ctx.phase) {
    case 'ENTRADA': {
      // §3: ENTRADA transita por MENSAGEM_CLASSIFICADA
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
      break;
    }

    case 'CONVERSA': {
      // §3: CONVERSA transita por MENSAGEM_CLASSIFICADA
      if (event.type === 'MENSAGEM_CLASSIFICADA') {
        if (event.intencao === 'incerto') {
          const novasRodadas = ctx.rodadasSemClareza + 1;
          // §3, 4.2: 3ª rodada sem clareza dispara INTERVENCAO
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
      }
      break;
    }

    case 'INTERVENCAO': {
      // §3, 4.2: INTERVENCAO é resolvida pela escolha explícita do usuário
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
      break;
    }

    case 'ELICITACAO':
    case 'ELICITACAO_CORRECAO': {
      // §3: Elicitação concluída avança para SPEC_REVISAO
      if (event.type === 'SPEC_PRONTA') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'SPEC_REVISAO' },
          effects: [],
        };
      }
      break;
    }

    case 'SPEC_REVISAO': {
      // §3: Spec rejeitada volta para ELICITACAO
      if (event.type === 'AJUSTE_SOLICITADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'ELICITACAO' },
          effects: [],
        };
      }
      // §3: Spec APROVADA (T1). Na etapa 0 (etapa1Ativa=false), pula MACROBRIEF/CONFERENCIA direto para PLANEJAMENTO
      if (event.type === 'SPEC_APROVADA') {
        const nextPhase: Phase = opts.etapa1Ativa ? 'MACROBRIEF' : 'PLANEJAMENTO';
        return {
          ok: true,
          ctx: { ...ctx, phase: nextPhase },
          effects: [],
        };
      }
      break;
    }

    case 'MACROBRIEF': {
      // §3: Elicitador entrega Macrobrief -> CONFERENCIA
      if (event.type === 'MACROBRIEF_PRONTO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'CONFERENCIA' },
          effects: [],
        };
      }
      break;
    }

    case 'CONFERENCIA': {
      // §3 (T8a): Conferência aprova Macrobrief -> PLANEJAMENTO e zera voltas
      if (event.type === 'CONFERENCIA_OK') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'PLANEJAMENTO', voltasConferencia: 0 },
          effects: [],
        };
      }
      // §3, regra 3 & §10.2: Conferência falha incrementa voltas. Na 4ª falha (passaria de 3), bloqueia
      if (event.type === 'CONFERENCIA_FALHOU') {
        const novasVoltas = ctx.voltasConferencia + 1;
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
      break;
    }

    case 'PLANEJAMENTO': {
      // §3 (T8b): Contratos e Microbriefs prontos -> EXECUCAO
      if (event.type === 'PLANO_PRONTO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'EXECUCAO' },
          effects: [{ type: 'INICIAR_EXECUCAO' }],
        };
      }
      break;
    }

    case 'EXECUCAO': {
      // §3: Sem pendências -> VERIFICACAO
      if (event.type === 'SEM_PENDENCIAS') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'VERIFICACAO' },
          effects: [],
        };
      }
      // §3, P6, D4: Sem LLM -> PAUSADA (guarda fase; não consome tentativa)
      if (event.type === 'SEM_LLM') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'PAUSADA', faseAntesDaPausa: 'EXECUCAO' },
          effects: [],
        };
      }
      // §3 (T6), §10.2: Executor bloqueado após 3 tentativas -> BLOQUEADA
      if (event.type === 'EXECUTOR_BLOQUEADO') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' },
          effects: [{ type: 'AVISAR_HUMANO', motivo: 'executor esgotou 3 tentativas' }],
        };
      }
      // §3, regra 2: Mudança durante execução -> SPEC_REVISAO + suspender executores pendentes
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
      break;
    }

    case 'PAUSADA': {
      // §3, D4: LLM voltou -> retoma a fase anterior à pausa
      if (event.type === 'LLM_VOLTOU') {
        const destino = ctx.faseAntesDaPausa ?? 'EXECUCAO';
        return {
          ok: true,
          ctx: { ...ctx, phase: destino, faseAntesDaPausa: undefined },
          effects: [{ type: 'RETOMAR_EXECUCAO' }],
        };
      }
      break;
    }

    case 'BLOQUEADA': {
      // §3, §10.2: Humano desbloqueia -> retoma a fase anterior ao bloqueio
      if (event.type === 'DESBLOQUEIO_HUMANO') {
        const destino = ctx.faseAntesDoBloqueio ?? 'EXECUCAO';
        return {
          ok: true,
          ctx: { ...ctx, phase: destino, faseAntesDoBloqueio: undefined },
          effects: [{ type: 'RETOMAR_EXECUCAO' }],
        };
      }
      break;
    }

    case 'VERIFICACAO': {
      // §3, regra 6 (T10): Lacunas na verificação voltam ao PLANEJAMENTO (Analista, nunca Elicitador)
      if (event.type === 'VERIFICACAO_COM_LACUNAS') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'PLANEJAMENTO' },
          effects: [],
        };
      }
      // §3 (T10): Verificação OK -> ENTREGUE
      if (event.type === 'VERIFICACAO_OK') {
        return {
          ok: true,
          ctx: { ...ctx, phase: 'ENTREGUE' },
          effects: [],
        };
      }
      break;
    }

    case 'ENTREGUE': {
      // §3: Novo pedido -> ENTRADA com contadores zerados
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
      break;
    }
  }

  // §3: Transição inválida para qualquer combinação fase x evento não mapeada
  const detail =
    event.type === 'MENSAGEM_CLASSIFICADA'
      ? `Intenção "${event.intencao}" não permitida na fase ${ctx.phase}`
      : `Evento "${event.type}" não permitido na fase ${ctx.phase}`;

  return {
    ok: false,
    reason: detail,
    allowedEvents,
  };
}
