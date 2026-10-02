"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { Activity, ShieldAlert, CheckCircle2, Layers, RefreshCw, X, Clock, Terminal } from "lucide-react";

interface TelemetryLogItem {
  id: string;
  sessionId: string | null;
  action: string;
  durationMs: number;
  details: any;
  createdAt: string;
}

interface TelemetryModalProps {
  onClose: () => void;
}

export function TelemetryModal({ onClose }: TelemetryModalProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalEvents: 0,
    completedNodes: 0,
    failedNodes: 0,
    activeSessions: 0,
  });
  const [logs, setLogs] = useState<TelemetryLogItem[]>([]);

  const fetchTelemetry = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/telemetry?limit=50");
      const data = await res.json();
      if (res.ok) {
        setSummary(data.summary || summary);
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Erro ao carregar telemetria:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] flex items-center justify-center font-bold">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>Telemetria & Métricas de Governança</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-[#0066cc] dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  SQLite WAL Log
                </span>
              </h3>
              <span className="text-xs text-slate-500 block">
                Monitoramento assíncrono de eventos e incidentes do orquestrador
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchTelemetry}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-[#0066cc]" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4 shrink-0">
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-500" /> Eventos Registrados
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-white font-mono">
                {summary.totalEvents}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Nós Concluídos
              </div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                {summary.completedNodes}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> Incidentes / Falhas
              </div>
              <div className="text-xl font-bold text-rose-600 dark:text-rose-400 font-mono">
                {summary.failedNodes}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-500" /> Sessões Ativas
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-white font-mono">
                {summary.activeSessions}
              </div>
            </div>
          </div>

          {/* Table / Event Stream */}
          <div className="flex-1 flex flex-col overflow-hidden space-y-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Trilha de Auditoria em Tempo Real (Últimos 50 Eventos)
            </span>

            <div className="flex-1 bg-slate-900 text-slate-200 rounded-xl p-3 font-mono text-xs overflow-y-auto space-y-2 border border-slate-800 shadow-inner">
              {logs.length === 0 ? (
                <div className="text-slate-500 italic text-center p-8">
                  Nenhum evento de telemetria gravado ainda.
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="border-b border-slate-800/80 pb-2 last:border-0 space-y-0.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-bold text-blue-400">{log.action}</span>
                      <span className="text-slate-500 text-[10px]">
                        {new Date(log.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>

                    {log.details && (
                      <div className="text-[10px] text-slate-300 bg-slate-950/60 p-1.5 rounded border border-slate-800/60 overflow-x-auto">
                        {JSON.stringify(log.details)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
