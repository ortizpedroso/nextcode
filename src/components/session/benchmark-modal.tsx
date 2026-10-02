"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { BarChart3, RefreshCw, X, Zap, DollarSign, Clock, CheckCircle2 } from "lucide-react";

interface BenchmarkResult {
  model: string;
  taskCount: number;
  totalTimeMs: number;
  avgLatencyPerTaskMs: number;
  governancePassRate: number;
  totalEstimatedCostUSD: number;
  recommendation: string;
}

interface BenchmarkModalProps {
  sessionId: string;
  onClose: () => void;
}

export function BenchmarkModal({ sessionId, onClose }: BenchmarkModalProps) {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [sessionTitle, setSessionTitle] = useState("");
  const [loading, setLoading] = useState(true);

  const runBenchmark = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/dag/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.results)) {
        setResults(data.results);
        setSessionTitle(data.sessionTitle || "Sessão Ativa");
      }
    } catch (err) {
      console.error("Erro ao rodar benchmark:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runBenchmark();
  }, [sessionId]);

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-[#0066cc] dark:text-blue-400 flex items-center justify-center font-bold">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                Simulador & Benchmark Comparativo de DAG
              </h2>
              <span className="text-[11px] text-slate-400">
                Sessão: <strong className="text-slate-700 dark:text-slate-200">{sessionTitle || sessionId.substring(0, 8)}</strong>
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
              <span>Simulando matriz de desempenho entre provedores...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              Não foi possível gerar dados de benchmark para esta sessão.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {results.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-950/50 space-y-2.5 text-xs shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white font-mono text-xs">
                      {item.model}
                    </span>
                    <span className="text-[10px] bg-blue-50 dark:bg-blue-950 text-[#0066cc] dark:text-blue-400 font-semibold px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                      {item.taskCount} nós
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-[10.5px] py-1 border-y border-slate-200/60 dark:border-slate-800/60">
                    <div>
                      <span className="text-slate-400 block text-[9.5px]">Latência Méd.</span>
                      <span className="font-bold font-mono text-slate-800 dark:text-slate-200 flex items-center justify-center gap-0.5">
                        <Clock className="w-3 h-3 text-amber-500" />
                        {item.avgLatencyPerTaskMs}ms
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[9.5px]">Governança</span>
                      <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        {item.governancePassRate}%
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[9.5px]">Custo Est.</span>
                      <span className="font-bold font-mono text-slate-800 dark:text-slate-200 flex items-center justify-center gap-0.5">
                        <DollarSign className="w-3 h-3 text-blue-500" />
                        ${item.totalEstimatedCostUSD}
                      </span>
                    </div>
                  </div>

                  <p className="text-[10.5px] text-slate-500 italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    💡 {item.recommendation}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
