/**
 * O painel decide se mostra a escolha. Não importa prisma nem o porteiro.
 * O terceiro argumento vem do servidor, que relê o contrato da sessão.
 * Escolha gravada como resolvida só fica escondida quando esse contrato ainda cumpre o pedido.
 */
export function pedidoUnicoAguardandoEscolha(
  result?: string | null,
  payload?: string | null,
  marcadoPeloServidor?: boolean
): boolean {
  if (result) {
    try {
      const parsed = JSON.parse(result) as { erro?: string };
      if (parsed.erro === "SKILL_PEDIDO_UNICO_INVALIDA") return false;
    } catch {
      /* resultado ilegível: segue o payload e a marca do servidor */
    }
  }
  if (marcadoPeloServidor === false) return false;
  if (marcadoPeloServidor === true) return true;
  if (payload) {
    try {
      const estado = JSON.parse(payload)?.pedidoUnico as { status?: string } | undefined;
      if (estado?.status === "resolvido") return false;
    } catch {
      /* payload ilegível: cai no resultado da etapa */
    }
  }
  if (!result) return false;
  try {
    const parsed = JSON.parse(result) as { pedidoUnicoAguardandoDecisao?: boolean };
    return parsed.pedidoUnicoAguardandoDecisao === true;
  } catch {
    return false;
  }
}

/** A escolha já está no payload, mas o servidor diz que o contrato da sessão ainda não cumpre o pedido. */
export function pedidoUnicoEscolhaGravadaAindaAberta(
  payload?: string | null,
  marcadoPeloServidor?: boolean
): boolean {
  if (marcadoPeloServidor !== true || !payload) return false;
  try {
    const estado = JSON.parse(payload)?.pedidoUnico as
      | { status?: string; decisao?: string; decisaoNormalizada?: string }
      | undefined;
    const decisao = estado?.decisaoNormalizada ?? estado?.decisao;
    return estado?.status === "resolvido" && (decisao === "vale_criterio" || decisao === "vale o critério");
  } catch {
    return false;
  }
}
