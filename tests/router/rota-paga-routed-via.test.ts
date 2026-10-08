import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { SmartRouter } from "@/core/router/smart-router";
import { resetGatewayState, type GatewayConfig } from "@/core/llm/gateways";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

let server: http.Server;
let baseUrl = "";
const FREE_KEY = "freellmapi-test-key";

interface FakeReply {
  status?: number;
  routedVia: string;
  content: string;
}

let replyQueue: FakeReply[] = [];
let receivedModels: string[] = [];

function listen(s: http.Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, () => resolve(`http://localhost:${(s.address() as AddressInfo).port}`))
  );
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/v1/chat/completions") {
      receivedModels.push(body.model);
      const next = replyQueue.shift() ?? {
        status: 200,
        routedVia: "custom/deepseek-v4-pro",
        content: "ok",
      };
      const status = next.status ?? 200;
      res.writeHead(status, {
        "content-type": "application/json",
        "x-routed-via": next.routedVia,
      });
      return res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: next.content } }],
        })
      );
    }
    res.writeHead(404);
    res.end();
  });
  baseUrl = await listen(server);
});

afterAll(async () => {
  resetGatewayState();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  replyQueue = [];
  receivedModels = [];
  resetGatewayState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFreeGw(modelHeavy: string): GatewayConfig {
  return {
    id: "freellmapi",
    enabled: true,
    priority: 1,
    baseUrl: `${baseUrl}/v1`,
    apiKey: FREE_KEY,
    modelFast: null,
    modelHeavy,
    heavyFirst: true,
  };
}

describe("R1.3b — trava de rota paga (X-Routed-Via)", () => {
  it("X-Routed-Via custom/deepseek-v4-pro é aceito", async () => {
    const logs: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      logs.push(entry);
    });

    replyQueue.push({
      routedVia: "custom/deepseek-v4-pro",
      content: "resposta paga",
    });

    const router = new SmartRouter();
    const res = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "oi" }],
      tier: "heavy",
      stream: false,
      gateways: [makeFreeGw("deepseek-v4-pro")],
      allowedRoutedViaPrefixes: ["custom/"],
    });

    expect(res.providerUsed).toBe("freellmapi");
    expect(res.modelUsed).toBe("custom/deepseek-v4-pro");
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe("resposta paga");
    expect(logs.some((l) => l.action === "llm.gateway_call")).toBe(true);
    expect(logs.some((l) => l.action === "llm.gateway_failure")).toBe(false);
  });

  it("X-Routed-Via electronhub/... é recusado e o próximo item da lista é tentado", async () => {
    const logs: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      logs.push(entry);
    });

    replyQueue.push(
      {
        routedVia: "electronhub/deepseek-v4-flash:free",
        content: "resposta gratuita indevida",
      },
      {
        routedVia: "custom/deepseek-v4-pro",
        content: "resposta paga no 2º item",
      }
    );

    const router = new SmartRouter();
    const res = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "oi" }],
      tier: "heavy",
      stream: false,
      gateways: [makeFreeGw("auto:paid-profile"), makeFreeGw("deepseek-v4-pro")],
      allowedRoutedViaPrefixes: ["custom/"],
    });

    expect(receivedModels).toEqual(["auto:paid-profile", "deepseek-v4-pro"]);
    expect(res.providerUsed).toBe("freellmapi");
    expect(res.modelUsed).toBe("custom/deepseek-v4-pro");
    const json = await res.response.json();
    expect(json.choices[0].message.content).toBe("resposta paga no 2º item");

    const failures = logs.filter((l) => l.action === "llm.gateway_failure");
    expect(failures).toHaveLength(1);
    expect(failures[0].details).toEqual({
      gateway: "freellmapi",
      requestedModel: "auto:paid-profile",
      kind: "bad_request",
      status: null,
      detail: "rota não paga recusada: electronhub/deepseek-v4-flash:free",
    });
  });

  it("sem allowedRoutedViaPrefixes nada muda", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    replyQueue.push({
      routedVia: "electronhub/deepseek-v4-flash:free",
      content: "resposta gratuita aceita no chat",
    });

    const router = new SmartRouter();
    const res = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "oi" }],
      tier: "heavy",
      stream: false,
      gateways: [makeFreeGw("auto:smart")],
    });

    expect(res.providerUsed).toBe("freellmapi");
    expect(res.modelUsed).toBe("electronhub/deepseek-v4-flash:free");
  });

  it("todos recusados → providerUsed none", async () => {
    const logs: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      logs.push(entry);
    });

    replyQueue.push(
      {
        routedVia: "electronhub/deepseek-v4-flash:free",
        content: "gratis 1",
      },
      {
        routedVia: "groq/llama-3.3-70b-versatile",
        content: "gratis 2",
      }
    );

    const router = new SmartRouter();
    const res = await router.dispatchWithFallback({
      messages: [{ role: "user", content: "oi" }],
      tier: "heavy",
      stream: false,
      gateways: [makeFreeGw("auto:paid-profile"), makeFreeGw("deepseek-v4-pro")],
      allowedRoutedViaPrefixes: ["custom/"],
    });

    expect(res.providerUsed).toBe("none");
    expect(res.tierTag).toBe("exhausted");
    const failures = logs.filter((l) => l.action === "llm.gateway_failure");
    expect(failures).toHaveLength(2);
  });
});
