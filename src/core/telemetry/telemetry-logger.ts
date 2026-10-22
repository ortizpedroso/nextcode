/**
 * Telemetry Logger (NextCode v5)
 * Registra assincronamente eventos de execução, falhas, uso de ferramentas e métricas
 * no SQLite WAL para posterior mineração de habilidades.
 */

import prisma from "@/lib/prisma";

export interface TelemetryEvent {
  sessionId?: string;
  action: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

export class TelemetryLogger {
  /**
   * Grava um evento de telemetria de forma não-bloqueante no banco de dados.
   */
  public static log(event: TelemetryEvent): void {
    const detailsJson = event.details ? JSON.stringify(event.details) : null;
    
    // Executa em plano de fundo sem travar a thread principal
    prisma.telemetryLog
      .create({
        data: {
          sessionId: event.sessionId || null,
          action: event.action,
          details: detailsJson,
          durationMs: event.durationMs || 0,
        },
      })
      .catch((err) => {
        console.error("[TelemetryLogger] Falha ao registrar evento de telemetria:", err);
      });
  }

  /**
   * Mudança 44: para registro que é ESTADO lido depois (pesquisa T7 da sessão, provas da revisão final),
   * espera a gravação — o `log` em plano de fundo pode ainda não estar no banco na próxima leitura.
   */
  public static async logAndWait(event: TelemetryEvent): Promise<void> {
    await prisma.telemetryLog.create({
      data: {
        sessionId: event.sessionId || null,
        action: event.action,
        details: event.details ? JSON.stringify(event.details) : null,
        durationMs: event.durationMs || 0,
      },
    });
  }

  /**
   * Recupera histórico de eventos recentes para análise de padrões
   */
  public static async getRecentLogs(limit: number = 100) {
    return prisma.telemetryLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
