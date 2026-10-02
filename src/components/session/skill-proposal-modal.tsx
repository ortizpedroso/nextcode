"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { Sparkles, CheckCircle2, XCircle, X, RefreshCw, FileCode2, Plus } from "lucide-react";

interface CandidateProposal {
  id: string;
  name: string;
  description: string;
  triggerPattern: string;
  sampleContent: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface SkillProposalModalProps {
  onClose: () => void;
}

export function SkillProposalModal({ onClose }: SkillProposalModalProps) {
  const [proposals, setProposals] = useState<CandidateProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchProposals = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills/proposals");
      const data = await res.json();
      if (res.ok && Array.isArray(data.proposals)) {
        setProposals(data.proposals);
      }
    } catch (err) {
      console.error("Erro ao buscar propostas de skills:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, []);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setActingId(id);
    try {
      const res = await authFetch("/api/skills/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (res.ok) {
        await fetchProposals();
      }
    } catch (err) {
      console.error("Erro ao processar proposta:", err);
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                Propostas de Habilidades Aprendidas (Candidate Skills)
              </h2>
              <span className="text-[11px] text-slate-400">
                Aprovação com 1-Clique para instalação no ecossistema Antigravity/NextCode
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

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#0066cc]" />
              <span>Carregando propostas de skills...</span>
            </div>
          ) : proposals.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              Nenhuma proposta de skill pendente ou registrada. As habilidades descobertas pela inteligência aparecerão aqui para aprovação com 1-clique.
            </div>
          ) : (
            proposals.map((item) => (
              <div
                key={item.id}
                className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-950/50 space-y-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white font-mono">
                      /{item.name}
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      item.status === "approved"
                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800"
                        : item.status === "rejected"
                        ? "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800"
                        : "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800 animate-pulse"
                    }`}
                  >
                    {item.status.toUpperCase()}
                  </span>
                </div>

                <div className="bg-slate-900 text-slate-200 p-2.5 rounded-lg font-mono text-[10px] max-h-24 overflow-y-auto whitespace-pre-wrap">
                  {item.sampleContent}
                </div>

                {item.status === "pending" && (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => handleAction(item.id, "reject")}
                      disabled={actingId === item.id}
                      className="px-3 py-1 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-400 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors border border-rose-200 dark:border-rose-800 disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Rejeitar</span>
                    </button>
                    <button
                      onClick={() => handleAction(item.id, "approve")}
                      disabled={actingId === item.id}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors shadow-sm disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Aprovação 1-Clique</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
