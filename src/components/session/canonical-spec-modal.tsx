"use client";

import { useState } from "react";
import { authFetch } from "@/lib/client-session";
import { X, Lock, Unlock, CheckCircle2, FileText, Save, Play } from "lucide-react";

interface CanonicalSpecModalProps {
  sessionId: string;
  specContent: string;
  specApproved: boolean;
  onClose: () => void;
  onSpecApproved: () => Promise<void>;
}

export function CanonicalSpecModal({
  sessionId,
  specContent,
  specApproved,
  onClose,
  onSpecApproved,
}: CanonicalSpecModalProps) {
  const [content, setContent] = useState(
    specContent ||
      `# 📋 Especificação Canônica de Governança (Trava T1)\n\n## 🎯 Objetivos do Projeto\n- [ ] Desenvolver arquitetura modular de alta performance\n- [ ] Garantir 100% de conformidade com OWASP e Clean Code\n\n## 📐 Critérios de Aceite\n1. Código gravado isoladamente na quarentena (.quarantine/)\n2. Validação determinística Tipo 1 e Auditoria Cega Tipo 2\n3. Zero chaves hardcoded e zero vazamento de segredos`
  );
  const [saving, setSaving] = useState(false);
  const [isApproved, setIsApproved] = useState(specApproved);

  const handleApproveAndUnlock = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specApproved: true,
          canonicalSpec: content,
        }),
      });

      if (res.ok) {
        setIsApproved(true);
        await onSpecApproved();
      }
    } catch (err) {
      console.error("Erro ao aprovar Spec Canônica:", err);
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
      await onSpecApproved();
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
              Documento Canônico de Requisitos (Markdown)
            </label>
            <span className="text-[10px] text-slate-400">
              Edite ou ajuste os critérios de aceite da Spec antes de autorizar a execução no disco
            </span>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0066cc] resize-none leading-relaxed"
            placeholder="Escreva a especificação canônica..."
          />
        </div>

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
              disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
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
