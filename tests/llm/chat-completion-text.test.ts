import { describe, it, expect } from "vitest";
import {
  extractAssistantTextFromCompletion,
  completionFinishReason,
  coerceAssistantContent,
} from "@/core/llm/chat-completion-text";

describe("extractAssistantTextFromCompletion", () => {
  it("prefere message.content", () => {
    expect(
      extractAssistantTextFromCompletion({
        choices: [{ message: { content: '{"aprovado":true}', reasoning_content: "pensando" } }],
      })
    ).toBe('{"aprovado":true}');
  });

  it("não usa reasoning_content quando content está vazio", () => {
    expect(
      extractAssistantTextFromCompletion({
        choices: [{ message: { content: null, reasoning_content: '{"aprovado":false,"falhas":[]}' } }],
      })
    ).toBe("");
  });

  it("usa candidates Gemini", () => {
    expect(
      extractAssistantTextFromCompletion({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      })
    ).toBe("ok");
  });

  it("usa choices[0].text legado", () => {
    expect(
      extractAssistantTextFromCompletion({
        choices: [{ text: "legacy" }],
      })
    ).toBe("legacy");
  });

  it("finish_reason", () => {
    expect(completionFinishReason({ choices: [{ finish_reason: "length" }] })).toBe("length");
  });

  it("content como array de partes OpenAI", () => {
    expect(
      extractAssistantTextFromCompletion({
        choices: [{ message: { content: [{ type: "text", text: "---\ndocumento: macrobrief" }] } }],
      })
    ).toBe("---\ndocumento: macrobrief");
    expect(coerceAssistantContent([{ text: "a" }, { text: "b" }])).toBe("a\nb");
  });
});
