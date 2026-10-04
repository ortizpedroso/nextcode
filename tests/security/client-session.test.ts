/**
 * Sessão local do navegador (client-session.ts): persistência do token entre reloads/abas
 * e consumo de SSE autenticado. Ambiente node → window/localStorage/fetch simulados.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MODULE = "../../src/lib/client-session";

function installWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:3001" }, localStorage });
  return store;
}

async function load() {
  vi.resetModules();
  return import(MODULE);
}

const KEY = "nextcode:session-token";

describe("client-session — token local persistente", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaproveita o token salvo após reload (não chama o bootstrap, que só entrega uma vez)", async () => {
    installWindow({ [KEY]: "tok-salvo" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return new Response(JSON.stringify({ token: headers.get("X-Nextcode-Token") }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const m = await load();
    const res = await m.authFetch("/api/sessions");

    expect(await res.json()).toEqual({ token: "tok-salvo" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sessions");
  });

  it("sem token salvo: faz bootstrap e persiste o token recebido", async () => {
    const store = installWindow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/api/auth/session")
          ? new Response(JSON.stringify({ token: "tok-novo" }), { status: 200 })
          : new Response("{}", { status: 200 })
      )
    );

    const m = await load();
    await m.authFetch("/api/dag?sessionId=1");
    expect(store.get(KEY)).toBe("tok-novo");
  });

  it("401 com token velho (servidor reiniciado) usa o token novo já salvo por outra aba, sem apagá-lo", async () => {
    const store = installWindow({ [KEY]: "tok-velho" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const token = new Headers(init?.headers).get("X-Nextcode-Token");
        if (url.endsWith("/api/auth/session")) return new Response("{}", { status: 403 });
        return new Response("{}", { status: token === "tok-novo" ? 200 : 401 });
      })
    );

    const m = await load();
    await m.getSessionToken(); // esta aba carregou "tok-velho" em memória
    store.set(KEY, "tok-novo"); // outra aba já fez o bootstrap no processo novo

    const res = await m.authFetch("/api/sessions");
    expect(res.status).toBe(200);
    expect(store.get(KEY)).toBe("tok-novo");
  });

  it("401 sem token novo disponível descarta o token salvo rejeitado", async () => {
    const store = installWindow({ [KEY]: "tok-velho" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/api/auth/session") ? new Response("{}", { status: 403 }) : new Response("{}", { status: 401 })
      )
    );

    const m = await load();
    const res = await m.authFetch("/api/sessions");
    expect(res.status).toBe(401);
    expect(store.has(KEY)).toBe(false);
  });
});

describe("client-session — authEventStream", () => {
  beforeEach(() => {
    installWindow({ [KEY]: "tok" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envia o token e entrega cada evento SSE, inclusive quando chega fatiado entre chunks", async () => {
    const chunks = [
      'event: log\ndata: {"type":"stdout","text":"ola"}\n\nevent: lo',
      'g\ndata: {"type":"stderr","text":"aviso"}\n\n',
      'event: done\ndata: {"exitCode":0}\n\n',
    ];
    let sentToken: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentToken = new Headers(init?.headers).get("X-Nextcode-Token");
        const body = new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      })
    );

    const m = await load();
    const events: Array<[string, unknown]> = [];
    await m.authEventStream("/api/terminal/stream?command=ls", (e: string, d: unknown) => events.push([e, d]));

    expect(sentToken).toBe("tok");
    expect(events).toEqual([
      ["log", { type: "stdout", text: "ola" }],
      ["log", { type: "stderr", text: "aviso" }],
      ["done", { exitCode: 0 }],
    ]);
  });

  it("lança erro legível quando a rota recusa (ex.: 403 do Jail Guard)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Comando Proibido (Jail Guard)" }), { status: 403 }))
    );
    const m = await load();
    await expect(m.authEventStream("/api/terminal/stream?command=rm", () => {})).rejects.toThrow("Jail Guard");
  });
});
