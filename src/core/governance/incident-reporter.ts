/**
 * Evolution Incident Reporter (OpenCode v5 - Trava T6 D-RANHO)
 * Compila o histórico de falhas de auditoria e gera um Relatório de Incidente de Evolução
 * quando uma tarefa atinge o limite de 3 tentativas rejeitadas.
 */

export interface FailureAttemptRecord {
  attemptNumber: number;
  rejectionReason: string;
  filesScope: string[];
  timestamp: string;
}

export class IncidentReporter {
  /**
   * Compila o relatório markdown de incidente quando a política D-RANHO é acionada.
   */
  public static generateIncidentReport(
    taskId: string,
    taskTitle: string,
    cluster: string,
    attemptsHistory: FailureAttemptRecord[]
  ): string {
    return `# Relatório de Incidente de Evolução (Política D-RANHO - Trava T6)

> **Severidade:** ALTA — Limite de Rejeição Atingido (3/3)
> **Tarefa:** \`${taskId}\` — ${taskTitle}
> **Cluster Afetado:** \`${cluster}\`
> **Data de Registro:** ${new Date().toISOString()}

---

## 1. Diagnóstico de Bloqueio Autônomo
A tarefa \`${taskId}\` atingiu o limite máximo de 3 tentativas de execução sem obter o veredito \`APPROVED\` da Auditoria Cega. 
Em cumprimento à **Política D-RANHO**, a execução desta subárvore foi pausada para evitar consumo desnecessário de tokens e corrupção de escopo.

## 2. Histórico das Tentativas Rejeitadas

${attemptsHistory
  .map(
    (att) => `### Tentativa ${att.attemptNumber}
- **Data/Hora:** ${att.timestamp}
- **Escopo Afetado:** \`${att.filesScope.join(", ")}\`
- **Motivo da Rejeição:** ${att.rejectionReason}
`
  )
  .join("\n")}

## 3. Estado Atual do Grafo (DAG)
- **Subárvore Dependente:** Em estado \`PAUSED_DEPENDENCY\` (Isolada mecanicamente).
- **Ramificações Independentes:** Continuam em execução normal em paralelo.

## 4. Ação Recomendada para o Desenvolvedor
- Inspecionar os arquivos do escopo em quarentena.
- Ajustar os critérios de aceite ou refatorar as dependências no Brief.
- Clicar em "Reorientar Tarefa" ou "Desbloquear Nó" no painel de governança.
`;
  }
}
