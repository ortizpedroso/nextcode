// ---------------------------------------------------------------------------
// Fase 12 — Quota Tracker: cooldown por combo quando a COTA esgota (HTTP 402/429).
//
// Contexto do bug real (diagnóstico capturado em produção):
//   OmniRoute: HTTP 402 "[openrouter/openrouter/auto] This request requires more
//   credits, or fewer max_tokens..."
// O OmniRoute aceita qualquer combo "auto/*", mas cada combo tem um POOL de
// provedores com cotas próprias. Quando o pool do combo esgota, TODAS as
// requisições daquele combo falham com 402 até o reset diário dos free tiers
// (meia-noite UTC). Sem este tracker, a cascata repetia o combo esgotado a cada
// mensagem e derrubava tudo para o fallback Gemini exibindo "Cotas Indisponíveis".
//
// Com o tracker: o combo esgotado entra em cooldown (até o próximo reset UTC),
// a cascata pula silenciosamente para o próximo combo e o gateway continua
// servindo via outros pools/provedores — que é exatamente o papel dele.
// ---------------------------------------------------------------------------

/** Janela máxima de cooldown: se não soubermos o reset, assume fim do dia UTC. */
const MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h (nunca prende o combo por 24h)

export interface ComboQuotaStatus {
  model: string;
  untilIso: string;      // fim do cooldown (ISO)
  reason: string;        // ex.: "HTTP 402" / "HTTP 429"
  hits: number;          // quantas vezes esgotou desde o último reset
}

// model -> timestamp ms até quando NÃO tentar de novo
const cooldowns = new Map<string, number>();
const lastReason = new Map<string, string>();
const hitCount = new Map<string, number>();

/** Próximo reset diário UTC (meia-noite). Free tiers Google/OpenRouter/Pollinations resetam aqui. */
export function nextUtcMidnightMs(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return Math.min(next - now, MAX_COOLDOWN_MS) + now;
}

/**
 * Registra que um combo esgotou cota. Ignora status que não são quota
 * (5xx/redes não entram aqui — pertencem ao circuit-breaker do gateway).
 */
export function markComboExhausted(model: string, status: number): void {
  if (status !== 402 && status !== 429) return;
  const until = nextUtcMidnightMs();
  // 429 costuma ser rate-limit passageiro (minutos); 402 é crédito/cota diária.
  const windowMs = status === 429 ? Math.min(5 * 60 * 1000, until - Date.now()) : until - Date.now();
  cooldowns.set(model, Date.now() + windowMs);
  lastReason.set(model, `HTTP ${status}`);
  hitCount.set(model, (hitCount.get(model) ?? 0) + 1);
  console.warn(
    `[QUOTA] Combo "${model}" esgotado (${status}) — em cooldown ate ${new Date(Date.now() + windowMs).toISOString()} ` +
      `(total de esgotamentos: ${hitCount.get(model)}).`
  );
}

/** True se o combo está em cooldown de cota e deve ser PULADO na cascata. */
export function isComboOnCooldown(model: string, now = Date.now()): boolean {
  const until = cooldowns.get(model);
  if (until === undefined) return false;
  if (now >= until) {
    cooldowns.delete(model); // expirou: volta a ser elegível
    return false;
  }
  return true;
}

/** Status atual (para /api/metrics e painel da UI). Combos expirados somem sozinhos. */
export function getQuotaStatus(now = Date.now()): ComboQuotaStatus[] {
  const out: ComboQuotaStatus[] = [];
  for (const [model, until] of cooldowns.entries()) {
    if (now >= until) {
      cooldowns.delete(model);
      continue;
    }
    out.push({
      model,
      untilIso: new Date(until).toISOString(),
      reason: lastReason.get(model) ?? "?",
      hits: hitCount.get(model) ?? 1,
    });
  }
  return out.sort((a, b) => a.model.localeCompare(b.model));
}

/** Limpa cooldowns (usado em testes e pelo botão "recarregar" da UI). */
export function clearQuotaCooldowns(): void {
  cooldowns.clear();
  lastReason.clear();
  hitCount.clear();
}
