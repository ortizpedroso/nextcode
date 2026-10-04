"use client";

import { useState, useRef, useEffect } from "react";
import { authFetch, authEventStream } from "@/lib/client-session";
import { Terminal, Send, X, Play, RefreshCw, Trash2, CheckCircle2, ShieldAlert, Radio } from "lucide-react";

interface WebTerminalProps {
  sessionId: string | null;
  projectId: string | null;
  onClose: () => void;
}

interface CommandHistoryItem {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  success: boolean;
  timestamp: string;
}

export function WebTerminal({ sessionId, projectId, onClose }: WebTerminalProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [commandHistoryList, setCommandHistoryList] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [running, setRunning] = useState(false);
  const [useSseStream, setUseSseStream] = useState(true);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [history, running]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistoryList.length === 0) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex < commandHistoryList.length) {
        setHistoryIndex(nextIndex);
        setCommand(commandHistoryList[commandHistoryList.length - 1 - nextIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setCommand(commandHistoryList[commandHistoryList.length - 1 - nextIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand("");
      }
    }
  };

  const handleRunCommand = async (cmdToRun?: string) => {
    const targetCmd = cmdToRun || command;
    if (!targetCmd.trim()) return;

    setCommandHistoryList((prev) => [...prev, targetCmd]);
    setHistoryIndex(-1);
    setRunning(true);

    if (!cmdToRun) setCommand("");

    if (useSseStream) {
      // Execução via SSE Stream Real-Time
      const timestamp = new Date().toLocaleTimeString("pt-BR");
      const itemIndex = history.length;

      setHistory((prev) => [
        ...prev,
        {
          command: targetCmd,
          cwd: "workspace",
          stdout: "",
          stderr: "",
          success: true,
          timestamp,
        },
      ]);

      // authEventStream em vez de EventSource: EventSource não envia o X-Nextcode-Token e a
      // rota /api/terminal/stream (protegida) respondia 401 em toda execução.
      const params = new URLSearchParams({ command: targetCmd });
      if (projectId) params.set("projectId", projectId);
      try {
        await authEventStream(`/api/terminal/stream?${params.toString()}`, (event, payload) => {
          const data = payload as { type?: string; text?: string; exitCode?: number; message?: string };
          setHistory((prev) => {
            const updated = [...prev];
            const targetItem = updated[itemIndex] ? { ...updated[itemIndex] } : null;
            if (!targetItem) return prev;
            if (event === "log" && data.type === "stdout") {
              targetItem.stdout += data.text || "";
            } else if (event === "log" && data.type === "stderr") {
              targetItem.stderr += data.text || "";
            } else if (event === "done") {
              targetItem.success = data.exitCode === 0;
            } else if (event === "error") {
              targetItem.stderr += `\n[Erro de execução] ${data.message || ""}`;
              targetItem.success = false;
            }
            updated[itemIndex] = targetItem;
            return updated;
          });
        });
      } catch (err) {
        setHistory((prev) => {
          const updated = [...prev];
          if (updated[itemIndex]) {
            updated[itemIndex] = {
              ...updated[itemIndex],
              stderr: `${updated[itemIndex].stderr}\n[Erro SSE Connection] ${err instanceof Error ? err.message : String(err)}`,
              success: false,
            };
          }
          return updated;
        });
      } finally {
        setRunning(false);
      }
    } else {
      // Execução síncrona padrão
      try {
        const res = await authFetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: targetCmd,
            sessionId,
            projectId,
          }),
        });

        const data = await res.json();
        setHistory((prev) => [
          ...prev,
          {
            command: targetCmd,
            cwd: data.cwd || "workspace",
            stdout: data.stdout || "",
            stderr: data.stderr || data.error || data.details || "",
            success: res.ok && data.success,
            timestamp: new Date().toLocaleTimeString("pt-BR"),
          },
        ]);
      } catch (err) {
        setHistory((prev) => [
          ...prev,
          {
            command: targetCmd,
            cwd: "workspace",
            stdout: "",
            stderr: String(err),
            success: false,
            timestamp: new Date().toLocaleTimeString("pt-BR"),
          },
        ]);
      } finally {
        setRunning(false);
      }
    }
  };

  return (
    <div className="border-t border-slate-800 bg-slate-950 text-slate-100 flex flex-col h-64 shrink-0 transition-all shadow-2xl">
      {/* Header Bar */}
      <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-slate-200">
            <Terminal className="w-4 h-4 text-[#0066cc]" />
            <span>Terminal Sandbox Local</span>
          </div>
          <button
            onClick={() => setUseSseStream(!useSseStream)}
            className={`text-[10px] px-2 py-0.5 rounded font-mono flex items-center gap-1 border transition-colors ${
              useSseStream
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-800"
                : "bg-slate-800 text-slate-400 border-slate-700"
            }`}
            title="Alternar entre modo SSE Stream em Tempo Real e Resposta Estática"
          >
            <Radio className={`w-3 h-3 ${useSseStream ? "text-emerald-400 animate-pulse" : ""}`} />
            <span>{useSseStream ? "SSE Stream Ativo" : "Modo Estático"}</span>
          </button>
        </div>

        {/* Quick Command Presets */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRunCommand("npx tsc --noEmit")}
            disabled={running}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors"
          >
            npx tsc
          </button>
          <button
            onClick={() => handleRunCommand("npx vitest run")}
            disabled={running}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors"
          >
            npx vitest
          </button>
          <button
            onClick={() => handleRunCommand("git status")}
            disabled={running}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors"
          >
            git status
          </button>

          <button
            onClick={() => setHistory([])}
            className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors"
            title="Limpar Histórico"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors"
            title="Fechar Terminal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal History Container */}
      <div ref={terminalRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-3 leading-relaxed">
        {history.length === 0 ? (
          <div className="text-slate-500 italic text-[11px]">
            Nenhum comando executado. Digite um comando abaixo ou selecione um atalho rápido acima.
          </div>
        ) : (
          history.map((item, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                <span className="text-emerald-400 font-bold">$</span>
                <span className="text-slate-200 font-semibold">{item.command}</span>
                <span className="text-[10px] text-slate-500">[{item.cwd}]</span>
                <span className="text-[10px] text-slate-600 ml-auto">{item.timestamp}</span>
              </div>

              {item.stdout && (
                <pre className="text-slate-300 whitespace-pre-wrap pl-4 border-l border-slate-800 bg-slate-900/40 p-2 rounded">
                  {item.stdout}
                </pre>
              )}

              {item.stderr && (
                <pre className="text-rose-400 whitespace-pre-wrap pl-4 border-l border-rose-900 bg-rose-950/30 p-2 rounded">
                  {item.stderr}
                </pre>
              )}
            </div>
          ))
        )}

        {running && (
          <div className="flex items-center gap-2 text-emerald-400 text-xs animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Streaming de logs via SSE em tempo real...</span>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleRunCommand();
        }}
        className="p-2 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2"
      >
        <span className="text-emerald-400 font-mono font-bold pl-2 text-sm">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite um comando shell (seta para cima/baixo navega histórico)..."
          disabled={running}
          className="flex-1 bg-transparent text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={running || !command.trim()}
          className="px-3 py-1 bg-[#0066cc] hover:bg-blue-600 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Executar</span>
        </button>
      </form>
    </div>
  );
}
