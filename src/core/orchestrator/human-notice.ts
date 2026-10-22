import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import type { HumanAction } from "@/core/orchestrator/phase-machine";

/**
 * Mudança 36: o que fazer depende da causa. Antes a frase era fixa ("a Spec volta para revisão")
 * e mandava refazer a Spec até quando faltava memória para rodar o type-check.
 */
export function humanActionText(acao: HumanAction | undefined): string {
  switch (acao) {
    case "retomar":
      return "**O que fazer:** nada muda na Spec. Resolva a causa acima (se for de ambiente: memória, Docker, rede) e clique em **Retomar** no painel da DAG — ou escreva `retomar` aqui no chat. A execução continua de onde parou.";
    case "autorizar_verba":
      return "**O que fazer:** autorize mais verba no painel da DAG (**Autorizar**). A execução continua de onde parou; nada muda na Spec.";
    case "retentar_etapa":
      return "**O que fazer:** se a falha foi passageira, clique em **Re-tentar** na etapa bloqueada (painel da DAG). Se o pedido estiver errado ou impossível, responda aqui dizendo o que ajustar: a Spec volta para revisão.";
    case "ajustar_spec":
    default:
      return "**O que fazer:** responda aqui no chat dizendo o que ajustar: a Spec volta para revisão e, aprovada, a execução recomeça.";
  }
}

/**
 * Notifica o humano no chat da sessão quando uma parada ou bloqueio ocorre,
 * garantindo que nenhuma sessão pare silenciosamente.
 *
 * @param sessionId ID da sessão
 * @param motivo Motivo amigável do bloqueio
 * @param detalhe Detalhe técnico ou lista de lacunas/erros
 * @param acao O que o humano deve fazer (mudança 36)
 */
export async function postHumanNotice(
  sessionId: string,
  motivo: string,
  detalhe?: string,
  acao?: HumanAction
): Promise<void> {
  const content =
    `🛑 **Sessão bloqueada — ${motivo}.**` +
    (detalhe ? "\n\n" + detalhe : "") +
    "\n\n" +
    humanActionText(acao);

  await prisma.message.create({
    data: {
      sessionId,
      role: "assistant",
      content,
    },
  });

  TelemetryLogger.log({
    sessionId,
    action: "HUMAN_NOTIFIED",
    details: { motivo, acao: acao ?? "ajustar_spec" },
  });
}
