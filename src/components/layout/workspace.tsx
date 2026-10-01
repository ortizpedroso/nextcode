"use client";

import { useEffect, useRef, useState } from "react";
import {
  Layers,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { SettingsFormState, CustomProviderItem } from "@/components/settings/settings-dialog";
import { DagSidebar } from "@/components/session/dag-sidebar";
import { PromptBar } from "@/components/session/prompt-bar";

export interface TaskNode {
  id: string;
  sessionId: string;
  title: string;
  role: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "quarantine";
  dependencies: string;
  mcpScope?: string;
  result?: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tokens?: number;
  tier?: string;
  createdAt?: string;
}

interface WorkspaceProps {
  activeView: "dag" | "settings" | "docs";
  activeSessionId: string | null;
  activeSessionTitle?: string;
  activeProjectName?: string | null;
  tasks: TaskNode[];
  messages: SessionMessage[];
  consoleLogs: string[];
  tokensSaved: number;
  loading: boolean;
  executingNodeId: string | null;
  settingsForm: SettingsFormState;
  customProviders: CustomProviderItem[];
  onUpdateSettingsForm: (updated: SettingsFormState) => void;
  onSaveSettings: () => Promise<void>;
  onCreateDAG: (prompt: string, modelOverride?: string) => Promise<void>;
  onExecuteNode: (nodeId: string) => Promise<void>;
  onRefreshTasks: () => Promise<void>;
  onStop?: () => void;
}

export function Workspace({
  activeView,
  activeSessionId,
  activeSessionTitle,
  activeProjectName,
  tasks,
  messages,
  consoleLogs,
  tokensSaved,
  loading,
  executingNodeId,
  settingsForm,
  customProviders,
  onUpdateSettingsForm,
  onSaveSettings,
  onCreateDAG,
  onExecuteNode,
  onRefreshTasks,
  onStop,
}: WorkspaceProps) {
  const [showDagPanel, setShowDagPanel] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Erro ao copiar texto:", err);
    }
  };

  // FIX (chat "nao sobe a conversa"): auto-scroll do historico. Antes nao havia nenhum
  // scroll-into-view: cada nova mensagem era renderizada abaixo da dobra e o usuario
  // precisava rolar manualmente. Agora rolamos para o fim quando chegam mensagens novas,
  // mas SEM sequestrar o scroll se o usuario estiver lendo mensagens anteriores
  // (padrao "near bottom": so auto-rola se ele ja estava proximo do final).
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const userHasScrolledUpRef = useRef(false);

  // Monitora scroll manual do usuario para detectar se ele subiu propositalmente para ler o historico
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userHasScrolledUpRef.current = distanceFromBottom > 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Sempre que houver nova mensagem, mudança de loading ou troca de sessão, força o scroll até o fim
  useEffect(() => {
    userHasScrolledUpRef.current = false;
    scrollToBottom("smooth");
    const timer = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);
    return () => clearTimeout(timer);
  }, [messages.length, loading, activeSessionId]);

  // MutationObserver para garantir scroll automatico continuo durante o streaming do assistente
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;

    const scheduleScroll = () => {
      if (!userHasScrolledUpRef.current) {
        window.requestAnimationFrame(() => {
          if (chatScrollRef.current && !userHasScrolledUpRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
          }
        });
      }
    };

    const observer = new MutationObserver(scheduleScroll);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const runningTask = tasks.find((t) => t.status === "running");

  return (
    <main className="flex-1 bg-white dark:bg-[#090d16] text-slate-900 dark:text-slate-100 flex flex-col h-screen overflow-hidden transition-colors">
      {/* 1. VIEW: ORQUESTRATION DAG & INTERAÇÃO DA SESSÃO ATIVA */}
      {activeView === "dag" && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Cabeçalho Superior da Sessão */}
          <div className="px-6 py-3 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 shrink-0">
            <div className="flex items-center gap-3">
              <MessageSquare className="w-5 h-5 text-[#0066cc]" />
              <div>
                <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <span>{activeSessionTitle || "Sessão de Orquestração NextCode"}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-[#0066cc] dark:bg-blue-950 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                    {activeProjectName ? `Projeto: ${activeProjectName}` : "Sessão Ad-hoc"}
                  </span>
                </h2>
                {activeSessionId && (
                  <span className="text-[10px] text-slate-400 font-mono block">
                    ID: {activeSessionId}
                  </span>
                )}
              </div>
            </div>

            {/* Status Indicador do Progresso Autônomo e Botão do Painel */}
            <div className="flex items-center gap-3">
              {!showDagPanel && tasks.length > 0 && (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full text-xs font-medium">
                  {runningTask ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-[#0066cc] animate-spin" />
                      <span className="text-slate-700 dark:text-slate-300">
                        Executando: <strong className="text-slate-900 dark:text-white">{runningTask.title}</strong> ({completedCount}/{tasks.length})
                      </span>
                    </>
                  ) : completedCount === tasks.length ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        DAG Concluída ({completedCount}/{tasks.length} etapas)
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">
                      Progresso DAG: {completedCount}/{tasks.length} etapas
                    </span>
                  )}
                </div>
              )}

              <button
                onClick={() => setShowDagPanel(!showDagPanel)}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors border border-slate-200/80 dark:border-slate-700"
                title="Alternar Painel do Grafo DAG"
              >
                <Layers className="w-3.5 h-3.5 text-[#0066cc]" />
                <span>Grafo DAG ({tasks.length})</span>
                {showDagPanel ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Área Central: Chat Autônomo + Painel Lateral Status Tracker */}
          <div className="flex-1 flex overflow-hidden">
            {/* Esquerda: Área de Chat e Conversa com a IA */}
            <div className="flex-1 flex flex-col h-full overflow-hidden p-6">
              {/* Lista de Mensagens (ref p/ auto-scroll do historico) */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
                {messages.length === 0 && tasks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-3 p-8 text-slate-400">
                    <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] flex items-center justify-center font-bold text-2xl shadow-sm">
                      ❖
                    </div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">
                      NextCode Autônomo Engine Workspace
                    </h3>
                    <p className="text-xs max-w-md leading-relaxed text-slate-500">
                      Digite seu objetivo na barra inferior. O NextCode irá decompor a instrução via <strong>spec-decomposer</strong> e executar a DAG autonomamente nos bastidores de ponta a ponta.
                    </p>
                  </div>
                ) : (
                  <>
                    {messages
                      .filter((msg) => msg.role === "user" || msg.role === "assistant")
                      .map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 text-xs leading-relaxed max-w-3xl ${
                          msg.role === "user" ? "ml-auto flex-row-reverse" : ""
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            msg.role === "user"
                              ? "bg-[#0066cc] text-white"
                              : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {msg.role === "user" ? "U" : "NC"}
                        </div>

                        <div
                          className={`p-4 rounded-2xl border space-y-1.5 shadow-sm ${
                            msg.role === "user"
                              ? "bg-[#0066cc] text-white border-blue-600"
                              : msg.role === "system"
                              ? "bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                              : "bg-slate-50 dark:bg-slate-950 border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-slate-100"
                          }`}
                        >
                          <div className="font-semibold text-[11px] opacity-80 flex items-center justify-between gap-4">
                            <span>
                              {msg.role === "user"
                                ? "Você"
                                : msg.role === "system"
                                ? "Notificação DAG"
                                : "NextCode Engine"}
                            </span>
                            <div className="flex items-center gap-2">
                              {msg.tier && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300/40 dark:border-slate-700">
                                  {msg.tier === "fast"
                                    ? "⚡ Gemini Flash (Fast)"
                                    : msg.tier === "heavy"
                                    ? "🧠 Claude Sonnet (Heavy)"
                                    : "🤖 OmniRoute Local"}
                                </span>
                              )}
                              <button
                                onClick={() => handleCopy(msg.id, msg.content)}
                                className={`p-1 rounded-md transition-colors flex items-center gap-1 text-[10px] ${
                                  msg.role === "user"
                                    ? "hover:bg-blue-700 text-white/80 hover:text-white"
                                    : "hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                }`}
                                title="Copiar resposta"
                              >
                                {copiedId === msg.id ? (
                                  <>
                                    <Check className={`w-3.5 h-3.5 ${msg.role === "user" ? "text-emerald-200" : "text-emerald-500"}`} />
                                    <span className={`font-medium ${msg.role === "user" ? "text-emerald-200" : "text-emerald-500"}`}>Copiado!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Copiar</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Componente PromptBar com Seletor Discreto */}
              <PromptBar
                loading={loading}
                customProviders={customProviders}
                onSubmit={onCreateDAG}
                onStop={onStop}
              />
            </div>

            {/* Direita: Painel Lateral DagSidebar (Status Tracker Autônomo) */}
            {showDagPanel && (
              <DagSidebar
                tasks={tasks}
                tokensSaved={tokensSaved}
                consoleLogs={consoleLogs}
                executingNodeId={executingNodeId}
                onClose={() => setShowDagPanel(false)}
                onRefreshTasks={onRefreshTasks}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
