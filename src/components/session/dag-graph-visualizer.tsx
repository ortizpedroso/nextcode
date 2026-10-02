"use client";

import { useMemo, useState } from "react";
import { TaskNode } from "@/components/layout/workspace";
import { CheckCircle2, RefreshCw, Box, ShieldAlert, AlertTriangle, Clock, ArrowDown, Sparkles } from "lucide-react";

interface DagGraphVisualizerProps {
  tasks: TaskNode[];
  onSelectTask?: (taskId: string) => void;
  onInspectQuarantine?: (taskId: string) => void;
}

export function DagGraphVisualizer({ tasks, onSelectTask, onInspectQuarantine }: DagGraphVisualizerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Group tasks into execution tiers/levels based on dependency depth
  const layers = useMemo(() => {
    if (tasks.length === 0) return [];

    const parsedTasks = tasks.map((t) => {
      let deps: string[] = [];
      try {
        if (t.dependencies) {
          if (t.dependencies.startsWith("[")) {
            deps = JSON.parse(t.dependencies);
          } else {
            deps = t.dependencies.split(",").map((s) => s.trim()).filter(Boolean);
          }
        }
      } catch {
        deps = [];
      }
      return { ...t, parsedDeps: deps };
    });

    const nodeLevels = new Map<string, number>();
    
    // Resolve levels iteratively
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;

      for (const task of parsedTasks) {
        const currentLevel = nodeLevels.get(task.id) || 0;
        let maxDepLevel = -1;

        for (const depId of task.parsedDeps) {
          const depLevel = nodeLevels.get(depId);
          if (depLevel !== undefined && depLevel > maxDepLevel) {
            maxDepLevel = depLevel;
          }
        }

        const newLevel = maxDepLevel + 1;
        if (newLevel !== currentLevel) {
          nodeLevels.set(task.id, newLevel);
          changed = true;
        }
      }
    }

    // Organize tasks into levels array
    const maxLevel = Math.max(0, ...Array.from(nodeLevels.values()));
    const result: Array<typeof parsedTasks> = Array.from({ length: maxLevel + 1 }, () => []);

    for (const task of parsedTasks) {
      const level = nodeLevels.get(task.id) || 0;
      result[level].push(task);
    }

    return result;
  }, [tasks]);

  const getNodeColorClass = (status: TaskNode["status"]) => {
    switch (status) {
      case "completed":
        return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 shadow-emerald-500/10";
      case "running":
        return "bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-600 text-blue-900 dark:text-blue-200 ring-2 ring-blue-500/30 animate-pulse shadow-blue-500/20";
      case "quarantine":
        return "bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-300 shadow-purple-500/10";
      case "blocked":
        return "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-300";
      case "failed":
        return "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300";
      default:
        return "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300";
    }
  };

  const getStatusIcon = (status: TaskNode["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
      case "running":
        return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />;
      case "quarantine":
        return <Box className="w-3.5 h-3.5 text-purple-500 shrink-0" />;
      case "blocked":
        return <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
      case "failed":
        return <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 italic text-[11px] bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800/80">
        <Sparkles className="w-5 h-5 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
        Grafo DAG Vazio. Crie uma nova sessão para visualizar as dependências dos nós.
      </div>
    );
  }

  return (
    <div className="space-y-4 py-1">
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <span>Grafo de Dependências Autônomo</span>
        </span>
        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-mono">
          {layers.length} Nível(is) de Orquestração
        </span>
      </div>

      <div className="space-y-3">
        {layers.map((layerTasks, layerIdx) => (
          <div key={layerIdx} className="space-y-2">
            {/* Header de Camada / Nível */}
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              <span className="text-[10px] font-mono font-medium text-slate-400 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80">
                Camada #{layerIdx + 1}
              </span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>

            {/* Grid de Nós na Camada */}
            <div className="grid grid-cols-1 gap-2">
              {layerTasks.map((task) => {
                const isSelected = selectedNodeId === task.id;
                return (
                  <div
                    key={task.id}
                    onClick={() => {
                      setSelectedNodeId(task.id);
                      if (onSelectTask) onSelectTask(task.id);
                    }}
                    className={`border rounded-xl p-2.5 transition-all cursor-pointer shadow-sm relative ${getNodeColorClass(
                      task.status
                    )} ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {getStatusIcon(task.status)}
                        <span className="font-bold text-xs truncate">{task.title}</span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 shrink-0">
                        {task.role}
                      </span>
                    </div>

                    {task.parsedDeps.length > 0 && (
                      <div className="mt-1.5 text-[9.5px] opacity-75 flex items-center gap-1 font-mono truncate">
                        <span>Depende de:</span>
                        <span className="font-semibold">{task.parsedDeps.join(", ")}</span>
                      </div>
                    )}

                    {task.result && (
                      <div className="mt-2 text-[10px] bg-white/60 dark:bg-black/30 p-1.5 rounded font-mono truncate">
                        {task.result}
                      </div>
                    )}

                    {onInspectQuarantine && (task.status === "completed" || task.status === "quarantine") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectQuarantine(task.id);
                        }}
                        className="mt-2 text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold flex items-center gap-1"
                      >
                        <Box className="w-3 h-3" /> Ver Quarentena
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Seta Visual de Conexão com Próxima Camada */}
            {layerIdx < layers.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowDown className="w-4 h-4 text-slate-400 dark:text-slate-600 animate-bounce" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
