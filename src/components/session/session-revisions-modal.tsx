"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { History, RefreshCw, X, RotateCcw, Plus, Clock, CheckCircle2 } from "lucide-react";

interface RevisionItem {
  id: string;
  label: string;
  taskCount: number;
  specApproved: boolean;
  createdAt: string;
}

interface SessionRevisionsModalProps {
  sessionId: string;
  onClose: () => void;
  onRevisionRestored: () => Promise<void>;
}

export function SessionRevisionsModal({ sessionId, onClose, onRevisionRestored }: SessionRevisionsModalProps) {
  const [revisions, setRevisions] = useState<RevisionItem[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const fetchRevisions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/revisions?sessionId=${sessionId}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.revisions)) {
        setRevisions(data.revisions);
      }
    } catch (err) {
      console.error("Erro ao carregar revisões:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRevisions();
  }, [sessionId]);

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    setActing(true);
    try {
      const res = await authFetch("/api/sessions/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_snapshot",
          sessionId,
          label: newLabel.trim() || undefined,
        }),
      });

      if (res.ok) {
        setNewLabel("");
        await fetchRevisions();
      }
    } catch (err) {
      console.error("Erro ao criar snapshot:", err);
    } finally {
      setActing(false);
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    if (!confirm("Deseja realmente restaurar a sessão para este ponto no tempo? O estado atual da DAG será sobrescrito.")) {
      return;
    }

    setActing(true);
    try {
      const res = await authFetch("/api/sessions/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore_snapshot",
          sessionId,
          snapshotId,
        }),
      });

      if (res.ok) {
        await onRevisionRestored();
        onClose();
      }
    } catch (err) {
      console.error("Erro ao restaurar snapshot:", err);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                Linha do Tempo & Histórico de Revisões da Sessão
              </h2>
              <span className="text-[11px] text-slate-400">
                Snapshots de segurança para rollback instantâneo de estado da DAG
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

        {/* Create Snapshot Bar */}
        <form onSubmit={handleCreateSnapshot} className="p-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950 flex items-center gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Nome do ponto de restauração (ex: Antes do refactor)..."
            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={acting}
            className="px-3 py-1.5 bg-[#0066cc] hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors shadow-sm disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Criar Snapshot</span>
          </button>
        </form>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 text-xs">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#0066cc]" />
              <span>Carregando histórico de revisões...</span>
            </div>
          ) : revisions.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              Nenhum snapshot de revisão salvo para esta sessão. Use o campo acima para salvar o estado atual.
            </div>
          ) : (
            revisions.map((rev) => (
              <div
                key={rev.id}
                className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between shadow-xs"
              >
                <div className="space-y-1">
                  <span className="font-bold text-slate-900 dark:text-white text-xs block">
                    {rev.label}
                  </span>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {new Date(rev.createdAt).toLocaleString("pt-BR")}
                    </span>
                    <span>•</span>
                    <span>{rev.taskCount} nó(s)</span>
                    {rev.specApproved && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        ✓ Spec Aprovada
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleRestoreSnapshot(rev.id)}
                  disabled={acting}
                  className="px-3 py-1 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/80 text-amber-700 dark:text-amber-400 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-amber-200 dark:border-amber-800 disabled:opacity-50"
                  title="Restaurar este estado"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Restaurar</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
