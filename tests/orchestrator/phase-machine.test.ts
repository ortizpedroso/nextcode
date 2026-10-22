import { describe, it, expect } from 'vitest';
import {
  initialContext,
  transition,
  Phase,
  PhaseContext,
  PhaseEvent,
  PhaseOptions,
  MessageIntention,
  PHASES,
  MESSAGE_INTENTIONS,
  PHASE_EVENT_TYPES,
  declaredPhaseTable,
} from '../../src/core/orchestrator/phase-machine';

// J2.7: a lista do próprio código.
const ALL_PHASES: Phase[] = [...PHASES];

const LLM_DEPENDENT_PHASES: Phase[] = [
  'CONVERSA',
  'INTERVENCAO',
  'ELICITACAO',
  'ELICITACAO_CORRECAO',
  'SPEC_REVISAO',
  'MACROBRIEF',
  'CONFERENCIA',
  'PLANEJAMENTO',
  'EXECUCAO',
  'VERIFICACAO',
];

const optsEtapa1On: PhaseOptions = { etapa1Ativa: true };
const optsEtapa1Off: PhaseOptions = { etapa1Ativa: false };

describe('Phase Machine — Módulo Puro de Orquestração (§3 - Revisão Passo 1b)', () => {
  it('initialContext() deve retornar ENTRADA com contadores zerados', () => {
    const ctx = initialContext();
    expect(ctx).toEqual({
      phase: 'ENTRADA',
      rodadasSemClareza: 0,
      voltasConferencia: 0,
    });
  });

  describe('Regra 1: ENTRADA', () => {
    it('criar_novo deve transitar para ELICITACAO', () => {
      const ctx = initialContext();
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
        expect(res.effects).toHaveLength(0);
      }
    });

    it('corrigir_existente deve transitar para ELICITACAO_CORRECAO', () => {
      const ctx = initialContext();
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'corrigir_existente' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO_CORRECAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('incerto deve transitar para CONVERSA com rodadasSemClareza = 1', () => {
      const ctx = initialContext();
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONVERSA');
        expect(res.ctx.rodadasSemClareza).toBe(1);
      }
    });

    it('ENTRADA + SEM_LLM deve continuar em ENTRADA + SEM_MODELO_DISPONIVEL', () => {
      const ctx = initialContext();
      const res = transition(ctx, { type: 'SEM_LLM' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ENTRADA');
        expect(res.effects).toEqual([{ type: 'SEM_MODELO_DISPONIVEL' }]);
      }
    });
  });

  describe('Regra 2: CONVERSA', () => {
    it('incerto com 1 rodada deve permanecer em CONVERSA (contador = 2, sem intervenção)', () => {
      const ctx: PhaseContext = { phase: 'CONVERSA', rodadasSemClareza: 1, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONVERSA');
        expect(res.ctx.rodadasSemClareza).toBe(2);
        expect(res.effects).toHaveLength(0);
      }
    });

    it('incerto atingindo 3ª rodada deve transitar para INTERVENCAO + OFERECER_TRES_CAMINHOS', () => {
      const ctx: PhaseContext = { phase: 'CONVERSA', rodadasSemClareza: 2, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('INTERVENCAO');
        expect(res.ctx.rodadasSemClareza).toBe(3);
        expect(res.effects).toEqual([{ type: 'OFERECER_TRES_CAMINHOS' }]);
      }
    });

    it('criar_novo a partir de CONVERSA deve ir para ELICITACAO e zerar rodadasSemClareza', () => {
      const ctx: PhaseContext = { phase: 'CONVERSA', rodadasSemClareza: 2, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('corrigir_existente a partir de CONVERSA deve ir para ELICITACAO_CORRECAO e zerar rodadasSemClareza', () => {
      const ctx: PhaseContext = { phase: 'CONVERSA', rodadasSemClareza: 2, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'corrigir_existente' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO_CORRECAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });
  });

  describe('Regra 3 & 4 (Mudanças A e C): Resposta ao Elicitador e Intervenção', () => {
    it('INTERVENCAO + ESCOLHA_INTERVENCAO criar → ELICITACAO', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'ESCOLHA_INTERVENCAO', escolha: 'criar' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('INTERVENCAO + ESCOLHA_INTERVENCAO corrigir → ELICITACAO_CORRECAO', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'ESCOLHA_INTERVENCAO', escolha: 'corrigir' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO_CORRECAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('INTERVENCAO + ESCOLHA_INTERVENCAO conversar → CONVERSA com rodadasSemClareza = 0', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'ESCOLHA_INTERVENCAO', escolha: 'conversar' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONVERSA');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('INTERVENCAO por texto (criar_novo, corrigir_existente, incerto)', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };

      // criar_novo por texto
      const r1 = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(r1.ok).toBe(true);
      if (r1.ok) expect(r1.ctx.phase).toBe('ELICITACAO');

      // corrigir_existente por texto
      const r2 = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'corrigir_existente' }, optsEtapa1Off);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.ctx.phase).toBe('ELICITACAO_CORRECAO');

      // incerto (resposta evasiva) → CONVERSA com contador zerado
      const r3 = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(r3.ok).toBe(true);
      if (r3.ok) {
        expect(r3.ctx.phase).toBe('CONVERSA');
        expect(r3.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('intervenção → evasiva → mais 2 incertas continua em CONVERSA → a 3ª volta à INTERVENCAO', () => {
      let ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };

      // Resposta evasiva na intervenção
      let res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('CONVERSA');
      expect(ctx.rodadasSemClareza).toBe(0);

      // 1ª mensagem incerta pós-evasiva
      res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('CONVERSA');
      expect(ctx.rodadasSemClareza).toBe(1);

      // 2ª mensagem incerta pós-evasiva
      res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('CONVERSA');
      expect(ctx.rodadasSemClareza).toBe(2);

      // 3ª mensagem incerta pós-evasiva → INTERVENCAO
      res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('INTERVENCAO');
      expect(ctx.rodadasSemClareza).toBe(3);
    });

    it('ELICITACAO / ELICITACAO_CORRECAO + mensagem do usuário mantém mesma fase + CONTINUAR_ELICITACAO', () => {
      const intentions: MessageIntention[] = ['criar_novo', 'corrigir_existente', 'incerto', 'mudanca_durante_execucao'];

      for (const intencao of intentions) {
        const ctx: PhaseContext = { phase: 'ELICITACAO', rodadasSemClareza: 0, voltasConferencia: 0 };
        const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao }, optsEtapa1Off);
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.ctx.phase).toBe('ELICITACAO');
          expect(res.effects).toEqual([{ type: 'CONTINUAR_ELICITACAO' }]);
        }
      }
    });

    it('SPEC_REVISAO + comentário do usuário → ELICITACAO (pedido de ajuste)', () => {
      const ctx: PhaseContext = { phase: 'SPEC_REVISAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.effects).toHaveLength(0);
      }
    });
  });

  describe('Regra 4: Dúvida avulsa em QUALQUER fase', () => {
    it.each(ALL_PHASES)('na fase %s a fase não muda e devolve RESPONDER_SEM_MUDAR_FASE', (phase) => {
      const ctx: PhaseContext = {
        phase,
        rodadasSemClareza: 1,
        voltasConferencia: 2,
        faseAntesDaPausa: 'EXECUCAO',
      };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'duvida_avulsa' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe(phase);
        expect(res.ctx.rodadasSemClareza).toBe(1);
        expect(res.ctx.voltasConferencia).toBe(2);
        expect(res.effects).toEqual([{ type: 'RESPONDER_SEM_MUDAR_FASE' }]);
      }
    });
  });

  describe('Regra 5: status em QUALQUER fase', () => {
    it.each(ALL_PHASES)('na fase %s a fase não muda e devolve MOSTRAR_STATUS', (phase) => {
      const ctx: PhaseContext = {
        phase,
        rodadasSemClareza: 1,
        voltasConferencia: 2,
      };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'status' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe(phase);
        expect(res.effects).toEqual([{ type: 'MOSTRAR_STATUS' }]);
      }
    });
  });

  describe('Regra 6: ELICITACAO e ELICITACAO_CORRECAO → SPEC_REVISAO', () => {
    it('ELICITACAO + SPEC_PRONTA → SPEC_REVISAO', () => {
      const ctx: PhaseContext = { phase: 'ELICITACAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('SPEC_REVISAO');
      }
    });

    it('ELICITACAO_CORRECAO + SPEC_PRONTA → SPEC_REVISAO', () => {
      const ctx: PhaseContext = { phase: 'ELICITACAO_CORRECAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('SPEC_REVISAO');
      }
    });

    it('SPEC_REVISAO + AJUSTE_SOLICITADO → ELICITACAO', () => {
      const ctx: PhaseContext = { phase: 'SPEC_REVISAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'AJUSTE_SOLICITADO' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
      }
    });
  });

  describe('Regra 7: SPEC_REVISAO + SPEC_APROVADA', () => {
    it('com etapa1Ativa: true → MACROBRIEF', () => {
      const ctx: PhaseContext = { phase: 'SPEC_REVISAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('MACROBRIEF');
      }
    });

    it('com etapa1Ativa: false → PLANEJAMENTO direto (etapa 0)', () => {
      const ctx: PhaseContext = { phase: 'SPEC_REVISAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('PLANEJAMENTO');
      }
    });
  });

  describe('Regra 8: MACROBRIEF e CONFERENCIA (com contadores de falhas)', () => {
    it('MACROBRIEF + MACROBRIEF_PRONTO → CONFERENCIA', () => {
      const ctx: PhaseContext = { phase: 'MACROBRIEF', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'MACROBRIEF_PRONTO' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONFERENCIA');
      }
    });

    it('CONFERENCIA + CONFERENCIA_OK → PLANEJAMENTO e zera voltasConferencia', () => {
      const ctx: PhaseContext = { phase: 'CONFERENCIA', rodadasSemClareza: 0, voltasConferencia: 2 };
      const res = transition(ctx, { type: 'CONFERENCIA_OK' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('PLANEJAMENTO');
        expect(res.ctx.voltasConferencia).toBe(0);
      }
    });

    it('3ª falha de conferência NÃO bloqueia (voltasConferencia de 2 → 3 continua no fluxo)', () => {
      const ctx: PhaseContext = { phase: 'CONFERENCIA', rodadasSemClareza: 0, voltasConferencia: 2 };
      const res = transition(ctx, { type: 'CONFERENCIA_FALHOU', culpa: 'macrobrief' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('MACROBRIEF');
        expect(res.ctx.voltasConferencia).toBe(3);
      }
    });

    it('CONFERENCIA + CONFERENCIA_FALHOU (4ª falha, voltas passam de 3) → BLOQUEADA + AVISAR_HUMANO', () => {
      const ctx: PhaseContext = { phase: 'CONFERENCIA', rodadasSemClareza: 0, voltasConferencia: 3 };
      const res = transition(ctx, { type: 'CONFERENCIA_FALHOU', culpa: 'macrobrief' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('BLOQUEADA');
        expect(res.ctx.voltasConferencia).toBe(4);
        expect(res.ctx.faseAntesDoBloqueio).toBe('CONFERENCIA');
        expect(res.effects).toEqual([
          { type: 'AVISAR_HUMANO', motivo: 'analista e elicitador sem acordo', acao: 'ajustar_spec' },
        ]);
      }
    });
  });

  describe('Regra D (Mudança D): Bloqueio e Desbloqueio Humano', () => {
    it('desbloqueio vindo de CONFERENCIA zera o contador voltasConferencia e emite RETOMAR_FASE', () => {
      const ctx: PhaseContext = {
        phase: 'BLOQUEADA',
        rodadasSemClareza: 0,
        voltasConferencia: 4,
        faseAntesDoBloqueio: 'CONFERENCIA',
      };
      const res = transition(ctx, { type: 'DESBLOQUEIO_HUMANO' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONFERENCIA');
        expect(res.ctx.voltasConferencia).toBe(0);
        expect(res.effects).toEqual([{ type: 'RETOMAR_FASE', fase: 'CONFERENCIA' }]);

        // A falha seguinte (1ª falha pós-desbloqueio) NÃO bloqueia
        const res2 = transition(res.ctx, { type: 'CONFERENCIA_FALHOU', culpa: 'macrobrief' }, optsEtapa1On);
        expect(res2.ok).toBe(true);
        if (res2.ok) {
          expect(res2.ctx.phase).toBe('MACROBRIEF');
          expect(res2.ctx.voltasConferencia).toBe(1);
        }
      }
    });

    it('DESBLOQUEIO_HUMANO vindo de EXECUCAO emite RETOMAR_EXECUCAO', () => {
      const ctx: PhaseContext = {
        phase: 'BLOQUEADA',
        rodadasSemClareza: 0,
        voltasConferencia: 0,
        faseAntesDoBloqueio: 'EXECUCAO',
      };
      const res = transition(ctx, { type: 'DESBLOQUEIO_HUMANO' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('EXECUCAO');
        expect(res.effects).toEqual([{ type: 'RETOMAR_EXECUCAO' }]);
      }
    });

    it('BLOQUEADA + MENSAGEM_CLASSIFICADA (mudanca_durante_execucao/criar_novo/corrigir_existente) → SPEC_REVISAO', () => {
      const ctx: PhaseContext = {
        phase: 'BLOQUEADA',
        rodadasSemClareza: 0,
        voltasConferencia: 4,
        faseAntesDoBloqueio: 'CONFERENCIA',
      };
      const res = transition(
        ctx,
        { type: 'MENSAGEM_CLASSIFICADA', intencao: 'mudanca_durante_execucao' },
        optsEtapa1On
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('SPEC_REVISAO');
        expect(res.ctx.voltasConferencia).toBe(0);
        expect(res.ctx.faseAntesDoBloqueio).toBeUndefined();
        expect(res.effects).toEqual([{ type: 'SUSPENDER_EXECUTORES_PENDENTES' }]);
      }
    });
  });

  describe('Regra E (Mudança E): Sem LLM e Retomada de Pausa', () => {
    it.each(LLM_DEPENDENT_PHASES)('SEM_LLM na fase %s transita para PAUSADA guardando a fase', (phase) => {
      const ctx: PhaseContext = { phase, rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SEM_LLM' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('PAUSADA');
        expect(res.ctx.faseAntesDaPausa).toBe(phase);
      }
    });

    it('PAUSADA + LLM_VOLTOU vindo de EXECUCAO emite RETOMAR_EXECUCAO', () => {
      const ctx: PhaseContext = {
        phase: 'PAUSADA',
        rodadasSemClareza: 0,
        voltasConferencia: 0,
        faseAntesDaPausa: 'EXECUCAO',
      };
      const res = transition(ctx, { type: 'LLM_VOLTOU' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('EXECUCAO');
        expect(res.effects).toEqual([{ type: 'RETOMAR_EXECUCAO' }]);
      }
    });

    it('PAUSADA + LLM_VOLTOU vindo de ELICITACAO emite RETOMAR_FASE', () => {
      const ctx: PhaseContext = {
        phase: 'PAUSADA',
        rodadasSemClareza: 0,
        voltasConferencia: 0,
        faseAntesDaPausa: 'ELICITACAO',
      };
      const res = transition(ctx, { type: 'LLM_VOLTOU' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.effects).toEqual([{ type: 'RETOMAR_FASE', fase: 'ELICITACAO' }]);
      }
    });

    it('SEM_LLM em PAUSADA, BLOQUEADA ou ENTREGUE deve ser recusado', () => {
      const unpausable: Phase[] = ['PAUSADA', 'BLOQUEADA', 'ENTREGUE'];
      for (const phase of unpausable) {
        const ctx: PhaseContext = { phase, rodadasSemClareza: 0, voltasConferencia: 0 };
        const res = transition(ctx, { type: 'SEM_LLM' }, optsEtapa1Off);
        expect(res.ok).toBe(false);
      }
    });

    it('caminho completo com uma pausa no meio da ELICITACAO, voltando à ELICITACAO', () => {
      let ctx = initialContext();

      // 1. ENTRADA → ELICITACAO
      let res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ELICITACAO');

      // 2. ELICITACAO → PAUSADA (sem LLM)
      res = transition(ctx, { type: 'SEM_LLM' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('PAUSADA');
      expect(ctx.faseAntesDaPausa).toBe('ELICITACAO');

      // 3. PAUSADA → ELICITACAO (LLM voltou)
      res = transition(ctx, { type: 'LLM_VOLTOU' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ELICITACAO');
      expect(res.effects).toEqual([{ type: 'RETOMAR_FASE', fase: 'ELICITACAO' }]);

      // 4. Conclusão normal → SPEC_REVISAO → PLANEJAMENTO → EXECUCAO → VERIFICACAO → ENTREGUE
      res = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('SPEC_REVISAO');

      res = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('PLANEJAMENTO');
    });
  });

  describe('Regra B (Mudança B): Novo pedido após ENTREGUE', () => {
    it('ENTREGUE + MENSAGEM_CLASSIFICADA criar_novo → ELICITACAO', () => {
      const ctx: PhaseContext = { phase: 'ENTREGUE', rodadasSemClareza: 2, voltasConferencia: 1 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
        expect(res.ctx.voltasConferencia).toBe(0);
      }
    });

    it('ENTREGUE + MENSAGEM_CLASSIFICADA corrigir_existente → ELICITACAO_CORRECAO', () => {
      const ctx: PhaseContext = { phase: 'ENTREGUE', rodadasSemClareza: 2, voltasConferencia: 1 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'corrigir_existente' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO_CORRECAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('ENTREGUE + MENSAGEM_CLASSIFICADA incerto → CONVERSA com rodadasSemClareza = 1', () => {
      const ctx: PhaseContext = { phase: 'ENTREGUE', rodadasSemClareza: 2, voltasConferencia: 1 };
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'incerto' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONVERSA');
        expect(res.ctx.rodadasSemClareza).toBe(1);
      }
    });

    it('ENTREGUE + NOVO_PEDIDO continua funcionando (reseta tudo e vai para ENTRADA)', () => {
      const ctx: PhaseContext = { phase: 'ENTREGUE', rodadasSemClareza: 2, voltasConferencia: 1 };
      const res = transition(ctx, { type: 'NOVO_PEDIDO' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ENTRADA');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });
  });

  describe('Regra 15 & F: Transições Inválidas e allowedIntents', () => {
    it('deve retornar ok: false com reason e allowedEvents quando evento é totalmente inválido', () => {
      const ctx = initialContext();
      const res = transition(ctx, { type: 'PLANO_PRONTO' }, optsEtapa1Off);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('não permitido');
        expect(res.allowedEvents).toEqual(['MENSAGEM_CLASSIFICADA', 'SEM_LLM']);
      }
    });

    it('deve retornar ok: false com allowedIntents quando MENSAGEM_CLASSIFICADA contém intenção recusada', () => {
      const ctx: PhaseContext = { phase: 'EXECUCAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(
        ctx,
        { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' },
        optsEtapa1Off
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('criar_novo');
        expect(res.allowedEvents).toEqual([
          'SEM_PENDENCIAS',
          'SEM_LLM',
          'AVALIADOR_FORA',
          'EXECUTOR_BLOQUEADO',
          'TETO_CUSTO',
          'FALHA_REPETIDA',
          'SILENCIO_DETECTADO',
          'MENSAGEM_CLASSIFICADA',
        ]);
        expect(res.allowedIntents).toEqual(['mudanca_durante_execucao', 'duvida_avulsa', 'status']);
      }
    });

    it.each(ALL_PHASES)('para cada fase %s, uma intenção recusada retorna ok: false com allowedIntents correto', (phase) => {
      const ctx: PhaseContext = { phase, rodadasSemClareza: 0, voltasConferencia: 0 };
      // Intenção fictícia/inválida para fases sem fluxo genérico de mensagem
      const invalidIntention: MessageIntention = phase === 'ENTRADA' ? 'mudanca_durante_execucao' : 'criar_novo';

      const res = transition(
        ctx,
        { type: 'MENSAGEM_CLASSIFICADA', intencao: invalidIntention },
        optsEtapa1Off
      );

      // Se a intenção for recusada na fase, deve retornar ok: false e allowedIntents
      if (!res.ok) {
        expect(res.allowedEvents).toContain('MENSAGEM_CLASSIFICADA');
        expect(res.allowedIntents).toBeDefined();
        expect(Array.isArray(res.allowedIntents)).toBe(true);
      }
    });
  });

  describe('Imutabilidade e Caminho Feliz', () => {
    it('o contexto de entrada não deve ser alterado', () => {
      const ctx: PhaseContext = Object.freeze({
        phase: 'ENTRADA',
        rodadasSemClareza: 0,
        voltasConferencia: 0,
      });
      const res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      expect(ctx.phase).toBe('ENTRADA');
    });

    it('fluxo completo ENTRADA → ENTREGUE com etapa1Ativa: false (Etapa 0)', () => {
      let ctx = initialContext();

      let res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ELICITACAO');

      res = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('SPEC_REVISAO');

      res = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('PLANEJAMENTO');

      res = transition(ctx, { type: 'PLANO_PRONTO' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('EXECUCAO');

      res = transition(ctx, { type: 'SEM_PENDENCIAS' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('VERIFICACAO');

      res = transition(ctx, { type: 'VERIFICACAO_OK' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ENTREGUE');
    });
  });

  describe('Consistência entre o declarado (allowedEvents/allowedIntents) e o aceito por transition', () => {
    const ALL_INTENTIONS: MessageIntention[] = [...MESSAGE_INTENTIONS];

    const SAMPLE_EVENTS: PhaseEvent[] = [
      { type: 'MENSAGEM_CLASSIFICADA', intencao: 'duvida_avulsa' },
      { type: 'ESCOLHA_INTERVENCAO', escolha: 'criar' },
      { type: 'SPEC_PRONTA' },
      { type: 'AJUSTE_SOLICITADO' },
      { type: 'SPEC_APROVADA' },
      { type: 'MACROBRIEF_PRONTO' },
      { type: 'CONFERENCIA_OK' },
      { type: 'CONFERENCIA_FALHOU', culpa: 'macrobrief' },
      { type: 'PLANO_PRONTO' },
      { type: 'PLANO_REPROVADO' },
      { type: 'AVALIADOR_FORA', ate: '2026-10-18T12:05:00.000Z', pausa: 1, motivo: 'x', definitivo: false },
      { type: 'SEM_PENDENCIAS' },
      { type: 'SEM_LLM' },
      { type: 'LLM_VOLTOU' },
      { type: 'EXECUTOR_BLOQUEADO' },
      { type: 'TETO_CUSTO' },
      { type: 'DESBLOQUEIO_HUMANO' },
      { type: 'VERIFICACAO_COM_LACUNAS' },
      { type: 'VERIFICACAO_OK' },
      { type: 'FALHA_AMBIENTE' },
      { type: 'REPARO_NECESSARIO' },
      { type: 'FALHA_REPETIDA' },
      { type: 'SILENCIO_DETECTADO' },
      { type: 'NOVO_PEDIDO' },
    ];

    it('J2.7: os eventos de amostra cobrem todos os tipos de evento do código', () => {
      expect(new Set(SAMPLE_EVENTS.map((e) => e.type))).toEqual(new Set(PHASE_EVENT_TYPES));
    });

    it('J2.7: a tabela tem todas as fases; todo evento aceito por alguma fase está na lista e todo evento da lista é aceito por alguma fase', () => {
      const table = declaredPhaseTable();
      expect(new Set(Object.keys(table))).toEqual(new Set(PHASES));
      const declared = new Set(Object.values(table).flatMap((c) => c.allowedEvents));
      for (const ev of declared) expect(PHASE_EVENT_TYPES as readonly string[]).toContain(ev);
      for (const ev of PHASE_EVENT_TYPES) expect(declared.has(ev), `evento ${ev} não é aceito por nenhuma fase`).toBe(true);
      for (const c of Object.values(table)) {
        for (const i of c.allowedIntents ?? []) expect(MESSAGE_INTENTIONS as readonly string[]).toContain(i);
      }
    });

    it.each(ALL_PHASES)('na fase %s, allowedEvents e allowedIntents coincidem exatamente com a aceitação real', (phase) => {
      const testCtx: PhaseContext = {
        phase,
        rodadasSemClareza: 1,
        voltasConferencia: 1,
        faseAntesDaPausa: 'EXECUCAO',
        faseAntesDoBloqueio: 'CONFERENCIA',
      };

      // 1. Testa intenções realmente aceitas vs declaradas em allowedIntents
      const acceptedIntents = ALL_INTENTIONS.filter((intencao) => {
        const res = transition(testCtx, { type: 'MENSAGEM_CLASSIFICADA', intencao }, optsEtapa1On);
        return res.ok;
      });

      const invalidIntentionSample: MessageIntention = ALL_INTENTIONS.find((i) => !acceptedIntents.includes(i)) ?? 'status';
      const rejectedRes = transition(testCtx, { type: 'MENSAGEM_CLASSIFICADA', intencao: invalidIntentionSample }, optsEtapa1On);

      if (!rejectedRes.ok && rejectedRes.allowedIntents) {
        expect(acceptedIntents.sort()).toEqual([...rejectedRes.allowedIntents].sort());
      }

      // 2. Testa tipos de evento realmente aceitos vs declarados em allowedEvents
      const acceptedEvents = Array.from(new Set(SAMPLE_EVENTS.filter((event) => {
        if (event.type === 'MENSAGEM_CLASSIFICADA') {
          return ALL_INTENTIONS.some((intencao) => transition(testCtx, { type: 'MENSAGEM_CLASSIFICADA', intencao }, optsEtapa1On).ok);
        }
        return transition(testCtx, event, optsEtapa1On).ok;
      }).map((e) => e.type)));

      const invalidEventSample = SAMPLE_EVENTS.find((e) => !acceptedEvents.includes(e.type)) ?? { type: 'NOVO_PEDIDO' };
      const rejectedEventRes = transition(testCtx, invalidEventSample, optsEtapa1On);
      expect(rejectedEventRes.ok).toBe(false);
      if (!rejectedEventRes.ok) {
        expect(acceptedEvents.sort()).toEqual([...rejectedEventRes.allowedEvents].sort());
      }
    });
  });
});
