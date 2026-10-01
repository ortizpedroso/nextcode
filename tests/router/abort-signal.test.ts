import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SmartRouter, DispatchOptions } from "../../src/core/router/smart-router";

/**
 * C5 — o guard de timeout da DAG agora propaga um AbortSignal real até os
 * fetches dos provedores. Estes testes garantem (e evitam regressão) que:
 *  1. o signal chega ao fetch do OmniRoute (safeFetch repassa init.signal);
 *  2. um sinal já abortado faz o dispatch falhar imediatamente (sem hang);
 *  3. a cascata BYOK (Groq/NVIDIA/DeepSeek/Gemini) também recebe o signal.
 */
describe("SmartRouter — AbortSignal real nos provedores (C5)", () => {
  let router: SmartRouter;

  beforeEach(() => {
    router = new SmartRouter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("repassa o signal para o fetch do OmniRoute", async () => {
    const captured: RequestInit[] = [];
    const mockFetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      captured.push(init);
      if (String(url).includes("localhost:20128")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Olá" }],
      omniRouteUrl: "http://localhost:20128",
      stream: false,
      signal: controller.signal,
    };

    const res = await router.dispatchWithFallback(options);
    expect(res.providerUsed).toBe("omniroute");
    const omniCall = captured.find((c) => c.method === "POST");
    expect(omniCall?.signal).toBe(controller.signal);
  });

  it("falha imediatamente quando o signal já está abortado (sem hang)", async () => {
    const neverResolves = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          // comportamento de fetch real com signal abortado: rejeita com AbortError
          const sig = init.signal;
          if (sig?.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
          } else {
            sig?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted", "AbortError"))
            );
            // nunca resolve sozinho — prova que sem signal haveria hang
          }
        })
    );
    vi.stubGlobal("fetch", neverResolves);

    const controller = new AbortController();
    controller.abort();

    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Olá" }],
      omniRouteUrl: "http://localhost:20128",
      groqKey: "gsk_test_key",
      geminiKey: "AIza_test_key",
      stream: false,
      signal: controller.signal,
    };

    // deve resolver rápido (não travar): ou exaustão graciosa, ou erro propagado
    const start = Date.now();
    const outcome = await Promise.race([
      router.dispatchWithFallback(options).then((r) => ({ kind: "result", r })),
      new Promise((resolve) => setTimeout(() => resolve({ kind: "hang" }), 5000)),
    ]).catch((e) => ({ kind: "error", e }));
    const elapsed = Date.now() - start;

    expect(outcome.kind).not.toBe("hang");
    expect(elapsed).toBeLessThan(4500);
  });

  it("repassa o signal para as chamadas diretas Groq/NVIDIA/DeepSeek", async () => {
    const seen: Record<string, unknown> = {};
    const mockFetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      const u = String(url);
      if (u.includes("api.groq.com")) seen.groq = init.signal;
      if (u.includes("integrate.api.nvidia.com")) seen.nvidia = init.signal;
      if (u.includes("api.deepseek.com")) seen.deepseek = init.signal;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), {
          status: u.includes("groq") ? 200 : 503,
        })
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Olá" }],
      modelOverride: "deepseek", // força entrada na cascata direta sem OmniRoute válido
      omniRouteUrl: "http://localhost:20128",
      deepseekKey: "sk-test-deepseek",
      groqKey: "gsk-test-groq",
      nvidiaKey: "nvapi-test",
      stream: false,
      signal: controller.signal,
    };

    await router.dispatchWithFallback(options);
    // pelo menos uma chamada direta deve ter recebido exatamente o signal externo
    const signals = [seen.groq, seen.nvidia, seen.deepseek].filter(Boolean);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals).toContain(controller.signal);
  });
});
