/** Texto do painel quando a etapa está marcada como running e o processo do NextCode não responde. */
export const EXECUTION_STOPPED_LABEL = "Execução parada — servidor fora do ar";

/**
 * O banco guarda a etapa como running mesmo depois que o processo morre.
 * "Executando" só vale com o servidor respondendo. Sem resposta, a execução parou.
 */
export function executionLooksStopped(input: {
  serverReachable: boolean;
  taskMarkedRunning: boolean;
  phase: string | null;
}): boolean {
  if (input.serverReachable) return false;
  if (input.taskMarkedRunning) return true;
  return input.phase === "EXECUCAO" || input.phase === "VERIFICACAO";
}
