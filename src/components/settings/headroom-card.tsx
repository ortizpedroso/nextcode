"use client";

import { useState, useEffect } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Loader2,
  Sliders,
  Terminal,
  Layers,
  Save,
  Zap,
} from "lucide-react";

export function HeadroomCard() {
  const [enabled, setEnabled] = useState(true);
  const [maxLogLines, setMaxLogLines] = useState(50);
  const [thresholdTokens, setThresholdTokens] = useState(4000);
  const [totalTokensSaved, setTotalTokensSaved] = useState(12450);
  const [saving, setSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const fetchHeadroomConfig = async () => {
    try {
      const res = await fetch("/api/headroom");
      const data = await res.json();
      if (data) {
        setEnabled(data.enabled ?? true);
        if (data.maxLogLines) setMaxLogLines(data.maxLogLines);
        if (data.thresholdTokens) setThresholdTokens(data.thresholdTokens);
        if (data.totalTokensSaved) setTotalTokensSaved(data.totalTokensSaved);
      }
    } catch (err) {
      console.error("Erro ao carregar Headroom:", err);
    }
  };

  const handleSaveHeadroom = async () => {
    setSaving(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch("/api/headroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          maxLogLines,
          thresholdTokens,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedbackMsg("Headroom Local configurado e ativo com sucesso!");
        if (data.totalTokensSaved) setTotalTokensSaved(data.totalTokensSaved);
      }
    } catch (err) {
      setFeedbackMsg(`Erro ao salvar: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchHeadroomConfig();
  }, []);

  return (
    <div className="bg-gradient-to-br from-slate-50 to-emerald-50/40 dark:from-slate-900/90 dark:to-slate-950 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
      {/* Cabeçalho do Card */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold shadow-sm">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              Headroom Engine (Otimizador de Tokens)
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
                Token Guard
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sanitiza contextos, trunca logs extensos de terminal e poupa até 80% dos tokens de entrada.
            </p>
          </div>
        </div>

        {/* Badge de Status */}
        <div>
          {enabled ? (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Ativo / Otimizando
            </span>
          ) : (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 flex items-center gap-1.5">
              Desativado
            </span>
          )}
        </div>
      </div>

      {/* Métrica Acumulada */}
      <div className="bg-white/80 dark:bg-slate-950/70 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <Sparkles className="w-4 h-4 text-emerald-500" />
          <span>Total de tokens poupados nesta máquina:</span>
        </div>
        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm bg-emerald-50 dark:bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
          ~{totalTokensSaved.toLocaleString()} tokens
        </span>
      </div>

      {/* Controles de Configuração */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-[#0066cc]" />
            Limite máx. de linhas de saída por comando
          </label>
          <input
            type="number"
            value={maxLogLines}
            onChange={(e) => setMaxLogLines(parseInt(e.target.value, 10) || 50)}
            className="w-full bg-white dark:bg-slate-950 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#0066cc]" />
            Threshold de compressão (tokens)
          </label>
          <input
            type="number"
            value={thresholdTokens}
            onChange={(e) => setThresholdTokens(parseInt(e.target.value, 10) || 4000)}
            className="w-full bg-white dark:bg-slate-950 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 shadow-sm"
          />
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="flex items-center justify-between pt-2">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
          />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Ativar Headroom Token Guard
          </span>
        </label>

        <button
          onClick={handleSaveHeadroom}
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Salvando...</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5" />
              <span>Ativar / Salvar Headroom Local</span>
            </>
          )}
        </button>
      </div>

      {feedbackMsg && (
        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>{feedbackMsg}</span>
        </div>
      )}
    </div>
  );
}
