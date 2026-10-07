import { describe, it, expect, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { isGatewayAnswering, type GatewayConfig } from "@/core/llm/gateways";

// Servidor falso: 200 só com a chave certa, 401 com qualquer outra.
const server = http.createServer((req, res) => {
  const ok = req.url === "/v1/models" && req.headers.authorization === "Bearer chave-boa";
  res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
  res.end(ok ? '{"data":[]}' : '{"error":"unauthorized"}');
});
const ready = new Promise<number>((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
);
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function gw(baseUrl: string, apiKey: string): GatewayConfig {
  return { id: "freellmapi", enabled: true, priority: 1, baseUrl, apiKey, modelFast: null, modelHeavy: null };
}

describe("Supervisor: gateway só conta como disponível quando responde de verdade", () => {
  it("chave válida e servidor no ar → disponível", async () => {
    const port = await ready;
    expect(await isGatewayAnswering(gw(`http://localhost:${port}/v1`, "chave-boa"))).toBe(true);
  });

  it("chave salva mas recusada (401) → indisponível", async () => {
    const port = await ready;
    expect(await isGatewayAnswering(gw(`http://localhost:${port}/v1`, "chave-ruim"))).toBe(false);
  });

  it("servidor fora do ar → indisponível", async () => {
    expect(await isGatewayAnswering(gw("http://localhost:1/v1", "chave-boa"), 1000)).toBe(false);
  });
});
