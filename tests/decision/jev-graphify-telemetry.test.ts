import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { writeSecret } from "@/core/security/crypto";
import { decideGraphifyEligibilityWithJev } from "@/core/decision/jev-decisions";
import * as fs from "fs";
import * as path from "path";

describe("Pacote E4 — Telemetria Jev para Ativação do Graphify", () => {
  const prevJevUrl = process.env.JEV_API_URL;
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    process.env.JEV_API_URL = "http://localhost:9999/v1/systemone";
  });

  afterEach(() => {
    if (prevJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = prevJevUrl;
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("1. Ativa elegibilidade via JEV com 100ms quando pergunta é estrutural/arquitetural", async () => {
    const fakeKey = "typesafe_live_test_key";
    const encKey = writeSecret(fakeKey);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: encKey,
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "jev-1.13.0",
        usage: { input_tokens: 120, output_tokens: 0 },
        answers: {
          precisa_analise_grafo_arquitetura: {
            type: "noul",
            noul: 0.94,
          },
          foco_da_analise: {
            type: "choice",
            choice: "arquitetura_e_dependencias",
            confidence: 0.92,
            probabilities: { arquitetura_e_dependencias: 0.92, nenhum_ou_pontual: 0.08 },
          },
        },
      }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await decideGraphifyEligibilityWithJev({
      prompt: "Quais são os módulos principais deste repositório e como eles dependem entre si?",
      temCodigoExistente: true,
      sessionId: "sess-e4-1",
    });

    expect(result.elegivel).toBe(true);
    expect(result.source).toBe("jev");
    expect(result.foco).toBe("arquitetura_e_dependencias");
    expect(result.probabilidadeNoul).toBe(0.94);
    expect(result.motivo).toContain("Mapear arquitetura e relações de dependência");
  });

  it("2. Rejeita elegibilidade via JEV para pedido pontual de implementação", async () => {
    const fakeKey = "typesafe_live_test_key";
    const encKey = writeSecret(fakeKey);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: encKey,
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "jev-1.13.0",
        usage: { input_tokens: 80, output_tokens: 0 },
        answers: {
          precisa_analise_grafo_arquitetura: {
            type: "noul",
            noul: 0.08,
          },
          foco_da_analise: {
            type: "choice",
            choice: "nenhum_ou_pontual",
            confidence: 0.96,
            probabilities: { nenhum_ou_pontual: 0.96 },
          },
        },
      }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await decideGraphifyEligibilityWithJev({
      prompt: "Adicione um botão azul de salvar no cabeçalho.",
      temCodigoExistente: true,
      sessionId: "sess-e4-2",
    });

    expect(result.elegivel).toBe(false);
    expect(result.source).toBe("jev");
    expect(result.probabilidadeNoul).toBe(0.08);
    expect(result.motivo).toContain("sem necessidade de grafo estrutural");
  });

  it("3. Identifica necessidade de mapeamento de acoplamento / god nodes para refatoração", async () => {
    const fakeKey = "typesafe_live_test_key";
    const encKey = writeSecret(fakeKey);
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: encKey,
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "jev-1.13.0",
        usage: { input_tokens: 95, output_tokens: 0 },
        answers: {
          precisa_analise_grafo_arquitetura: {
            type: "noul",
            noul: 0.88,
          },
          foco_da_analise: {
            type: "choice",
            choice: "god_nodes_e_acoplamento",
            confidence: 0.89,
            probabilities: { god_nodes_e_acoplamento: 0.89 },
          },
        },
      }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await decideGraphifyEligibilityWithJev({
      prompt: "Quais são os god nodes e módulos mais acoplados antes de eu começar a refatorar?",
      temCodigoExistente: true,
      sessionId: "sess-e4-3",
    });

    expect(result.elegivel).toBe(true);
    expect(result.source).toBe("jev");
    expect(result.foco).toBe("god_nodes_e_acoplamento");
    expect(result.motivo).toContain("god nodes");
  });

  it("4. Executa fallback determinístico gracioso sem quebrar quando Jev está offline", async () => {
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue(null);

    const resultArquitetura = await decideGraphifyEligibilityWithJev({
      prompt: "Preciso ver a arquitetura completa e o mapa de dependências deste projeto.",
      temCodigoExistente: true,
      sessionId: "sess-e4-4",
    });

    expect(resultArquitetura.elegivel).toBe(true);
    expect(resultArquitetura.source).toBe("fallback");
    expect(resultArquitetura.motivo).toContain("fallback");

    const resultPontual = await decideGraphifyEligibilityWithJev({
      prompt: "Mude o texto do label para 'Email do Usuário'",
      temCodigoExistente: true,
      sessionId: "sess-e4-4",
    });

    expect(resultPontual.elegivel).toBe(false);
    expect(resultPontual.source).toBe("fallback");
  });

  it("5. Retorna elegivel=false imediatamente para prompt trivial menor que 10 caracteres", async () => {
    const result = await decideGraphifyEligibilityWithJev({
      prompt: "oi",
      temCodigoExistente: true,
      sessionId: "sess-e4-5",
    });

    expect(result.elegivel).toBe(false);
    expect(result.source).toBe("fallback");
    expect(result.motivo).toContain("muito curto");
  });
});
