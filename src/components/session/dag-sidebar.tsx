import { useEffect, useRef, useState } from "react";
import { TaskNode } from "@/components/layout/workspace";
import { DagGraphVisualizer } from "@/components/session/dag-graph-visualizer";
import {
  Layers,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Box,
  Terminal,
  ChevronRight,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  Eye,
  Download,
  List,
  GitFork,
} from "lucide-react";

interface DagSidebarProps {
  tasks: TaskNode[];
  tokensSaved: number;
  consoleLogs: string[];
  executingNodeId: string | null;
  onClose: () => void;
  onRefreshTasks: () => Promise<void>;
  onRetryNode?: (nodeId: string) => Promise<void>;
  onInspectQuarantine?: (taskId: string) => void;
  onExportAuditReport?: () => void;
  budget?: SessionBudget | null;
  onAuthorizeBudget?: (acrescimoUsd: number) => Promise<void>;
  /** Mudança 36: fase da sessão e Retomar (sessão BLOQUEADA sem mexer na Spec). */
  sessionPhase?: string | null;
  onResumeSession?: () => Promise<void>;
  /** Mudança 43.4: mais uma rodada de reparo (o servidor recusa se o bloqueio não for por rodadas gastas). */
  onAuthorizeRound?: () => Promise<void>;
}

export interface SessionCostBreakdown {
  totalUsd: number;
  executorUsd: number;
  avaliadorUsd: number;
  jevUsd: number;
  outroUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  byNode: Record<string, number>;
}

export interface SessionBudget {
  spentUsd: number;
  limitUsd: number;
  alertUsd: number;
  status: "ok" | "alerta" | "teto";
  breakdown?: SessionCostBreakdown;
  estimativaPlanoUsd?: number;
  sugestaoAutorizacaoUsd?: number;
}

export function formatUsd(val: number): string {
  if (!Number.isFinite(val) || val === 0) return "US$ 0.00";
  if (val < 1.0) return `US$ ${val.toFixed(4)}`;
  return `US$ ${val.toFixed(2)}`;
}

const AUTHORIZE_STEP_USD = 0.5;

export function DagSidebar({
  tasks,
  tokensSaved,
  consoleLogs,
  executingNodeId,
  onClose,
  onRefreshTasks,
  onRetryNode,
  onInspectQuarantine,
  onExportAuditReport,
  budget,
  onAuthorizeBudget,
  sessionPhase,
  onResumeSession,
  onAuthorizeRound,
}: DagSidebarProps) {
  const [authorizing, setAuthorizing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [authorizingRound, setAuthorizingRound] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");

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
      setCopiedTaskId(id);
      setTimeout(() => setCopiedTaskId(null), 2000);
    } catch (err) {
      console.error("Erro ao copiar texto:", err);
    }
  };

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [consoleLogs.length]);
  const getStatusBadge = (status: TaskNode["status"]) => {
    switch (status) {
      case "completed":
        return (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Concluído
          </span>
        );
      case "running":
        return (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-100 dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 border border-blue-300 dark:border-blue-800 flex items-center gap-1 font-medium animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin text-[#0066cc]" /> Em Execução
          </span>
        );
      case "quarantine":
        return (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border border-purple-300 dark:border-purple-800 flex items-center gap-1 font-medium">
            <Box className="w-3 h-3" /> Quarentena
          </span>
        );
      case "blocked":
        return (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 flex items-center gap-1 font-medium">
            <ShieldAlert className="w-3 h-3" /> Bloqueado
          </span>
        );
      case "failed":
        return (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 flex items-center gap-1 font-medium">
            <AlertTriangle className="w-3 h-3" /> Falhou
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 flex items-center gap-1 font-medium">
            <Clock className="w-3 h-3" /> Pendente
          </span>
        );
    }
  };

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <aside className="w-80 lg:w-96 border-l border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/40 p-4 flex flex-col h-full overflow-hidden space-y-4 shrink-0 text-xs transition-all">
      {/* Cabeçalho do Painel Lateral */}
      <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] flex items-center justify-center font-bold">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
              Monitor da DAG
              <span className="text-[10px] font-normal text-slate-500 bg-slate-200 dark:bg-slate-800 px-1.5 py-0.2 rounded-full">
                {completedCount}/{tasks.length}
              </span>
            </h3>
            <span className="text-[10px] text-slate-400 block">Execução Autônoma</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-300/60 dark:border-slate-700">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1 rounded text-[10px] font-medium flex items-center gap-1 transition-colors ${
                viewMode === "list"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
              title="Modo Lista"
            >
              <List className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`p-1 rounded text-[10px] font-medium flex items-center gap-1 transition-colors ${
                viewMode === "graph"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
              title="Modo Grafo Visual"
            >
              <GitFork className="w-3 h-3" />
            </button>
          </div>

          {onExportAuditReport && (
            <button
              onClick={onExportAuditReport}
              className="p-1.5 text-[#0066cc] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-lg transition-colors border border-blue-200 dark:border-blue-800"
              title="Baixar Relatório de Auditoria de Governança (.md)"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onRefreshTasks}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            title="Atualizar tarefas da DAG"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            title="Recolher painel lateral"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Custo do projeto (Trava T9 com telemetria e breakdown) */}
      {budget && (() => {
        const pct = Math.min(100, Math.max(0, (budget.spentUsd / (budget.limitUsd || 1)) * 100));
        const barColor =
          budget.status === "teto"
            ? "bg-rose-500"
            : budget.status === "alerta"
            ? "bg-amber-500"
            : "bg-emerald-500";

        return (
          <div
            className={`rounded-xl border p-2.5 text-[11px] space-y-2 ${
              budget.status === "teto"
                ? "border-rose-300 bg-rose-50/70 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                : budget.status === "alerta"
                ? "border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700 dark:text-slate-300">Custo do projeto</span>
              <span className="font-semibold font-mono text-slate-900 dark:text-white">
                {formatUsd(budget.spentUsd)} / US$ {budget.limitUsd.toFixed(2)}
              </span>
            </div>

            {/* Barra de progresso visual do orçamento */}
            <div className="w-full bg-slate-200/80 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${barColor}`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>

            {/* Chips de Decomposição por Papel */}
            {budget.breakdown && (
              <div className="pt-1 border-t border-slate-200/60 dark:border-slate-800/60 grid grid-cols-3 gap-1 text-[9px]">
                <div className="bg-slate-100/90 dark:bg-slate-800/90 rounded px-1 py-0.5 text-center">
                  <span className="text-slate-400 block text-[8px] uppercase tracking-wider">Exec</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {formatUsd(budget.breakdown.executorUsd)}
                  </span>
                </div>
                <div className="bg-slate-100/90 dark:bg-slate-800/90 rounded px-1 py-0.5 text-center">
                  <span className="text-slate-400 block text-[8px] uppercase tracking-wider">Eval</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {formatUsd(budget.breakdown.avaliadorUsd)}
                  </span>
                </div>
                <div className="bg-slate-100/90 dark:bg-slate-800/90 rounded px-1 py-0.5 text-center">
                  <span className="text-slate-400 block text-[8px] uppercase tracking-wider">Jev</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {formatUsd(budget.breakdown.jevUsd)}
                  </span>
                </div>
              </div>
            )}

            {budget.status === "teto" && onAuthorizeBudget && (
              <button
                type="button"
                disabled={authorizing}
                onClick={async () => {
                  setAuthorizing(true);
                  try {
                    await onAuthorizeBudget(budget.sugestaoAutorizacaoUsd ?? AUTHORIZE_STEP_USD);
                  } finally {
                    setAuthorizing(false);
                  }
                }}
                className="mt-1 w-full rounded-lg bg-rose-600 px-2 py-1.5 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {authorizing ? "Autorizando..." : `Autorizar mais verba (+US$ ${(budget.sugestaoAutorizacaoUsd ?? AUTHORIZE_STEP_USD).toFixed(2)})`}
              </button>
            )}
          </div>
        );
      })()}

      {sessionPhase === "BLOQUEADA" && onResumeSession && (
        <button
          type="button"
          disabled={resuming}
          onClick={async () => {
            setResuming(true);
            try {
              await onResumeSession();
            } finally {
              setResuming(false);
            }
          }}
          title="Retoma a sessão de onde parou, sem mexer na Spec (use quando a causa foi ambiente, erro interno ou avaliador fora)"
          className="w-full rounded-lg bg-amber-600 px-2 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <RotateCcw className="w-3 h-3" /> {resuming ? "Retomando..." : "Retomar"}
        </button>
      )}
      {sessionPhase === "BLOQUEADA" && onAuthorizeRound && (
        <button
          type="button"
          disabled={authorizingRound}
          onClick={async () => {
            setAuthorizingRound(true);
            try {
              await onAuthorizeRound();
            } finally {
              setAuthorizingRound(false);
            }
          }}
          title="Libera mais uma rodada de reparo quando as 3 automáticas acabaram e o que sobrou é defeito de código (a Spec está certa)"
          className="w-full rounded-lg bg-indigo-600 px-2 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> {authorizingRound ? "Autorizando..." : "Autorizar mais uma rodada"}
        </button>
      )}

      {/* Lista ou Grafo da DAG */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {viewMode === "graph" ? (
          <DagGraphVisualizer
            tasks={tasks}
            onInspectQuarantine={onInspectQuarantine}
          />
        ) : tasks.length === 0 ? (
          <div className="p-6 text-center text-slate-400 italic text-[11px] bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800/80">
            <Sparkles className="w-5 h-5 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            Nenhum nó ativo. Digite um objetivo no prompt para decompor e executar as tarefas automaticamente.
          </div>
        ) : (
          tasks.map((task, planIndex) => {
            const isExecuting = executingNodeId === task.id || task.status === "running";
            const taskCostUsd = budget?.breakdown?.byNode?.[task.id];
            return (
              <div
                key={task.id}
                className={`bg-white dark:bg-slate-900/80 border rounded-xl p-3 space-y-2 shadow-sm transition-all ${
                  isExecuting
                    ? "border-blue-400 dark:border-blue-600 ring-1 ring-blue-400/20"
                    : task.status === "completed"
                    ? "border-emerald-200 dark:border-emerald-950"
                    : "border-slate-200/80 dark:border-slate-800"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white text-xs leading-snug">
                    {/* TR1 (5): número = ordem do plano (a mesma do placar no chat). */}
                    <span className="mr-1 font-mono text-slate-400">#{planIndex + 1}</span>
                    {task.title}
                    {isExecuting && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                        rodando agora
                      </span>
                    )}
                  </span>
                  <div className="shrink-0">{getStatusBadge(task.status)}</div>
                </div>

                <div className="flex items-center flex-wrap gap-1.5 text-[10px] text-slate-500">
                  <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-medium">
                    Role: {task.role}
                  </span>
                  {taskCostUsd !== undefined && taskCostUsd > 0 && (
                    <span className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 px-1.5 py-0.5 rounded font-mono font-semibold">
                      {formatUsd(taskCostUsd)}
                    </span>
                  )}
                  {task.mcpScope && (
                    <span className="bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 px-1.5 py-0.5 rounded font-mono">
                      {task.mcpScope}
                    </span>
                  )}
                </div>

                {task.result && (
                  <div className="relative group text-[10px] bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-200/60 dark:border-slate-800/80 text-slate-700 dark:text-slate-300 font-mono overflow-x-auto max-h-24">
                    <button
                      onClick={() => handleCopy(task.id, task.result || "")}
                      className="absolute top-1 right-1 p-1 bg-white/80 dark:bg-slate-900/80 rounded border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Copiar resultado"
                    >
                      {copiedTaskId === task.id ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    {task.result}
                  </div>
                )}

                {(task.result || task.status === "completed" || task.status === "failed") && onInspectQuarantine && (
                  <button
                    onClick={() => onInspectQuarantine(task.id)}
                    className="w-full mt-1 py-1 px-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/80 text-[#0066cc] dark:text-blue-400 rounded-lg text-[10px] font-semibold border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Eye className="w-3 h-3 text-[#0066cc] dark:text-blue-400" />
                    <span>Ver Diff / Quarentena</span>
                  </button>
                )}

                {(task.status === "failed" || task.status === "blocked") && onRetryNode && (
                  <button
                    onClick={() => onRetryNode(task.id)}
                    className="w-full mt-1 py-1 px-2 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/80 text-rose-700 dark:text-rose-300 rounded-lg text-[10px] font-semibold border border-rose-200 dark:border-rose-800 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                    <span>Desbloquear / Re-tentar Etapa</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Execution Headroom / Console Logs */}
      <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2 shrink-0">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-[#0066cc]" /> Execution Headroom
          </span>
          {tokensSaved > 0 && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              ~{tokensSaved} tokens poupados
            </span>
          )}
        </div>

        <div ref={logsContainerRef} className="bg-slate-900 text-slate-200 p-2.5 rounded-xl font-mono text-[10px] h-28 overflow-y-auto space-y-1 shadow-inner">
          {consoleLogs.length === 0 ? (
            <span className="text-slate-500 italic block">Aguardando logs de execução autônoma...</span>
          ) : (
            consoleLogs.map((log, idx) => (
              <div key={idx} className="leading-relaxed opacity-90 border-b border-slate-800/40 pb-0.5 last:border-0">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
