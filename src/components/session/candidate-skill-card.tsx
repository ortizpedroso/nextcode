"use client";

import { useState, useEffect } from "react";
import { Sparkles, Check, X, ShieldAlert, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SkillProposal {
  id: string;
  name: string;
  description: string;
  triggerPattern: string;
  sampleContent: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export function CandidateSkillCard() {
  const [proposals, setProposals] = useState<SkillProposal[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const fetchProposals = async () => {
    try {
      const res = await fetch("/api/skills/proposals");
      const data = await res.json();
      if (data.proposals) {
        setProposals(data.proposals.filter((p: SkillProposal) => p.status === "pending"));
      }
    } catch (err) {
      console.error("Falha ao carregar propostas de skills:", err);
    }
  };

  useEffect(() => {
    fetchProposals();
    const interval = setInterval(fetchProposals, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (proposalId: string, action: "approve" | "reject") => {
    setLoadingId(proposalId);
    try {
      const res = await fetch("/api/skills/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, action }),
      });
      const data = await res.json();
      if (data.success) {
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      }
    } catch (err) {
      console.error("Erro ao autorizar skill:", err);
    } finally {
      setLoadingId(null);
    }
  };

  if (proposals.length === 0) return null;

  return (
    <div className="space-y-3 my-4">
      {proposals.map((proposal) => (
        <div
          key={proposal.id}
          className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                  <span>Sugestão de Nova Skill Minerada</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {proposal.triggerPattern}
                  </span>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">{proposal.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-amber-500/30 hover:bg-amber-500/10 text-amber-300"
                onClick={() => handleAction(proposal.id, "reject")}
                disabled={loadingId === proposal.id}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Descartar
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-amber-500 hover:bg-amber-600 text-black font-medium shadow-md shadow-amber-500/20"
                onClick={() => handleAction(proposal.id, "approve")}
                disabled={loadingId === proposal.id}
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                Criar Skill Agora
              </Button>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-amber-400/70 flex items-center gap-1.5 pt-2 border-t border-amber-500/10">
            <ShieldAlert className="w-3 h-3 text-amber-400" />
            <span>Trava de Governança: Esta habilidade só será gravada no disco após o seu clique no botão acima.</span>
          </div>
        </div>
      ))}
    </div>
  );
}
