/**
 * Gateways LLM: ordem, classificação de falha, passagem ao próximo
 * gateway e diagnóstico real — com servidores HTTP falsos de FreeLLMAPI e DeepSeek.
 * O desenho está em docs/NEXTCODE-REFERENCIA.md.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import prisma from "@/lib/prisma";
import { SmartRouter } from "@/core/router/smart-router";
import {
  classifyProviderOutage,
  classifyStatus,
  providerResetWaitMs,
  probeGateway,
  resetGatewayState,
  saveGatewayConfig,
  type GatewayConfig,
} from "@/core/llm/gateways";

type Mode = "ok" | "exhausted" | "auth";

let freeMode: Mode = "ok";
let freeChatCalls: { model: string; auth: string | undefined }[] = [];
let deepChatCalls: { model: string }[] = [];
let freeServer: http.Server;
let deepServer: http.Server;
let freeUrl = "";
let deepUrl = "";
const FREE_KEY = "freellmapi-test-key";

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, () => resolve(`http://localhost:${(server.address() as AddressInfo).port}`))
  );
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

let originalSetting: Awaited<ReturnType<typeof prisma.setting.findUnique>> = null;

beforeAll(async () => {
  freeServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/api/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }
    const auth = req.headers.authorization;
    if (req.url === "/v1/models") {
      const ok = auth === `Bearer ${FREE_KEY}`;
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      return res.end(JSON.stringify(ok ? { data: [{ id: "auto" }] } : { error: { message: "Invalid API key" } }));
    }
    if (req.url === "/v1/chat/completions") {
      freeChatCalls.push({ model: body.model, auth });
      if (freeMode === "exhausted") {
        res.writeHead(503, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "All providers exhausted" } }));
      }
      if (freeMode === "auth" || auth !== `Bearer ${FREE_KEY}`) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      }
      res.writeHead(200, { "content-type": "application/json", "x-routed-via": "groq/llama-3.3-70b-versatile" });
      return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok via free" } }] }));
    }
    res.writeHead(404);
    res.end();
  });
  freeUrl = await listen(freeServer);
  deepServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "deepseek-chat" }] }));
    }
    if (req.url === "/v1/chat/completions") {
      deepChatCalls.push({ model: body.model });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok via deep" } }] }));
    }
    res.writeHead(404);
    res.end();
  });
  deepUrl = await listen(deepServer);
  originalSetting = await prisma.setting.findUnique({ where: { id: "default" } });
});

afterAll(async () => {
  await prisma.llmGateway.deleteMany({});
  if (originalSetting) {
    const { id, ...rest } = originalSetting;
    await prisma.setting.update({ where: { id }, data: rest });
  }
  resetGatewayState();
  await new Promise<void>((r) => freeServer.close(() => r()));
  await new Promise<void>((r) => deepServer.close(() => r()));
});

beforeEach(async () => {
  freeMode = "ok";
  freeChatCalls = [];
  deepChatCalls = [];
  await prisma.llmGateway.deleteMany({});
  resetGatewayState();
});

const freeGw = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => ({
  id: "freellmapi",
  enabled: true,
  priority: 0,
  baseUrl: `${freeUrl}/v1`,
  apiKey: FREE_KEY,
  modelFast: "auto",
  modelHeavy: "auto:smart",
  ...overrides,
});
const deepGw = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => ({
  id: "deepseek",
  enabled: true,
  priority: 1,
  baseUrl: `${deepUrl}/v1`,
  apiKey: "sk-deep-test",
  modelFast: "deepseek-chat",
  modelHeavy: "deepseek-chat",
  ...overrides,
});
const messages = [{ role: "user" as const, content: "oi" }];

describe("Gateways LLM — ordem e passagem ao próximo", () => {
  it("FreeLLMAPI primeiro: atende, informa quem serviu (X-Routed-Via) e o DeepSeek nem é chamado", async () => {
    const res = await new SmartRouter().dispatchWithFallback({
      messages,
      stream: false,
      gateways: [freeGw(), deepGw()],
    });
    expect(res.providerUsed).toBe("freellmapi");
    expect(res.modelUsed).toBe("groq/llama-3.3-70b-versatile");
    expect(res.badge).toContain("FreeLLMAPI");
    expect(freeChatCalls).toEqual([{ model: "auto", auth: `Bearer ${FREE_KEY}` }]);
    expect(deepChatCalls).toHaveLength(0);
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe("ok via free");
  });

  it("tier heavy usa o modelo pesado do gateway", async () => {
    await new SmartRouter().dispatchWithFallback({
      messages,
      tier: "heavy",
      stream: false,
      gateways: [freeGw(), deepGw()],
    });
    expect(freeChatCalls[0].model).toBe("auto:smart");
  });

  it("FreeLLMAPI esgotado (503) → DeepSeek atende, e a falha vai para a telemetria classificada", async () => {
    freeMode = "exhausted";
    const before = new Date(Date.now() - 1);
    const res = await new SmartRouter().dispatchWithFallback({
      messages,
      stream: false,
      gateways: [freeGw(), deepGw()],
    });
    expect(res.providerUsed).toBe("deepseek");
    expect(freeChatCalls).toHaveLength(1);
    expect(deepChatCalls).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    const logs = await prisma.telemetryLog.findMany({
      where: { action: "llm.gateway_failure", createdAt: { gte: before } },
    });
    expect(logs.some((l) => JSON.parse(l.details!).kind === "exhausted")).toBe(true);
  });

  it("FreeLLMAPI fora do ar (conexão recusada) → DeepSeek atende", async () => {
    const res = await new SmartRouter().dispatchWithFallback({
      messages,
      stream: false,
      gateways: [freeGw({ baseUrl: "http://localhost:1/v1" }), deepGw()],
    });
    expect(res.providerUsed).toBe("deepseek");
    expect(deepChatCalls).toHaveLength(1);
  });



});

describe("Gateways LLM — rotas nativas (BYOK direto) depois do agregador", () => {
  const groqHit = () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.groq.com")) {
        calls.push(url);
        return new Response(JSON.stringify({ choices: [{ message: { content: "via groq" } }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    return { calls, restore: () => (globalThis.fetch = realFetch) };
  };

  it("FreeLLMAPI no ar mas esgotado → rotas nativas são puladas (não somam minutos com modelos fixos)", async () => {
    freeMode = "exhausted";
    const g = groqHit();
    try {
      const res = await new SmartRouter().dispatchWithFallback({
        messages,
        stream: false,
        groqKey: "gsk_teste",
        gateways: [freeGw()],
      });
      expect(g.calls).toHaveLength(0);
      expect(res.providerUsed).toBe("none");
    } finally {
      g.restore();
    }
  });

  it("FreeLLMAPI fora do ar (rede) → rotas nativas continuam como reserva", async () => {
    const g = groqHit();
    try {
      const res = await new SmartRouter().dispatchWithFallback({
        messages,
        stream: false,
        groqKey: "gsk_teste",
        gateways: [freeGw({ baseUrl: "http://localhost:1/v1" })],
      });
      expect(g.calls.length).toBeGreaterThan(0);
      expect(res.providerUsed).toBe("groq-fallback");
    } finally {
      g.restore();
    }
  });
});

describe("Gateways LLM — classificação e diagnóstico real", () => {
  it("classifica status como o opencode: chave, requisição inválida ou esgotado", () => {
    expect(classifyStatus(401)).toBe("auth");
    expect(classifyStatus(403)).toBe("auth");
    expect(classifyStatus(400)).toBe("bad_request");
    expect(classifyStatus(402)).toBe("exhausted");
    expect(classifyStatus(429)).toBe("exhausted");
    expect(classifyStatus(503)).toBe("exhausted");
  });

  it("cooldown e falha transitória 502/fetch de upstream do FreeLLMAPI viram espera (não chave nem crédito)", () => {
    const detail =
      "No candidate model has a configured, usable provider key. All models exhausted: 1 route checked (1 rate-limited or on cooldown).";
    expect(classifyProviderOutage(detail, 503)).toBe("espera");
    const upstreamFetch502 =
      "All 1 routed attempt(s) failed with upstream provider errors (error ×1). This is a provider-side failure, not a problem with your request; retry, or check provider status. Attempt trail: custom/deepseek-v4-pro key1: error. Last error: fetch";
    expect(classifyProviderOutage(upstreamFetch502, 502)).toBe("espera");
    expect(classifyProviderOutage("out_of_credits", 402)).toBe("credito");
    expect(classifyProviderOutage("invalid api key", 401)).toBe("chave");
    expect(providerResetWaitMs("Soonest reset ~14s.")).toBe(14_000);
    expect(providerResetWaitMs("Soonest reset ~18h")).toBe(18 * 3_600_000);
    expect(providerResetWaitMs("sem prazo")).toBeNull();
  });

  it("diagnóstico: fora do ar → manda subir o container", async () => {
    await saveGatewayConfig("freellmapi", { baseUrl: "http://localhost:1/v1", apiKey: FREE_KEY });
    const h = await probeGateway("freellmapi");
    expect(h.reachable).toBe(false);
    expect(h.chatOk).toBe(false);
    expect(h.action).toContain("docker compose up -d freellmapi");
  });

  it("diagnóstico: sem chave → explica onde pegar a chave unificada", async () => {
    await saveGatewayConfig("freellmapi", { baseUrl: `${freeUrl}/v1` });
    const h = await probeGateway("freellmapi");
    expect(h.reachable).toBe(true);
    expect(h.authOk).toBe(false);
    expect(h.action).toContain("chave unificada");
  });

  it("diagnóstico: chave errada → 'Chave recusada'", async () => {
    await saveGatewayConfig("freellmapi", { baseUrl: `${freeUrl}/v1`, apiKey: "errada" });
    const h = await probeGateway("freellmapi");
    expect(h.authOk).toBe(false);
    expect(h.error).toContain("Chave recusada");
    expect(freeChatCalls).toHaveLength(0);
  });

  it("diagnóstico: chave ok mas provedores esgotados → mostra o erro do gateway e manda cadastrar chaves", async () => {
    freeMode = "exhausted";
    await saveGatewayConfig("freellmapi", { baseUrl: `${freeUrl}/v1`, apiKey: FREE_KEY });
    const h = await probeGateway("freellmapi");
    expect(h.authOk).toBe(true);
    expect(h.chatOk).toBe(false);
    expect(h.httpStatus).toBe(503);
    expect(h.error).toBe("All providers exhausted");
    expect(h.action).toContain("Cadastre chaves");
  });

  it("diagnóstico: pronto só quando uma conversa real responde", async () => {
    await saveGatewayConfig("freellmapi", { baseUrl: `${freeUrl}/v1`, apiKey: FREE_KEY });
    const h = await probeGateway("freellmapi");
    expect(h.chatOk).toBe(true);
    expect(h.servedBy).toBe("groq/llama-3.3-70b-versatile");
    expect(freeChatCalls).toHaveLength(1);
  });
});

describe("Gateways LLM — modelo forte pago só no tier pesado", () => {
  let paidServer: http.Server;
  let paidUrl = "";
  let paidCalls: string[] = [];

  beforeAll(async () => {
    paidServer = http.createServer(async (req, res) => {
      const body = await readBody(req);
      if (req.url === "/v1/chat/completions") {
        paidCalls.push(body.model);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "via pago" } }] }));
      }
      res.writeHead(404);
      res.end();
    });
    paidUrl = await listen(paidServer);
  });
  afterAll(async () => {
    await new Promise<void>((r) => paidServer.close(() => r()));
  });
  beforeEach(() => {
    paidCalls = [];
  });

  const paidGw = (): GatewayConfig => ({
    id: "deepseek",
    enabled: true,
    priority: 2,
    baseUrl: `${paidUrl}/v1`,
    apiKey: "sk-pago",
    modelFast: null,
    modelHeavy: "deepseek-v4-pro",
    heavyFirst: true,
  });

  it("tier pesado: o pago atende primeiro, mesmo listado depois do gratuito", async () => {
    const res = await new SmartRouter().dispatchWithFallback({
      messages,
      tier: "heavy",
      stream: false,
      gateways: [freeGw(), paidGw()],
    });
    expect(res.providerUsed).toBe("deepseek");
    expect(res.badge).toContain("DeepSeek");
    expect(paidCalls).toEqual(["deepseek-v4-pro"]);
    expect(freeChatCalls).toHaveLength(0);
  });

  it("tier rápido: o pago (sem modelo rápido) nunca é chamado", async () => {
    const res = await new SmartRouter().dispatchWithFallback({
      messages,
      tier: "fast",
      stream: false,
      gateways: [paidGw(), freeGw()],
    });
    expect(res.providerUsed).toBe("freellmapi");
    expect(paidCalls).toHaveLength(0);
  });

  it("pago fora do ar no tier pesado → gratuito assume", async () => {
    const res = await new SmartRouter().dispatchWithFallback({
      messages,
      tier: "heavy",
      stream: false,
      gateways: [{ ...paidGw(), baseUrl: "http://localhost:1/v1" }, freeGw()],
    });
    expect(res.providerUsed).toBe("freellmapi");
    expect(freeChatCalls[0].model).toBe("auto:smart");
  });
});
