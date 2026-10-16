import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { callElicitadorClaude } from "@/core/llm/elicitador-claude";

describe("P5c.1 — Elicitador Claude direto para a Spec", () => {
  // Montado em tempo de execução conforme Trava T-G
  const fakeClaudeKey = "sk-ant-" + "api03-" + "teste-p5c-key-xyz987";
  const prevModelEnv = process.env.ELICITADOR_CLAUDE_MODEL;

  afterEach(() => {
    if (prevModelEnv === undefined) {
      delete process.env.ELICITADOR_CLAUDE_MODEL;
    } else {
      process.env.ELICITADOR_CLAUDE_MODEL = prevModelEnv;
    }
    vi.restoreAllMocks();
  });

  it("(a) Sucesso com normalização de mensagens, system e descarte de assistant inicial", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers || {};
      capturedBody = JSON.parse(init?.body || "{}");

      return new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [
            { type: "thinking", thinking: "pensamento do modelo" },
            { type: "text", text: "---\nSpec" },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const res = await callElicitadorClaude({
      messages: [
        { role: "system", content: "S1" },
        { role: "system", content: "S2" },
        { role: "assistant", content: "A0" },
        { role: "user", content: "U1" },
        { role: "user", content: "U2" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "U3" },
      ],
      claudeKey: fakeClaudeKey,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.text).toBe("---\nSpec");
    expect(res.model).toBe("claude-opus-5-5");
    expect(res.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(res.stopReason).toBe("end_turn");
    expect(res.ms).toBeGreaterThanOrEqual(0);

    expect(capturedUrl).toContain("api.anthropic.com/v1/messages");
    expect(capturedHeaders["x-api-key"]).toBe(fakeClaudeKey);
    expect(capturedBody.max_tokens).toBe(48000);
    expect(capturedBody.system).toBe("S1\n\nS2");
    expect(capturedBody.messages).toEqual([
      { role: "user", content: "U1\n\nU2" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U3" },
    ]);
  });

  it("(b) HTTP 529 → ok: false e detail contém '529'; não lança", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } }), {
        status: 529,
        headers: { "content-type": "application/json" },
      })
    );

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).toContain("529");
  });

  it("(c) Chave vazia e chave '••••abc' → ok: false e fetch não chamado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const resVazia = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: "",
    });
    expect(resVazia.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const resMascara = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: "••••abc",
    });
    expect(resMascara.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const resAsteriscos = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: "****abc",
    });
    expect(resAsteriscos.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("(d) process.env.ELICITADOR_CLAUDE_MODEL = 'claude-teste-x' → corpo com model === 'claude-teste-x'", async () => {
    process.env.ELICITADOR_CLAUDE_MODEL = "claude-teste-x";

    let capturedBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init?.body || "{}");
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "OK" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });

    expect(res.ok).toBe(true);
    expect(capturedBody.model).toBe("claude-teste-x");
  });

  it("(e) 200 só com bloco thinking → ok: false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: "thinking", thinking: "apenas pensando sem texto" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).toContain("resposta sem texto");
  });

  it("(f) Em nenhum caso a chave falsa aparece em detail", async () => {
    // 1. Simula erro HTTP que ecoa a chave
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`Erro com chave ${fakeClaudeKey}`, {
        status: 401,
        headers: { "content-type": "text/plain" },
      })
    );

    const resHttp = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });
    expect(resHttp.ok).toBe(false);
    if (!resHttp.ok) {
      expect(resHttp.detail).not.toContain(fakeClaudeKey);
    }

    // 2. Simula exceção lançada que ecoa a chave
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`Falha de conexão com ${fakeClaudeKey}`));
    const resEx = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });
    expect(resEx.ok).toBe(false);
    if (!resEx.ok) {
      expect(resEx.detail).not.toContain(fakeClaudeKey);
    }
  });
});
