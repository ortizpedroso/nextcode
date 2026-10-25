/** Mensagens de recusa da Trava T1 (modal e chat). */
export function messageForApproveSpecFailure(reason: string, problems?: string[]): string {
  switch (reason) {
    case "SESSAO_SEM_PROJETO":
      return "Vincule esta sessão a um projeto com pasta no disco (menu da sessão → mover para projeto). A Spec continua salva.";
    case "SPEC_AUSENTE":
      return "A Spec Canônica precisa estar salva no servidor antes da aprovação. Gere ou salve o rascunho no painel.";
    case "SPEC_SEM_REQUISITOS":
      return "A Spec não possui requisitos verificáveis (REQ-001…). Complete a especificação no chat.";
    case "SPEC_SEM_MODULOS":
      return "A Spec não declara módulos.";
    case "SPEC_SEM_ARQUIVOS":
      return "A Spec não define arquivos_afetados.";
    case "SPEC_INVALIDA_OU_MALFORMATADA":
      return "O documento da Spec está ilegível ou incompleto (YAML). Abra “Editar documento completo” e corrija, ou regenere no chat.";
    case "PERGUNTA_AO_HUMANO":
      return (
        "Preciso de uma confirmação sua antes de seguir (responda no chat, inclusive nomeando cluster se for exceção):\n" +
        (problems ?? []).map((p) => `• ${p}`).join("\n")
      );
    case "CONFERENCIA_REPROVADA":
      return (
        "A conferência Spec × Macrobrief reprovou. Corrija e tente de novo:\n" +
        (problems ?? []).map((p) => `• ${p}`).join("\n")
      );
    default:
      return problems?.length
        ? `Aprovação recusada (${reason}):\n${problems.map((p) => `• ${p}`).join("\n")}`
        : `Aprovação recusada (${reason}).`;
  }
}
