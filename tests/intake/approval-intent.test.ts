import { describe, it, expect } from "vitest";
import { isExplicitSpecApproval, isNewSpecRequest } from "@/core/intake/approval-intent";

describe("Trava T1 — detecção de aprovação explícita da Spec", () => {
  it.each(["Aprovo a spec", "pode executar", "ok, aprovado. Iniciar DAG", "validar e aprovar"])(
    "aprova: %s",
    (text) => expect(isExplicitSpecApproval(text)).toBe(true)
  );

  it.each([
    "não vou aprovar ainda",
    "nao aprovo essa spec",
    "nunca disse que pode executar",
    "o que acontece se eu aprovar?",
    "reaprovarei depois",
    "desaprovado",
  ])("NÃO aprova: %s", (text) => expect(isExplicitSpecApproval(text)).toBe(false));
});

describe("Trava T1 — detecção de pedido de nova Spec", () => {
  it.each(["quero uma nova spec", "crie um dashboard", "reescreva a spec"])("é nova spec: %s", (text) =>
    expect(isNewSpecRequest(text)).toBe(true)
  );

  it.each(["melhore o aspecto do botão", "caso especial no respectivo campo"])("NÃO é nova spec: %s", (text) =>
    expect(isNewSpecRequest(text)).toBe(false)
  );
});
