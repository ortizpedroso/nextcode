"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/client-session";
import { Sidebar, ProjectItem, SessionItem } from "@/components/layout/sidebar";
import { Workspace, TaskNode, SessionMessage } from "@/components/layout/workspace";
import { ProjectFormData } from "@/components/projects/open-project-dialog";
import { ProjectData } from "@/components/projects/project-actions-menu";
import { SettingsFormState, CustomProviderItem } from "@/components/settings/settings-dialog";

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

  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [tokensSaved, setTokensSaved] = useState<number>(12450);
  const [loading, setLoading] = useState(false);
  const [executingNodeId, setExecutingNodeId] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    geminiKey: "",
    claudeKey: "",
    openaiKey: "",
    deepseekKey: "",
    omniRouteKey: "",
    customEndpoint: "",
  });

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
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
      const res = await fetch("/api/sessions?adhocOnly=true");
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
      const res = await fetch("/api/providers/custom");
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
      const res = await fetch(`/api/dag?sessionId=${targetSessionId}`);
      const data = await res.json();

      if (data.session) {
        setActiveSessionId(data.session.id);
        setActiveSessionTitle(data.session.title);
        setActiveProjectName(data.session.project?.name || null);
        setActiveProjectId(data.session.projectId || null);
        setTasks(data.tasks || []);
        // Filtra estritamente para que APENAS mensagens do Usuário e do Assistente sejam exibidas
        const cleanMsgs = (data.messages || []).filter(
          (m: SessionMessage) => m.role === "user" || m.role === "assistant"
        );
        setMessages(cleanMsgs);
      }
    } catch (err) {
      console.error("Erro ao carregar detalhes da sessão:", err);
    }
  }, [activeSessionId]);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettingsForm({
        geminiKey: data.geminiKey || "",
        claudeKey: data.claudeKey || "",
        openaiKey: data.openaiKey || "",
        deepseekKey: data.deepseekKey || "",
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

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveView("dag");
    await fetchSessionDetails(sessionId);
  };

  const handleCreateProject = async (data: ProjectFormData) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (res.ok) {
        await fetchProjects();
        setActiveProjectId(resData.project.id);
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
      const res = await fetch(`/api/projects/${id}`, {
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
      const res = await fetch(`/api/projects/${projectId}`, {
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
      const res = await fetch(`/api/sessions/${sessionId}`, {
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
      const res = await fetch(`/api/sessions/${sessionId}`, {
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

      const res = await fetch("/api/sessions", {
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
  const handleSendMessage = async (prompt: string, modelOverride?: string) => {
    setLoading(true);
    setConsoleLogs((prev) => [...prev, `[CHAT] Processando mensagem do usuário: "${prompt.substring(0, 30)}..."`]);

    try {
      // 1. Chamada direta ao endpoint conversacional /api/chat
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          prompt,
          projectId: activeProjectId,
          modelOverride,
        }),
      });

      const chatData = await chatRes.json();
      if (chatRes.ok && chatData.sessionId) {
        const targetSessionId = chatData.sessionId;
        setActiveSessionId(targetSessionId);
        setMessages(chatData.messages || []);
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

        // 2. Dispara a decomposição e execução autônoma da DAG em background (apenas no painel da DAG)
        triggerBackgroundDAG(prompt, targetSessionId, modelOverride);
      }
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[ERRO] Falha no envio da mensagem: ${String(err)}`]);
    } finally {
      setLoading(false);
    }
  };

  // Execução de DAG autônoma estritamente no painel lateral
  const triggerBackgroundDAG = async (prompt: string, targetSessionId: string, modelOverride?: string) => {
    try {
      const res = await fetch("/api/dag", {
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
          `[DAG AUTÔNOMA] ${data.tasks.length} nós de tarefas gerados no painel lateral. Iniciando tarefas...`,
        ]);

        // Execução sequencial dos nós da DAG em background
        const createdNodes: TaskNode[] = data.tasks;
        for (const taskNode of createdNodes) {
          setExecutingNodeId(taskNode.id);
          setConsoleLogs((prev) => [...prev, `[TELEMETRIA DAG] Executando nó: "${taskNode.title}" (${taskNode.role})...`]);

          try {
            const execRes = await fetch("/api/dag", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "execute_node", nodeId: taskNode.id }),
            });

            if (execRes.ok) {
              const execData = await execRes.json();
              setConsoleLogs((prev) => [
                ...prev,
                `[TELEMETRIA DAG] Nó "${execData.executedTask?.title || taskNode.title}" concluído via MCP.`,
              ]);
              // Atualiza a lista de tarefas da DAG e mensagens do chat se houver atualização
              const refreshRes = await fetch(`/api/dag?sessionId=${targetSessionId}`);
              const refreshData = await refreshRes.json();
              if (refreshData.tasks) setTasks(refreshData.tasks);
              if (refreshData.messages) setMessages(refreshData.messages);
            }
          } catch (execErr) {
            setConsoleLogs((prev) => [...prev, `[ERRO DAG] Falha no nó ${taskNode.id}: ${String(execErr)}`]);
          } finally {
            setExecutingNodeId(null);
          }
        }
      }
    } catch (dagErr) {
      console.error("Erro na DAG autônoma:", dagErr);
    }
  };

  const handleExecuteNode = async (nodeId: string) => {
    setExecutingNodeId(nodeId);
    setConsoleLogs((prev) => [...prev, `[EXEC] Executando nó ID: ${nodeId}...`]);

    try {
      const res = await fetch("/api/dag", {
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
        const refreshRes = await fetch(`/api/dag?sessionId=${activeSessionId}`);
        const refreshData = await refreshRes.json();
        if (refreshData.tasks) setTasks(refreshData.tasks);
      }
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[ERRO] Falha na execução do nó: ${String(err)}`]);
    } finally {
      setExecutingNodeId(null);
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
          setActiveProjectId(id);
          // FIX (vínculo sessão↔projeto): ao clicar num projeto, sincroniza o
          // nome e limpa a sessão ativa. Sem isso, activeProjectId apontava para
          // um projeto enquanto activeSessionId ainda pertencia a OUTRO projeto —
          // o backend usava o projeto da sessão e injetava contexto errado/nulo.
          const proj = projects.find((p) => p.id === id);
          setActiveProjectName(proj?.name ?? null);
          if (activeSessionId) {
            setActiveSessionId(null);
            setActiveSessionTitle("");
            setMessages([]);
            setTasks([]);
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
      />
    </div>
  );
}
