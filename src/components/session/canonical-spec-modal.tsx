"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { X, Lock, Unlock, CheckCircle2, FileText, Save, Code2 } from "lucide-react";
import { canonicalizeSpecDocument, parseSpecDocument } from "@/core/intake/spec-format";
import { messageForApproveSpecFailure } from "@/core/intake/approve-spec-messages";
import { SpecSummaryCard } from "./spec-summary-card";

interface CanonicalSpecModalProps {
  sessionId: string;
  specContent: string;
  specApproved: boolean;
  /** Spec registrada como aprovada no servidor (o selo do resumo vem daqui, nunca do texto). */
  approvedSpec?: string | null;
  onClose: () => void;
  onSpecApproved: () => Promise<void>;
  /** Rascunho salvo (sem aprovar): só recarrega a sessão. Nunca dispara execução. */
  onSpecSaved?: () => Promise<void>;
}

const DEFAULT_SPEC = `---
titulo: "Especificação pendente"
status: aguardando_aprovacao
data: "${new Date().toISOString().split("T")[0]}"
---

# Especificação pendente

Nenhuma Spec foi gerada ainda nesta sessão. Descreva o projeto no chat para que a IA produza a Spec Canônica.`;

export function CanonicalSpecModal({
  sessionId,
  specContent,
  specApproved,
  approvedSpec,
  onClose,
  onSpecApproved,
  onSpecSaved,
}: CanonicalSpecModalProps) {
  const [content, setContent] = useState(specContent || DEFAULT_SPEC);
  const [saving, setSaving] = useState(false);
  const [isApproved, setIsApproved] = useState(specApproved);
  const [approvedHere, setApprovedHere] = useState(false);
  const [showFullDoc, setShowFullDoc] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  useEffect(() => {
    setContent(specContent || DEFAULT_SPEC);
    setIsApproved(specApproved);
    setApprovedHere(false);
    setApproveError(null);
  }, [specContent, specApproved, sessionId]);

  const parsedSpec = useMemo(() => parseSpecDocument(content), [content]);

  // Impede aprovação de templates vazios, sem módulos, sem arquivos concretos ou sem requisitos (REQ-001...)
  const isSpecExecutable = useMemo(() => {
    if (!parsedSpec) return false;
    if (parsedSpec.titulo?.toLowerCase().includes("pendente")) return false;
    if (!parsedSpec.modulos || parsedSpec.modulos.length === 0) return false;
    if (!parsedSpec.arquivosAfetados || parsedSpec.arquivosAfetados.length === 0) return false;
    if (!parsedSpec.requisitos || parsedSpec.requisitos.length === 0) return false;
    return true;
  }, [parsedSpec]);

  const handleApproveAndUnlock = async () => {
    if (!isSpecExecutable) {
      alert("Atenção: Esta especificação ainda está pendente ou não possui módulos, arquivos e requisitos (REQ-001...) definidos. Descreva seu projeto no chat para a IA gerar a especificação completa antes de aprovar.");
      return;
    }
    const canonical = canonicalizeSpecDocument(content);
    if (!canonical) {
      setApproveError(
        "Não consegui ler a Spec (YAML). Abra “Editar documento completo”, confira o frontmatter --- … --- ou regenere no chat."
      );
      return;
    }
    setSaving(true);
    setApproveError(null);
    try {
      const res = await authFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specApproved: true,
          canonicalSpec: canonical,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        problems?: string[];
        error?: string;
      };

      if (res.ok && data.ok !== false) {
        setContent(canonical);
        setIsApproved(true);
        setApprovedHere(true);
        await onSpecApproved();
        return;
      }

      const reason = data.reason || data.error || `HTTP_${res.status}`;
      setApproveError(messageForApproveSpecFailure(reason, data.problems));
    } catch (err) {
      console.error("Erro ao aprovar Spec Canônica:", err);
      setApproveError("Falha de rede ao aprovar. Verifique se o servidor está no ar e tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOnly = async () => {
    setSaving(true);
    try {
      await authFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalSpec: content,
        }),
      });
      await onSpecSaved?.();
    } catch (err) {
      console.error("Erro ao salvar Spec Canônica:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                isApproved
                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                  : "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
              }`}
            >
              {isApproved ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>Especificação Canônica (Trava T1)</span>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                    isApproved
                      ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800"
                      : "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800"
                  }`}
                >
                  {isApproved ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Trava T1: Aprovada
                    </>
                  ) : (
                    <>
                      <Lock className="w-3 h-3 text-amber-500" /> Trava T1: Bloqueada (Pendente)
                    </>
                  )}
                </span>
              </h3>
              <span className="text-xs text-slate-500 block">
                Sessão ID: {sessionId.substring(0, 8)}...
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content / Editor */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-[#0066cc]" />
              {showFullDoc ? "Documento Completo (YAML + Markdown)" : "Resumo da Especificação"}
            </label>
            <button
              onClick={() => setShowFullDoc((v) => !v)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
            >
              <Code2 className="w-3 h-3" />
              {showFullDoc ? "Ver Resumo" : "Editar Documento Completo"}
            </button>
          </div>

          {showFullDoc || !parsedSpec ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0066cc] resize-none leading-relaxed"
              placeholder="Escreva a especificação canônica (YAML Frontmatter + Markdown)..."
            />
          ) : (
            <div className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <SpecSummaryCard
                spec={parsedSpec}
                approved={
                  approvedHere ||
                  (Boolean(approvedSpec) && approvedSpec!.replace(/\r\n/g, "\n").trim() === content.replace(/\r\n/g, "\n").trim())
                }
              />
            </div>
          )}
        </div>

        {approveError && (
          <div className="mx-6 mb-0 px-3 py-2.5 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-[11px] text-rose-800 dark:text-rose-200 whitespace-pre-wrap">
            {approveError}
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 shrink-0">
          <button
            onClick={handleSaveOnly}
            disabled={saving}
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-slate-700"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Salvar Rascunho</span>
          </button>

          {!isApproved ? (
            <button
              onClick={handleApproveAndUnlock}
              disabled={saving || !isSpecExecutable}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                isSpecExecutable
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md hover:shadow-lg cursor-pointer"
                  : "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700"
              }`}
              title={
                !isSpecExecutable
                  ? "A especificação precisa conter módulos e arquivos válidos antes da aprovação."
                  : "Aprovar Spec e liberar execução da DAG"
              }
            >
              <Unlock className="w-4 h-4" />
              <span>Aprovar Spec Canônica & Liberar Execução DAG (Trava T1)</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Spec Aprovada! Execução Liberada.
              </span>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-[#0066cc] hover:bg-blue-700 text-white rounded-xl text-xs font-medium"
              >
                Concluir
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
