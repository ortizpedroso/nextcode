/**
 * Pausas na conferência de entrada (Trava T1): não reprovam conteúdo, não gastam voltasConferencia.
 * Códigos estáveis para telemetria, API e UI — não inferir tipo pela string em português.
 */

export const ConferentePausaMsg = {
  LAUDO_JSON_INVALIDO: "O laudo do conferente não é um JSON válido.",
  LAUDO_VAZIO: "O conferente não devolveu o laudo.",
  MODELO_INDISPONIVEL: "O modelo do conferente não respondeu.",
} as const;

export type IntakePausaCodigo =
  | "CONFERENTE_LAUDO_JSON_INVALIDO"
  | "CONFERENTE_LAUDO_VAZIO"
  | "CONFERENTE_MODELO_INDISPONIVEL"
  | "MACROBRIEF_ILLEGIVEL"
  | "JEV_INCERTO_NAO_RESOLVIDO";

/** Motivo exposto em approveSpecAndStart / chat / modal. */
export type ApproveSpecPausaReason =
  | "CONFERENCIA_LLM_INDISPONIVEL"
  | "PERGUNTA_AO_HUMANO";

export function approveReasonFromIntakePausa(codigo: IntakePausaCodigo): ApproveSpecPausaReason {
  switch (codigo) {
    case "CONFERENTE_LAUDO_JSON_INVALIDO":
    case "CONFERENTE_LAUDO_VAZIO":
    case "CONFERENTE_MODELO_INDISPONIVEL":
      return "CONFERENCIA_LLM_INDISPONIVEL";
    case "MACROBRIEF_ILLEGIVEL":
    case "JEV_INCERTO_NAO_RESOLVIDO":
      return "PERGUNTA_AO_HUMANO";
    default: {
      const _exhaustive: never = codigo;
      return _exhaustive;
    }
  }
}

export function intakePausaCodigoFromConferenteMsg(msg: string): IntakePausaCodigo | null {
  if (msg === ConferentePausaMsg.LAUDO_JSON_INVALIDO) return "CONFERENTE_LAUDO_JSON_INVALIDO";
  if (msg === ConferentePausaMsg.LAUDO_VAZIO) return "CONFERENTE_LAUDO_VAZIO";
  if (msg === ConferentePausaMsg.MODELO_INDISPONIVEL) return "CONFERENTE_MODELO_INDISPONIVEL";
  return null;
}
