/**
 * Teto de custo por projeto (decisão do fundador, 07/10): antes de cada lote da fila, soma o custo
 * real da sessão (LLM_COST). Ao atingir o teto, a sessão vai para BLOQUEADA (exige ação humana — a
 * pausa por falta de IA, PAUSADA, retoma sozinha e não serve aqui). O fundador autoriza mais verba
 * pela API (acao authorize_budget), registrada na trilha como BUDGET_AUTHORIZED (append-only).
 *
 * Limite conhecido: o teto é conferido entre lotes; um lote em andamento (até 3 etapas) termina
 * mesmo que passe do teto.
 */
import prisma from "@/lib/prisma";
import { sessionCostUsd, sessionCostBreakdown, type SessionCostBreakdown } from "@/core/llm/cost";
import { loadOrchestrationPolicy, type OrchestrationPolicy } from "@/core/config/orchestration-policy";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export const BUDGET_AUTHORIZED_ACTION = "BUDGET_AUTHORIZED";
const ALERT_MARKER = "Alerta de custo";
const BLOCK_MARKER = "Teto de custo atingido";

export async function authorizedExtraUsd(sessionId: string): Promise<number> {
  const rows = await prisma.telemetryLog.findMany({
    where: { sessionId, action: BUDGET_AUTHORIZED_ACTION },
    select: { details: true },
  });
  return rows.reduce((sum, r) => {
    try {
      const v = Number(JSON.parse(r.details || "{}").acrescimoUsd);
      return Number.isFinite(v) && v > 0 ? sum + v : sum;
    } catch {
      return sum;
    }
  }, 0);
}

export interface BudgetState {
  spentUsd: number;
  limitUsd: number;
  alertUsd: number;
  status: "ok" | "alerta" | "teto";
  breakdown?: SessionCostBreakdown;
}

export async function getSessionBudget(sessionId: string, policy?: OrchestrationPolicy): Promise<BudgetState> {
  const p = policy ?? loadOrchestrationPolicy();
  const [breakdown, extra] = await Promise.all([sessionCostBreakdown(sessionId), authorizedExtraUsd(sessionId)]);
  const spentUsd = breakdown.totalUsd;
  const limitUsd = p.orcamento.tetoCustoPorProjetoUsd + extra;
  const alertUsd = limitUsd * (p.orcamento.alertaPercentualTeto / 100);
  const status = spentUsd >= limitUsd ? "teto" : spentUsd >= alertUsd ? "alerta" : "ok";
  return { spentUsd, limitUsd, alertUsd, status, breakdown };
}

const fmt = (v: number) => `US$ ${v.toFixed(2)}`;

async function postOnce(sessionId: string, marker: string, limitUsd: number, content: string): Promise<void> {
  // Uma mensagem por patamar de teto (depois de autorizar mais verba, o novo patamar avisa de novo).
  const tag = `${marker} (${fmt(limitUsd)})`;
  const exists = await prisma.message.findFirst({
    where: { sessionId, role: "assistant", content: { contains: tag } },
  });
  if (!exists) await prisma.message.create({ data: { sessionId, role: "assistant", content: content.replace(marker, tag) } });
}

/**
 * Confere o teto antes de um lote. Retorna true se a fila pode seguir; false se bloqueou a sessão.
 */
export async function enforceBudgetBeforeBatch(sessionId: string): Promise<boolean> {
  const b = await getSessionBudget(sessionId);
  if (b.status === "ok") return true;

  if (b.status === "alerta") {
    await postOnce(
      sessionId,
      ALERT_MARKER,
      b.limitUsd,
      `💰 **${ALERT_MARKER}:** este projeto já gastou ${fmt(b.spentUsd)} de ${fmt(b.limitUsd)}. A execução continua; ao atingir o teto ela para e pede sua autorização.`
    );
    return true;
  }

  const res = await applyPhaseEvent(sessionId, { type: "TETO_CUSTO" }, { avisoJaPostado: true });
  TelemetryLogger.log({
    sessionId,
    action: "BUDGET_CEILING_REACHED",
    details: { spentUsd: b.spentUsd, limitUsd: b.limitUsd, transitionOk: res.ok },
  });
  await postOnce(
    sessionId,
    BLOCK_MARKER,
    b.limitUsd,
    `🛑 **${BLOCK_MARKER}:** gasto de ${fmt(b.spentUsd)} para um teto de ${fmt(b.limitUsd)}. A execução parou e nenhuma etapa foi perdida. Para continuar, autorize mais verba (botão "Autorizar mais verba" no painel da execução).`
  );
  return false;
}
