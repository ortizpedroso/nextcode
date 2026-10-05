import { describe, it, expect } from 'vitest';
import {
  initialContext,
  transition,
  Phase,
  PhaseContext,
  PhaseEvent,
  PhaseOptions,
} from '../../src/core/orchestrator/phase-machine';

const ALL_PHASES: Phase[] = [
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
];

const optsEtapa1On: PhaseOptions = { etapa1Ativa: true };
const optsEtapa1Off: PhaseOptions = { etapa1Ativa: false };

describe('Phase Machine — Módulo Puro de Orquestração (§3)', () => {
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

  describe('Regra 3: INTERVENCAO', () => {
    it('escolha criar deve ir para ELICITACAO', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'ESCOLHA_INTERVENCAO', escolha: 'criar' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('escolha corrigir deve ir para ELICITACAO_CORRECAO', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'ESCOLHA_INTERVENCAO', escolha: 'corrigir' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ELICITACAO_CORRECAO');
        expect(res.ctx.rodadasSemClareza).toBe(0);
      }
    });

    it('escolha conversar deve voltar para CONVERSA com rodadasSemClareza = 0', () => {
      const ctx: PhaseContext = { phase: 'INTERVENCAO', rodadasSemClareza: 3, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'ESCOLHA_INTERVENCAO', escolha: 'conversar' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('CONVERSA');
        expect(res.ctx.rodadasSemClareza).toBe(0);
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

  describe('Regra 8: MACROBRIEF e CONFERENCIA', () => {
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

    it('CONFERENCIA + CONFERENCIA_FALHOU (1ª falha, culpa macrobrief) → MACROBRIEF', () => {
      const ctx: PhaseContext = { phase: 'CONFERENCIA', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'CONFERENCIA_FALHOU', culpa: 'macrobrief' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('MACROBRIEF');
        expect(res.ctx.voltasConferencia).toBe(1);
      }
    });

    it('CONFERENCIA + CONFERENCIA_FALHOU (2ª falha, culpa spec) → SPEC_REVISAO', () => {
      const ctx: PhaseContext = { phase: 'CONFERENCIA', rodadasSemClareza: 0, voltasConferencia: 1 };
      const res = transition(ctx, { type: 'CONFERENCIA_FALHOU', culpa: 'spec' }, optsEtapa1On);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('SPEC_REVISAO');
        expect(res.ctx.voltasConferencia).toBe(2);
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
          { type: 'AVISAR_HUMANO', motivo: 'analista e elicitador sem acordo' },
        ]);
      }
    });
  });

  describe('Regra 9: PLANEJAMENTO + PLANO_PRONTO', () => {
    it('PLANEJAMENTO + PLANO_PRONTO → EXECUCAO + INICIAR_EXECUCAO', () => {
      const ctx: PhaseContext = { phase: 'PLANEJAMENTO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'PLANO_PRONTO' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('EXECUCAO');
        expect(res.effects).toEqual([{ type: 'INICIAR_EXECUCAO' }]);
      }
    });
  });

  describe('Regra 10: EXECUCAO', () => {
    it('SEM_PENDENCIAS → VERIFICACAO', () => {
      const ctx: PhaseContext = { phase: 'EXECUCAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SEM_PENDENCIAS' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('VERIFICACAO');
      }
    });

    it('SEM_LLM → PAUSADA e guarda faseAntesDaPausa', () => {
      const ctx: PhaseContext = { phase: 'EXECUCAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'SEM_LLM' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('PAUSADA');
        expect(res.ctx.faseAntesDaPausa).toBe('EXECUCAO');
      }
    });

    it('EXECUTOR_BLOQUEADO → BLOQUEADA + AVISAR_HUMANO e guarda faseAntesDoBloqueio', () => {
      const ctx: PhaseContext = { phase: 'EXECUCAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'EXECUTOR_BLOQUEADO' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('BLOQUEADA');
        expect(res.ctx.faseAntesDoBloqueio).toBe('EXECUCAO');
        expect(res.effects).toEqual([
          { type: 'AVISAR_HUMANO', motivo: 'executor esgotou 3 tentativas' },
        ]);
      }
    });

    it('mudanca_durante_execucao → SPEC_REVISAO + SUSPENDER_EXECUTORES_PENDENTES', () => {
      const ctx: PhaseContext = { phase: 'EXECUCAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(
        ctx,
        { type: 'MENSAGEM_CLASSIFICADA', intencao: 'mudanca_durante_execucao' },
        optsEtapa1Off
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('SPEC_REVISAO');
        expect(res.effects).toEqual([{ type: 'SUSPENDER_EXECUTORES_PENDENTES' }]);
      }
    });
  });

  describe('Regra 11: PAUSADA + LLM_VOLTOU', () => {
    it('LLM_VOLTOU volta para faseAntesDaPausa + RETOMAR_EXECUCAO (sem consumir tentativa)', () => {
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
        expect(res.ctx.faseAntesDaPausa).toBeUndefined();
        expect(res.effects).toEqual([{ type: 'RETOMAR_EXECUCAO' }]);
      }
    });
  });

  describe('Regra 12: BLOQUEADA + DESBLOQUEIO_HUMANO', () => {
    it('DESBLOQUEIO_HUMANO volta para faseAntesDoBloqueio + RETOMAR_EXECUCAO', () => {
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
        expect(res.ctx.faseAntesDoBloqueio).toBeUndefined();
        expect(res.effects).toEqual([{ type: 'RETOMAR_EXECUCAO' }]);
      }
    });
  });

  describe('Regra 13: VERIFICACAO', () => {
    it('VERIFICACAO_COM_LACUNAS → PLANEJAMENTO (Analista)', () => {
      const ctx: PhaseContext = { phase: 'VERIFICACAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'VERIFICACAO_COM_LACUNAS' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('PLANEJAMENTO');
      }
    });

    it('VERIFICACAO_OK → ENTREGUE', () => {
      const ctx: PhaseContext = { phase: 'VERIFICACAO', rodadasSemClareza: 0, voltasConferencia: 0 };
      const res = transition(ctx, { type: 'VERIFICACAO_OK' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ENTREGUE');
      }
    });
  });

  describe('Regra 14: ENTREGUE + NOVO_PEDIDO', () => {
    it('NOVO_PEDIDO → ENTRADA com contadores zerados', () => {
      const ctx: PhaseContext = {
        phase: 'ENTREGUE',
        rodadasSemClareza: 2,
        voltasConferencia: 1,
        faseAntesDaPausa: 'EXECUCAO',
      };
      const res = transition(ctx, { type: 'NOVO_PEDIDO' }, optsEtapa1Off);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.ctx.phase).toBe('ENTRADA');
        expect(res.ctx.rodadasSemClareza).toBe(0);
        expect(res.ctx.voltasConferencia).toBe(0);
        expect(res.ctx.faseAntesDaPausa).toBeUndefined();
      }
    });
  });

  describe('Regra 15: Transições Inválidas', () => {
    it('deve retornar ok: false com reason e allowedEvents correto quando evento é inválido', () => {
      const ctx = initialContext();
      const res = transition(ctx, { type: 'PLANO_PRONTO' }, optsEtapa1Off);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('não permitido');
        expect(res.allowedEvents).toEqual(['MENSAGEM_CLASSIFICADA']);
      }
    });

    it('deve retornar ok: false para intenção inválida na fase EXECUCAO', () => {
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
          'EXECUTOR_BLOQUEADO',
          'MENSAGEM_CLASSIFICADA',
        ]);
      }
    });
  });

  describe('Imutabilidade do contexto', () => {
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
  });

  describe('Inalcançabilidade com etapa1Ativa: false', () => {
    it('com etapa1Ativa: false, a aprovação da Spec pula MACROBRIEF e CONFERENCIA indo direto a PLANEJAMENTO', () => {
      let ctx = initialContext();

      const r1 = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(r1.ok).toBe(true);
      if (r1.ok) ctx = r1.ctx;
      expect(ctx.phase).toBe('ELICITACAO');

      const r2 = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1Off);
      expect(r2.ok).toBe(true);
      if (r2.ok) ctx = r2.ctx;
      expect(ctx.phase).toBe('SPEC_REVISAO');

      const r3 = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1Off);
      expect(r3.ok).toBe(true);
      if (r3.ok) ctx = r3.ctx;
      expect(ctx.phase).toBe('PLANEJAMENTO'); // Pula MACROBRIEF e CONFERENCIA
    });
  });

  describe('Caminho Feliz Completo', () => {
    it('fluxo completo ENTRADA → ENTREGUE com etapa1Ativa: false (Etapa 0)', () => {
      let ctx = initialContext();

      // 1. ENTRADA → ELICITACAO
      let res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ELICITACAO');

      // 2. ELICITACAO → SPEC_REVISAO
      res = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('SPEC_REVISAO');

      // 3. SPEC_REVISAO → PLANEJAMENTO
      res = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('PLANEJAMENTO');

      // 4. PLANEJAMENTO → EXECUCAO
      res = transition(ctx, { type: 'PLANO_PRONTO' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('EXECUCAO');

      // 5. EXECUCAO → VERIFICACAO
      res = transition(ctx, { type: 'SEM_PENDENCIAS' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('VERIFICACAO');

      // 6. VERIFICACAO → ENTREGUE
      res = transition(ctx, { type: 'VERIFICACAO_OK' }, optsEtapa1Off);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ENTREGUE');
    });

    it('fluxo completo ENTRADA → ENTREGUE com etapa1Ativa: true (Etapa 1)', () => {
      let ctx = initialContext();

      // 1. ENTRADA → ELICITACAO
      let res = transition(ctx, { type: 'MENSAGEM_CLASSIFICADA', intencao: 'criar_novo' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ELICITACAO');

      // 2. ELICITACAO → SPEC_REVISAO
      res = transition(ctx, { type: 'SPEC_PRONTA' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('SPEC_REVISAO');

      // 3. SPEC_REVISAO → MACROBRIEF
      res = transition(ctx, { type: 'SPEC_APROVADA' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('MACROBRIEF');

      // 4. MACROBRIEF → CONFERENCIA
      res = transition(ctx, { type: 'MACROBRIEF_PRONTO' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('CONFERENCIA');

      // 5. CONFERENCIA → PLANEJAMENTO
      res = transition(ctx, { type: 'CONFERENCIA_OK' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('PLANEJAMENTO');

      // 6. PLANEJAMENTO → EXECUCAO
      res = transition(ctx, { type: 'PLANO_PRONTO' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('EXECUCAO');

      // 7. EXECUCAO → VERIFICACAO
      res = transition(ctx, { type: 'SEM_PENDENCIAS' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('VERIFICACAO');

      // 8. VERIFICACAO → ENTREGUE
      res = transition(ctx, { type: 'VERIFICACAO_OK' }, optsEtapa1On);
      expect(res.ok).toBe(true); if (res.ok) ctx = res.ctx;
      expect(ctx.phase).toBe('ENTREGUE');
    });
  });
});
