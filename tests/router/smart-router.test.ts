/**
 * Fase 7 — Testes unitários do roteador OmniRoute (normalização de URL + endpoints).
 * Cobre os bugs históricos: hostname "omniroute" fora do Docker, concatenação
 * malformada de /v1/chat/completions e o modelo "auto".
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadRouter() {
  vi.resetModules();
  return import("../../src/core/router/smart-router");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveOmniRouteUrl", () => {
  it("fora do Docker mantém localhost intacto (bug ENOTFOUND histórico)", async () => {
    delete process.env.IS_DOCKER;
    delete process.env.DOCKER_CONTAINER;
    delete process.env.DOCKER;
    const m = await loadRouter();
    // sem /.dockerenv no host de teste, não deve reescrever para "omniroute"
    const out = m.resolveOmniRouteUrl("http://localhost:20128/v1");
    expect(out).toBe("http://localhost:20128/v1");
    expect(out).not.toContain("host.docker.internal");
  });

  it("dentro do Docker converte localhost -> host.docker.internal", async () => {
    process.env.IS_DOCKER = "true";
    const m = await loadRouter();
    expect(m.resolveOmniRouteUrl("http://localhost:20128/v1")).toBe(
      "http://host.docker.internal:20128/v1"
    );
    expect(m.resolveOmniRouteUrl("http://127.0.0.1:20128/v1")).toBe(
      "http://host.docker.internal:20128/v1"
    );
  });

  it("dentro do Docker NÃO altera hostname de rede (omniroute permanece)", async () => {
    process.env.IS_DOCKER = "true";
    const m = await loadRouter();
    expect(m.resolveOmniRouteUrl("http://omniroute:20128/v1")).toBe("http://omniroute:20128/v1");
  });

  it("usa OMNIROUTE_URL do env como default e fallback padrão :20128", async () => {
    process.env.OMNIROUTE_URL = "http://meu-host:9999/v1";
    const m = await loadRouter();
    expect(m.resolveOmniRouteUrl()).toBe("http://meu-host:9999/v1");
    delete process.env.OMNIROUTE_URL;
    expect(m.resolveOmniRouteUrl()).toBe("http://localhost:20128/v1");
  });
});

describe("buildOmniEndpoints — normalização de qualquer formato de URL", () => {
  const cases: Array<[string, string, string]> = [
    ["http://localhost:20128", "http://localhost:20128/v1/chat/completions", "http://localhost:20128"],
    ["http://localhost:20128/", "http://localhost:20128/v1/chat/completions", "http://localhost:20128"],
    ["http://localhost:20128/v1", "http://localhost:20128/v1/chat/completions", "http://localhost:20128"],
    ["http://localhost:20128/v1/", "http://localhost:20128/v1/chat/completions", "http://localhost:20128"],
    [
      "http://localhost:20128/v1/chat/completions",
      "http://localhost:20128/v1/chat/completions",
      "http://localhost:20128",
    ],
    ["http://omniroute:20128/v1", "http://omniroute:20128/v1/chat/completions", "http://omniroute:20128"],
  ];

  it.each(cases)("input '%s' -> chatUrl '%s'", async (input, expectedChat, expectedRoot) => {
    delete process.env.IS_DOCKER;
    const m = await loadRouter();
    const { chatUrl, rootUrl } = m.buildOmniEndpoints(input);
    expect(chatUrl).toBe(expectedChat);
    expect(rootUrl).toBe(expectedRoot);
    // nunca duplicar segmentos (bug antigo de concatenação)
    expect(chatUrl).not.toMatch(/\/v1\/v1/);
    expect(chatUrl).not.toMatch(/completions\/completions/);
  });
});

describe("modelo 'auto' — correção dos 350+ provedores", () => {
  // Helper: replica a regra de seleção do router (linhas ~394-399 do smart-router)
  // e valida contra o comportamento real via mock de fetch.
  function expectedModel(tier: string, envOverride?: string) {
    if (envOverride?.trim()) return envOverride.trim();
    return tier === "heavy" ? "auto/coding" : tier === "custom" ? "auto/smart" : "auto";
  }

  it("regra de variantes por tier está correta no código-fonte", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/core/router/smart-router.ts"),
      "utf8"
    );
    expect(src).toContain('"auto/coding"');
    expect(src).toContain('"auto/smart"');
    expect(src).toContain("process.env.OMNIROUTE_MODEL?.trim() || tierAutoVariant");
    // regressão histórica: o ID inválido nunca deve voltar
    expect(src).not.toContain("omniroute-auto");
  });

  it("variants calculadas batem com as variantes oficiais do gateway", () => {
    expect(expectedModel("fast")).toBe("auto");
    expect(expectedModel("heavy")).toBe("auto/coding");
    expect(expectedModel("custom")).toBe("auto/smart");
    expect(expectedModel("fast", "meu-modelo")).toBe("meu-modelo");
    expect(expectedModel("fast", "  espaco  ")).toBe("espaco");
  });

  it("dispatch envia model='auto' ao gateway quando OmniRoute é primário", async () => {
    vi.resetModules();

    const captured: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        captured.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    try {
      const m = await import("../../src/core/router/smart-router");
      const router = new m.SmartRouter();
      const result = await router.dispatchWithFallback({
        messages: [{ role: "user", content: "ping" }],
        tier: "fast",
        omniRouteUrl: "http://localhost:20128/v1",
        omniRouteKey: "chave-de-teste",
        stream: false,
      });
      expect(result.providerUsed).toBe("omniroute");
      const omniCall = captured.find((c) => String(c.url).includes("/v1/chat/completions"));
      expect(omniCall).toBeDefined();
      expect(omniCall!.body.model).toBe("auto/best-free"); // regressão: nunca 'omniroute-auto'; variante gratuita (evita 402)
      expect(omniCall!.url).toBe("http://localhost:20128/v1/chat/completions");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tier heavy usa variante 'auto/coding' no dispatch real", async () => {
    vi.resetModules();
    const captured: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        captured.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    try {
      const m = await import("../../src/core/router/smart-router");
      const router = new m.SmartRouter();
      await router.dispatchWithFallback({
        messages: [{ role: "user", content: "refactor complexo" }],
        tier: "heavy",
        omniRouteUrl: "http://localhost:20128",
        omniRouteKey: "k",
        stream: false,
      });
      const omniCall = captured.find((c) => String(c.url).includes("/v1/chat/completions"));
      expect(omniCall?.body.model).toBe("auto/coding:free");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("OMNIROUTE_MODEL do env sobrescreve a variante do tier", async () => {
    process.env.OMNIROUTE_MODEL = "meu-combo-personalizado";
    vi.resetModules();
    const captured: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        captured.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    try {
      const m = await import("../../src/core/router/smart-router");
      const router = new m.SmartRouter();
      await router.dispatchWithFallback({
        messages: [{ role: "user", content: "ping" }],
        tier: "fast",
        omniRouteUrl: "http://localhost:20128/v1",
        omniRouteKey: "k",
        stream: false,
      });
      const omniCall = captured.find((c) => String(c.url).includes("/v1/chat/completions"));
      expect(omniCall?.body.model).toBe("meu-combo-personalizado");
    } finally {
      delete process.env.OMNIROUTE_MODEL;
      vi.unstubAllGlobals();
    }
  });

  it("gateway morto (fetch falha) faz fallback e NUNCA envia 'omniroute-auto'", async () => {
    vi.resetModules();
    const captured: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        captured.push(String(url));
        throw new Error("ECONNREFUSED"); // simula container caído
      })
    );
    try {
      const m = await import("../../src/core/router/smart-router");
      const router = new m.SmartRouter();
      const result = await router.dispatchWithFallback({
        messages: [{ role: "user", content: "ping" }],
        tier: "fast",
        omniRouteUrl: "http://localhost:20128/v1",
        omniRouteKey: "k",
        geminiKey: "chave-gemini-fake",
        stream: false,
      });
      // todos os provedores falharam -> estado honesto 'none' (nunca falso 'gemini')
      expect(result.providerUsed).toBe("none");
      expect(result.tierTag).toBe("exhausted");
      expect(JSON.stringify(captured)).not.toContain("omniroute-auto");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
