import type { IntakePausaCodigo } from "@/core/intake/intake-pause";

/** Mensagens de recusa da Trava T1 (modal e chat). */
export function messageForApproveSpecFailure(
  reason: string,
  problems?: string[],
  opts?: { pausaCodigo?: IntakePausaCodigo }
): string {
  const codigo = opts?.pausaCodigo;
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
    case "CONFERENCIA_LLM_INDISPONIVEL":
      return messageForConferenciaInfraPausa(codigo, problems);
    case "PERGUNTA_AO_HUMANO":
      return messageForPerguntaAoHumano(codigo, problems);
    case "CONFERENCIA_REPROVADA":
      return (
        "A conferência Spec × Macrobrief reprovou. Corrija e tente de novo:\n" +
        (problems ?? []).map((p) => `• ${p}`).join("\n")
      );
    case "PLANO_REPROVADO":
      return (
        "O **plano de execução** (T8b do analista) reprovou — **não** é a conferência Spec×Macrobrief. " +
        "A Spec pode estar correta: leia os itens abaixo, ajuste só o que for necessário e **aprove de novo** em Spec T1.\n" +
        (problems ?? []).map((p) => `• ${p}`).join("\n")
      );
    case "CONCURRENT_PHASE_CHANGED":
      return (
        "A aprovação desta Spec já está em andamento (a fase mudou enquanto este pedido corria). " +
        "Espere o analista terminar. Não é preciso aprovar de novo, e a Trava T1 continua pendente até a execução."
      );
    case "SESSAO_BLOQUEADA":
      return (
        (problems ?? []).join("\n") ||
        "A sessão está bloqueada. Use Retomar ou Re-tentar no painel DAG antes de aprovar a Spec."
      );
    default:
      return problems?.length
        ? `Aprovação recusada (${reason}):\n${problems.map((p) => `• ${p}`).join("\n")}`
        : `Aprovação recusada (${reason}).`;
  }
}

/** Pausa operacional: laudo não parseado — §4.3.1 / D-M10 em docs/NEXTCODE-REFERENCIA.md */
function messageForConferenciaInfraPausa(codigo: IntakePausaCodigo | undefined, problems?: string[]): string {
  const detalhe = (problems ?? []).map((p) => `• ${p}`).join("\n");
  switch (codigo) {
    case "CONFERENTE_LAUDO_JSON_INVALIDO":
      return (
        "Tratamento: **pausa operacional** na conferência de entrada — o modelo respondeu, mas **fora do contrato** (objeto JSON com `aprovado`, `falhas`, `incertos`). " +
        "Não reprova a Spec, não consome as 3 voltas do elicitador e **não** pede exceção de cluster.\n" +
        "Ação: confira em Configurações o **tier heavy** (Gemini/FreeLLMAPI) e se o gateway não está truncando a resposta; o NextCode já tenta **2 vezes** e lê JSON em `content` ou `reasoning`. Depois **aprovar de novo** sem alterar a Spec.\n" +
        detalhe
      );
    case "CONFERENTE_LAUDO_VAZIO":
      return (
        "Tratamento: **pausa operacional** — o conferente não devolveu texto utilizável. " +
        "Não é lacuna de cluster nem falha de conteúdo do Macrobrief.\n" +
        "Ação: verificar gateway/modelo forte (Settings) e log do servidor; aprovar de novo.\n" +
        detalhe
      );
    case "CONFERENTE_MODELO_INDISPONIVEL":
      return (
        "Tratamento: **pausa operacional** — chamada ao modelo forte falhou (sem resposta ou exceção). " +
        "Não reprova a Spec nem consome voltas de conferência.\n" +
        "Ação: gateway, chaves e disponibilidade do tier heavy; aprovar de novo.\n" +
        detalhe
      );
    default:
      return (
        "Tratamento: **pausa operacional** na conferência de entrada (não reprovação de Spec).\n" +
        detalhe
      );
  }
}

function messageForPerguntaAoHumano(codigo: IntakePausaCodigo | undefined, problems?: string[]): string {
  const list = problems ?? [];
  const detalhe = list.map((p) => `• ${p}`).join("\n");
  if (codigo === "JEV_INCERTO_NAO_RESOLVIDO") {
    return (
      "Tratamento: **ambiguidade** sinalizada pelo conferente — o Jev não fechou os incertos. " +
      "Responda no chat com clareza; **não** é exceção de cluster salvo o texto pedir lacuna.\n" +
      detalhe
    );
  }
  if (codigo === "MACROBRIEF_ILLEGIVEL") {
    return (
      "Tratamento: **pausa** — Macrobrief ilegível ou vazio (elicitador). " +
      "Peça regeneração do Macrobrief no chat; não nomeie cluster por causa desta mensagem.\n" +
      detalhe
    );
  }
  if (list.some((p) => /\[.*\]|cluster|lacuna/i.test(p))) {
    return (
      "Tratamento: **confirmação humana** (ex.: lacuna de cluster). " +
      "Responda no chat, nomeando cluster (core, backend, frontend, integration) se for exceção.\n" +
      detalhe
    );
  }
  return "Tratamento: **confirmação humana** antes de seguir.\n" + detalhe;
}
