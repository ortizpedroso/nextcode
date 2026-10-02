"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { X, FileCode, CheckCircle2, AlertTriangle, ShieldCheck, Copy, Check } from "lucide-react";

interface DiffFile {
  filePath: string;
  newContent: string;
  existingContent: string;
  isNewFile: boolean;
}

interface QuarantineDiffModalProps {
  taskId: string;
  onClose: () => void;
}

export function QuarantineDiffModal({ taskId, onClose }: QuarantineDiffModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    taskTitle: string;
    auditVerdict: string;
    files: DiffFile[];
  } | null>(null);

  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchDiffData = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/quarantine/diff?taskId=${taskId}`);
        const json = await res.json();
        if (res.ok) {
          setData(json);
        } else {
          setError(json.error || "Erro ao carregar dados da quarentena.");
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchDiffData();
  }, [taskId]);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Erro ao copiar:", err);
    }
  };

  const activeFile = data?.files[activeFileIndex];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>Inspetor de Quarentena & Auditoria</span>
                {data?.auditVerdict && (
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      data.auditVerdict === "APPROVED"
                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800"
                        : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800"
                    }`}
                  >
                    {data.auditVerdict === "APPROVED" ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-rose-500" />
                    )}
                    Veredito: {data.auditVerdict}
                  </span>
                )}
              </h3>
              <span className="text-xs text-slate-500 block">
                {data?.taskTitle || `Tarefa ID: ${taskId}`}
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

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center p-8 text-slate-400 text-xs">
              Carregando alterações em quarentena...
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center p-8 text-rose-500 text-xs">
              {error}
            </div>
          ) : !data || data.files.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8 text-slate-400 text-xs">
              Nenhum arquivo gerado nesta etapa.
            </div>
          ) : (
            <>
              {/* Esquerda: Lista de Arquivos Gerados */}
              <div className="w-64 border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-3 space-y-1 overflow-y-auto shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 block mb-2">
                  Arquivos Gerados ({data.files.length})
                </span>
                {data.files.map((file, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveFileIndex(idx)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                      activeFileIndex === idx
                        ? "bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold border border-blue-200 dark:border-blue-800"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className="w-4 h-4 shrink-0" />
                      <span className="truncate">{file.filePath}</span>
                    </div>
                    {file.isNewFile && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 font-bold shrink-0">
                        Novo
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Direita: Visualizador de Código Gerado */}
              <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900 text-slate-100">
                {activeFile && (
                  <>
                    <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 shrink-0">
                      <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
                        <FileCode className="w-4 h-4 text-blue-400" />
                        <span>{activeFile.filePath}</span>
                      </div>

                      <button
                        onClick={() => handleCopyCode(activeFile.newContent)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[11px] font-medium text-slate-300 flex items-center gap-1.5 transition-colors border border-slate-700"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copiar Código
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 selection:bg-blue-600 selection:text-white">
                      <pre className="whitespace-pre-wrap">{activeFile.newContent}</pre>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
