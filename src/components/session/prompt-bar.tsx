"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Sparkles, Loader2, Cpu, Zap, Brain, Bot, Globe, FileCode2, Command } from "lucide-react";
import { CustomProviderItem } from "@/components/settings/settings-dialog";
import { SkillItemInfo } from "@/app/api/skills/list/route";

interface PromptBarProps {
  loading: boolean;
  customProviders: CustomProviderItem[];
  projectId?: string | null;
  onSubmit: (prompt: string, modelOverride?: string) => Promise<void>;
}

const BUILTIN_COMMANDS: SkillItemInfo[] = [
  { name: "plan", description: "Ativar modo de planejamento e criar plano detalhado", type: "generic", path: "builtin:plan" },
  { name: "goal", description: "Executar tarefa complexa em modo autônomo e focado", type: "generic", path: "builtin:goal" },
  { name: "help", description: "Exibir guia rápido e lista de habilidades do assistente", type: "generic", path: "builtin:help" },
  { name: "clear", description: "Limpar histórico e contexto da sessão atual", type: "generic", path: "builtin:clear" },
];

export function PromptBar({ loading, customProviders, projectId, onSubmit }: PromptBarProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Slash commands state
  const [skills, setSkills] = useState<SkillItemInfo[]>([]);
  const [showSkillsPopup, setShowSkillsPopup] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const fetchSkills = useCallback(async () => {
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const res = await fetch(`/api/skills/list${query}`);
      const data = await res.json();
      if (res.ok && data.skills) {
        setSkills(data.skills);
      }
    } catch {}
  }, [projectId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

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

  // Lista unificada de comandos (Built-in + Skills customizadas instaladas)
  const allCommands = [...skills, ...BUILTIN_COMMANDS];

  // Filtra comandos baseados na barra digitada (/termo)
  const isSlashActive = prompt.startsWith("/");
  const filterQuery = isSlashActive ? prompt.slice(1).toLowerCase() : "";

  const filteredCommands = isSlashActive
    ? allCommands.filter((s) => s.name.toLowerCase().includes(filterQuery))
    : [];

  useEffect(() => {
    if (isSlashActive) {
      setShowSkillsPopup(true);
      setSelectedIndex(0);
    } else {
      setShowSkillsPopup(false);
    }
  }, [prompt, isSlashActive]);

  const handleSelectSkill = (skill: SkillItemInfo) => {
    setPrompt(`/${skill.name} `);
    setShowSkillsPopup(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    const modelToPass = selectedModel === "auto" ? undefined : selectedModel;
    await onSubmit(prompt.trim(), modelToPass);
    setPrompt("");
    setShowSkillsPopup(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSkillsPopup && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        handleSelectSkill(filteredCommands[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSkillsPopup(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim() && !loading) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const renderTypeBadge = (type: string) => {
    switch (type) {
      case "google":
        return <span className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">Google</span>;
      case "claude":
        return <span className="text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">Claude</span>;
      case "cursor":
        return <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">Cursor</span>;
      default:
        return <span className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Comando</span>;
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
    <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 shrink-0 relative">
      {/* Popup Autocomplete de Slash Commands */}
      {showSkillsPopup && (
        <div className="absolute bottom-full mb-2 left-0 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden text-xs">
          <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
            <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
              <Command className="w-3.5 h-3.5 text-[#0066cc]" />
              Skills & Slash Commands
            </span>
            <span className="text-[9px] font-normal text-slate-400">↑↓ navegar | Enter/Tab selecionar</span>
          </div>
          <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
            {filteredCommands.length === 0 ? (
              <div className="p-3 text-slate-400 text-[11px] text-center italic">
                Nenhum comando ou skill encontrado com &quot;/{filterQuery}&quot;.
              </div>
            ) : (
              filteredCommands.map((item, idx) => (
                <button
                  key={item.path}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSkill(item);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                    idx === selectedIndex
                      ? "bg-[#e8f1fb] dark:bg-blue-950/80 text-[#0066cc] dark:text-blue-300 font-medium"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <FileCode2 className="w-3.5 h-3.5 text-[#0066cc] shrink-0" />
                    <div className="truncate">
                      <span className="font-bold font-mono">/{item.name}</span>
                      <span className="text-[10px] text-slate-400 block truncate">{item.description}</span>
                    </div>
                  </div>
                  {renderTypeBadge(item.type)}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="bg-slate-50/80 dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-3 shadow-sm focus-within:border-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all flex flex-col gap-2.5">
          {/* Linha Superior: Ícone + Textarea */}
          <div className="flex items-start gap-2">
            <div className="pt-1 text-[#0066cc] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Digite o objetivo ou / para listar skills (ex: /plan, /my-skill)..."
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                adjustHeight();
              }}
              onFocus={() => fetchSkills()}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="flex-1 bg-transparent px-1 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none disabled:opacity-50 resize-none overflow-y-auto max-h-40 leading-relaxed font-sans"
            />
          </div>

          {/* Linha Inferior: Canto Inferior Esquerdo (Seletor de Provedor + Badge) | Canto Inferior Direito (Botão Enviar) */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/40 dark:border-slate-800/40 gap-2">
            {/* Canto Inferior Esquerdo: Seletor de Modelo de Provedor */}
            <div className="flex items-center gap-2">
              <div className="relative flex items-center shrink-0">
                <Cpu className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={loading}
                  className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium focus:outline-none hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer transition-colors max-w-[220px] truncate disabled:opacity-50"
                  title="Escolha do Modelo de Provedor"
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

              {renderActiveBadge()}
            </div>

            {/* Canto Inferior Direito: Botão Enviar */}
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
        </div>
      </form>
    </div>
  );
}


