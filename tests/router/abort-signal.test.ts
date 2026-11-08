import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SmartRouter, type DispatchOptions } from "../../src/core/router/smart-router";
import type { GatewayConfig } from "../../src/core/llm/gateways";
import { MOCK_FREELLM_KEY } from "../helpers/mock-freellm-gateway";

/**
 * C5 — o guard de timeout da DAG propaga AbortSignal até os fetches dos provedores.
 */
describe("SmartRouter — AbortSignal real nos provedores (C5)", () => {
  let router: SmartRouter;
  const gateway: GatewayConfig = {
    id: "freellmapi",
    enabled: true,
    priority: 0,
    baseUrl: "http://localhost:3100/v1",
    apiKey: MOCK_FREELLM_KEY,
    modelFast: "auto",
    modelHeavy: "auto:smart",
  };

  beforeEach(() => {
    router = new SmartRouter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("repassa o signal para o fetch do gateway", async () => {
    const captured: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        captured.push(init);
        if (String(url).includes("/v1/chat/completions")) {
          return Promise.resolve(
            new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
              status: 200,
              headers: { "x-routed-via": "mock/model" },
            })
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      })
    );

    const controller = new AbortController();
    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Olá" }],
      stream: false,
      signal: controller.signal,
      gateways: [gateway],
    };

    const res = await router.dispatchWithFallback(options);
    expect(res.providerUsed).toBe("freellmapi");
    const chatCall = captured.find((_, i) => captured[i]?.method === "POST");
    expect(chatCall?.signal).toBeInstanceOf(AbortSignal);
    expect(chatCall?.signal?.aborted).toBe(false);
    controller.abort();
    expect(chatCall?.signal?.aborted).toBe(true);
  });

  it("falha imediatamente quando o signal já está abortado (sem hang)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const sig = init.signal;
        if (sig?.aborted) {
          return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
        }
        return new Promise((_resolve, reject) => {
          sig?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError"))
          );
        });
      })
    );

    const controller = new AbortController();
    controller.abort();

    const res = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "Olá" }],
      stream: false,
      signal: controller.signal,
      gateways: [gateway],
    });
    expect(res.providerUsed).toBe("none");
    expect(res.tierTag).toBe("exhausted");
  });
});
