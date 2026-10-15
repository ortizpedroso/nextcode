import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import {
  runUniversalIntakeFunnel,
  formatIntakeFunnelBrief,
  type IntakeFunnelResult,
} from "@/core/intake/universal-funnel";

describe("P5.2 — Peneira M0: conversa inteira, tempo próprio, incerteza vira pergunta", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
    vi.spyOn(prisma.telemetryLog, "create").mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("(a) Jev responde has_database com noul: 0.58 → aConfirmar contém has_database e brief mostra Banco de Dados: [A CONFIRMAR]", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            app_kind: { type: "choice", choice: "web_fullstack", confidence: 0.9 },
            user_model: { type: "choice", choice: "authenticated_users", confidence: 0.9 },
            complexity_score: { type: "score", score: 2, confidence: 0.9 },
            has_database: { type: "noul", noul: 0.58 },
            has_auth: { type: "noul", noul: 0.9 },
            has_financial_payments: { type: "noul", noul: 0.1 },
            has_external_comms: { type: "noul", noul: 0.1 },
            has_public_api: { type: "noul", noul: 0.1 },
            has_whitelabel: { type: "noul", noul: 0.1 },
            financial_split_model: { type: "choice", choice: "not_applicable", confidence: 0.9 },
            notification_channels: { type: "choice", choice: "none", confidence: 0.9 },
            has_strict_business_rules: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await runUniversalIntakeFunnel({
      prompt: "Quero criar um app para gerenciar tarefas locais",
      sessionId: "sess-p52-a",
    });

    expect(res.source).toBe("jev");
    expect(res.aConfirmar).toContain("has_database");
    const brief = formatIntakeFunnelBrief(res);
    expect(brief).toContain("Banco de Dados: [A CONFIRMAR]");
    expect(brief).toContain("- ATENÇÃO: os itens abaixo marcados [A CONFIRMAR] não são requisito; viram pergunta objetiva na seção 7 (Dúvidas em aberto) da Spec.");
  });

  it("(b) noul: 0.95 → fora de aConfirmar, linha igual à de hoje", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            app_kind: { type: "choice", choice: "web_fullstack", confidence: 0.9 },
            user_model: { type: "choice", choice: "authenticated_users", confidence: 0.9 },
            complexity_score: { type: "score", score: 2, confidence: 0.9 },
            has_database: { type: "noul", noul: 0.95 },
            has_auth: { type: "noul", noul: 0.9 },
            has_financial_payments: { type: "noul", noul: 0.1 },
            has_external_comms: { type: "noul", noul: 0.1 },
            has_public_api: { type: "noul", noul: 0.1 },
            has_whitelabel: { type: "noul", noul: 0.1 },
            financial_split_model: { type: "choice", choice: "not_applicable", confidence: 0.9 },
            notification_channels: { type: "choice", choice: "none", confidence: 0.9 },
            has_strict_business_rules: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await runUniversalIntakeFunnel({
      prompt: "Preciso de um app com banco de dados Postgres",
      sessionId: "sess-p52-b",
    });

    expect(res.source).toBe("jev");
    expect(res.aConfirmar).not.toContain("has_database");
    const brief = formatIntakeFunnelBrief(res);
    expect(brief).toContain("- Banco de Dados: OBRIGATÓRIO (modelar schema Prisma e entidades relacionais)");
  });

  it("(c) notification_channels com confidence: 0.4 → em aConfirmar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            app_kind: { type: "choice", choice: "web_fullstack", confidence: 0.9 },
            user_model: { type: "choice", choice: "authenticated_users", confidence: 0.9 },
            complexity_score: { type: "score", score: 2, confidence: 0.9 },
            has_database: { type: "noul", noul: 0.95 },
            has_auth: { type: "noul", noul: 0.9 },
            has_financial_payments: { type: "noul", noul: 0.1 },
            has_external_comms: { type: "noul", noul: 0.8 },
            has_public_api: { type: "noul", noul: 0.1 },
            has_whitelabel: { type: "noul", noul: 0.1 },
            financial_split_model: { type: "choice", choice: "not_applicable", confidence: 0.9 },
            notification_channels: { type: "choice", choice: "email_only", confidence: 0.4 },
            has_strict_business_rules: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await runUniversalIntakeFunnel({
      prompt: "Talvez enviar email de aviso",
      sessionId: "sess-p52-c",
    });

    expect(res.source).toBe("jev");
    expect(res.aConfirmar).toContain("notification_channels");
    const brief = formatIntakeFunnelBrief(res);
    expect(brief).toContain("Canais de Notificação de Comprovante: [A CONFIRMAR]");
  });

  it("(d) Jev indisponível → source: 'fallback', 7 itens em aConfirmar e a linha de estimativa", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Conexão recusada"));

    const res = await runUniversalIntakeFunnel({
      prompt: "Criar um gateway com cobrança e pagamentos Pix",
      sessionId: "sess-p52-d",
    });

    expect(res.source).toBe("fallback");
    expect(res.aConfirmar).toEqual([
      "has_database",
      "has_auth",
      "has_financial_payments",
      "has_external_comms",
      "has_public_api",
      "has_whitelabel",
      "has_strict_business_rules",
    ]);

    const brief = formatIntakeFunnelBrief(res);
    expect(brief).toContain("- Estimativa por palavras-chave (o Jev não respondeu).");
    expect(brief).toContain("- ATENÇÃO: os itens abaixo marcados [A CONFIRMAR] não são requisito; viram pergunta objetiva na seção 7 (Dúvidas em aberto) da Spec.");
  });

  it("(e) o body enviado ao Jev contém trechos de duas mensagens diferentes do usuário", async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init && init.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            app_kind: { type: "choice", choice: "web_fullstack", confidence: 0.9 },
            user_model: { type: "choice", choice: "authenticated_users", confidence: 0.9 },
            complexity_score: { type: "score", score: 2, confidence: 0.9 },
            has_database: { type: "noul", noul: 0.9 },
            has_auth: { type: "noul", noul: 0.9 },
            has_financial_payments: { type: "noul", noul: 0.1 },
            has_external_comms: { type: "noul", noul: 0.1 },
            has_public_api: { type: "noul", noul: 0.1 },
            has_whitelabel: { type: "noul", noul: 0.1 },
            financial_split_model: { type: "choice", choice: "not_applicable", confidence: 0.9 },
            notification_channels: { type: "choice", choice: "none", confidence: 0.9 },
            has_strict_business_rules: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const msg1 = "Primeira mensagem: quero um sistema de estoque.";
    const msg2 = "Segunda mensagem: adicione controle de validade e alertas.";
    const conversa = `${msg1}\n---\n${msg2}`;

    await runUniversalIntakeFunnel({
      prompt: conversa,
      sessionId: "sess-p52-e",
    });

    expect(capturedBody).not.toBeNull();
    const stateObj = JSON.parse(capturedBody.state);
    expect(stateObj.prompt).toContain(msg1);
    expect(stateObj.prompt).toContain(msg2);
    expect(stateObj.prompt).toContain("\n---\n");
  });

  it("(f) timeoutMs: 10000 chega ao fetch", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            app_kind: { type: "choice", choice: "web_fullstack", confidence: 0.9 },
            user_model: { type: "choice", choice: "authenticated_users", confidence: 0.9 },
            complexity_score: { type: "score", score: 2, confidence: 0.9 },
            has_database: { type: "noul", noul: 0.9 },
            has_auth: { type: "noul", noul: 0.9 },
            has_financial_payments: { type: "noul", noul: 0.1 },
            has_external_comms: { type: "noul", noul: 0.1 },
            has_public_api: { type: "noul", noul: 0.1 },
            has_whitelabel: { type: "noul", noul: 0.1 },
            financial_split_model: { type: "choice", choice: "not_applicable", confidence: 0.9 },
            notification_channels: { type: "choice", choice: "none", confidence: 0.9 },
            has_strict_business_rules: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await runUniversalIntakeFunnel({
      prompt: "Teste timeout",
      sessionId: "sess-p52-f",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(10000);
  });
});
