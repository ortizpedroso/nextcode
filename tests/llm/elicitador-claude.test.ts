import { describe, it, expect, afterEach, vi } from "vitest";
import { callElicitadorClaude } from "@/core/llm/elicitador-claude";

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `event: message\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function sseResponseFromChunks(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("P5c.1 / P5c.3 — Elicitador Claude direto para a Spec (streaming)", () => {
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

  it("(a) Sucesso com normalização de mensagens, system, stream e usage", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers || {};
      capturedBody = JSON.parse(init?.body || "{}");

      return sseResponse([
        {
          type: "message_start",
          message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 9000, cache_creation_input_tokens: 700 } },
        },
        { type: "ping" },
        { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "pensamento" },
        },
        { type: "content_block_start", index: 1, content_block: { type: "text" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "---\n" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Spec" } },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 50 },
        },
        { type: "message_stop" },
      ]);
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
    expect(res.usage).toMatchObject({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9000, cache_creation_input_tokens: 700 });
    expect(res.stopReason).toBe("end_turn");
    expect(res.ms).toBeGreaterThanOrEqual(0);

    expect(capturedUrl).toContain("api.anthropic.com/v1/messages");
    expect(capturedHeaders["x-api-key"]).toBe(fakeClaudeKey);
    expect(capturedBody.max_tokens).toBe(48000);
    expect(capturedBody.stream).toBe(true);
    // Mudança 29: corte explícito na skill + cache automático no topo (o corte anda com a conversa).
    expect(capturedBody.cache_control).toEqual({ type: "ephemeral" });
    expect(capturedBody.system).toEqual([{ type: "text", text: "S1\n\nS2", cache_control: { type: "ephemeral" } }]);
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
      return sseResponse([
        { type: "content_block_delta", delta: { type: "text_delta", text: "OK" } },
      ]);
    });

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });

    expect(res.ok).toBe(true);
    expect(capturedBody.model).toBe("claude-teste-x");
  });

  it("(e) stream só com thinking_delta → ok: false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "apenas pensando" },
        },
      ])
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

  it("(g) evento error no stream → ok: false e detail contém Overloaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        },
      ])
    );

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("Overloaded");
  });

  it("(h) text_delta com JSON partido entre dois chunks do stream", async () => {
    const event =
      'event: message\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"AB"}}\n\n';
    const part1 = event.slice(0, 28);
    const part2 = event.slice(28);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponseFromChunks([part1, part2]));

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("AB");
  });

  it("(i) eventos com \\r\\n → mesmo resultado do (a) simplificado", async () => {
    const body =
      'event: message\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"X"}}\r\n\r\n';
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
    );

    const res = await callElicitadorClaude({
      messages: [{ role: "user", content: "olá" }],
      claudeKey: fakeClaudeKey,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("X");
  });
});
