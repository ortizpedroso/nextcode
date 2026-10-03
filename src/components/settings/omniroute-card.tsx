"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/client-session";
import {
  Cpu,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  Loader2,
  Zap,
  RefreshCw,
  Check,
  XCircle,
  Globe,
  Save,
  ExternalLink,
} from "lucide-react";

export function OmniRouteCard() {
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected" | "error" | "not_installed">("checking");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [endpoint, setEndpoint] = useState<string>("http://localhost:20128/v1");
  const [isValidating, setIsValidating] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [isPrimaryRoute, setIsPrimaryRoute] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const [urlDraft, setUrlDraft] = useState("http://localhost:20128/v1");
  const [keyDraft, setKeyDraft] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);

  const saveManualConfig = async () => {
    setSavingManual(true);
    setFeedbackMsg(null);
    try {
      const payload: Record<string, string> = {};
      if (urlDraft.trim()) payload.omniRouteUrl = urlDraft.trim();
      if (keyDraft.trim()) payload.omniRouteKey = keyDraft.trim();
      if (!Object.keys(payload).length) {
        setFeedbackMsg("Nada para salvar — preencha a URL e/ou cole a API Key.");
        return;
      }
      const res = await authFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, activeProvider: "omniroute" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setKeyDraft("");
        setHasSavedKey(true);
        // Valida a chave NOVA de fato contra o gateway em vez de só dizer "salvo" —
        // sem isso o usuário só descobria que a chave estava errada no próximo refresh manual.
        setFeedbackMsg("Configuração salva e cifrada. Validando contra o gateway...");
        const healthRes = await authFetch("/api/omniroute/health", { method: "POST" });
        const health = await healthRes.json().catch(() => ({}));
        if (health.keyValid) {
          setStatus("connected");
          setLatencyMs(health.latencyMs ?? null);
          setFeedbackMsg(`Chave validada — OmniRoute conectado (${health.latencyMs ?? "?"}ms).`);
        } else if (health.status === "connected_unauthorized") {
          setStatus("error");
          setFeedbackMsg(
            "Chave salva, mas o gateway respondeu 401 (Unauthorized) — confira se copiou a chave certa do Dashboard do OmniRoute."
          );
        } else {
          setStatus("disconnected");
          setFeedbackMsg(health.message || "Chave salva, mas o gateway não respondeu na porta configurada.");
        }
        if (health.endpoint) setEndpoint(health.endpoint);
        if (typeof health.isPrimaryRoute === "boolean") setIsPrimaryRoute(health.isPrimaryRoute);
      } else {
        setFeedbackMsg(data?.error || `Falha ao salvar (HTTP ${res.status}).`);
      }
    } catch (err) {
      setFeedbackMsg(`Erro ao salvar: ${String(err)}`);
    } finally {
      setSavingManual(false);
    }
  };

  const checkStatus = async () => {
    setIsValidating(true);
    try {
      const res = await authFetch("/api/omniroute/health", { method: "POST" });
      const data = await res.json();

      if (data.success || data.status === "connected" || data.status === "online") {
        if (data.status === "connected_unauthorized" || data.keyValid === false) {
          setStatus("error");
          setLatencyMs(null);
        } else {
          setStatus("connected");
          setLatencyMs(data.latencyMs || (data.latency ? parseInt(data.latency) : null));
        }
        if (data.endpoint) setEndpoint(data.endpoint);
        if (typeof data.isPrimaryRoute === "boolean") {
          setIsPrimaryRoute(data.isPrimaryRoute);
        }
      } else {
        setStatus("disconnected");
        setLatencyMs(null);
        if (typeof data.isPrimaryRoute === "boolean") {
          setIsPrimaryRoute(data.isPrimaryRoute);
        }
      }
    } catch {
      setStatus("disconnected");
      setLatencyMs(null);
    } finally {
      setIsValidating(false);
    }
  };

  const handlePrimaryRouteToggle = async (checked: boolean) => {
    setIsPrimaryRoute(checked);
    try {
      const res = await authFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeProvider: checked ? "omniroute" : "auto" }),
      });
      if (res.ok) {
        setFeedbackMsg(
          checked
            ? "OmniRoute configurado como Rota Primária no SQLite (activeProvider = omniroute)."
            : "Rota Primária redefinida para Auto (Smart Router)."
        );
      }
    } catch (err) {
      console.error("Erro ao atualizar rota primária:", err);
    }
  };

  const handle1ClickSetup = async () => {
    setSettingUp(true);
    setFeedbackMsg("Iniciando setup e registro do OmniRoute em 1 clique...");
    try {
      const res = await authFetch("/api/omniroute/setup", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        if (data.status === "connected") {
          setStatus("connected");
          setLatencyMs(data.latencyMs || 10);
          setIsPrimaryRoute(true);
        } else {
          setStatus("disconnected");
          setLatencyMs(null);
          setIsPrimaryRoute(false);
        }
        setFeedbackMsg(data.message || "OmniRoute Local registrado no SQLite!");
      } else {
        setFeedbackMsg(data.error || "Falha ao autoconfigurar OmniRoute.");
      }
    } catch (err) {
      setFeedbackMsg(`Erro no setup: ${String(err)}`);
    } finally {
      setSettingUp(false);
      checkStatus();
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const res = await authFetch("/api/settings");
        const data = await res.json();
        if (data.omniRouteUrl) setUrlDraft(data.omniRouteUrl);
        if (data.hasOmniRouteKey) setHasSavedKey(true);
      } catch {}
      await checkStatus();
    };
    init();
  }, []);

  const renderBadge = () => {
    if (status === "checking") {
      return (
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0066cc]" />
          Verificando Status...
        </span>
      );
    }
    if (status === "connected") {
      return (
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          Conectado {latencyMs ? `(${latencyMs}ms)` : ""}
        </span>
      );
    }
    if (status === "error") {
      return (
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 flex items-center gap-1.5">
          <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          Chave inválida / Erro no Gateway
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
        Desconectado (Gateway Parado)
      </span>
    );
  };

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-900/90 dark:to-slate-950 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
      {/* Cabeçalho do Card */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 text-[#0066cc] dark:text-blue-400 flex items-center justify-center font-bold shadow-sm">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              OmniRoute Local Gateway
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-[#0066cc] border border-blue-200 dark:border-blue-900">
                1-Click Provisioning
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Proxy local inteligente com autoconfiguração e fallbacks offline.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {renderBadge()}
          <button
            onClick={checkStatus}
            disabled={isValidating}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            title="Verificar status e latência de tráfego real (Dry-Run)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin text-[#0066cc]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Informações de Conexão */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/70 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/80 text-xs">
        <div>
          <span className="text-[11px] text-slate-400 block">Endpoint Local:</span>
          <code className="font-mono text-[#0066cc] dark:text-blue-400 font-semibold text-[11px]">
            {endpoint}
          </code>
        </div>
        <div>
          <span className="text-[11px] text-slate-400 block">Modelos roteadores suportados:</span>
          <span className="font-medium text-slate-700 dark:text-slate-300 text-[11px]">
            auto, auto/coding, auto/fast, auto/smart (350+ provedores)
          </span>
        </div>
      </div>

      {/* Configuração manual: URL + API Key do OmniRoute */}
      <div className="bg-white/70 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/80 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[#0066cc]" />
            Conexão manual (URL + API Key gerada no painel do OmniRoute)
          </p>
          <a
            href="http://localhost:20128"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 text-[10px] font-bold flex items-center gap-1 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
            title="Abre o Dashboard do OmniRoute para gerar/rotacionar a API Key"
          >
            <ExternalLink className="w-3 h-3" />
            Gerar nova chave
          </a>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="http://localhost:20128/v1"
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={hasSavedKey ? "API Key já salva — cole nova para substituir" : "API Key do OmniRoute (sk-or-...)"}
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={saveManualConfig}
            disabled={savingManual}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors shrink-0"
          >
            {savingManual ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Salvar e Validar
          </button>
        </div>
        <p className="text-[10px] text-slate-400 leading-snug">
          Gere a chave em http://localhost:20128 (painel do OmniRoute → API Keys). Ela é cifrada com
          AES-256-GCM antes de ir ao SQLite. A URL aceita host:porta, .../v1 ou o endpoint completo.
        </p>
      </div>

      {/* Botão de Ação Principal 1-Click Setup */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <button
          onClick={handle1ClickSetup}
          disabled={settingUp || isValidating}
          className="w-full sm:w-auto px-5 py-2.5 bg-[#0066cc] hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 transition-all cursor-pointer"
        >
          {settingUp ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Configurando e Registrando OmniRoute...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 text-amber-300" />
              <span>Configurar e Iniciar OmniRoute Local (1-Clique)</span>
            </>
          )}
        </button>

        {/* Switch Rota Primária */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isPrimaryRoute}
            onChange={(e) => handlePrimaryRouteToggle(e.target.checked)}
            className="w-4 h-4 text-[#0066cc] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
          />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Usar OmniRoute como rota primária
          </span>
        </label>
      </div>

      {/* Feedback Message */}
      {feedbackMsg && (
        <div className="p-2.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-900 text-[11px] text-slate-800 dark:text-slate-200 flex items-center gap-2 font-medium">
          <Check className="w-3.5 h-3.5 text-[#0066cc] shrink-0" />
          <span className="truncate">{feedbackMsg}</span>
        </div>
      )}
    </div>
  );
}
