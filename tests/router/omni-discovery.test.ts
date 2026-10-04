/**
 * Descoberta de modelos verificados do OmniRoute + cascata do SmartRouter, contra um gateway
 * FALSO que reproduz o cenário real medido: combos `auto/*` lentos que terminam em 502,
 * provedor sem credencial (OpenCode, 402), provedor sem conexão no gateway, modelo que
 * responde 200 com conteúdo vazio, modelo lento e modelos bons com latências diferentes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import {
  ensureVerifiedOmniModels,
  getVerifiedOmniModels,
  resetOmniDiscovery,
  waitForOmniDiscovery,
} from "../../src/core/router/omni-model-discovery";

let server: http.Server;
let baseUrl: string;
const chatCalls: string[] = [];

const CATALOG = [
  { id: "auto/best-free", owned_by: "combo" },
  { id: "oc/muse-spark-1.2", owned_by: "opencode" },
  { id: "cxa/gpt-5.6-sol", owned_by: "codex-app-server" }, // provedor sem conexão no gateway
  { id: "openrouter/vazio:free", owned_by: "openrouter" },
  { id: "openrouter/lento:free", owned_by: "openrouter" },
  { id: "openrouter/rapido:free", owned_by: "openrouter" },
  { id: "openrouter/medio:free", owned_by: "openrouter" },
];

function reply(res: http.ServerResponse, status: number, body: unknown, delayMs = 0) {
  setTimeout(() => {
    if (res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }, delayMs);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/v1/models") return reply(res, 200, { data: CATALOG });
      if (req.url === "/api/providers") {
        return reply(res, 200, [
          { provider: "openrouter", isActive: true, testStatus: "active" },
          { provider: "opencode", isActive: true, testStatus: "unknown" },
        ]);
      }
      if (req.url === "/v1/chat/completions") {
        const model = JSON.parse(raw).model as string;
        chatCalls.push(model);
        const ok = (content: string, delay: number) =>
          reply(res, 200, { model, choices: [{ message: { role: "assistant", content } }] }, delay);
        switch (model) {
          case "auto/best-free":
            return reply(res, 502, { error: { message: "oc/muse-spark-1.2: [402] requires an opencode API key" } }, 400);
          case "oc/muse-spark-1.2":
            return reply(res, 402, { error: { message: "model requires an opencode API key" } });
          case "openrouter/vazio:free":
            return ok("", 10);
          case "openrouter/lento:free":
            return ok("function soma() {}", 3000);
          case "openrouter/rapido:free":
            return ok("function soma(a, b) { return a + b; }", 20);
          case "openrouter/medio:free":
            return ok("function soma(a, b) { return a + b; }", 120);
        }
        return reply(res, 404, { error: { message: "model not found" } });
      }
      reply(res, 404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  process.env.OMNIROUTE_DISCOVERY_PROBE_TIMEOUT_MS = "1500";
});

afterAll(() => {
  server.close();
  delete process.env.OMNIROUTE_DISCOVERY_PROBE_TIMEOUT_MS;
  delete process.env.OMNIROUTE_TIMEOUT_MS;
});

beforeEach(() => {
  resetOmniDiscovery();
  chatCalls.length = 0;
});

describe("omni-model-discovery", () => {
  it("só verifica modelos de provedores com conexão ativa que respondem com conteúdo, mais rápido primeiro", async () => {
    const config = { rootUrl: baseUrl, chatUrl: `${baseUrl}/v1/chat/completions`, apiKey: "k" };
    await ensureVerifiedOmniModels(config);
    // Espera a varredura em background terminar: o modelo lento (3s) estoura o timeout de
    // teste de 1,5s e fica fora da lista final.
    await waitForOmniDiscovery();

    expect(getVerifiedOmniModels().map((m) => m.id)).toEqual(["openrouter/rapido:free", "openrouter/medio:free"]);
    // Combo virtual e provedor sem conexão nunca são testados.
    expect(chatCalls).not.toContain("auto/best-free");
    expect(chatCalls).not.toContain("cxa/gpt-5.6-sol");
    // Provedor com conexão "ativa" mas sem credencial é testado e descartado (402).
    expect(chatCalls).toContain("oc/muse-spark-1.2");
    expect(chatCalls).toContain("openrouter/lento:free");
  });
});

describe("SmartRouter x descoberta", () => {
  it("usa o modelo verificado em vez do combo auto/* e responde", async () => {
    const { SmartRouter } = await import("../../src/core/router/smart-router");
    const result = await new SmartRouter().dispatchWithFallback({
      messages: [{ role: "user", content: "soma" }],
      tier: "fast",
      omniRouteUrl: baseUrl,
      omniRouteKey: "k",
      stream: false,
    });
    expect(result.providerUsed).toBe("omniroute");
    expect(["openrouter/rapido:free", "openrouter/medio:free"]).toContain(result.modelUsed);
    const payload = await result.response.json();
    expect(payload.choices[0].message.content).toContain("soma");
    expect(chatCalls.filter((m) => m === "auto/best-free")).toEqual([]);
  });

  it("modelo lento estoura o timeout POR MODELO e a cascata segue para o próximo (não abandona o gateway)", async () => {
    process.env.OMNIROUTE_MODEL = "openrouter/lento:free,openrouter/rapido:free";
    process.env.OMNIROUTE_TIMEOUT_MS = "500";
    try {
      const { SmartRouter } = await import("../../src/core/router/smart-router");
      const result = await new SmartRouter().dispatchWithFallback({
        messages: [{ role: "user", content: "soma" }],
        tier: "fast",
        omniRouteUrl: baseUrl,
        omniRouteKey: "k",
        stream: false,
      });
      expect(result.providerUsed).toBe("omniroute");
      expect(result.modelUsed).toBe("openrouter/rapido:free");
      expect(chatCalls).toEqual(["openrouter/lento:free", "openrouter/rapido:free"]);
    } finally {
      delete process.env.OMNIROUTE_MODEL;
      delete process.env.OMNIROUTE_TIMEOUT_MS;
    }
  });
});
