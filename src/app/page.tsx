"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { authFetch, authDownload } from "@/lib/client-session";
import { Sidebar, ProjectItem, SessionItem } from "@/components/layout/sidebar";
import { Workspace, TaskNode, SessionMessage, GraphifyRunOutcome } from "@/components/layout/workspace";
import { ProjectFormData } from "@/components/projects/open-project-dialog";
import { ProjectData } from "@/components/projects/project-actions-menu";
import { SettingsFormState, CustomProviderItem } from "@/components/settings/settings-dialog";
import { QuarantineDiffModal } from "@/components/session/quarantine-diff-modal";
import { CanonicalSpecModal } from "@/components/session/canonical-spec-modal";
import { TelemetryModal } from "@/components/session/telemetry-modal";
import { QuotaModal } from "@/components/session/quota-modal";
import { SkillProposalModal } from "@/components/session/skill-proposal-modal";
import { BenchmarkModal } from "@/components/session/benchmark-modal";
import { McpToolsModal } from "@/components/session/mcp-tools-modal";
import { CodeSearchModal } from "@/components/session/code-search-modal";
import { SessionRevisionsModal } from "@/components/session/session-revisions-modal";

export default function DashboardOrchestrator() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [adhocSessions, setAdhocSessions] = useState<SessionItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionTitle, setActiveSessionTitle] = useState<string>("");
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<"dag" | "settings" | "docs">("dag");
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProviderItem[]>([]);
  const [inspectTaskId, setInspectTaskId] = useState<string | null>(null);

  const [showSpecModal, setShowSpecModal] = useState(false);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showBenchmarkModal, setShowBenchmarkModal] = useState(false);
  const [showMcpToolsModal, setShowMcpToolsModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showRevisionsModal, setShowRevisionsModal] = useState(false);
  const [canonicalSpec, setCanonicalSpec] = useState("");
  const [isSpecApproved, setIsSpecApproved] = useState(false);

  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [tokensSaved, setTokensSaved] = useState<number>(12450);
  const [loading, setLoading] = useState(false);
  const [executingNodeId, setExecutingNodeId] = useState<string | null>(null);
  const [graphifyRunningMessageId, setGraphifyRunningMessageId] = useState<string | null>(null);
  const [graphifyResults, setGraphifyResults] = useState<Record<string, GraphifyRunOutcome>>({});
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setExecutingNodeId(null);
    setConsoleLogs((prev) => [...prev, "[CANCELADO] Processamento interrompido pelo usuário."]);
  };

  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    geminiKey: "",
    claudeKey: "",
    openaiKey: "",
    deepseekKey: "",
    groqKey: "",
    nvidiaKey: "",
    omniRouteKey: "",
    customEndpoint: "",
  });

  const fetchProjects = async () => {
    try {
      const res = await authFetch("/api/projects");
      if (!res.ok) return;
      const data = await res.json();
      if (data.projects) {
        setProjects(data.projects);
      }
    } catch (err) {
      console.error("Erro ao carregar projetos:", err);
    }
  };

  const fetchAdhocSessions = async () => {
    try {
      const res = await authFetch("/api/sessions?adhocOnly=true");
      if (!res.ok) return;
      const data = await res.json();
      if (data.sessions) {
        setAdhocSessions(data.sessions);
      }
    } catch (err) {
      console.error("Erro ao carregar sessões ad-hoc:", err);
    }
  };

  const fetchCustomProviders = async () => {
    try {
      const res = await authFetch("/api/providers/custom");
      if (!res.ok) return;
      const data = await res.json();
      if (data.providers) {
        setCustomProviders(data.providers);
      }
    } catch (err) {
      console.error("Erro ao carregar provedores customizados:", err);
    }
  };

  const fetchSessionDetails = useCallback(async (sessionId?: string | null) => {
    const targetSessionId = sessionId !== undefined ? sessionId : activeSessionId;
    if (!targetSessionId) return;

    try {
      const res = await authFetch(`/api/dag?sessionId=${targetSessionId}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.session) {
        setActiveSessionId(data.session.id);
        setActiveSessionTitle(data.session.title);
        setActiveProjectName(data.session.project?.name || null);
        setActiveProjectId(data.session.projectId || null);
        setCanonicalSpec(data.session.canonicalSpec || "");
        setIsSpecApproved(Boolean(data.session.specApproved));
        setTasks(data.tasks || []);
        // Filtra estritamente para que APENAS mensagens do Usuário e do Assistente sejam exibidas
        const cleanMsgs = (data.messages || []).filter(
          (m: SessionMessage) => m.role === "user" || m.role === "assistant"
        );
        setMessages(cleanMsgs);
      }
    } catch (err) {
      // Falhas temporárias de rede (ex.: re-compilação do dev server) não devem quebrar a UI
      if (process.env.NODE_ENV === "development") {
        console.warn("Sincronização temporária de sessão pausada (servidor indisponível ou reconectando).");
      }
    }
  }, [activeSessionId]);

  const fetchSettings = async () => {
    try {
      const res = await authFetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettingsForm({
        geminiKey: data.geminiKey || "",
        claudeKey: data.claudeKey || "",
        openaiKey: data.openaiKey || "",
        deepseekKey: data.deepseekKey || "",
        groqKey: data.groqKey || "",
        nvidiaKey: data.nvidiaKey || "",
        omniRouteKey: data.omniRouteKey || "",
        customEndpoint: data.customEndpoint || "",
      });
    } catch (err) {
      console.error("Erro ao carregar configurações:", err);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchAdhocSessions();
    fetchCustomProviders();
    fetchSettings();
  }, []);

  // Polling em tempo real: Sincroniza estado das tarefas e mensagens enquanto houver DAG rodando no servidor
  useEffect(() => {
    if (!activeSessionId) return;
    const hasActiveTasks = tasks.some((t) => t.status === "running" || t.status === "pending");
    if (!hasActiveTasks && !loading) return;

    const interval = setInterval(() => {
      fetchSessionDetails(activeSessionId);
    }, 2500);

    return () => clearInterval(interval);
  }, [activeSessionId, tasks, loading, fetchSessionDetails]);

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveView("dag");
    await fetchSessionDetails(sessionId);
  };

  const handleCreateProject = async (data: ProjectFormData) => {
    try {
      const res = await authFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (res.ok && resData.project) {
        await fetchProjects();
        setActiveProjectId(resData.project.id);
        setActiveProjectName(resData.project.name);
        setActiveSessionId(null);
        setActiveSessionTitle("");
        setTasks([]);
        setMessages([]);
        setConsoleLogs((prev) => [
          ...prev,
          `[PROJETO] Projeto "${resData.project.name}" ${resData.project.path ? `(Pasta: ${resData.project.path})` : ""} cadastrado!`,
        ]);
      }
    } catch (err) {
      console.error("Erro ao criar projeto:", err);
    }
  };

  const handleUpdateProject = async (id: string, data: Partial<ProjectData>) => {
    try {
      const res = await authFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchProjects();
        setConsoleLogs((prev) => [...prev, `[PROJETO] Dados do projeto ${id.substring(0, 6)} atualizados.`]);
      }
    } catch (err) {
      console.error("Erro ao atualizar projeto:", err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (activeProjectId === projectId) {
          setActiveProjectId(null);
          setActiveSessionId(null);
          setActiveSessionTitle("");
          setActiveProjectName(null);
          setTasks([]);
          setMessages([]);
        }
        await fetchProjects();
        setConsoleLogs((prev) => [...prev, `[PROJETO] Projeto ${projectId.substring(0, 6)} removido com sucesso.`]);
      }
    } catch (err) {
      console.error("Erro ao apagar projeto:", err);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      const res = await authFetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setActiveSessionTitle("");
          setActiveProjectName(null);
          setTasks([]);
          setMessages([]);
        }
        await fetchProjects();
        await fetchAdhocSessions();
        setConsoleLogs((prev) => [...prev, `[SESSÃO] Sessão ${sessionId.substring(0, 6)} excluída com sucesso.`]);
      }
    } catch (err) {
      console.error("Erro ao apagar sessão:", err);
    }
  };

  const handleAttachSessionToProject = async (sessionId: string, projectId: string | null) => {
    try {
      const res = await authFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProjects();
        await fetchAdhocSessions();

        const targetProj = projects.find((p) => p.id === projectId);
        if (activeSessionId === sessionId) {
          setActiveProjectId(projectId);
          setActiveProjectName(targetProj?.name || null);
        }

        const projNameStr = targetProj ? `ao projeto "${targetProj.name}"` : "às Sessões Ad-hoc (desvinculada)";
        setConsoleLogs((prev) => [
          ...prev,
          `[SESSÃO] Sessão ${sessionId.substring(0, 6)} anexada ${projNameStr}.`,
        ]);
      } else {
        console.error("Erro ao vincular sessão ao projeto:", data.error);
      }
    } catch (err) {
      console.error("Erro ao vincular sessão ao projeto:", err);
    }
  };

  const handleCreateSession = async (projectId?: string | null) => {
    try {
      const targetProjectId = projectId !== undefined ? projectId : activeProjectId;

      const res = await authFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: targetProjectId }),
      });
      const data = await res.json();

      if (res.ok && data.session) {
        setActiveSessionId(data.session.id);
        setActiveSessionTitle(data.session.title);
        setActiveProjectId(targetProjectId || null);
        setActiveProjectName(data.session.project?.name || null);
        setTasks([]);
        setMessages([]);
        setActiveView("dag");

        await fetchProjects();
        await fetchAdhocSessions();

        if (targetProjectId) {
          setConsoleLogs((prev) => [...prev, `[SESSÃO] Nova sessão criada no projeto ID: ${targetProjectId.substring(0, 6)}.`]);
        } else {
          setConsoleLogs((prev) => [...prev, "[SESSÃO] Nova sessão Ad-hoc iniciada."]);
        }
      }
    } catch (err) {
      console.error("Erro ao criar sessão:", err);
    }
  };

  // Chat Conversacional Direto com a IA (Sem poluir o chat com notificações técnicas de DAG)
  const handleSendMessage = async (prompt: string, modelOverride?: string, attachments?: string[]) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setConsoleLogs((prev) => [...prev, `[CHAT] Processando mensagem do usuário: "${prompt.substring(0, 30)}..." ${attachments ? `(${attachments.length} imagem/ns)` : ""}`]);

    try {
      // 1. Chamada direta ao endpoint conversacional /api/chat com authFetch e AbortSignal
      const chatRes = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          prompt,
          projectId: activeProjectId,
          modelOverride,
          attachments,
        }),
        signal: controller.signal,
      });

      const chatData = await chatRes.json();
      if (chatRes.ok && chatData.sessionId) {
        const targetSessionId = chatData.sessionId;
        setActiveSessionId(targetSessionId);

        // A sugestão de graphify é um campo efêmero (não persistido na tabela Message) retornado
        // só nesta resposta — anexamos na última mensagem do assistente para o card inline aparecer.
        const incomingMessages: SessionMessage[] = chatData.messages || [];
        if (chatData.graphifySuggestion) {
          for (let i = incomingMessages.length - 1; i >= 0; i--) {
            if (incomingMessages[i].role === "assistant") {
              incomingMessages[i] = { ...incomingMessages[i], graphifySuggestion: chatData.graphifySuggestion };
              break;
            }
          }
        }
        setMessages(incomingMessages);
        if (chatData.tokensSaved) {
          setTokensSaved((prev) => prev + chatData.tokensSaved);
        }

        setConsoleLogs((prev) => [
          ...prev,
          `[SMART ROUTER] Modelo Acionado: ${chatData.intent?.actualModelUsed || "Auto"} (Tier: ${(chatData.intent?.tier || "fast").toUpperCase()})`,
          `[HEADROOM] Contexto sanitizado. Tokens poupados: ${chatData.tokensSaved || 0}`,
        ]);

        await fetchProjects();
        await fetchAdhocSessions();

        // 2. Dispara a DAG em background SOMENTE se a Trava T1 já estiver genuinamente liberada
        // (aprovação explícita via modal "Aprovar Spec Canônica" ou palavra-chave de aprovação
        // detectada pelo /api/chat). Nunca inferir aprovação por heurística de palavras comuns
        // do prompt do usuário ("criar", "fazer", "pode", "sim" etc. aparecem em qualquer pedido
        // normal e isso permitia executar a DAG sem o usuário jamais ter aprovado a Spec).
        setIsSpecApproved(Boolean(chatData.specApproved));

        if (chatData.specApproved) {
          await triggerBackgroundDAG(prompt, targetSessionId, modelOverride);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setConsoleLogs((prev) => [...prev, "[CHAT] Processamento interrompido pelo usuário."]);
      } else {
        setConsoleLogs((prev) => [...prev, `[ERRO] Falha no envio da mensagem: ${String(err)}`]);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  // Telemetria "graphify": instala a skill + roda o pipeline (extração AST, sem LLM) no projeto
  // ativo, acionado pelo botão inline anexado à resposta do chat quando o classificador julgou
  // o pedido elegível (ver graphifySuggestion em handleSendMessage / /api/chat).
  const handleRunGraphify = async (messageId: string, projectId: string) => {
    setGraphifyRunningMessageId(messageId);
    try {
      const res = await authFetch("/api/skills/graphify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sessionId: activeSessionId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setGraphifyResults((prev) => ({
          ...prev,
          [messageId]: {
            success: true,
            nodes: data.result?.nodes,
            edges: data.result?.edges,
            communities: data.result?.communities,
          },
        }));
        setConsoleLogs((prev) => [...prev, `[GRAPHIFY] Grafo gerado: ${data.result?.nodes} nós, ${data.result?.edges} arestas.`]);
      } else {
        setGraphifyResults((prev) => ({
          ...prev,
          [messageId]: { success: false, error: data.error || "Falha desconhecida ao executar o graphify." },
        }));
      }
    } catch (err) {
      setGraphifyResults((prev) => ({
        ...prev,
        [messageId]: { success: false, error: String(err) },
      }));
    } finally {
      setGraphifyRunningMessageId(null);
    }
  };

  // Execução de DAG autônoma estritamente no servidor com logs no painel lateral
  const triggerBackgroundDAG = async (
    prompt: string,
    targetSessionId: string,
    modelOverride?: string
  ) => {
    try {
      // 1. Assegura a criação dos nós da DAG
      const res = await authFetch("/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_dag",
          prompt,
          sessionId: targetSessionId,
          projectId: activeProjectId,
          tierOverride: modelOverride,
        }),
      });

      const data = await res.json();
      if (res.ok && data.tasks) {
        setTasks(data.tasks);
        setConsoleLogs((prev) => [
          ...prev,
          `[DAG AUTÔNOMA] ${data.tasks.length} nós de tarefas prontos no painel. Processador autônomo acionado no servidor...`,
        ]);
      }

      // 2. Dispara o processador de fila de DAG autônomo no Servidor (Server-Side Execution)
      const procRes = await authFetch("/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process_queue",
          sessionId: targetSessionId,
        }),
      });

      const procData = await procRes.json().catch(() => ({}));
      if (procRes.ok && procData.tasks) {
        setTasks(procData.tasks);
        await fetchSessionDetails(targetSessionId);
        setConsoleLogs((prev) => [
          ...prev,
          `[DAG AUTÔNOMA] ✅ Pipeline de tarefas processado no servidor (${procData.processedCount || 0} etapas executadas, auditadas e promovidas)!`,
        ]);
      } else if (!procRes.ok) {
        setConsoleLogs((prev) => [
          ...prev,
          `[AVISO DAG] Processamento no servidor finalizado ou interrompido: ${procData.details || procData.error || "veja o painel de tarefas"}`,
        ]);
        await fetchSessionDetails(targetSessionId);
      }
    } catch (dagErr: unknown) {
      console.error("Erro na DAG autônoma:", dagErr);
      setConsoleLogs((prev) => [...prev, `[ERRO DAG] Falha de comunicação com o servidor: ${String(dagErr)}`]);
    }
  };

  const handleExecuteNode = async (nodeId: string) => {
    setExecutingNodeId(nodeId);
    setConsoleLogs((prev) => [...prev, `[EXEC] Executando nó ID: ${nodeId}...`]);

    try {
      const res = await authFetch("/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_node", nodeId }),
      });

      const data = await res.json();
      if (res.ok) {
        setConsoleLogs((prev) => [
          ...prev,
          `[SUCCESS] Nó '${data.executedTask.title}' concluído com sucesso via MCP Protocol!`,
        ]);
        const refreshRes = await authFetch(`/api/dag?sessionId=${activeSessionId}`);
        const refreshData = await refreshRes.json();
        if (refreshData.tasks) setTasks(refreshData.tasks);
      } else {
        setConsoleLogs((prev) => [...prev, `[BLOQUEADO] ${data.error || "Execução recusada"}: ${data.details || ""}`]);
      }
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[ERRO] Falha na execução do nó: ${String(err)}`]);
    } finally {
      setExecutingNodeId(null);
    }
  };

  const handleRetryNode = async (nodeId: string) => {
    setConsoleLogs((prev) => [...prev, `[RETRY] Desbloqueando etapa e liberando fila no servidor...`]);
    try {
      const res = await authFetch("/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_node", nodeId }),
      });

      const data = await res.json();
      if (res.ok && data.tasks) {
        setTasks(data.tasks);
        setConsoleLogs((prev) => [
          ...prev,
          `[RETRY] ${data.message || "Etapa desbloqueada com sucesso!"} Retomando processador no servidor...`,
        ]);

        if (activeSessionId) {
          await authFetch("/api/dag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "process_queue", sessionId: activeSessionId }),
          });
          await fetchSessionDetails(activeSessionId);
        }
      }
    } catch (err) {
      console.error("Erro ao desbloquear nó:", err);
      setConsoleLogs((prev) => [...prev, `[ERRO] Falha ao desbloquear etapa: ${String(err)}`]);
    }
  };

  // Exportações usam authDownload: window.open não envia o X-Nextcode-Token e a rota
  // protegida respondia 401 na aba nova.
  const handleExportAuditReport = async () => {
    if (!activeSessionId) return;
    try {
      await authDownload(
        `/api/governance/export?sessionId=${activeSessionId}&format=markdown`,
        `auditoria-nextcode-${activeSessionId.substring(0, 8)}.md`
      );
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[ERRO] Falha ao exportar relatório de auditoria: ${String(err)}`]);
    }
  };

  const handleSaveSettings = async (updated: SettingsFormState) => {
    setSettingsForm(updated);
    const res = await authFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || "Erro ao salvar configurações");
    }
    await fetchCustomProviders();
    await fetchSettings();
  };

  const handleExportSessionJSON = async (sessionId: string) => {
    try {
      await authDownload(
        `/api/sessions/export-import?sessionId=${sessionId}`,
        `nextcode-session-${sessionId.substring(0, 8)}.json`
      );
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[ERRO] Falha ao exportar sessão: ${String(err)}`]);
    }
  };

  const handleImportSessionJSON = async (file: File) => {
    try {
      const text = await file.text();
      const backupJson = JSON.parse(text);
      const res = await authFetch("/api/sessions/export-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: backupJson }),
      });
      const data = await res.json();
      if (res.ok && data.session) {
        await fetchProjects();
        await fetchAdhocSessions();
        handleSelectSession(data.session.id);
        setConsoleLogs((prev) => [
          ...prev,
          `[BACKUP] Sessão "${data.session.title}" restaurada a partir do arquivo JSON!`,
        ]);
      } else {
        alert(data.error || "Erro ao importar sessão.");
      }
    } catch (err) {
      console.error("Erro ao importar JSON:", err);
      alert("Arquivo JSON inválido.");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar Reorganizada em 3 Seções */}
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        activeSessionId={activeSessionId}
        adhocSessions={adhocSessions}
        settings={settingsForm}
        onSelectProject={(id) => {
          if (!id) {
            setActiveProjectId(null);
            setActiveProjectName(null);
            setActiveSessionId(null);
            setActiveSessionTitle("");
            setTasks([]);
            setMessages([]);
            return;
          }
          setActiveProjectId(id);
          const proj = projects.find((p) => p.id === id);
          setActiveProjectName(proj?.name ?? null);
          if (proj && proj.sessions && proj.sessions.length > 0) {
            handleSelectSession(proj.sessions[0].id);
          } else {
            setActiveSessionId(null);
            setActiveSessionTitle("");
            setTasks([]);
            setMessages([]);
          }
        }}
        onSelectSession={handleSelectSession}
        onCreateProject={handleCreateProject}
        onUpdateProject={handleUpdateProject}
        onDeleteProject={handleDeleteProject}
        onDeleteSession={handleDeleteSession}
        onCreateSession={handleCreateSession}
        onSaveSettings={handleSaveSettings}
        onRefreshProjects={fetchProjects}
        onAttachSessionToProject={handleAttachSessionToProject}
        onExportSessionJSON={handleExportSessionJSON}
        onImportSessionJSON={handleImportSessionJSON}
      />

      {/* Workspace Principal à Direita */}
      <Workspace
        activeView={activeView}
        activeSessionId={activeSessionId}
        activeSessionTitle={activeSessionTitle}
        activeProjectName={activeProjectName}
        tasks={tasks}
        messages={messages}
        consoleLogs={consoleLogs}
        tokensSaved={tokensSaved}
        loading={loading}
        executingNodeId={executingNodeId}
        settingsForm={settingsForm}
        customProviders={customProviders}
        onUpdateSettingsForm={setSettingsForm}
        onSaveSettings={() => handleSaveSettings(settingsForm)}
        onCreateDAG={handleSendMessage}
        onExecuteNode={handleExecuteNode}
        onRefreshTasks={() => fetchSessionDetails(activeSessionId)}
        onRetryNode={handleRetryNode}
        onInspectQuarantine={setInspectTaskId}
        onExportAuditReport={handleExportAuditReport}
        onOpenSpecModal={(content) => {
          // Usa a Spec real escrita pela IA na conversa (se o clique partiu de uma mensagem),
          // em vez de deixar o modal reabrir com o estado antigo/desincronizado em canonicalSpec.
          if (content) setCanonicalSpec(content);
          setShowSpecModal(true);
        }}
        onOpenTelemetryModal={() => setShowTelemetryModal(true)}
        onOpenQuotaModal={() => setShowQuotaModal(true)}
        onOpenSkillsModal={() => setShowSkillsModal(true)}
        onOpenBenchmarkModal={() => setShowBenchmarkModal(true)}
        onOpenMcpToolsModal={() => setShowMcpToolsModal(true)}
        onOpenSearchModal={() => setShowSearchModal(true)}
        onOpenRevisionsModal={() => setShowRevisionsModal(true)}
        onStop={handleStopProcessing}
        onRunGraphify={handleRunGraphify}
        graphifyRunningMessageId={graphifyRunningMessageId}
        graphifyResults={graphifyResults}
      />

      {inspectTaskId && (
        <QuarantineDiffModal
          taskId={inspectTaskId}
          onClose={() => setInspectTaskId(null)}
        />
      )}

      {showTelemetryModal && (
        <TelemetryModal
          onClose={() => setShowTelemetryModal(false)}
        />
      )}

      {showQuotaModal && (
        <QuotaModal
          onClose={() => setShowQuotaModal(false)}
        />
      )}

      {showSkillsModal && (
        <SkillProposalModal
          onClose={() => setShowSkillsModal(false)}
        />
      )}

      {showBenchmarkModal && activeSessionId && (
        <BenchmarkModal
          sessionId={activeSessionId}
          onClose={() => setShowBenchmarkModal(false)}
        />
      )}

      {showMcpToolsModal && (
        <McpToolsModal
          onClose={() => setShowMcpToolsModal(false)}
        />
      )}

      {showSearchModal && (
        <CodeSearchModal
          projectId={activeProjectId}
          onClose={() => setShowSearchModal(false)}
        />
      )}

      {showRevisionsModal && activeSessionId && (
        <SessionRevisionsModal
          sessionId={activeSessionId}
          onClose={() => setShowRevisionsModal(false)}
          onRevisionRestored={async () => {
            await fetchSessionDetails(activeSessionId);
            setConsoleLogs((prev) => [
              ...prev,
              "[REVISÃO] Estado da sessão e DAG restaurados com sucesso!",
            ]);
          }}
        />
      )}

      {showSpecModal && activeSessionId && (
        <CanonicalSpecModal
          sessionId={activeSessionId}
          specContent={canonicalSpec}
          specApproved={isSpecApproved}
          onClose={() => setShowSpecModal(false)}
          onSpecApproved={async () => {
            await fetchSessionDetails(activeSessionId);
            setConsoleLogs((prev) => [
              ...prev,
              "[ESPECIFICAÇÃO] Spec Canônica APROVADA e Trava T1 LIBERADA com sucesso!",
            ]);

            // Dispara o processador de fila no servidor para iniciar a execução da DAG
            await authFetch("/api/dag", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "process_queue", sessionId: activeSessionId }),
            });
            await fetchSessionDetails(activeSessionId);
          }}
        />
      )}
    </div>
  );
}
