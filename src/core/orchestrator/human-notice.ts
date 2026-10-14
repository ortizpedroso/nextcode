import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

/**
 * Notifica o humano no chat da sessão quando uma parada ou bloqueio ocorre,
 * garantindo que nenhuma sessão pare silenciosamente.
 *
 * @param sessionId ID da sessão
 * @param motivo Motivo amigável do bloqueio
 * @param detalhe Detalhe técnico ou lista de lacunas/erros
 */
export async function postHumanNotice(
  sessionId: string,
  motivo: string,
  detalhe?: string
): Promise<void> {
  const content =
    `🛑 **Sessão bloqueada — ${motivo}.**` +
    (detalhe ? "\n\n" + detalhe : "") +
    "\n\nPara continuar, responda aqui no chat dizendo o que ajustar: a Spec volta para revisão e, aprovada, a execução recomeça.";

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
    details: { motivo },
  });
}
