"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Loader2, RefreshCw, Save, XCircle } from "lucide-react";

interface GatewayRow {
  id: "freellmapi" | "omniroute";
  label: string;
  dashboardUrl: string;
  enabled: boolean;
  priority: number;
  baseUrl: string;
  hasKey: boolean;
  maskedKey: string;
  modelFast: string | null;
  modelHeavy: string | null;
  defaultModelFast: string | null;
  defaultModelHeavy: string | null;
}

interface GatewayHealth {
  id: GatewayRow["id"];
  label: string;
  reachable: boolean;
  authOk: boolean | null;
  chatOk: boolean;
  servedBy: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
  model: string | null;
  error: string | null;
  action: string | null;
}

interface Draft {
  baseUrl: string;
  apiKey: string;
  modelFast: string;
  modelHeavy: string;
}

/**
 * Gateways LLM em ordem de uso (FreeLLMAPI, OmniRoute). O diagnóstico faz uma conversa real com o
 * modelo configurado: verde aqui significa que o chat e a DAG vão funcionar por esse gateway.
 */
export function LlmGatewaysCard() {
  const [gateways, setGateways] = useState<GatewayRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [health, setHealth] = useState<Record<string, GatewayHealth>>({});
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const res = await authFetch("/api/llm/gateways");
    const data = await res.json().catch(() => ({ gateways: [] }));
    const rows: GatewayRow[] = data.gateways || [];
    setGateways(rows);
    setDrafts(
      Object.fromEntries(
        rows.map((g) => [
          g.id,
          { baseUrl: g.baseUrl, apiKey: "", modelFast: g.modelFast ?? "", modelHeavy: g.modelHeavy ?? "" },
        ])
      )
    );
  };

  const runHealth = async () => {
    setChecking(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/llm/health", { method: "POST" });
      const data = await res.json().catch(() => ({ gateways: [] }));
      setHealth(Object.fromEntries((data.gateways || []).map((h: GatewayHealth) => [h.id, h])));
      setMessage(
        data.ready
          ? `Pronto: as chamadas saem por ${data.gateways.find((g: GatewayHealth) => g.id === data.primary)?.label}.`
          : "Nenhum gateway respondeu a uma conversa real. Siga a ação indicada em cada um."
      );
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    load().then(runHealth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (gw: GatewayRow) => {
    const d = drafts[gw.id];
    setSaving(gw.id);
    setMessage(null);
    try {
      const res = await authFetch("/api/llm/gateways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: gw.id,
          baseUrl: d.baseUrl,
          ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}),
          modelFast: d.modelFast,
          modelHeavy: d.modelHeavy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || `Falha ao salvar (HTTP ${res.status}).`);
        return;
      }
      await load();
      await runHealth();
    } finally {
      setSaving(null);
    }
  };

  const toggle = async (gw: GatewayRow) => {
    await authFetch("/api/llm/gateways", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: gw.id, enabled: !gw.enabled }),
    });
    await load();
  };

  const move = async (index: number, delta: number) => {
    const reordered = [...gateways];
    const [item] = reordered.splice(index, 1);
    reordered.splice(index + delta, 0, item);
    await authFetch("/api/llm/gateways", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gateways: reordered.map((g, i) => ({ id: g.id, priority: i })) }),
    });
    await load();
  };

  const setDraft = (id: string, field: keyof Draft, value: string) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Gateways LLM</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Ordem de uso: o primeiro que responder atende. Depois deles, as chaves BYOK diretas.
          </p>
        </div>
        <button
          onClick={runHealth}
          disabled={checking}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Diagnosticar
        </button>
      </div>

      {message && (
        <div className="text-xs px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
          {message}
        </div>
      )}

      {gateways.map((gw, index) => {
        const h = health[gw.id];
        const d = drafts[gw.id];
        if (!d) return null;
        return (
          <div
            key={gw.id}
            className={`rounded-xl border p-4 space-y-3 ${
              gw.enabled ? "border-slate-200 dark:border-slate-800" : "border-dashed border-slate-300 dark:border-slate-700 opacity-60"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">{index + 1}.</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{gw.label}</span>
                {!gw.enabled ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                    Desativado
                  </span>
                ) : h &&
                  (h.chatOk ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Pronto · {h.servedBy} · {h.latencyMs}ms
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400 flex items-center gap-1">
                      <XCircle className="w-3 h-3" />
                      {!h.reachable ? "Fora do ar" : h.authOk === false ? "Chave inválida" : "Sem resposta do modelo"}
                    </span>
                  ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                  title="Subir na ordem"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === gateways.length - 1}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                  title="Descer na ordem"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <label className="flex items-center gap-1 text-xs ml-2 cursor-pointer">
                  <input type="checkbox" checked={gw.enabled} onChange={() => toggle(gw)} />
                  Ativo
                </label>
              </div>
            </div>

            {gw.enabled && h && !h.chatOk && (h.error || h.action) && (
              <div className="text-xs rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 px-3 py-2 space-y-1">
                {h.error && <div>{h.error}</div>}
                {h.action && <div className="font-medium">→ {h.action}</div>}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-500 space-y-1">
                <span>URL (compatível com OpenAI)</span>
                <input
                  value={d.baseUrl}
                  onChange={(e) => setDraft(gw.id, "baseUrl", e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </label>
              <label className="text-[11px] text-slate-500 space-y-1">
                <span>{gw.id === "freellmapi" ? "Chave unificada" : "API key"}</span>
                <input
                  type="password"
                  value={d.apiKey}
                  placeholder={gw.hasKey ? `salva: ${gw.maskedKey}` : "cole a chave"}
                  onChange={(e) => setDraft(gw.id, "apiKey", e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </label>
              <label className="text-[11px] text-slate-500 space-y-1">
                <span>Modelo rápido (chat, classificação, DAG)</span>
                <input
                  value={d.modelFast}
                  placeholder={gw.defaultModelFast ?? "cascata automática"}
                  onChange={(e) => setDraft(gw.id, "modelFast", e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </label>
              <label className="text-[11px] text-slate-500 space-y-1">
                <span>Modelo pesado</span>
                <input
                  value={d.modelHeavy}
                  placeholder={gw.defaultModelHeavy ?? "cascata automática"}
                  onChange={(e) => setDraft(gw.id, "modelHeavy", e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <a
                href={gw.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#0066cc] dark:text-blue-400 flex items-center gap-1 hover:underline"
              >
                Abrir painel do {gw.label} <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={() => save(gw)}
                disabled={saving === gw.id}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0066cc] hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-60"
              >
                {saving === gw.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar e testar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
