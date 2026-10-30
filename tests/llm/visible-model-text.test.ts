import { describe, it, expect } from "vitest";
import { textoVisivelDaResposta } from "@/core/llm/visible-model-text";

describe("textoVisivelDaResposta (item 3)", () => {
  it("content preenchido → devolve esse texto", () => {
    const res = textoVisivelDaResposta({
      content: "Olá, aqui está o resultado.",
      reasoning_content: "Pensando na resposta...",
    });
    expect(res).toBe("Olá, aqui está o resultado.");
  });

  it("content vazio e reasoning_content preenchido → null", () => {
    const resVazio = textoVisivelDaResposta({
      content: "",
      reasoning_content: "Raciocínio interno confidencial",
    });
    expect(resVazio).toBeNull();

    const resEspacos = textoVisivelDaResposta({
      content: "   \n  \t ",
      reasoning_content: "Raciocínio interno confidencial",
    });
    expect(resEspacos).toBeNull();
  });

  it("mensagem ausente → null", () => {
    expect(textoVisivelDaResposta(null)).toBeNull();
    expect(textoVisivelDaResposta(undefined)).toBeNull();
    expect(textoVisivelDaResposta({})).toBeNull();
    expect(textoVisivelDaResposta({ content: null })).toBeNull();
  });
});
