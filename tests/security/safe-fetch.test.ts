/**
 * Fase 7 — Testes unitários do anti-SSRF (safe-fetch.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MODULE = "../../src/core/security/safe-fetch";

async function loadSafeFetch() {
  vi.resetModules();
  return import(MODULE);
}

describe("safe-fetch.ts — política anti-SSRF", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SSRF_ALLOWED_HOSTS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("ipIsPrivateOrReserved", () => {
    it("bloqueia ranges privados IPv4 conhecidos", async () => {
      const m = await loadSafeFetch();
      const blocked = [
        "10.0.0.1",
        "10.255.255.255",
        "127.0.0.1",
        "127.5.5.5", // loopback inteiro /8
        "169.254.169.254", // metadados AWS/GCP/Azure
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "192.0.0.1",
        "100.64.0.1", // CGNAT
        "100.127.255.255",
        "224.0.0.1", // multicast
        "240.0.0.1", // reservado
        "0.0.0.0",
      ];
      for (const ip of blocked) {
        expect(m.ipIsPrivateOrReserved(ip), `${ip} deveria ser bloqueado`).toBe(true);
      }
    });

    it("permite IPs públicos", async () => {
      const m = await loadSafeFetch();
      for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.128.0.1", "192.167.1.1"]) {
        expect(m.ipIsPrivateOrReserved(ip), `${ip} deveria ser permitido`).toBe(false);
      }
    });

    it("bloqueia IPv6 loopback/ULA/link-local/multicast e IPv4-mapped", async () => {
      const m = await loadSafeFetch();
      expect(m.ipIsPrivateOrReserved("::1")).toBe(true);
      expect(m.ipIsPrivateOrReserved("fd00::1")).toBe(true);
      expect(m.ipIsPrivateOrReserved("fe80::1")).toBe(true);
      expect(m.ipIsPrivateOrReserved("ff02::1")).toBe(true);
      expect(m.ipIsPrivateOrReserved("::ffff:169.254.169.254")).toBe(true); // evasão clássica
      expect(m.ipIsPrivateOrReserved("2606:4700:4700::1111")).toBe(false); // Cloudflare público
    });

    it("trata string não-IP como suspeita (defensivo)", async () => {
      const m = await loadSafeFetch();
      expect(m.ipIsPrivateOrReserved("nao-e-um-ip")).toBe(true);
    });
  });

  describe("assertSafeUrl", () => {
    it("rejeita protocolos perigosos (file/gopher/dict)", async () => {
      const m = await loadSafeFetch();
      for (const bad of ["file:///etc/passwd", "gopher://127.0.0.1:11211/", "dict://evil/"]) {
        expect(() => m.assertSafeUrl(bad)).toThrow(/protocolo|não permitido/);
      }
    });

    it("rejeita URLs inválidas e hostname ausente", async () => {
      const m = await loadSafeFetch();
      expect(() => m.assertSafeUrl("isso-nao-e-url")).toThrow(/inválida/);
      expect(() => m.assertSafeUrl("http://")).toThrow(/hostname/);
    });

    it("bloqueia IPs literais privados mesmo em URL válida", async () => {
      const m = await loadSafeFetch();
      expect(() => m.assertSafeUrl("http://169.254.169.254/latest/meta-data/")).toThrow(/IP privado/);
      expect(() => m.assertSafeUrl("http://127.0.0.1:20128/v1")).toThrow(/IP privado/);
      expect(() => m.assertSafeUrl("http://[::1]:20128/v1")).toThrow(/IP privado/);
    });

    it("permite IPs públicos literais", async () => {
      const m = await loadSafeFetch();
      expect(() => m.assertSafeUrl("https://8.8.8.8/ping")).not.toThrow();
    });

    it("allowlist padrão cobre o caso de uso legítimo do gateway local", async () => {
      const m = await loadSafeFetch();
      for (const host of [
        "http://localhost:20128/v1",
        "http://host.docker.internal:20128/v1",
        "http://omniroute:20128/v1",
        "http://nextcode-omniroute:20128/v1",
      ]) {
        expect(() => m.assertSafeUrl(host)).not.toThrow();
      }
    });

    it("SSRF_ALLOWED_HOSTS estende a allowlist via env", async () => {
      process.env.SSRF_ALLOWED_HOSTS = "meu-gateway.local, 10.0.5.9 ";
      const m = await loadSafeFetch();
      expect(() => m.assertSafeUrl("http://meu-gateway.local:20128/v1")).not.toThrow();
      // atenção: IP literal privado continua bloqueado (allowlist é por hostname)
      expect(() => m.assertSafeUrl("http://10.0.5.9:20128/v1")).toThrow(/IP privado/);
    });

    it("aceita https público normal", async () => {
      const m = await loadSafeFetch();
      expect(() => m.assertSafeUrl("https://api.openai.com/v1/models")).not.toThrow();
    });
  });

  describe("safeFetch — enforcement no momento da conexão", () => {
    it("faz fetch com redirect:'error' e timeout quando a URL passa", async () => {
      const m = await loadSafeFetch();
      const fakeResponse = new Response("ok");
      const spy = vi.fn(async () => fakeResponse);
      vi.stubGlobal("fetch", spy);

      const res = await m.safeFetch("http://localhost:20128/v1/models", { timeoutMs: 1234 });
      expect(res).toBe(fakeResponse);
      expect(spy).toHaveBeenCalledTimes(1);
      const [, init] = spy.mock.calls[0];
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeDefined();
      vi.unstubAllGlobals();
    });

    it("NUNCA chama fetch para alvo bloqueado (metadados de nuvem)", async () => {
      const m = await loadSafeFetch();
      const spy = vi.fn();
      vi.stubGlobal("fetch", spy);

      await expect(m.safeFetch("http://169.254.169.254/latest/meta-data/iam/")).rejects.toThrow(/SSRF/);
      expect(spy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("bloqueia hostname externo que resolve para IP privado (DNS rebinding)", async () => {
      // re-importa o módulo com dns.lookup mockado ANTES do safeFetch
      vi.resetModules();
      vi.doMock("dns", () => ({
        default: {
          lookup: (_h: string, _o: any, cb: any) => cb(null, { address: "127.0.0.1" }),
        },
      }));
      const m = await import("../../src/core/security/safe-fetch");
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(m.safeFetch("http://evil-rebinding.example/x")).rejects.toThrow(/privado|reservado/);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
      vi.doUnmock("dns");
    });

    it("falha de DNS é tratada como bloqueio (não vaza erro cru de rede)", async () => {
      const m = await loadSafeFetch();
      vi.stubGlobal("fetch", vi.fn());
      await expect(m.safeFetch("http://dominio-inexistente-nxdomain.invalid/x")).rejects.toThrow(/SSRF/);
      vi.unstubAllGlobals();
    });
  });
});
