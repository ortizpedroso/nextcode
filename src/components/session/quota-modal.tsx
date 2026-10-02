"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { Zap, RefreshCw, X, ShieldAlert, CheckCircle2, RotateCcw, Clock } from "lucide-react";

interface CooldownItem {
  model: string;
  reason: number; // 402 ou 429
  hits: number;
  until: string;
  remainingSeconds: number;
}

interface QuotaModalProps {
  onClose: () => void;
}

export function QuotaModal({ onClose }: QuotaModalProps) {
  const [cooldowns, setCooldowns] = useState<CooldownItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const fetchQuotaStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quota");
      const data = await res.json();
      if (res.ok && Array.isArray(data.activeCooldowns)) {
        setCooldowns(data.activeCooldowns);
      }
    } catch (err) {
      console.error("Erro ao carregar status de cotas:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotaStatus();
  }, []);

  const handleClearAll = async () => {
    setResetting(true);
    try {
      const res = await authFetch("/api/quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_cooldowns" }),
      });
      if (res.ok) {
        await fetchQuotaStatus();
      }
    } catch (err) {
      console.error("Erro ao resetar cotas:", err);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                Gestão de Cotas & Cooldowns de Provedores
              </h2>
              <span className="text-[11px] text-slate-400">
                Monitoramento inteligente de rate-limits (429) e créditos zerados (402)
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#0066cc]" />
              <span>Verificando cotas dos provedores...</span>
            </div>
          ) : cooldowns.length === 0 ? (
            <div className="p-6 text-center text-emerald-600 dark:text-emerald-400 text-xs bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-1">
              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500" />
              <p className="font-bold">Todos os Provedores Operacionais!</p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Nenhum modelo está em cooldown ou bloqueado por esgotamento de cota no SmartRouter.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cooldowns.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-rose-200 dark:border-rose-900 rounded-xl p-3 bg-rose-50/50 dark:bg-rose-950/40 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
                      <span className="font-bold font-mono text-slate-900 dark:text-white">
                        {item.model}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 pl-6 flex items-center gap-2">
                      <span>Motivo: HTTP {item.reason} ({item.reason === 402 ? "Crédito esgotado" : "Rate-limit atingido"})</span>
                      <span>•</span>
                      <span>Hit Count: {item.hits}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-mono font-semibold text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {item.remainingSeconds}s restantes
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <button
            onClick={fetchQuotaStatus}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Atualizar Status</span>
          </button>

          <button
            onClick={handleClearAll}
            disabled={resetting || cooldowns.length === 0}
            className="px-4 py-1.5 bg-[#0066cc] hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Zerar Todos os Cooldowns</span>
          </button>
        </div>
      </div>
    </div>
  );
}
