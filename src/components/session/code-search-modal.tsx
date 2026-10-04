"use client";

import { useEffect, useState } from "react";
import { Search, RefreshCw, X, FileText, Regex, ArrowRight } from "lucide-react";
import { authFetch } from "@/lib/client-session";

interface MatchResult {
  filePath: string;
  relativePath: string;
  lineNumber: number;
  lineText: string;
}

interface CodeSearchModalProps {
  projectId?: string | null;
  onClose: () => void;
}

export function CodeSearchModal({ projectId, onClose }: CodeSearchModalProps) {
  const [query, setQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (searchTerm?: string) => {
    const q = searchTerm !== undefined ? searchTerm : query;
    if (!q.trim()) {
      setMatches([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    try {
      const projParam = projectId ? `&projectId=${encodeURIComponent(projectId)}` : "";
      const regexParam = isRegex ? "&isRegex=true" : "";
      const res = await authFetch(`/api/fs/search?query=${encodeURIComponent(q)}${projParam}${regexParam}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.matches)) {
        setMatches(data.matches);
        setTotal(data.total);
      }
    } catch (err) {
      console.error("Erro na busca de código:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        handleSearch();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, isRegex]);

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-[#0066cc] dark:text-blue-400 flex items-center justify-center font-bold">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                Busca de Código & Indexação no Projeto Local
              </h2>
              <span className="text-[11px] text-slate-400">
                Pesquisa instantânea de texto e expressões regulares em todo o código
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

        {/* Search Input Bar */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o termo ou Regex para buscar no código..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          <button
            onClick={() => setIsRegex(!isRegex)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
              isRegex
                ? "bg-[#0066cc] text-white border-blue-600 shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
            }`}
            title="Alternar Modo Regex"
          >
            <Regex className="w-3.5 h-3.5" />
            <span>Regex</span>
          </button>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            <span>Resultados Encontrados</span>
            <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
              {total} ocorrência(s)
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#0066cc]" />
              <span>Indexando e pesquisando arquivos do projeto...</span>
            </div>
          ) : matches.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              {query.trim()
                ? "Nenhuma ocorrência encontrada para a pesquisa."
                : "Digite um termo de busca acima para pesquisar o código."}
            </div>
          ) : (
            matches.map((item, idx) => (
              <div
                key={idx}
                className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/50 space-y-1 hover:border-blue-400 transition-colors"
              >
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="font-bold text-[#0066cc] dark:text-blue-400 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    {item.relativePath}
                  </span>
                  <span className="bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-400">
                    Linha {item.lineNumber}
                  </span>
                </div>

                <div className="bg-slate-900 text-slate-200 p-2 rounded-lg font-mono text-[10.5px] truncate border border-slate-800">
                  <span className="text-slate-500 mr-2">{item.lineNumber}:</span>
                  {item.lineText}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
