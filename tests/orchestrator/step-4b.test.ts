import { describe, it, expect, afterEach, vi } from "vitest";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { classifyMessage } from "@/core/orchestrator/message-intent";

function makeFakeDispatchResult(content: string): DispatchResult {
  return {
    response: new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ),
    providerUsed: "omniroute",
    badge: "OmniRoute",
    tierTag: "omniroute",
    modelUsed: "fake-fast-model",
  };
}

describe("Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("9. Classificação: mensagem que as regras decidem → 0 chamadas ao LLM; mensagem ambígua com LLM falso que demora 10 s → 'incerto' em menos de 3,5 s", async () => {
    const spy = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");

    // 9a. Regras determinísticas: status, criar_novo, corrigir_existente, duvida_avulsa, mudanca_durante_execucao
    expect(await classifyMessage("qual o status?", "EXECUCAO")).toBe("status");
    expect(await classifyMessage("o que falta implementar?", "ENTREGUE")).toBe("status");
    expect(await classifyMessage("Todas as páginas foram concluídas?", "EXECUCAO")).toBe("status");
    expect(await classifyMessage("como está o andamento?", "EXECUCAO")).toBe("status");
    expect(await classifyMessage("terminou?", "EXECUCAO")).toBe("status");
    expect(
      await classifyMessage(
        "Pode detalhar como será feita a validação dos campos do cartão?",
        "SPEC_REVISAO"
      )
    ).toBe("duvida_avulsa");
    expect(await classifyMessage("Criar um módulo de checkout com PIX", "ENTRADA")).toBe(
      "criar_novo"
    );
    expect(await classifyMessage("Corrigir o bug no cálculo de juros", "ENTRADA")).toBe(
      "corrigir_existente"
    );
    expect(
      await classifyMessage("Adicionar também o campo de cupom de desconto", "EXECUCAO")
    ).toBe("mudanca_durante_execucao");

    // Nenhuma chamada ao LLM nas mensagens decididas pelas regras
    expect(spy).toHaveBeenCalledTimes(0);

    // 9b. Mensagem ambígua com LLM falso que demora 10 s -> 'incerto' em menos de 3,5 s
    spy.mockImplementationOnce(async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 10_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        });
      });
      return makeFakeDispatchResult('{"intencao":"criar_novo"}');
    });

    const startedAt = Date.now();
    const resultSlow = await classifyMessage("hmm talvez algo assim", "ENTRADA");
    const elapsedMs = Date.now() - startedAt;

    expect(resultSlow).toBe("incerto");
    expect(elapsedMs).toBeLessThan(3500);
    expect(spy).toHaveBeenCalledTimes(1);

    // 9c. Mensagem ambígua com JSON inválido do LLM -> 'incerto'
    spy.mockImplementationOnce(async () => makeFakeDispatchResult("não sei dizer"));
    expect(await classifyMessage("olá", "ENTRADA")).toBe("incerto");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
