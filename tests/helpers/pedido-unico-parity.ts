import { etapaBloqueadaPorPedidoUnicoSemResolucao } from "@/core/governance/pedido-unico";
import { pedidoUnicoAguardandoEscolha } from "@/lib/pedido-unico-ui";

export function painelCoerenteComPorteiroPedidoUnico(
  task: { payload?: string | null; result?: string | null; status?: string | null },
  canonicalSpecSessao?: string | null
): boolean {
  const marcado = etapaBloqueadaPorPedidoUnicoSemResolucao(task, canonicalSpecSessao);
  const uiMostraEscolha = pedidoUnicoAguardandoEscolha(task.result, task.payload, marcado);
  const uiMostraRetry =
    (task.status === "failed" || task.status === "blocked") && !uiMostraEscolha;
  if (marcado) return uiMostraEscolha && !uiMostraRetry;
  return !uiMostraEscolha;
}
