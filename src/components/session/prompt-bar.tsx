"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Loader2, Cpu, Zap, Brain, Bot } from "lucide-react";
import { CustomProviderItem } from "@/components/settings/settings-dialog";

interface PromptBarProps {
  loading: boolean;
  customProviders: CustomProviderItem[];
  onSubmit: (prompt: string, modelOverride?: string) => Promise<void>;
}

export function PromptBar({ loading, customProviders, onSubmit }: PromptBarProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [prompt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    const modelToPass = selectedModel === "auto" ? undefined : selectedModel;
    await onSubmit(prompt.trim(), modelToPass);
    setPrompt("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim() && !loading) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const renderActiveBadge = () => {
    if (selectedModel === "auto") {
      return (
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full shrink-0">
          <Zap className="w-3 h-3 text-amber-500" />
          Smart Router Ativo
        </span>
      );
    }
    if (selectedModel === "fast") {
      return (
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full shrink-0">
          ⚡ Gemini Flash (Fast)
        </span>
      );
    }
    if (selectedModel === "heavy") {
      return (
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full shrink-0">
          🧠 Claude Sonnet (Heavy)
        </span>
      );
    }
    return (
      <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full shrink-0">
        <Bot className="w-3 h-3 text-blue-500" />
        Custom Model
      </span>
    );
  };

  return (
    <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 shrink-0">
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex items-start gap-2 bg-slate-50/80 dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2 shadow-sm focus-within:border-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
          <div className="pl-2 pt-2 text-[#0066cc] shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Digite o objetivo (ex: Criar API de auth JWT com refatoração de schema e testes)..."
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="flex-1 bg-transparent px-2 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none disabled:opacity-50 resize-none overflow-y-auto max-h-40 leading-relaxed font-sans"
          />

          {renderActiveBadge()}

          {/* Seletor de Modelo Discreto */}
          <div className="relative flex items-center shrink-0">
            <Cpu className="w-3.5 h-3.5 text-slate-400 absolute left-2 pointer-events-none" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loading}
              className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-xl pl-7 pr-3 py-1.5 text-xs font-medium focus:outline-none hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer transition-colors max-w-[210px] truncate disabled:opacity-50"
              title="Seletor de Modelo de Execução"
            >
              <option value="auto">NextCode Auto (Inteligente)</option>
              <option value="fast">Forçar Fast (Gemini 2.5 Flash)</option>
              <option value="heavy">Forçar Heavy (Claude 3.7 / Gemini Pro)</option>
              {customProviders.length > 0 && (
                <optgroup label="Provedores Personalizados">
                  {customProviders.map((cp) => {
                    const modelsArr = JSON.parse(cp.models || "[]");
                    return modelsArr.map((m: { id: string; name: string }) => (
                      <option key={`${cp.id}-${m.id}`} value={`${cp.id}:${m.id}`}>
                        {cp.name} - {m.name}
                      </option>
                    ));
                  })}
                </optgroup>
              )}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="bg-[#0066cc] hover:bg-blue-700 text-white font-medium px-4 py-1.5 rounded-xl flex items-center gap-1.5 text-xs shadow-sm disabled:opacity-40 transition-colors shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processando...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Enviar</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
