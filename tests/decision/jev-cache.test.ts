import { describe, it, expect, beforeEach, vi } from "vitest";
import { JevDecisionCache, globalJevCache } from "@/core/decision/jev-cache";
import { askJevBatch, askJevChoice } from "@/core/decision/jev";
import * as safeFetchModule from "@/core/security/safe-fetch";
import prisma from "@/lib/prisma";

describe("Pacote P6 — Cache Local de Decisões do JEV (TypeSafe AI)", () => {
  beforeEach(() => {
    globalJevCache.clear();
    globalJevCache.setEnabled(true);
    vi.restoreAllMocks();
  });

  it("1. computeKey é determinística e imune à ordem das propriedades em questions", () => {
    const cache = new JevDecisionCache();
    const key1 = cache.computeKey("teste_purpose", "Estado de teste", {
      q1: { type: "choice", instructions: "Instrução 1" },
      q2: { type: "noul", instructions: "Instrução 2" },
    });

    const key2 = cache.computeKey("teste_purpose", "Estado de teste", {
      q2: { type: "noul", instructions: "Instrução 2" },
      q1: { type: "choice", instructions: "Instrução 1" },
    });

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("2. Armazenamento e recuperação fiel de entradas com contabilização de hits e misses", () => {
    const cache = new JevDecisionCache();
    const key = "chave-teste-1";

    expect(cache.get(key)).toBeNull();
    expect(cache.getStats().misses).toBe(1);

    cache.set(key, { resposta: "aprovado", confianca: 0.95 });
    const cached = cache.get<{ resposta: string; confianca: number }>(key);

    expect(cached).toEqual({ resposta: "aprovado", confianca: 0.95 });
    expect(cache.getStats().hits).toBe(1);
    expect(cache.getStats().hitRatePct).toBe(50.0);
  });

  it("3. Expiração por TTL: itens expirados são descartados automaticamente", async () => {
    const cache = new JevDecisionCache({ defaultTtlMs: 20 });
    const key = "chave-expiravel";

    cache.set(key, "valor-temporario", 20); // 20ms
    expect(cache.get(key)).toBe("valor-temporario");

    // Aguarda o TTL vencer
    await new Promise((r) => setTimeout(r, 35));

    expect(cache.get(key)).toBeNull();
  });

  it("4. Descarte do mais antigo ao atingir maxEntries", () => {
    const cache = new JevDecisionCache({ maxEntries: 2 });
    cache.set("k1", "v1");
    cache.set("k2", "v2");
    expect(cache.getStats().size).toBe(2);

    // Inserção da 3ª chave deve descartar k1
    cache.set("k3", "v3");
    expect(cache.get("k1")).toBeNull();
    expect(cache.get("k2")).toBe("v2");
    expect(cache.get("k3")).toBe("v3");
    expect(cache.getStats().size).toBe(2);
  });

  it("5. Bypass quando desabilitado via setEnabled(false)", () => {
    const cache = new JevDecisionCache();
    cache.set("k1", "v1");
    expect(cache.get("k1")).toBe("v1");

    cache.setEnabled(false);
    expect(cache.get("k1")).toBeNull();

    cache.setEnabled(true);
    expect(cache.get("k1")).toBe("v1");
  });

  it("6. Integração E2E com askJevBatch: 2ª chamada idêntica usa cache em <1ms sem chamar rede", async () => {
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: "chave-mock-jev-123",
    } as any);

    let networkCallCount = 0;
    vi.spyOn(safeFetchModule, "safeFetch").mockImplementation(async () => {
      networkCallCount++;
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            intencao: { type: "choice", choice: "status", confidence: 0.92, probabilities: { status: 0.92 } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const params = {
      purpose: "teste_cache_batch",
      state: "Qual o status do projeto?",
      useCache: true,
      questions: {
        intencao: {
          type: "choice" as const,
          instructions: "Classifique a intenção",
          criteria: { status: "Dúvida de status", criar: "Criar novo" },
        },
      },
    };

    // 1ª chamada: Rede chamada (Cache Miss)
    const res1 = await askJevBatch(params);
    expect(res1).toBeDefined();
    expect(networkCallCount).toBe(1);

    // 2ª chamada: Cache Hit (Sem chamada de rede!)
    const res2 = await askJevBatch(params);
    expect(res2).toEqual(res1);
    expect(networkCallCount).toBe(1); // Não incrementou rede!
    expect(globalJevCache.getStats().hits).toBe(1);
  });

  it("7. Integração E2E com askJevChoice: 2ª chamada idêntica usa cache sem chamar rede", async () => {
    vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
      id: "default",
      typesafeKey: "chave-mock-jev-123",
    } as any);

    let networkCallCount = 0;
    vi.spyOn(safeFetchModule, "safeFetch").mockImplementation(async () => {
      networkCallCount++;
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            q: { choice: "sim", confidence: 0.99, probabilities: { sim: 0.99, nao: 0.01 } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const params = {
      purpose: "teste_cache_choice",
      state: "Pergunta simples",
      instructions: "Responda sim ou nao",
      criteria: { sim: "Sim", nao: "Nao" },
      useCache: true,
    };

    const res1 = await askJevChoice<"sim" | "nao">(params);
    expect(res1?.choice).toBe("sim");
    expect(networkCallCount).toBe(1);

    const res2 = await askJevChoice<"sim" | "nao">(params);
    expect(res2?.choice).toBe("sim");
    expect(networkCallCount).toBe(1); // Reutilizou cache!
    expect(globalJevCache.getStats().hits).toBe(1);
  });

  it("C1.2: perguntas com conteúdo diferente geram chaves diferentes", () => {
    const cache = new JevDecisionCache();
    const key1 = cache.computeKey("teste_purpose", "Estado", {
      a: { type: "choice", instructions: "Instrução X", criteria: { s: "Sim" } },
    });
    const key2 = cache.computeKey("teste_purpose", "Estado", {
      a: { type: "choice", instructions: "Instrução Y", criteria: { s: "Sim" } },
    });
    expect(key1).not.toBe(key2);
  });

  it("C1.2: ordem das chaves aninhadas não muda a chave", () => {
    const cache = new JevDecisionCache();
    const key1 = cache.computeKey("teste_purpose", "Estado", {
      a: {
        type: "choice",
        instructions: "Instrução",
        criteria: { primeira: "1", segunda: "2" },
      },
    });
    const key2 = cache.computeKey("teste_purpose", "Estado", {
      a: {
        criteria: { segunda: "2", primeira: "1" },
        instructions: "Instrução",
        type: "choice",
      },
    });
    expect(key1).toBe(key2);
  });
});
