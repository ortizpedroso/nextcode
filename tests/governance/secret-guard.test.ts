import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import * as localAuthModule from "@/core/security/local-auth";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import * as empiricalGateMod from "@/core/governance/empirical-gate";
import { executeTaskNode, setExecutorModeForTests } from "@/core/orchestrator/node-executor";
import { POST as postChat } from "@/app/api/chat/route";
import {
  checkSecretsInCodeWithJev,
  redactSecretsInChatWithJev,
  maskSecretInExcerpt,
} from "@/core/governance/secret-guard";
import * as jevDecisions from "@/core/decision/jev-decisions";

describe("Passo 10.4 — Guarda de segredos no código gerado (ativo, fail-closed)", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    setExecutorModeForTests("chamada_unica");
    vi.spyOn(SkillMiner, "analyzeAndPropose").mockResolvedValue([] as any);
    vi.spyOn(SkillMiner, "detectRecurringBugs").mockResolvedValue([] as any);
    vi.spyOn(empiricalGateMod, "promoteWithEmpiricalGate").mockResolvedValue({
      passed: true,
      rolledBack: false,
      buildResult: { success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 },
    } as any);
  });

  afterEach(() => {
    setExecutorModeForTests(null);
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  function setupTaskWithGeneratedCode(fileName: string, fileContent: string) {
    const task: any = {
      id: "node-10-4",
      sessionId: "sess-10-4",
      specVersion: 1,
      title: `Implementar ${fileName}`,
      role: "executor-backend",
      cluster: "backend",
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      dependencies: "[]",
      filesScope: JSON.stringify([fileName]),
      payload: JSON.stringify({
        goal: "# Spec\nCliente de API",
        nodeFiles: [fileName],
        cluster: "backend",
      }),
      result: null,
      failureHistory: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      session: {
        id: "sess-10-4",
        canonicalSpec: "# Spec\nCliente de API",
        project: null,
      },
    };

    let lastUpdatedData: any = null;
    vi.spyOn(prisma.taskNode, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.taskNode, "findMany").mockResolvedValue([] as any);
    vi.spyOn(prisma.message, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
    vi.spyOn(prisma.taskNode, "update").mockImplementation((async (args: any) => {
      lastUpdatedData = args.data;
      return { ...task, ...args.data };
    }) as any);

    const executorOutput = `\`\`\`typescript\n// file: ${fileName}\n${fileContent}\n\`\`\``;
    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValue({
      response: new Response(
        JSON.stringify({
          choices: [{ message: { content: executorOutput } }],
        })
      ),
      providerUsed: "freellmapi",
      badge: "",
      tierTag: "freellmapi",
      modelUsed: "mock-model",
    } satisfies DispatchResult);

    vi.spyOn(DualLensAuditor, "validateType2").mockResolvedValue({
      verdict: "APPROVED",
      rawVerdict: "APROVADO",
      method: "blind_llm",
    } as any);

    return { task, getLastUpdatedData: () => lastUpdatedData };
  }

  it("segredo real → bloqueia antes da promoção; motivo e telemetria nunca contêm o valor", async () => {
    const telemetryCalls: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      telemetryCalls.push(entry);
    });

    const realKey = "sk_"+"live_9876543210abcdefSECRET";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q_0: { type: "noul", noul: 0.96 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { task, getLastUpdatedData } = setupTaskWithGeneratedCode(
      "src/lib/stripe.ts",
      `export const stripeKey = "${realKey}";\n`
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("failed");
    expect(res.promotionTarget).toBeNull();
    expect(empiricalGateMod.promoteWithEmpiricalGate).not.toHaveBeenCalled();

    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.rejectionReason).toBe(
      "[SECRET IN CODE] src/lib/stripe.ts:1 — use variável de ambiente"
    );
    expect(saved.rejectionReason).not.toContain(realKey);

    const secretGuardLogs = telemetryCalls.filter((c) => c.action === "SECRET_GUARD");
    expect(secretGuardLogs).toHaveLength(1);
    expect(secretGuardLogs[0].details).toMatchObject({
      nodeId: "node-10-4",
      arquivo: "src/lib/stripe.ts",
      linha: 1,
      noul: 0.96,
      bloqueado: true,
    });
    expect(JSON.stringify(secretGuardLogs[0])).not.toContain(realKey);
  });

  it("process.env → passa sem chamar Jev", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { task } = setupTaskWithGeneratedCode(
      "src/lib/stripe.ts",
      "export const stripeKey = process.env.STRIPE_SECRET_KEY || '';\n"
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
    // AV1.4: sem projeto vinculado o porteiro não roda (D30 revista) — só a promoção depois da aprovação.
    const gateCalls = vi.mocked(empiricalGateMod.promoteWithEmpiricalGate).mock.calls;
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0][4]).toBeUndefined();
  });

  it("placeholder → passa sem chamar Jev", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { task } = setupTaskWithGeneratedCode(
      "src/lib/stripe.ts",
      [
        'export const k1 = "<sk_"+"live_placeholder>";',
        'export const k2 = "your-key-here-1234567890";',
        'export const apiKey = "changeme_example_xxx";',
      ].join("\n")
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Jev null + regex → bloqueia (fail-closed) sem expor o valor no motivo nem na telemetria", async () => {
    const telemetryCalls: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      telemetryCalls.push(entry);
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));

    const ghSecret = "ghp_Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4";
    const { task, getLastUpdatedData } = setupTaskWithGeneratedCode(
      "src/lib/github.ts",
      `const token = "${ghSecret}";\nexport default token;\n`
    );

    const res = await executeTaskNode(task);
    expect(res.finalStatus).toBe("failed");
    expect(empiricalGateMod.promoteWithEmpiricalGate).not.toHaveBeenCalled();

    const saved = JSON.parse(getLastUpdatedData().result);
    expect(saved.rejectionReason).toBe(
      "[SECRET IN CODE] src/lib/github.ts:1 — use variável de ambiente"
    );
    expect(saved.rejectionReason).not.toContain(ghSecret);

    const secretGuardLogs = telemetryCalls.filter((c) => c.action === "SECRET_GUARD");
    expect(secretGuardLogs).toHaveLength(1);
    expect(secretGuardLogs[0].details).toMatchObject({
      nodeId: "node-10-4",
      arquivo: "src/lib/github.ts",
      linha: 1,
      noul: null,
      bloqueado: true,
    });
    expect(JSON.stringify(secretGuardLogs[0])).not.toContain(ghSecret);
  });
});

describe("Passo 10.5 — Guarda de segredos na resposta do chat (ativo)", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    vi.spyOn(localAuthModule, "requireAuth").mockReturnValue({ response: null } as any);
  });

  afterEach(() => {
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  function setupChatRouteMocks(aiText: string) {
    const savedMessages: any[] = [];
    const fakeSession: any = {
      id: "sess-chat-10-5",
      title: "Sessão Chat",
      phase: "ENTRADA",
      phaseContext: "{}",
      specApproved: false,
      specVersion: 0,
      canonicalSpec: null,
      project: { id: "p1", name: "P1", path: process.cwd() },
      tasks: [],
    };

    vi.spyOn(jevDecisions, "decideGraphifyEligibilityWithJev").mockResolvedValue({
      elegivel: false,
      motivo: "mock",
      clusterRecomendado: "nenhum",
      confidence: 0.1,
      source: "mock",
    } as any);

    vi.spyOn(jevDecisions, "evaluateChatFanOutWithJev").mockResolvedValue({
      intencao: "duvida_avulsa",
      intencaoRaw: "duvida_avulsa",
      confiancaIntencao: 0.9,
      aprovacaoSpec: {
        aprovadoParaFase2: false,
        confianca: 0.1,
        probabilidadeIncondicional: 0.05,
      },
      graphify: {
        elegivel: false,
        probabilidade: 0.1,
        confianca: 0.8,
        motivo: "mock",
      },
      guardrailEntrada: {
        inseguro: false,
        probabilidadeInseguro: 0.05,
      },
      perfilUsuario: "desenvolvedor_tecnico",
      source: "fallback",
      latenciaMs: 1,
    });

    vi.spyOn(prisma.session, "findUnique").mockResolvedValue(fakeSession);
    vi.spyOn(prisma.session, "updateMany").mockResolvedValue({ count: 1 } as any);
    vi.spyOn(prisma.session, "update").mockImplementation((async (args: any) => ({
      ...fakeSession,
      ...args.data,
    })) as any);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
    vi.spyOn(prisma.message, "create").mockImplementation((async (args: any) => {
      const msg = { id: `msg-${savedMessages.length + 1}`, createdAt: new Date(), ...args.data };
      savedMessages.push(msg);
      return msg;
    }) as any);
    vi.spyOn(prisma.message, "findMany").mockImplementation((async () => savedMessages) as any);

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockResolvedValue({
      response: new Response(
        JSON.stringify({
          choices: [{ message: { content: aiText } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      providerUsed: "freellmapi",
      badge: "",
      tierTag: "freellmapi",
      modelUsed: "mock-chat",
    } satisfies DispatchResult);

    return { savedMessages };
  }

  it("resposta com chave → salva ocultada como [SEGREDO OCULTADO] e registra SECRET_GUARD_CHAT sem o valor", async () => {
    const telemetryCalls: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      telemetryCalls.push(entry);
    });

    const leakedKey = "sk-"+"proj1234567890abcdefSECRETKEY";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q_0: { type: "noul", noul: 0.95 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { savedMessages } = setupChatRouteMocks(
      `Para autenticar, use a chave ${leakedKey} no cabeçalho Authorization.`
    );

    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "sess-chat-10-5",
        prompt: "O que é o SQLite em modo WAL e como ele funciona?",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);

    const assistantMsg = savedMessages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toBe(
      "Para autenticar, use a chave [SEGREDO OCULTADO] no cabeçalho Authorization."
    );
    expect(assistantMsg.content).not.toContain(leakedKey);

    const chatLogs = telemetryCalls.filter((c) => c.action === "SECRET_GUARD_CHAT");
    expect(chatLogs).toHaveLength(1);
    expect(chatLogs[0].details).toMatchObject({
      linha: 1,
      noul: 0.95,
      bloqueado: true,
    });
    expect(JSON.stringify(chatLogs[0])).not.toContain(leakedKey);
  });

  it("resposta normal → salva idêntica sem chamar Jev", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const normalText = "O SQLite em modo WAL permite leituras concorrentes enquanto uma escrita ocorre.";
    const { savedMessages } = setupChatRouteMocks(normalText);

    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "sess-chat-10-5",
        prompt: "O que é o SQLite em modo WAL e como ele funciona?",
      }),
    });

    const res = await postChat(req);
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const assistantMsg = savedMessages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toBe(normalText);
  });
});


describe("Guarda de segredos — o valor nunca sai da máquina (Jev é serviço externo)", () => {
  const prevJevUrl = process.env.JEV_API_URL;

  beforeEach(() => {
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: writeSecret("ts-test-key"),
    } as any);
  });

  afterEach(() => {
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    vi.restoreAllMocks();
  });

  function jevNoul(noul: number) {
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { q_0: { type: "noul", noul } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function sentBodies(fetchSpy: ReturnType<typeof vi.spyOn>): string {
    return fetchSpy.mock.calls.map((c: any[]) => String(c[1]?.body ?? "")).join("\n");
  }

  it("código gerado: o Jev recebe só nome, prefixo, tamanho e entropia — nunca o valor", async () => {
    const realKey = "sk_"+"live_51N9qR8wK2mP7vX4nL9jH3fG6dS1aZ0yB5cV8";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jevNoul(0.9));

    const res = await checkSecretsInCodeWithJev({
      sessionId: "sess-mask",
      nodeId: "node-mask",
      codeContentMap: { "src/lib/stripe.ts": `export const STRIPE_KEY = "${realKey}";\n` },
      modo: "ativo",
      limiarSegredoNoul: 0.7,
    });

    expect(res.blocked).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = sentBodies(fetchSpy);
    expect(body).not.toContain(realKey);
    expect(body).not.toContain(realKey.slice(8, 24));
    expect(body).toContain("STRIPE_KEY");
    expect(body).toContain(`sk_live_«valor oculto: ${realKey.length} caracteres`);
  });

  it("chat: a chave é ocultada na mensagem e também no que vai ao Jev", async () => {
    const leakedKey = "sk-"+"proj1234567890abcdefSECRETKEY";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jevNoul(0.95));

    const res = await redactSecretsInChatWithJev({
      sessionId: "sess-mask-chat",
      text: `Use a chave ${leakedKey} no cabeçalho.`,
      modo: "ativo",
      limiarSegredoNoul: 0.7,
    });

    expect(res.redactedText).toBe("Use a chave [SEGREDO OCULTADO] no cabeçalho.");
    expect(sentBodies(fetchSpy)).not.toContain(leakedKey);
  });

  it("chave privada PEM: nenhuma linha do corpo da chave vai ao Jev", async () => {
    const body64 = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7";
    const pem = `-----BEGIN PRIVATE KEY-----\n${body64}\n-----END PRIVATE KEY-----`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jevNoul(0.99));

    await checkSecretsInCodeWithJev({
      nodeId: "node-pem",
      codeContentMap: { "src/lib/cert.ts": `export const KEY = \`${pem}\`;\n` },
      modo: "ativo",
      limiarSegredoNoul: 0.7,
    });

    expect(sentBodies(fetchSpy)).not.toContain(body64);
  });

  it("maskSecretInExcerpt: trecho cortado no meio do valor não deixa sobrar pedaço", () => {
    const valor = "AKIAABCDEFGHIJKLMNOPQRSTUV0123456789";
    const trechoCortado = `const awsKey = "${valor.slice(0, 20)}`;
    const masked = maskSecretInExcerpt(trechoCortado, valor);
    expect(masked).not.toContain(valor.slice(4, 20));
    expect(masked).toContain("AKIA«valor oculto:");
  });
});
