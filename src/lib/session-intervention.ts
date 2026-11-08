/** Só a fase BLOQUEADA exige Retomar / Autorizar rodada no painel DAG. */
export function sessionNeedsHumanIntervention(input: {
  phase: string | null | undefined;
}): boolean {
  return input.phase === "BLOQUEADA";
}
