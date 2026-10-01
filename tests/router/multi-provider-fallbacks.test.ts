import { describe, it, expect, vi, beforeEach } from "vitest";
import { SmartRouter, DispatchOptions } from "../../src/core/router/smart-router";

describe("SmartRouter Multi-Provider Fallbacks", () => {
  let router: SmartRouter;

  beforeEach(() => {
    router = new SmartRouter();
  });

  it("utiliza Groq Cloud direta quando selecionado via modelOverride ou em fallback", async () => {
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("api.groq.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Resposta via Groq Cloud" } }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Olá" }],
      groqKey: "gsk_test_groq_key_123",
      omniRouteUrl: "http://localhost:20128",
      stream: false,
    };

    const res = await router.dispatchWithFallback(options);
    expect(res.providerUsed).toBe("groq-fallback");
    expect(res.badge).toContain("Groq Cloud");
    expect(res.modelUsed).toBe("llama-3.3-70b-versatile");

    vi.unstubAllGlobals();
  });

  it("utiliza NVIDIA NIM direta quando selecionado via modelOverride ou em fallback", async () => {
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("integrate.api.nvidia.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Resposta via NVIDIA NIM" } }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Teste NVIDIA" }],
      nvidiaKey: "nvapi_test_key_456",
      omniRouteUrl: "http://localhost:20128",
      stream: false,
    };

    const res = await router.dispatchWithFallback(options);
    expect(res.providerUsed).toBe("nvidia-fallback");
    expect(res.badge).toContain("NVIDIA NIM");
    expect(res.modelUsed).toBe("meta/llama-3.3-70b-instruct");

    vi.unstubAllGlobals();
  });

  it("utiliza DeepSeek API direta quando selecionado via modelOverride ou em fallback", async () => {
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("api.deepseek.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Resposta via DeepSeek API" } }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const options: DispatchOptions = {
      messages: [{ role: "user", content: "Teste DeepSeek" }],
      deepseekKey: "sk-deepseek-test",
      omniRouteUrl: "http://localhost:20128",
      stream: false,
    };

    const res = await router.dispatchWithFallback(options);
    expect(res.providerUsed).toBe("deepseek-fallback");
    expect(res.badge).toContain("DeepSeek");
    expect(res.modelUsed).toBe("deepseek-chat");

    vi.unstubAllGlobals();
  });
});
