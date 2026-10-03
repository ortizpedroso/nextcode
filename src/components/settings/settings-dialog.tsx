"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/client-session";
import {
  Key,
  AlertTriangle,
  Server,
  Sliders,
  HelpCircle,
  X,
  CheckCircle2,
  Save,
  Zap,
  Code,
  ShieldCheck,
  FileCode,
  Plus,
  ExternalLink,
  Trash2,
  Edit3,
  RefreshCw,
  Globe,
  Radio,
  Check,
  UserCheck,
  ShieldAlert,
  Lock,
} from "lucide-react";
import { ByokTab } from "./byok-tab";
import { OmniRouteCard } from "./omniroute-card";
import { HeadroomCard } from "./headroom-card";
import { GithubSkillInstallerCard } from "./github-skill-installer-card";

export interface SettingsFormState {
  geminiKey: string;
  claudeKey: string;
  openaiKey: string;
  deepseekKey: string;
  groqKey: string;
  nvidiaKey: string;
  omniRouteKey: string;
  customEndpoint: string;
}

export interface CustomProviderItem {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  models: string; // JSON
  headers?: string | null; // JSON
}

export interface McpServerItem {
  id: string;
  name: string;
  type: "stdio" | "sse";
  command?: string | null;
  args?: string | null;
  url?: string | null;
  env?: string | null;
  status: "online" | "offline" | "error";
}

interface SettingsDialogProps {
  isOpen: boolean;
  settings: SettingsFormState;
  onClose: () => void;
  onSave: (updated: SettingsFormState) => Promise<void>;
}

export function SettingsDialog({
  isOpen,
  settings,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<"keys" | "custom" | "mcp" | "omniroute" | "headroom" | "roles" | "preferences" | "docs">("keys");
  const [formData, setFormData] = useState<SettingsFormState>(settings);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);
  // null = ainda não consultado; false = sem NEXTCODE_MASTER_KEY (chaves seriam gravadas em texto plano).
  const [secretsEncryptionEnabled, setSecretsEncryptionEnabled] = useState<boolean | null>(null);

  // Provedores Customizados State
  const [customProviders, setCustomProviders] = useState<CustomProviderItem[]>([]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customForm, setCustomForm] = useState({
    id: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    modelId: "",
    modelName: "",
    modelsList: [] as { id: string; name: string }[],
    headerKey: "",
    headerValue: "",
    headersList: [] as { key: string; value: string }[],
  });

  // Servidores MCP State
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [editingMcpId, setEditingMcpId] = useState<string | null>(null);
  const [mcpForm, setMcpForm] = useState({
    name: "",
    type: "stdio" as "stdio" | "sse",
    command: "",
    args: "",
    url: "",
    env: "",
  });

  // RBAC Roles State
  const [currentRole, setCurrentRole] = useState<"ADMIN" | "DEVELOPER" | "AUDITOR">("DEVELOPER");
  const [availableRoles, setAvailableRoles] = useState<any[]>([]);
  const [roleUpdating, setRoleUpdating] = useState(false);

  const fetchCustomProviders = async () => {
    try {
      const res = await fetch("/api/providers/custom");
      const data = await res.json();
      if (data.providers) setCustomProviders(data.providers);
    } catch (err) {
      console.error("Erro ao carregar provedores customizados:", err);
    }
  };

  const fetchMcpServers = async () => {
    try {
      const res = await fetch("/api/mcp/servers");
      const data = await res.json();
      if (data.servers) setMcpServers(data.servers);
    } catch (err) {
      console.error("Erro ao carregar servidores MCP:", err);
    }
  };

  const fetchSecretsEncryptionStatus = async () => {
    try {
      const res = await authFetch("/api/settings");
      const data = await res.json();
      if (typeof data.secretsEncryptionEnabled === "boolean") setSecretsEncryptionEnabled(data.secretsEncryptionEnabled);
    } catch (err) {
      console.error("Erro ao consultar status de criptografia das chaves:", err);
    }
  };

  const fetchRbacRoles = async () => {
    try {
      const res = await authFetch("/api/auth/roles");
      const data = await res.json();
      if (data.availableRoles) setAvailableRoles(data.availableRoles);
    } catch (err) {
      console.error("Erro ao carregar papéis RBAC:", err);
    }
  };

  const handleSelectRole = async (role: "ADMIN" | "DEVELOPER" | "AUDITOR") => {
    setRoleUpdating(true);
    try {
      const res = await authFetch("/api/auth/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentRole(role);
        setTestResult({
          provider: "RBAC Permissões",
          ok: true,
          message: `Papel '${role}' ativado com ${data.activePermissions.length} permissões.`,
        });
      }
    } catch (err) {
      console.error("Erro ao alterar papel RBAC:", err);
    } finally {
      setRoleUpdating(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFormData(settings);
      fetchCustomProviders();
      fetchMcpServers();
      fetchRbacRoles();
      fetchSecretsEncryptionStatus();
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSaveNativeKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
      setTestResult({ provider: "Configurações BYOK", ok: true, message: "Chaves salvas no SQLite!" });
    } catch {
      setTestResult({ provider: "Configurações BYOK", ok: false, message: "Erro ao salvar chaves." });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customForm.id || !/^[a-z0-9_-]+$/.test(customForm.id.trim())) {
      alert("ID inválido. Use apenas letras minúsculas, números, hifens e sublinhados (ex: ollama-local).");
      return;
    }
    try {
      const res = await authFetch("/api/providers/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customForm.id.trim(),
          name: customForm.name.trim(),
          baseUrl: customForm.baseUrl.trim(),
          apiKey: customForm.apiKey.trim() || undefined,
          models: customForm.modelsList,
          headers: Object.fromEntries(customForm.headersList.map((h) => [h.key, h.value])),
        }),
      });

      if (res.ok) {
        await fetchCustomProviders();
        setShowCustomModal(false);
        setCustomForm({
          id: "",
          name: "",
          baseUrl: "",
          apiKey: "",
          modelId: "",
          modelName: "",
          modelsList: [],
          headerKey: "",
          headerValue: "",
          headersList: [],
        });
        setTestResult({ provider: customForm.name, ok: true, message: "Provedor customizado registrado com sucesso!" });
      }
    } catch (err) {
      console.error("Erro ao criar provedor customizado:", err);
    }
  };

  const handleDeleteCustomProvider = async (id: string) => {
    try {
      const res = await authFetch(`/api/providers/custom/${id}`, { method: "DELETE" });
      if (res.ok) await fetchCustomProviders();
    } catch (err) {
      console.error("Erro ao deletar provedor:", err);
    }
  };

  const handleSaveMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingMcpId ? `/api/mcp/servers/${editingMcpId}` : "/api/mcp/servers";
      const method = editingMcpId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mcpForm.name.trim(),
          type: mcpForm.type,
          command: mcpForm.command.trim() || undefined,
          args: mcpForm.args.trim() ? mcpForm.args.split(" ") : undefined,
          url: mcpForm.url.trim() || undefined,
          env: mcpForm.env.trim() || undefined,
        }),
      });

      if (res.ok) {
        await fetchMcpServers();
        setShowMcpModal(false);
        setEditingMcpId(null);
        setMcpForm({ name: "", type: "stdio", command: "", args: "", url: "", env: "" });
      }
    } catch (err) {
      console.error("Erro ao salvar servidor MCP:", err);
    }
  };

  const handlePingMcp = async (id: string, name: string) => {
    try {
      const res = await authFetch(`/api/mcp/servers/${id}/ping`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ provider: `MCP ${name}`, ok: true, message: data.message });
        await fetchMcpServers();
      }
    } catch (err) {
      console.error("Erro no ping MCP:", err);
    }
  };

  const handleDeleteMcp = async (id: string) => {
    try {
      const res = await authFetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
      if (res.ok) await fetchMcpServers();
    } catch (err) {
      console.error("Erro ao apagar servidor MCP:", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl h-[600px] shadow-2xl flex flex-col overflow-hidden text-xs">
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[#0066cc]" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Hub Central de Configurações & Provedores
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo com Abas Laterais */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar de Abas Internas */}
          <div className="w-56 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 p-3 space-y-1">
            <button
              onClick={() => setActiveTab("keys")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 font-medium transition-all ${
                activeTab === "keys"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <Key className="w-4 h-4 text-[#0066cc]" />
              <span>Chaves Nativas (BYOK)</span>
            </button>

            <button
              onClick={() => setActiveTab("custom")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 font-medium transition-all ${
                activeTab === "custom"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <Globe className="w-4 h-4 text-[#0066cc]" />
              <span>Provedores OpenAI-Compatible</span>
            </button>

            <button
              onClick={() => setActiveTab("omniroute")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 font-medium transition-all ${
                activeTab === "omniroute"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <Zap className="w-4 h-4 text-amber-500" />
              <span>OmniRoute Local (1-Clique)</span>
            </button>

            <button
              onClick={() => setActiveTab("headroom")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between font-medium transition-all ${
                activeTab === "headroom"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Headroom Token Optimizer</span>
              </div>
              <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                Ativo
              </span>
            </button>

            <button
              onClick={() => setActiveTab("roles")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between font-medium transition-all ${
                activeTab === "roles"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-4 h-4 text-indigo-500" />
                <span>Papéis & RBAC</span>
              </div>
              <span className="text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950 px-1.5 py-0.5 rounded-full border border-indigo-300 dark:border-indigo-800 font-mono">
                {currentRole}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("mcp")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 font-medium transition-all ${
                activeTab === "mcp"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <Server className="w-4 h-4 text-[#0066cc]" />
              <span>Servidores & Skills MCP</span>
            </button>

            <button
              onClick={() => setActiveTab("preferences")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 font-medium transition-all ${
                activeTab === "preferences"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <Sliders className="w-4 h-4 text-[#0066cc]" />
              <span>Preferências do Sistema</span>
            </button>

            <button
              onClick={() => setActiveTab("docs")}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 font-medium transition-all ${
                activeTab === "docs"
                  ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900"
              }`}
            >
              <HelpCircle className="w-4 h-4 text-[#0066cc]" />
              <span>Documentação & Ajuda</span>
            </button>
          </div>

          {/* Conteúdo da Aba */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {testResult && (
              <div
                className={`p-3 rounded-lg flex items-center gap-2 text-xs border ${
                  testResult.ok
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                    : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>[{testResult.provider}] {testResult.message}</span>
              </div>
            )}

            {/* ABA 1: BYOK NATIVO COM TESTES INLINE */}
            {activeTab === "keys" && secretsEncryptionEnabled === false && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <strong>NEXTCODE_MASTER_KEY não configurada:</strong> as chaves salvas aqui ficam em texto plano no
                  banco SQLite. Defina a variável no <code>.env</code> e reinicie o servidor (em produção o salvamento é
                  recusado).
                </span>
              </div>
            )}
            {activeTab === "keys" && (
              <ByokTab
                settings={formData}
                onUpdateSettings={setFormData}
                onSave={async () => {
                  try {
                    await onSave(formData);
                    setTestResult({
                      provider: "Configurações BYOK",
                      ok: true,
                      message: "Chaves salvas com sucesso no banco de dados!",
                    });
                  } catch (err) {
                    setTestResult({
                      provider: "Configurações BYOK",
                      ok: false,
                      message: err instanceof Error ? err.message : String(err),
                    });
                  }
                }}
              />
            )}

            {/* ABA: OMNIROUTE LOCAL 1-CLIQUE */}
            {activeTab === "omniroute" && <OmniRouteCard />}

            {/* ABA: HEADROOM TOKEN OPTIMIZER */}
            {activeTab === "headroom" && <HeadroomCard />}

            {/* ABA: RBAC PAPÉIS & PERMISSÕES */}
            {activeTab === "roles" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-indigo-500" />
                      <span>Controle de Acesso RBAC & Multi-Tenancy</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Defina o perfil de permissão ativo para governança das operações na DAG e no Terminal.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  {(availableRoles.length > 0
                    ? availableRoles
                    : [
                        {
                          role: "ADMIN",
                          description: "Acesso total ao sistema, gerenciamento de chaves, cotas e servidores MCP",
                          permissions: ["read:*", "write:*", "admin:*", "exec:*", "quarantine:*"],
                        },
                        {
                          role: "DEVELOPER",
                          description: "Criação de DAGs, execução de tarefas no terminal e proposição de skills",
                          permissions: ["read:*", "write:code", "exec:terminal", "quarantine:stage"],
                        },
                        {
                          role: "AUDITOR",
                          description: "Leitura de logs de auditoria Dual-Lens, telemetria e revisões de código",
                          permissions: ["read:telemetry", "read:audit", "read:code"],
                        },
                      ]
                  ).map((r) => {
                    const isSelected = currentRole === r.role;
                    return (
                      <div
                        key={r.role}
                        onClick={() => handleSelectRole(r.role)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all space-y-2 flex flex-col justify-between ${
                          isSelected
                            ? "bg-indigo-50/70 dark:bg-indigo-950/60 border-indigo-500 dark:border-indigo-600 shadow-sm"
                            : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-indigo-300"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between font-bold text-xs">
                            <span className={isSelected ? "text-indigo-700 dark:text-indigo-300" : "text-slate-900 dark:text-white"}>
                              {r.role}
                            </span>
                            {isSelected && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1">
                            {r.description}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-slate-200/50 dark:border-slate-800">
                          <span className="text-[10px] font-mono text-slate-400 block mb-1">Permissões ({r.permissions.length}):</span>
                          <div className="flex flex-wrap gap-1">
                            {r.permissions.map((p: string, i: number) => (
                              <span
                                key={i}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 font-mono text-slate-700 dark:text-slate-300"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ABA 2: PROVEDORES OPENAI-COMPATIBLE CUSTOMIZADOS */}
            {activeTab === "custom" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h4 className="font-bold text-slate-900 dark:text-white">
                    Provedores Personalizados (OpenAI Compatible)
                  </h4>
                  <button
                    onClick={() => setShowCustomModal(true)}
                    className="px-3 py-1.5 bg-[#0066cc] text-white rounded-lg flex items-center gap-1 text-xs font-medium shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar Provedor
                  </button>
                </div>

                {customProviders.length === 0 ? (
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-slate-400">
                    Nenhum provedor personalizado cadastrado (ex: Ollama, vLLM, LM Studio, Groq, LiteLLM).
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customProviders.map((p) => {
                      const modelsArr = JSON.parse(p.models || "[]");
                      return (
                        <div
                          key={p.id}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between"
                        >
                          <div className="space-y-1">
                            <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                              <span>{p.name}</span>
                              <code className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                id: {p.id}
                              </code>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">{p.baseUrl}</div>
                            {modelsArr.length > 0 && (
                              <div className="text-[10px] text-slate-400 flex items-center gap-1 pt-1">
                                <span>Modelos: {modelsArr.map((m: { name: string }) => m.name).join(", ")}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDeleteCustomProvider(p.id)}
                              className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-lg"
                              title="Excluir"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Modal Cadastrar Provedor Customizado */}
                {showCustomModal && (
                  <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Globe className="w-4 h-4 text-[#0066cc]" />
                        Cadastrar Provedor OpenAI-Compatible
                      </h3>
                      <form onSubmit={handleSaveCustomProvider} className="space-y-3 text-xs">
                        <div>
                          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                            ID do Provedor (slug: letras minúsculas, números, - e _)
                          </label>
                          <input
                            type="text"
                            placeholder="ex: ollama-local"
                            value={customForm.id}
                            onChange={(e) => setCustomForm({ ...customForm, id: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Nome de Exibição
                          </label>
                          <input
                            type="text"
                            placeholder="ex: Ollama Local ou Gateway Interno"
                            value={customForm.name}
                            onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                            URL Base da API
                          </label>
                          <input
                            type="text"
                            placeholder="ex: http://localhost:11434/v1"
                            value={customForm.baseUrl}
                            onChange={(e) => setCustomForm({ ...customForm, baseUrl: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#0066cc]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Chave de API (Opcional)
                          </label>
                          <input
                            type="password"
                            placeholder="Deixe em branco se gerenciar autenticação via cabeçalhos"
                            value={customForm.apiKey}
                            onChange={(e) => setCustomForm({ ...customForm, apiKey: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                          />
                        </div>

                        {/* Modelos */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          <label className="block font-bold text-slate-900 dark:text-white">
                            Modelos Suportados
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="ID: deepseek-r1:14b"
                              value={customForm.modelId}
                              onChange={(e) => setCustomForm({ ...customForm, modelId: e.target.value })}
                              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs"
                            />
                            <input
                              type="text"
                              placeholder="Nome: DeepSeek R1 14B"
                              value={customForm.modelName}
                              onChange={(e) => setCustomForm({ ...customForm, modelName: e.target.value })}
                              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (customForm.modelId.trim() && customForm.modelName.trim()) {
                                  setCustomForm({
                                    ...customForm,
                                    modelsList: [
                                      ...customForm.modelsList,
                                      { id: customForm.modelId.trim(), name: customForm.modelName.trim() },
                                    ],
                                    modelId: "",
                                    modelName: "",
                                  });
                                }
                              }}
                              className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg font-medium"
                            >
                              +
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1 pt-1">
                            {customForm.modelsList.map((m, i) => (
                              <span
                                key={i}
                                className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 font-mono"
                              >
                                {m.name} ({m.id})
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-3">
                          <button
                            type="button"
                            onClick={() => setShowCustomModal(false)}
                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            className="px-4 py-1.5 text-xs bg-[#0066cc] hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm"
                          >
                            Salvar Provedor
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ABA 3: CRUD SERVIDORES MCP & SKILLS GITHUB */}
            {activeTab === "mcp" && (
              <div className="space-y-6">
                <GithubSkillInstallerCard />

                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h4 className="font-bold text-slate-900 dark:text-white">
                    Servidores Model Context Protocol (MCP)
                  </h4>
                  <button
                    onClick={() => {
                      setEditingMcpId(null);
                      setMcpForm({ name: "", type: "stdio", command: "", args: "", url: "", env: "" });
                      setShowMcpModal(true);
                    }}
                    className="px-3 py-1.5 bg-[#0066cc] text-white rounded-lg flex items-center gap-1 text-xs font-medium shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Registrar Servidor
                  </button>
                </div>

                {mcpServers.length === 0 ? (
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-slate-400">
                    Nenhum servidor MCP conectado.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mcpServers.map((srv) => (
                      <div
                        key={srv.id}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                            <span>{srv.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                srv.status === "online"
                                  ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                  : "bg-slate-200 text-slate-600 border-slate-300"
                              }`}
                            >
                              {srv.status.toUpperCase()}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">[{srv.type}]</span>
                          </div>
                          <code className="text-[11px] text-slate-500 font-mono block">
                            {srv.type === "stdio" ? `${srv.command} ${srv.args || ""}` : srv.url}
                          </code>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePingMcp(srv.id, srv.name)}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 rounded-lg flex items-center gap-1 text-[11px] border border-emerald-200 dark:border-emerald-800"
                            title="Testar Conexão / Ping"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Ping</span>
                          </button>

                          <button
                            onClick={() => {
                              setEditingMcpId(srv.id);
                              setMcpForm({
                                name: srv.name,
                                type: srv.type,
                                command: srv.command || "",
                                args: srv.args || "",
                                url: srv.url || "",
                                env: srv.env || "",
                              });
                              setShowMcpModal(true);
                            }}
                            className="p-1.5 text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"
                            title="Editar"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleDeleteMcp(srv.id)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-lg"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Modal Cadastrar/Editar MCP Server */}
                {showMcpModal && (
                  <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Server className="w-4 h-4 text-[#0066cc]" />
                        {editingMcpId ? "Editar Servidor MCP" : "Registrar Servidor MCP"}
                      </h3>
                      <form onSubmit={handleSaveMcpServer} className="space-y-3 text-xs">
                        <div>
                          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Nome do Servidor MCP
                          </label>
                          <input
                            type="text"
                            placeholder="ex: Filesystem MCP"
                            value={mcpForm.name}
                            onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                            required
                          />
                        </div>

                        <div>
                          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Tipo de Conexão MCP
                          </label>
                          <select
                            value={mcpForm.type}
                            onChange={(e) => setMcpForm({ ...mcpForm, type: e.target.value as "stdio" | "sse" })}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                          >
                            <option value="stdio">STDIO (Comando Local)</option>
                            <option value="sse">SSE (HTTP Server-Sent Events)</option>
                          </select>
                        </div>

                        {mcpForm.type === "stdio" ? (
                          <>
                            <div>
                              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Comando
                              </label>
                              <input
                                type="text"
                                placeholder="ex: npx"
                                value={mcpForm.command}
                                onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                              />
                            </div>
                            <div>
                              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Argumentos (separados por espaço)
                              </label>
                              <input
                                type="text"
                                placeholder="ex: -y @modelcontextprotocol/server-filesystem /workspace"
                                value={mcpForm.args}
                                onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                              />
                            </div>
                          </>
                        ) : (
                          <div>
                            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                              URL SSE HTTP
                            </label>
                            <input
                              type="text"
                              placeholder="ex: http://localhost:8080/sse"
                              value={mcpForm.url}
                              onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })}
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#0066cc]"
                            />
                          </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setShowMcpModal(false)}
                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            className="px-4 py-1.5 text-xs bg-[#0066cc] hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm"
                          >
                            Salvar Servidor MCP
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ABA 4: PREFERÊNCIAS DO SISTEMA */}
            {activeTab === "preferences" && (
              <div className="space-y-4">
                <h4 className="font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
                  Parâmetros de Rede & Sandbox
                </h4>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Faixa de Portas Dinâmicas do Boot Server
                  </label>
                  <input
                    type="text"
                    defaultValue="3001 - 3099"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    readOnly
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Timeout Padrão de Execução do Sandboxed Terminal (segundos)
                  </label>
                  <input
                    type="number"
                    defaultValue={30}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Diretório de Quarentena / Isolamento
                  </label>
                  <input
                    type="text"
                    defaultValue=".quarantine"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* ABA 5: DOCUMENTAÇÃO & AJUDA */}
            {activeTab === "docs" && (
              <div className="space-y-4">
                <h4 className="font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
                  Guia Rápido de Skills MCP & Automação
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="font-bold text-[#0066cc] flex items-center gap-1.5">
                      <FileCode className="w-4 h-4" /> smart-patch
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                      Aplica patches cirúrgicos via blocos diff sem sobrescrever o arquivo completo.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="font-bold text-[#0066cc] flex items-center gap-1.5">
                      <Code className="w-4 h-4" /> spec-decomposer
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                      Decompõe objetivos complexos em nós encadeados de DAG com dependências.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="font-bold text-[#0066cc] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" /> sandboxed-terminal
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                      Executa comandos de shell com filtro de segurança contra instruções destrutivas.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="font-bold text-[#0066cc] flex items-center gap-1.5">
                      <Zap className="w-4 h-4" /> intent-router
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                      Classifica a complexidade e roteia tarefas entre as camadas FAST e HEAVY.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
