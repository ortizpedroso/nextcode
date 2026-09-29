/**
 * Fase 7 — Teste E2E do fluxo OmniRoute com gateway FALSO (sem Docker).
 * Sobe um servidor HTTP local que simula o gateway (catálogo /v1/models,
 * /healthz, /v1/chat/completions streaming e não-streaming) e exercita o
 * SmartRouter real contra ele.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

let server: http.Server;
let baseUrl: string;
const seenRequests: Array<{ path: string; body?: any }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seenRequests.push({ path: req.url || "", body });

      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ status: "ok" }));
      }
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ data: [{ id: "auto" }, { id: "auto/coding" }, { id: "auto/smart" }, { id: "auto/best-free" }, { id: "auto/coding:free" }] })
        );
      }
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        if (!body?.model || !Array.isArray(body.messages)) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: { message: "invalid request" } }));
        }
        // modelo inexistente -> erro como o gateway real (reproduz o bug 'omniroute-auto')
        if (!["auto", "auto/coding", "auto/smart", "auto/best-free", "auto/coding:free"].includes(body.model)) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: { message: `model '${body.model}' not found` } }));
        }
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ol" } }] })}\n\n`);
          setTimeout(() => {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "á" }, finish_reason: "stop" }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          }, 30);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "olá do gateway fake" }, finish_reason: "stop" }],
            provider: "fake-provider-kiro",
          })
        );
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("E2E — SmartRouter x gateway OmniRoute (fake)", () => {
  it("health: /healthz responde e catálogo expõe variantes de 'auto'", async () => {
    const h = await fetch(`${baseUrl}/healthz`);
    expect(h.status).toBe(200);
    const models = await (await fetch(`${baseUrl}/v1/models`)).json();
    const ids = models.data.map((m: any) => m.id);
    expect(ids).toContain("auto");
    expect(ids).toContain("auto/coding");
  });

  it("chat não-streaming via router usa 'auto' e retorna providerUsed=omniroute", async () => {
    const m = await import("../../src/core/router/smart-router");
    const router = new m.SmartRouter();
    const result = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "diga olá" }],
      tier: "fast",
      omniRouteUrl: baseUrl,
      stream: false,
    });
    expect(result.providerUsed).toBe("omniroute");
    expect(result.badge).toContain("OmniRoute");
    const payload = await result.response.json();
    expect(payload.choices[0].message.content).toBe("olá do gateway fake");
    const chatReq = seenRequests.filter((r) => r.path === "/v1/chat/completions").pop();
    expect(chatReq?.body.model).toBe("auto/best-free"); // variante gratuita (evita HTTP 402 de créditos)
  });

  it("chat em streaming entrega chunks SSE pelo router", async () => {
    const m = await import("../../src/core/router/smart-router");
    const router = new m.SmartRouter();
    const result = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "stream ping" }],
      tier: "fast",
      omniRouteUrl: baseUrl,
      stream: true,
    });
    expect(result.providerUsed).toBe("omniroute");
    const text = await result.response.text();
    expect(text).toContain("delta");
    expect(text).toContain("[DONE]");
  });

  it("regressão histórica: 'omniroute-auto' recebia 404 do gateway", async () => {
    // documenta o comportamento que causava a ilusão de '350 provedores nunca funcionam'
    const bad = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "omniroute-auto", messages: [{ role: "user", content: "oi" }] }),
    });
    expect(bad.status).toBe(404);
    const good = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "oi" }] }),
    });
    expect(good.status).toBe(200);
  });

  it("gateway caído -> router cai para Gemini/none sem hang (failover)", async () => {
    const m = await import("../../src/core/router/smart-router");
    const router = new m.SmartRouter();
    const start = Date.now();
    const result = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "ping" }],
      tier: "fast",
      omniRouteUrl: "http://localhost:1/v1", // porta fechada
      timeoutMsSafe: 800,
      stream: false,
    } as any);
    const elapsed = Date.now() - start;
    expect(["gemini-fallback", "none"]).toContain(result.providerUsed);
    expect(elapsed).toBeLessThan(60_000); // failover rápido, sem travar
  });
});
