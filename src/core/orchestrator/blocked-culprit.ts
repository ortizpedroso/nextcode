/**
 * G3 (mudança 38): a etapa que falhou de verdade é a que tem tentativas próprias no histórico; as
 * dependentes ficam "blocked" pela cascata depois dela (updatedAt mais novo) e não têm falha própria.
 * Teste real `4d019f00`: o relatório de incidente culpava a dependente, sem nenhuma tentativa.
 */
export function pickBlockedCulprit<T extends { failureHistory: string | null }>(blockedTasks: T[]): T | undefined {
  const ownFailures = (t: T): number => {
    try {
      const h = JSON.parse(t.failureHistory || "[]");
      return Array.isArray(h) ? h.length : 0;
    } catch {
      return 0;
    }
  };
  return blockedTasks.find((t) => ownFailures(t) > 0) ?? blockedTasks[0];
}
