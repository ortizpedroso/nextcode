import { describe, it, expect } from "vitest";
import { classifyMessageDeterministic } from "@/core/orchestrator/message-intent";

describe("Perguntas sem verbo de mudança são dúvida avulsa (sem LLM)", () => {
  it.each([
    "o que o zod faz em nosso projeto?",
    "qual banco de dados vamos usar?",
    "isso funciona com o Asaas sandbox?",
  ])("%s", (text) => {
    expect(classifyMessageDeterministic(text, "SPEC_REVISAO")).toBe("duvida_avulsa");
  });

  it("pergunta que pede mudança não é decidida aqui (vai ao classificador)", () => {
    expect(classifyMessageDeterministic("pode adicionar login com Google?", "SPEC_REVISAO")).toBeNull();
  });
});
