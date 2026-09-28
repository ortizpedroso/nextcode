/**
 * Fase 3 — Anti-SSRF.
 *
 * Endpoints que aceitam URLs configuráveis pelo usuário (setup/health/audit do
 * OmniRoute) NÃO podem fazer fetch cego: um atacante poderia apontar para
 * 169.254.169.254 (metadados de nuvem), redes internas, file:// etc.
 *
 * Estratégia:
 *  - exige http/https e hostname explícito;
 *  - bloqueia IPs privados/link-local/multicast/loopback por padrão, COM
 *    allowlist local deliberada (localhost / host.docker.internal / rede do
 *    compose) porque o OmniRoute é, por design, um gateway LOCAL;
 *  - resolve DNS antes de conectar e revalida o IP resolvido (mitiga DNS
 *    rebinding de domínios que apontam para 127.0.0.1);
 *  - redirect: "error" + timeout obrigatório.
 */
import dns from "dns";
import net from "net";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

const DEFAULT_ALLOWED_HOSTS = new Set([
  "localhost",
  "host.docker.internal",
  "omniroute", // serviço da rede do docker-compose
  "nextcode-omniroute",
]);

export class SsrfError extends Error {
  constructor(reason: string) {
    super(`URL bloqueada pela política anti-SSRF: ${reason}`);
    this.name = "SsrfError";
  }
}

export function ipIsPrivateOrReserved(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (inclui 169.254.169.254 AWS/GCP metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 192 && b === 0) return true; // TEST-NET / port relay
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    if (a === 0) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^f[cd]/.test(lower)) return true; // unique-local fc00::/7
    if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipIsPrivateOrReserved(mapped[1]);
    return false;
  }
  return true; // não é IP parseável -> trata como suspeito
}

function allowedHosts(): Set<string> {
  const extra = (process.env.SSRF_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...extra]);
}

export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("URL inválida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`protocolo '${url.protocol}' não permitido (apenas http/https)`);
  }
  const host = url.hostname.toLowerCase();
  if (!host) throw new SsrfError("hostname ausente");

  const literalIp = net.isIP(host) ? host : null;
  if (literalIp) {
    if (ipIsPrivateOrReserved(literalIp)) {
      throw new SsrfError(`IP privado/reservado ${host} bloqueado`);
    }
    return url;
  }

  // Hostnames permitidos explicitamente (gateway local é o caso de uso legítimo)
  if (allowedHosts().has(host)) return url;

  // Qualquer outro host: validação pós-DNS acontece em safeFetch
  return url;
}

/** Resolve DNS e valida o IP efetivo — mitiga DNS rebinding. */
async function validateResolvedAddress(url: URL): Promise<void> {
  if (net.isIP(url.hostname)) return; // já validado em assertSafeUrl
  if (allowedHosts().has(url.hostname.toLowerCase())) return; // alvo local intencional
  try {
    const { address } = await lookup(url.hostname, { all: false });
    if (ipIsPrivateOrReserved(address)) {
      throw new SsrfError(
        `hostname '${url.hostname}' resolve para endereço privado/reservado (${address})`
      );
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError(`falha na resolução DNS de '${url.hostname}'`);
  }
}

export interface SafeFetchInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * fetch() endurecido: valida a URL (estática + pós-DNS), proíbe redirects e
 * impõe timeout. Use em TODOS os pontos que consumem URLs configuráveis.
 */
export async function safeFetch(rawUrl: string, init: SafeFetchInit = {}): Promise<Response> {
  const url = assertSafeUrl(rawUrl);
  await validateResolvedAddress(url);
  const { timeoutMs = 5000, ...rest } = init;
  return fetch(url.toString(), {
    ...rest,
    redirect: "error",
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
