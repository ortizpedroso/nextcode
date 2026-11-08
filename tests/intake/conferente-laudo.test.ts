import { describe, expect, it } from "vitest";
import { extractAssistantTextFromCompletion } from "@/core/llm/chat-completion-text";
import {
  extractJsonObject,
  parseConferenteLaudoFromCompletion,
  parseConferenteLaudoFromText,
} from "@/core/intake/conferente-laudo";

describe("conferente laudo", () => {
  it("parseia JSON puro e exige aprovado === true", () => {
    const raw = JSON.stringify({ aprovado: true, falhas: [], incertos: [] });
    const r = parseConferenteLaudoFromText(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.laudo.aprovado).toBe(true);
  });

  it("parseia JSON dentro de fence markdown", () => {
    const wrapped = "```json\n{\"aprovado\": false, \"falhas\": [], \"incertos\": []}\n```";
    const r = parseConferenteLaudoFromText(wrapped);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.laudo.aprovado).toBe(false);
  });

  it("rejeita prosa sem objeto", () => {
    expect(parseConferenteLaudoFromText("Aqui está minha análise…").ok).toBe(false);
    expect(() => extractJsonObject("sem chaves")).toThrow();
  });

  it("laudo via resposta OpenAI com content em partes", () => {
    const json = JSON.stringify({ aprovado: true, falhas: [], incertos: [] });
    const text = extractAssistantTextFromCompletion({
      choices: [{ message: { content: [{ type: "text", text: json }] } }],
    });
    const r = parseConferenteLaudoFromText(text);
    expect(r.ok).toBe(true);
  });

  it("parseia JSON com vírgula final e preâmbulo", () => {
    const wrapped =
      'Análise:\n```json\n{"aprovado": true, "falhas": [], "incertos": [],}\n```\nFim.';
    expect(parseConferenteLaudoFromText(wrapped).ok).toBe(true);
  });

  it("usa reasoning_content quando content está vazio", () => {
    const json = JSON.stringify({ aprovado: true, falhas: [], incertos: [] });
    const r = parseConferenteLaudoFromCompletion({
      choices: [{ message: { content: "", reasoning_content: json } }],
    });
    expect(r.ok).toBe(true);
  });

});
