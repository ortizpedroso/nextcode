import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { askJevBatch } from "@/core/decision/jev";
import { maskSecretsForJev } from "@/core/governance/secret-guard";

describe("P5.5 — Máscara de segredos do Jev com JSON, atribuição sem aspas e chave Asaas", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  // Montados em tempo de execução conforme Trava T-G
  const fakeHighEntropySecret = "7xK9" + "mP2q" + "vL5w" + "8zRt" + "4nYb" + "1cDf";
  const fakeSecretWithPrefix = "sk-" + "aB3dE" + "kL9mZ8qW2vX7" + "pT4yR1zW8v9B";
  const fakeAsaasKey = "$" + "aact_" + "YTU5" + "x".repeat(10) + "Qw9Zk3Lp7Rt2Nm8Bc4Hd6Fg1";

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

  it("(a) JSON.stringify({ prompt: 'const apiKey = \"<valor alta entropia>\";' })", () => {
    const input = JSON.stringify({ prompt: `const apiKey = "${fakeSecretWithPrefix}";` });
    const res = maskSecretsForJev(input);

    expect(res.text).not.toContain(fakeSecretWithPrefix);
    expect(res.text).toContain("«valor oculto:");
    expect(res.count).toBe(1);
  });

  it("(b) JSON.stringify({ prompt: 'ASAAS_API_KEY=<valor>' }) e o mesmo texto sem JSON", () => {
    // Com JSON
    const inputJson = JSON.stringify({ prompt: `ASAAS_API_KEY=${fakeHighEntropySecret}` });
    const resJson = maskSecretsForJev(inputJson);
    expect(resJson.text).not.toContain(fakeHighEntropySecret);
    expect(resJson.text).toContain("«valor oculto:");
    expect(resJson.count).toBe(1);

    // Sem JSON
    const inputRaw = `ASAAS_API_KEY=${fakeHighEntropySecret}`;
    const resRaw = maskSecretsForJev(inputRaw);
    expect(resRaw.text).not.toContain(fakeHighEntropySecret);
    expect(resRaw.text).toContain("«valor oculto:");
    expect(resRaw.count).toBe(1);
  });

  it("(c) JSON.stringify({ prompt: 'ASAAS_API_KEY: <valor>' })", () => {
    const input = JSON.stringify({ prompt: `ASAAS_API_KEY: ${fakeHighEntropySecret}` });
    const res = maskSecretsForJev(input);

    expect(res.text).not.toContain(fakeHighEntropySecret);
    expect(res.text).toContain("«valor oculto:");
    expect(res.count).toBe(1);
  });

  it("(d) chave Asaas falsa ($aact_…) solta numa frase, crua e dentro de JSON", () => {
    // Crua
    const inputRaw = `Configuração de pagamento com chave ${fakeAsaasKey} no ambiente`;
    const resRaw = maskSecretsForJev(inputRaw);
    expect(resRaw.text).not.toContain(fakeAsaasKey);
    expect(resRaw.text).toContain("«valor oculto:");
    expect(resRaw.count).toBe(1);

    // Dentro de JSON
    const inputJson = JSON.stringify({ mensagem: `Configuração de pagamento com chave ${fakeAsaasKey} no ambiente` });
    const resJson = maskSecretsForJev(inputJson);
    expect(resJson.text).not.toContain(fakeAsaasKey);
    expect(resJson.text).toContain("«valor oculto:");
    expect(resJson.count).toBe(1);
  });

  it("(e) objeto aninhado { spec: { regras: ['token=<valor>'] } } em JSON", () => {
    const input = JSON.stringify({ spec: { regras: [`token=${fakeHighEntropySecret}`] } });
    const res = maskSecretsForJev(input);

    expect(res.text).not.toContain(fakeHighEntropySecret);
    expect(res.text).toContain("«valor oculto:");
    expect(res.count).toBe(1);
  });

  it("(f) não mascara: ASAAS_API_KEY=your_api_key_here, token=process.env.ASAAS_API_KEY e um JSON sem segredo — count: 0 e texto idêntico ao de entrada", () => {
    const text1 = "ASAAS_API_KEY=your_api_key_here";
    const res1 = maskSecretsForJev(text1);
    expect(res1.count).toBe(0);
    expect(res1.text).toBe(text1);

    const text2 = "token=process.env.ASAAS_API_KEY";
    const res2 = maskSecretsForJev(text2);
    expect(res2.count).toBe(0);
    expect(res2.text).toBe(text2);

    const text3 = JSON.stringify({
      projeto: "NextCode",
      regras: ["validar entrada", "executar testes"],
      ativo: true,
      tentativas: 3,
    });
    const res3 = maskSecretsForJev(text3);
    expect(res3.count).toBe(0);
    expect(res3.text).toBe(text3);
  });

  it("(g) pelo caminho real: askJevBatch com state: JSON.stringify({ prompt: 'minha chave ASAAS_API_KEY=<valor>' }) → body capturado no fetch não contém o valor", async () => {
    const rawState = JSON.stringify({ prompt: `minha chave ASAAS_API_KEY=${fakeHighEntropySecret}` });

    let capturedBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init && init.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q1: { type: "noul", noul: 0.95 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const res = await askJevBatch({
      purpose: "test_json_asaas_mask",
      state: rawState,
      questions: { q1: { type: "noul", instructions: "ok?" } },
      sessionId: "sess-test-mask-json",
    });

    expect(res).not.toBeNull();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.state).not.toContain(fakeHighEntropySecret);
    expect(capturedBody.state).toContain("«valor oculto:");
  });
});
