/**
 * Fase 7 — Testes unitários da autenticação local + rate limit (local-auth.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MODULE = "../../src/core/security/local-auth";

async function loadAuth(env: Record<string, string> = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import(MODULE);
}

const ORIGINAL_ENV = { ...process.env };

function fakeRequest(headers: Record<string, string>) {
  // Minimal NextRequest-like: requireAuth só usa req.headers.get()
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null } } as any;
}

describe("local-auth.ts — token, rate-limit e guard", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("verifyToken", () => {
    it("aceita o token do env NEXTCODE_AUTH_TOKEN", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "token-fixo-de-teste" });
      expect(m.verifyToken("token-fixo-de-teste")).toBe(true);
    });

    it("rejeita token errado, vazio, null e undefined", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "token-fixo-de-teste" });
      expect(m.verifyToken("errado")).toBe(false);
      expect(m.verifyToken("")).toBe(false);
      expect(m.verifyToken(null)).toBe(false);
      expect(m.verifyToken(undefined)).toBe(false);
    });

    it("rejeita token de comprimento diferente sem lançar (timingSafeEqual protegido)", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "abcdefghij" });
      expect(() => m.verifyToken("x")).not.toThrow();
      expect(m.verifyToken("x")).toBe(false);
      expect(m.verifyToken("abcdefghijk-extra-long")).toBe(false);
    });

    it("sem env: gera token runtime aleatório estável entre chamadas", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "" });
      const t1 = m.getRuntimeToken();
      const t2 = m.getRuntimeToken();
      expect(t1).toMatch(/^[0-9a-f]{48}$/); // 24 bytes hex
      expect(t1).toBe(t2); // memoizado em memória
      expect(m.verifyToken(t1)).toBe(true);
    });
  });

  describe("rateLimited (token bucket por IP)", () => {
    it("permite até o limite e bloqueia acima dele", async () => {
      const m = await loadAuth({ NEXTCODE_RATE_LIMIT: "5" });
      for (let i = 0; i < 5; i++) {
        expect(m.rateLimited("1.2.3.4"), `req ${i + 1}`).toBe(false);
      }
      expect(m.rateLimited("1.2.3.4")).toBe(true); // 6ª req bloqueada
      expect(m.rateLimited("1.2.3.4")).toBe(true);
    });

    it("IPs diferentes têm buckets independentes", async () => {
      const m = await loadAuth({ NEXTCODE_RATE_LIMIT: "2" });
      expect(m.rateLimited("10.0.0.1")).toBe(false);
      expect(m.rateLimited("10.0.0.1")).toBe(false);
      expect(m.rateLimited("10.0.0.1")).toBe(true);
      expect(m.rateLimited("10.0.0.2")).toBe(false); // outro IP unaffected
    });

    it("janela expira e o bucket reinicia (fake timers)", async () => {
      vi.useFakeTimers();
      try {
        const m = await loadAuth({ NEXTCODE_RATE_LIMIT: "1" });
        expect(m.rateLimited("9.9.9.9")).toBe(false);
        expect(m.rateLimited("9.9.9.9")).toBe(true);
        vi.advanceTimersByTime(61_000); // > janela de 60s
        expect(m.rateLimited("9.9.9.9")).toBe(false); // janela nova
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("requireAuth (guard das rotas mutativas)", () => {
    it("401 sem header X-Nextcode-Token", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "tok-valido" });
      const res = m.requireAuth(fakeRequest({}));
      expect(res.ok).toBe(false);
      expect(res.response?.status).toBe(401);
    });

    it("ok com token correto", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "tok-valido" });
      const res = m.requireAuth(fakeRequest({ "x-nextcode-token": "tok-valido" }));
      expect(res.ok).toBe(true);
      expect(res.response).toBeUndefined();
    });

    it("429 quando estoura o rate limit, mesmo COM token válido", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "tok-valido", NEXTCODE_RATE_LIMIT: "2" });
      const req = fakeRequest({ "x-nextcode-token": "tok-valido", "x-forwarded-for": "5.5.5.5" });
      expect(m.requireAuth(req).ok).toBe(true);
      expect(m.requireAuth(req).ok).toBe(true);
      const third = m.requireAuth(req);
      expect(third.ok).toBe(false);
      expect(third.response?.status).toBe(429);
    });

    it("usa x-forwarded-for (primeiro valor) como chave do bucket", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "t", NEXTCODE_RATE_LIMIT: "1" });
      const a = fakeRequest({ "x-nextcode-token": "t", "x-forwarded-for": "7.7.7.7, proxy" });
      const b = fakeRequest({ "x-nextcode-token": "t", "x-forwarded-for": "8.8.8.8, proxy" });
      expect(m.requireAuth(a).ok).toBe(true);
      expect(m.requireAuth(a).response?.status).toBe(429);
      expect(m.requireAuth(b).ok).toBe(true); // IP real distinto -> bucket distinto
    });

    it("respostas de erro nunca contêm o token esperado", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "segredo-nao-vazar" });
      const res = m.requireAuth(fakeRequest({ "x-nextcode-token": "wrong" }));
      const body = await res.response?.json();
      expect(JSON.stringify(body)).not.toContain("segredo-nao-vazar");
    });
  });

  describe("requireReadAuth (guard dos GETs com dados locais)", () => {
    it("401 sem header e 401 com token errado", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "tok-leitura" });
      expect(m.requireReadAuth(fakeRequest({})).response?.status).toBe(401);
      expect(m.requireReadAuth(fakeRequest({ "X-Nextcode-Token": "outro" })).response?.status).toBe(401);
    });

    it("aceita o token válido e NÃO aplica rate limit (a UI faz polling dos GETs)", async () => {
      const m = await loadAuth({ NEXTCODE_AUTH_TOKEN: "tok-leitura", NEXTCODE_RATE_LIMIT: "1" });
      for (let i = 0; i < 10; i++) {
        const res = m.requireReadAuth(fakeRequest({ "X-Nextcode-Token": "tok-leitura" }));
        expect(res.ok).toBe(true);
      }
    });
  });

  describe("maskKey", () => {
    it("mostra apenas os 4 últimos caracteres", async () => {
      const m = await loadAuth({});
      expect(m.maskKey("sk-supersecreta-XYZW")).toBe("••••XYZW");
      expect(m.maskKey("ab")).toBe("••••");
      expect(m.maskKey(null)).toBe("");
      expect(m.maskKey("")).toBe("");
    });
  });
});
