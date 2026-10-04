"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-session";
import { Wrench, RefreshCw, X, Play, Server, CheckCircle2 } from "lucide-react";

interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

interface ServerWithTools {
  serverId: string;
  serverName: string;
  status: string;
  type: string;
  tools: McpTool[];
}

interface McpToolsModalProps {
  onClose: () => void;
}

export function McpToolsModal({ onClose }: McpToolsModalProps) {
  const [servers, setServers] = useState<ServerWithTools[]>([]);
  const [selectedTool, setSelectedTool] = useState<{ serverId: string; tool: McpTool } | null>(null);
  const [argsJson, setArgsJson] = useState('{\n  "path": "package.json"\n}');
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchTools = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/mcp/tools");
      const data = await res.json();
      if (res.ok && Array.isArray(data.servers)) {
        setServers(data.servers);
        if (data.servers.length > 0 && data.servers[0].tools.length > 0) {
          setSelectedTool({ serverId: data.servers[0].serverId, tool: data.servers[0].tools[0] });
        }
      }
    } catch (err) {
      console.error("Erro ao listar ferramentas MCP:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleExecuteTool = async () => {
    if (!selectedTool) return;
    setRunning(true);
    setExecutionResult(null);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(argsJson);
    } catch {
      alert("JSON de argumentos inválido.");
      setRunning(false);
      return;
    }

    try {
      const res = await authFetch("/api/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: selectedTool.serverId,
          toolName: selectedTool.tool.name,
          args: parsedArgs,
        }),
      });

      const data = await res.json();
      if (res.ok && data.result) {
        setExecutionResult(data.result);
      } else {
        setExecutionResult({ error: data.error || "Erro na execução da ferramenta MCP" });
      }
    } catch (err) {
      setExecutionResult({ error: String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-[#0066cc] dark:text-blue-400 flex items-center justify-center font-bold">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                Explorer & Testador de Ferramentas MCP (JSON-RPC)
              </h2>
              <span className="text-[11px] text-slate-400">
                Inspeção visual e teste de execução de ferramentas MCP em servidores conectados
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

        {/* Content Body split in 2 panels */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row text-xs">
          {/* Left Panel: Tools List */}
          <div className="w-full md:w-72 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto space-y-3 shrink-0 bg-slate-50/40 dark:bg-slate-950/40">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Servidores MCP ({servers.length})
            </div>

            {loading ? (
              <div className="p-4 text-center text-slate-400 italic">Carregando ferramentas...</div>
            ) : servers.length === 0 ? (
              <div className="p-4 text-center text-slate-400 italic">
                Nenhum servidor MCP cadastrado. Adicione um servidor em Configurações &gt; MCP.
              </div>
            ) : (
              servers.map((s) => (
                <div key={s.serverId} className="space-y-1">
                  <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 text-[11px]">
                    <Server className="w-3.5 h-3.5 text-[#0066cc]" />
                    <span>{s.serverName}</span>
                  </div>

                  <div className="space-y-1 pl-2">
                    {s.tools.map((t) => {
                      const isSelected = selectedTool?.tool.name === t.name;
                      return (
                        <button
                          key={t.name}
                          onClick={() => setSelectedTool({ serverId: s.serverId, tool: t })}
                          className={`w-full text-left p-2 rounded-lg transition-colors flex flex-col gap-0.5 ${
                            isSelected
                              ? "bg-blue-50 dark:bg-blue-950/80 text-[#0066cc] dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800"
                              : "hover:bg-slate-200/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-transparent"
                          }`}
                        >
                          <span className="font-mono text-[11px] truncate">{t.name}</span>
                          <span className="text-[10px] text-slate-400 truncate font-normal">
                            {t.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right Panel: Execution Workbench */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col justify-between">
            {selectedTool ? (
              <div className="space-y-3 flex-1 flex flex-col">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm font-mono flex items-center gap-2">
                    <span>{selectedTool.tool.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedTool.tool.description}</p>
                </div>

                <div className="space-y-1 flex-1 flex flex-col">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Argumentos JSON da Ferramenta
                  </label>
                  <textarea
                    value={argsJson}
                    onChange={(e) => setArgsJson(e.target.value)}
                    className="w-full bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-xs focus:outline-none flex-1 min-h-[100px] border border-slate-800"
                  />
                </div>

                {executionResult && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Saída JSON-RPC
                    </div>
                    <pre className="bg-slate-950 text-emerald-300 p-3 rounded-xl font-mono text-[10.5px] max-h-40 overflow-y-auto whitespace-pre-wrap border border-slate-800">
                      {JSON.stringify(executionResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic">
                Selecione uma ferramenta na lista lateral para testar a execução.
              </div>
            )}

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                onClick={handleExecuteTool}
                disabled={running || !selectedTool}
                className="px-4 py-2 bg-[#0066cc] hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-40"
              >
                <Play className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
                <span>Executar Ferramenta MCP</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
