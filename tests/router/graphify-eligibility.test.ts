import { describe, it, expect, vi } from "vitest";

describe("SmartRouter.classifyGraphifyEligibility", () => {
  it("retorna eligible=true quando o modelo classifica o pedido como arquitetural", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"eligible":true,"reasoning":"pede mapa de arquitetura do projeto"}' } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    try {
      const { SmartRouter } = await import("../../src/core/router/smart-router");
      const router = new SmartRouter();
      const result = await router.classifyGraphifyEligibility(
        { prompt: "Como esse projeto está organizado? Quais módulos dependem de quais?" },
        { omniRouteUrl: "http://localhost:20128/v1", omniRouteKey: "k" }
      );
      expect(result).not.toBeNull();
      expect(result!.eligible).toBe(true);
      expect(result!.reasoning).toContain("arquitetura");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retorna eligible=false quando o modelo classifica como pedido pontual", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"eligible":false,"reasoning":"pergunta pontual sobre um arquivo"}' } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    try {
      const { SmartRouter } = await import("../../src/core/router/smart-router");
      const router = new SmartRouter();
      const result = await router.classifyGraphifyEligibility(
        { prompt: "corrige esse typo na linha 12 do arquivo utils.ts" },
        { omniRouteUrl: "http://localhost:20128/v1", omniRouteKey: "k" }
      );
      expect(result).not.toBeNull();
      expect(result!.eligible).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retorna null quando a resposta não é um JSON reconhecível (nunca quebra o chamador)", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "texto solto sem json" } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    );
    try {
      const { SmartRouter } = await import("../../src/core/router/smart-router");
      const router = new SmartRouter();
      const result = await router.classifyGraphifyEligibility(
        { prompt: "oi" },
        { omniRouteUrl: "http://localhost:20128/v1", omniRouteKey: "k" }
      );
      expect(result).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
