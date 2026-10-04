/**
 * Descoberta de modelos VERIFICADOS do OmniRoute.
 *
 * Problema que resolve: o router pedia combos virtuais do gateway (`auto/best-free`,
 * `auto/chat`...). Cada combo sorteia entre centenas de alvos do catálogo (473 no caso
 * medido) — inclusive provedores SEM credencial (ex.: `oc/` exige chave do OpenCode, 402/403)
 * — e só tenta o próximo depois que o anterior falha. Resultado: 46s até um 502, enquanto
 * modelos que funcionam (respostas em 2–20s) existiam no mesmo gateway.
 *
 * Aqui o NextCode descobre por conta própria o que funciona de verdade:
 *  1. lê o catálogo (/v1/models) e as conexões (/api/providers) do gateway;
 *  2. mantém só modelos de provedores com conexão ATIVA (`owned_by` === `provider`);
 *  3. testa cada candidato com uma requisição real e curta; só entra quem devolve conteúdo;
 *  4. ordena por latência medida e guarda em cache (TTL), revalidando em segundo plano.
 * Nada de IDs de modelo fixos no código: eles envelhecem (vide Groq/NVIDIA com modelos
 * descontinuados).
 */

import { safeFetch } from "../security/safe-fetch";

export interface VerifiedOmniModel {
  id: string;
  latencyMs: number;
  verifiedAt: number;
}

export interface OmniDiscoveryConfig {
  rootUrl: string;
  chatUrl: string;
  apiKey: string;
}

interface DiscoveryState {
  models: VerifiedOmniModel[];
  discoveredAt: number;
  inFlight: Promise<VerifiedOmniModel[]> | null;
  lastSummary: string;
  lastConfig: OmniDiscoveryConfig | null;
  catalogFailed: boolean;
}

// Em `next dev` cada rota reavalia os módulos; o estado compartilhado fica em globalThis.
const globalForDiscovery = globalThis as unknown as { nextcodeOmniDiscovery?: DiscoveryState };
const state: DiscoveryState = (globalForDiscovery.nextcodeOmniDiscovery ??= {
  models: [],
  discoveredAt: 0,
  inFlight: null,
  lastSummary: "nunca executada",
  lastConfig: null,
  catalogFailed: false,
});

// Lidos no uso (não no import): permite ajustar por env sem reiniciar e em testes.
const ttlMs = () => Number(process.env.OMNIROUTE_DISCOVERY_TTL_MS) || 30 * 60 * 1000;
const maxCandidates = () => Number(process.env.OMNIROUTE_DISCOVERY_MAX_CANDIDATES) || 24;
const probeTimeoutMs = () => Number(process.env.OMNIROUTE_DISCOVERY_PROBE_TIMEOUT_MS) || 25000;
const PROBE_CONCURRENCY = 4;
/** Quantos modelos verificados bastam para liberar o chamador; o resto termina em background. */
const MIN_READY = 2;
/** Teto de espera do chamador pela varredura (se nada responder, segue sem travar a mensagem). */
const maxWaitMs = () => Number(process.env.OMNIROUTE_DISCOVERY_MAX_WAIT_MS) || 30000;
/** Varredura que não achou nenhum modelo só é refeita depois deste intervalo (não a cada mensagem). */
const EMPTY_RETRY_MS = 2 * 60 * 1000;
/** Catálogo inacessível (erro transitório do gateway): nova varredura bem mais cedo. */
const CATALOG_ERROR_RETRY_MS = 15 * 1000;

/** Lista atual de modelos verificados (mais rápido primeiro). */
export function getVerifiedOmniModels(): VerifiedOmniModel[] {
  return [...state.models];
}

/** Aguarda a varredura em andamento (se houver) terminar. */
export async function waitForOmniDiscovery(): Promise<void> {
  if (state.inFlight) await state.inFlight.catch(() => undefined);
}

export function getOmniDiscoveryStatus(): { models: VerifiedOmniModel[]; discoveredAt: string | null; summary: string } {
  return {
    models: getVerifiedOmniModels(),
    discoveredAt: state.discoveredAt ? new Date(state.discoveredAt).toISOString() : null,
    summary: state.lastSummary,
  };
}

/** Rebaixa um modelo que falhou em uso real: sai da lista até a próxima descoberta. */
export function reportOmniModelFailure(id: string): void {
  state.models = state.models.filter((m) => m.id !== id);
  // Lista ficando curta: revalida em background, sem bloquear a mensagem atual.
  if (state.models.length < MIN_READY && !state.inFlight && state.lastConfig) {
    startDiscovery(state.lastConfig);
  }
}

/** Atualiza a latência observada em uso real (média móvel simples) e reordena. */
export function reportOmniModelSuccess(id: string, latencyMs: number): void {
  const model = state.models.find((m) => m.id === id);
  if (!model) return;
  model.latencyMs = Math.round(model.latencyMs * 0.7 + latencyMs * 0.3);
  state.models.sort((a, b) => a.latencyMs - b.latencyMs);
}

/** Zera o cache (ex.: chave/URL do gateway mudou). */
export function resetOmniDiscovery(): void {
  state.models = [];
  state.discoveredAt = 0;
}

/**
 * Garante uma lista de modelos verificados. Se o cache está fresco e tem modelos suficientes,
 * devolve na hora. Senão dispara a descoberta (uma por vez) e espera só até MIN_READY modelos
 * responderem — os demais testes continuam em background e completam a lista.
 */
export async function ensureVerifiedOmniModels(
  config: OmniDiscoveryConfig,
  signal?: AbortSignal
): Promise<VerifiedOmniModel[]> {
  const configChanged =
    state.lastConfig !== null &&
    (state.lastConfig.chatUrl !== config.chatUrl || state.lastConfig.apiKey !== config.apiKey);
  if (configChanged) resetOmniDiscovery();
  state.lastConfig = config;

  const age = Date.now() - state.discoveredAt;
  const needsRun =
    state.discoveredAt === 0 ||
    age > ttlMs() ||
    (state.models.length === 0 && age > (state.catalogFailed ? CATALOG_ERROR_RETRY_MS : EMPTY_RETRY_MS));
  if (needsRun && !state.inFlight) startDiscovery(config);

  // Já há modelos suficientes (ou nenhuma varredura em andamento), ou o chamador já
  // desistiu: responde na hora com o que houver.
  if (state.models.length >= MIN_READY || !state.inFlight || signal?.aborted) return getVerifiedOmniModels();

  // Varredura em andamento sem modelos suficientes: espera só até MIN_READY responderem — os
  // demais testes continuam em background e completam a lista.
  const inFlight = state.inFlight;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      signal?.removeEventListener("abort", finish);
      resolve(getVerifiedOmniModels());
    };
    // O chamador (ex.: guard de timeout da etapa da DAG) desistiu: não segura a mensagem.
    signal?.addEventListener("abort", finish, { once: true });
    const waitStarted = Date.now();
    const poll = setInterval(() => {
      if (state.models.length >= MIN_READY || Date.now() - waitStarted > maxWaitMs()) finish();
    }, 150);
    inFlight.then(finish, finish);
  });
}

function startDiscovery(config: OmniDiscoveryConfig): void {
  state.inFlight = runDiscovery(config).finally(() => {
    state.inFlight = null;
  });
}

interface CatalogModel {
  id: string;
  owned_by?: string;
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const res = await safeFetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    timeoutMs: 10000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

/** Provedores com conexão ativa no gateway (null se a API de gestão não estiver acessível). */
async function activeProviders(config: OmniDiscoveryConfig): Promise<Set<string> | null> {
  try {
    const data = (await fetchJson(`${config.rootUrl}/api/providers`, config.apiKey)) as
      | Array<Record<string, unknown>>
      | { providers?: Array<Record<string, unknown>>; connections?: Array<Record<string, unknown>> };
    const list = Array.isArray(data) ? data : data.providers || data.connections || [];
    const active = list
      .filter((c) => c.isActive !== false && c.testStatus !== "error" && c.testStatus !== "failed")
      .map((c) => String(c.provider || ""))
      .filter(Boolean);
    return new Set(active);
  } catch {
    return null;
  }
}

/**
 * Ordem de teste dos candidatos: modelos explicitamente gratuitos primeiro (sem risco de
 * cobrança e mais prováveis de funcionar sem créditos), depois os demais. Combos virtuais
 * (`owned_by: "combo"`) ficam de fora — são exatamente o que causava o problema.
 */
function rankCandidates(catalog: CatalogModel[], providers: Set<string> | null): string[] {
  const isCombo = (m: CatalogModel) => m.owned_by === "combo" || /^auto(\/|$)/i.test(m.id);
  const eligible = catalog.filter(
    (m) => !isCombo(m) && (!providers || (m.owned_by && providers.has(m.owned_by)))
  );
  const isFree = (id: string) => /(:free|-free)$/i.test(id);
  return [...eligible.filter((m) => isFree(m.id)), ...eligible.filter((m) => !isFree(m.id))]
    .map((m) => m.id)
    .slice(0, maxCandidates());
}

async function probeModel(config: OmniDiscoveryConfig, id: string): Promise<VerifiedOmniModel | null> {
  const started = Date.now();
  try {
    const res = await safeFetch(config.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      // max_tokens folgado: modelos de raciocínio gastam tokens "pensando" antes de responder
      // — com limite baixo devolvem 200 com conteúdo vazio, que não serve para nada.
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "Escreva uma função TypeScript soma(a, b). Responda só com o código." }],
        max_tokens: 400,
        stream: false,
      }),
      timeoutMs: probeTimeoutMs(),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = json?.choices?.[0]?.message?.content?.trim() || "";
    if (!content) return null;
    return { id, latencyMs: Date.now() - started, verifiedAt: Date.now() };
  } catch {
    return null;
  }
}

async function runDiscovery(config: OmniDiscoveryConfig): Promise<VerifiedOmniModel[]> {
  const started = Date.now();
  let catalog: CatalogModel[] | null = null;
  let catalogError = "";
  // O gateway às vezes devolve erro transitório no catálogo (medido: 401 momentâneo enquanto
  // ele recalculava conexões): uma nova tentativa curta antes de desistir.
  for (let attempt = 1; attempt <= 2 && !catalog; attempt++) {
    try {
      const data = (await fetchJson(`${config.rootUrl}/v1/models`, config.apiKey)) as { data?: CatalogModel[] };
      catalog = data.data || [];
    } catch (err) {
      catalogError = String(err).slice(0, 120);
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  state.catalogFailed = !catalog;
  if (!catalog) {
    state.lastSummary = `catálogo indisponível: ${catalogError}`;
    state.discoveredAt = Date.now();
    return getVerifiedOmniModels();
  }

  const providers = await activeProviders(config);
  const candidates = rankCandidates(catalog, providers);
  const found: VerifiedOmniModel[] = [];
  // Mantém os modelos já verificados utilizáveis enquanto a nova varredura roda.
  const publish = () => {
    const merged = new Map(state.models.map((m) => [m.id, m]));
    for (const m of found) merged.set(m.id, m);
    state.models = Array.from(merged.values()).sort((a, b) => a.latencyMs - b.latencyMs);
  };

  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const id = candidates[next++];
      const verified = await probeModel(config, id);
      if (verified) {
        found.push(verified);
        publish();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, candidates.length) }, worker));

  // Fim da varredura: a lista passa a ser exatamente o que respondeu agora.
  state.models = found.sort((a, b) => a.latencyMs - b.latencyMs);
  state.discoveredAt = Date.now();
  state.lastSummary =
    `${found.length}/${candidates.length} candidatos responderam ` +
    `(${providers ? `provedores ativos: ${Array.from(providers).join(", ")}` : "API de provedores indisponível"}; ` +
    `${Math.round((Date.now() - started) / 1000)}s)`;
  console.log(`[ROUTER] Descoberta OmniRoute: ${state.lastSummary}.`);
  return getVerifiedOmniModels();
}
