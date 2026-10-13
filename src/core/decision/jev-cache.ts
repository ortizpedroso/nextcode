import * as crypto from "crypto";

export interface JevCacheEntry<T> {
  value: T;
  timestamp: number;
  ttlMs: number;
}

export interface JevCacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRatePct: number;
}

/**
 * Cache semântico em memória para decisões atômicas e em lote do Jev (TypeSafe AI).
 * Princípio: Decisões puras com mesmo estado e perguntas têm veredito idempotente.
 * Respeita TTL configurável (padrão 1 hora) e teto máximo de entradas (LRU simples).
 */
export class JevDecisionCache {
  private cache = new Map<string, JevCacheEntry<any>>();
  private maxEntries: number;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private enabled = true;

  constructor(opts?: { maxEntries?: number; defaultTtlMs?: number; enabled?: boolean }) {
    this.maxEntries = opts?.maxEntries ?? 500;
    this.defaultTtlMs = opts?.defaultTtlMs ?? 3600 * 1000; // 1 hora
    this.enabled = opts?.enabled ?? true;
  }

  /**
   * Gera uma chave SHA-256 estável e determinística.
   */
  public computeKey(purpose: string, state: string, questions: unknown): string {
    function stableStringify(val: unknown): string {
      if (val === null || typeof val !== "object") {
        return JSON.stringify(val);
      }
      if (Array.isArray(val)) {
        return `[${val.map((item) => stableStringify(item)).join(",")}]`;
      }
      const obj = val as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
      return `{${entries.join(",")}}`;
    }

    const serializedQuestions = stableStringify(questions);
    const payload = `${purpose}::${state.trim()}::${serializedQuestions}`;
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  public get<T>(key: string): T | null {
    if (!this.enabled) {
      this.misses++;
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlMs?: number): void {
    if (!this.enabled) return;

    // Se atingir o teto de capacidade, descarta a entrada mais antiga (FIFO/LRU básico no Map)
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getStats(): JevCacheStats {
    const total = this.hits + this.misses;
    const hitRatePct = total > 0 ? Number(((this.hits / total) * 100).toFixed(1)) : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRatePct,
    };
  }
}

// Instância Singleton do cache para o processo
export const globalJevCache = new JevDecisionCache();
