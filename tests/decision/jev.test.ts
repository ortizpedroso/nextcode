/**
 * Jev no classificador de mensagens: decide quando as regras não decidem; abaixo da confiança
 * mínima, sem chave ou fora do ar → reserva (classificador LLM). Servidor HTTP falso no lugar
 * da TypeSafe, com o formato real da API (conferido em 06/10/2026).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { classifyMessage } from "@/core/orchestrator/message-intent";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";

let server: http.Server;
let jevMode: "ok" | "low" | "down" = "ok";
let jevChoice = "duvida_avulsa";
let jevCalls: { auth: string | undefined; body: any }[] = [];
let originalKey: string | null = null;

const llmAnswer = (intencao: string): DispatchResult => ({
  response: new Response(JSON.stringify({ choices: [{ message: { content: `{"intencao":"${intencao}"}` } }] })),
  providerUsed: "freellmapi",
  badge: "",
  tierTag: "freellmapi",
  modelUsed: "x",
});

beforeAll(async () => {
  process.env.NEXTCODE_MASTER_KEY = process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      jevCalls.push({ auth: req.headers.authorization, body: JSON.parse(raw || "{}") });
      if (jevMode === "down") {
        res.writeHead(503);
        return res.end("{}");
      }
      const confidence = jevMode === "low" ? 0.3 : 0.97;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { q: { type: "choice", choice: jevChoice, confidence, probabilities: { [jevChoice]: confidence } } },
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  process.env.JEV_API_URL = `http://localhost:${(server.address() as AddressInfo).port}/v1/systemone`;
  const s = await prisma.setting.findUnique({ where: { id: "default" } });
  originalKey = s?.typesafeKey ?? null;
  await prisma.setting.upsert({
    where: { id: "default" },
    update: { typesafeKey: writeSecret("ts-test-key") },
    create: { id: "default", typesafeKey: writeSecret("ts-test-key") },
  });
});

afterAll(async () => {
  await prisma.setting.update({ where: { id: "default" }, data: { typesafeKey: originalKey } });
  delete process.env.JEV_API_URL;
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  jevMode = "ok";
  jevChoice = "duvida_avulsa";
  jevCalls = [];
  vi.restoreAllMocks();
});

// Ambígua para as regras: sem "?" e sem verbo de criação/correção.
const ambiguous = "isso aí do pix e boleto";

describe("Jev no classificador de mensagens", () => {
  it("regras decidem → Jev não é chamado", async () => {
    expect(await classifyMessage("qual o status?", "EXECUCAO")).toBe("status");
    expect(jevCalls).toHaveLength(0);
  });

  it("mensagem ambígua → decisão do Jev, no formato real da API, sem chamar LLM", async () => {
    const llm = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback");
    expect(await classifyMessage(ambiguous, "SPEC_REVISAO")).toBe("duvida_avulsa");
    expect(jevCalls).toHaveLength(1);
    expect(jevCalls[0].auth).toBe("Bearer ts-test-key");
    expect(jevCalls[0].body.model).toBe("jev-1.13.0");
    expect(jevCalls[0].body.questions.q.type).toBe("choice");
    expect(Object.keys(jevCalls[0].body.questions.q.criteria)).toContain("mudanca_durante_execucao");
    expect(llm).not.toHaveBeenCalled();
  });

  it("decisão registrada na trilha com probabilidades (JEV_DECISION)", async () => {
    const before = new Date(Date.now() - 1);
    await classifyMessage(ambiguous, "SPEC_REVISAO", null);
    await new Promise((r) => setTimeout(r, 50));
    const log = await prisma.telemetryLog.findFirst({ where: { action: "JEV_DECISION", createdAt: { gte: before } } });
    expect(JSON.parse(log!.details!)).toMatchObject({ purpose: "classificacao_mensagem", choice: "duvida_avulsa" });
  });

  it("confiança baixa → reserva (LLM), sem usar a escolha do Jev", async () => {
    jevMode = "low";
    jevChoice = "criar_novo";
    const llm = vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValue(llmAnswer("status"));
    expect(await classifyMessage(ambiguous, "SPEC_REVISAO")).toBe("status");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("Jev fora do ar → reserva (LLM), sem travar", async () => {
    jevMode = "down";
    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValue(llmAnswer("criar_novo"));
    expect(await classifyMessage(ambiguous, "SPEC_REVISAO")).toBe("criar_novo");
  });
});
