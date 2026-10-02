"use client";

import { useState, useRef, useEffect } from "react";
import { authFetch } from "@/lib/client-session";
import { Terminal, Send, X, Play, RefreshCw, Trash2, CheckCircle2, ShieldAlert } from "lucide-react";

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
  const [running, setRunning] = useState(false);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [history, running]);

  const handleRunCommand = async (cmdToRun?: string) => {
    const targetCmd = cmdToRun || command;
    if (!targetCmd.trim()) return;

    setRunning(true);
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
      if (!cmdToRun) setCommand("");
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
          <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded font-mono">
            Jail Guard Ativo
          </span>
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
          <div className="flex items-center gap-2 text-blue-400 text-xs animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Executando comando no ambiente sandbox...</span>
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
          placeholder="Digite um comando shell (ex: npm test, git status)..."
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
