/** Relatório humano quando o analista não entrega plano T8b válido (≠ conferente Spec×Macrobrief). */

export type PlanoReprovadoAnalista = {
  motivo: string;
  dono: "analista";
  erros?: string[];
  rodadas?: number;
};

/** Título curto no chat (postHumanNotice) — alinhado ao efeito AVISAR_HUMANO da máquina de fases. */
export const PLANO_T8B_REPROVADO_MOTIVO =
  "plano de execução reprovado na validação T8b do analista (não é conferência Spec×Macrobrief)";

export function humanMotivoPlanoAnalista(motivo: string, extra?: { rodadas?: number }): string {
  switch (motivo) {
    case "rodadas_esgotadas":
      return extra?.rodadas
        ? `O analista esgotou ${extra.rodadas} rodada(s) sem plano válido na T8b.`
        : "O analista esgotou todas as rodadas sem plano válido na T8b.";
    case "spec_sem_requisitos":
      return "A Spec não declara requisitos (REQ-001…); o analista não pode montar o plano.";
    case "skill_analista_indisponivel":
      return "Skill do analista indisponível no servidor (arquivo de papel ausente ou ilegível).";
    case "exception_or_offline":
      return "Chamada ao modelo do analista falhou (timeout, gateway ou exceção).";
    default:
      return `Plano reprovado (${motivo}).`;
  }
}

export function buildPlanoReprovadoDetalhe(
  plano: Pick<PlanoReprovadoAnalista, "motivo" | "erros" | "rodadas">,
  extra?: { rodadas?: number }
): string {
  const erros = plano.erros ?? [];
  const rodadas = extra?.rodadas ?? plano.rodadas;
  const human = humanMotivoPlanoAnalista(plano.motivo, { rodadas });
  let body =
    "**Dono:** analista (validação mecânica T8b do plano DAG — não é a conferência Spec×Macrobrief).\n\n" +
    `${human}\n\n` +
    "Nenhuma etapa foi criada e nada foi gasto em execução.";
  if (erros.length > 0) {
    body +=
      `\n\nProblemas da última rodada (${erros.length}):\n` +
      erros.slice(0, 15).map((e) => "- " + e).join("\n") +
      (erros.length > 15 ? `\n- … e mais ${erros.length - 15}` : "");
  } else if (plano.motivo === "rodadas_esgotadas") {
    body +=
      "\n\n_Nenhum erro T8b estruturado foi capturado (respostas vazias, YAML ilegível ou corte de tokens em todas as rodadas). " +
      "Confira tier heavy, gateway e `ANALISTA_TIMEOUT_MS`._";
  }
  return body;
}

export function buildPlanoReprovadoProblems(plano: Pick<PlanoReprovadoAnalista, "motivo" | "erros">, extra?: { rodadas?: number }): string[] {
  const erros = plano.erros ?? [];
  const headline =
    "O plano do analista não passou na validação mecânica T8b (não é a conferência Spec×Macrobrief). Nenhuma etapa foi criada.";
  const out: string[] = [headline, humanMotivoPlanoAnalista(plano.motivo, extra)];
  if (erros.length > 0) {
    out.push(...erros.slice(0, 20));
    if (erros.length > 20) out.push(`… e mais ${erros.length - 20} problema(s).`);
  } else if (plano.motivo === "rodadas_esgotadas") {
    out.push(
      "Sem lista de erros T8b — verifique resposta do modelo (formato YAML, limite de tokens) e infraestrutura LLM."
    );
  }
  return out;
}
