"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  FolderPlus,
  Folder,
  FolderOpen,
  Layers,
  Settings,
  Sun,
  Moon,
  Plus,
  Cpu,
  Pin,
  ChevronDown,
  ChevronRight,
  UserCheck,
  Sparkles,
} from "lucide-react";
import { ProjectActionsMenu, ProjectData } from "@/components/projects/project-actions-menu";
import { SessionActionsMenu } from "@/components/projects/session-actions-menu";
import { OpenProjectDialog, ProjectFormData } from "@/components/projects/open-project-dialog";
import { SettingsDialog, SettingsFormState } from "@/components/settings/settings-dialog";
export interface ProjectItem extends ProjectData {
  sessions?: SessionItem[];
}

export interface SessionItem {
  id: string;
  title: string;
  projectId?: string | null;
  createdAt: string;
}

interface SidebarProps {
  projects: ProjectItem[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  adhocSessions: SessionItem[];
  settings: SettingsFormState;
  onSelectProject: (projectId: string | null) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateProject: (data: ProjectFormData) => Promise<void>;
  onUpdateProject: (id: string, data: Partial<ProjectData>) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onCreateSession: (projectId?: string | null) => Promise<void>;
  onSaveSettings: (updated: SettingsFormState) => Promise<void>;
  onRefreshProjects?: () => Promise<void>;
  onAttachSessionToProject?: (sessionId: string, projectId: string | null) => Promise<void>;
  onExportSessionJSON?: (sessionId: string) => void;
  onImportSessionJSON?: (file: File) => Promise<void>;
}

export function Sidebar({
  projects,
  activeProjectId,
  activeSessionId,
  adhocSessions,
  settings,
  onSelectProject,
  onSelectSession,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onDeleteSession,
  onCreateSession,
  onSaveSettings,
  onRefreshProjects,
  onAttachSessionToProject,
  onExportSessionJSON,
  onImportSessionJSON,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const [openProjectDialogOpen, setOpenProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectFormData | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const activeProjects = projects.filter((p) => !p.isArchived);

  const toggleExpand = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const handleOpenCreateModal = () => {
    setEditingProject(null);
    setOpenProjectDialogOpen(true);
  };

  const handleOpenEditModal = (proj: ProjectData) => {
    setEditingProject({
      id: proj.id,
      name: proj.name,
      description: proj.description || undefined,
      path: proj.path || undefined,
    });
    setOpenProjectDialogOpen(true);
  };

  const handleProjectFormSubmit = async (data: ProjectFormData) => {
    if (data.id) {
      await onUpdateProject(data.id, {
        name: data.name,
        description: data.description,
        path: data.path,
      });
    } else {
      await onCreateProject(data);
    }
  };

  return (
    <aside className="w-68 bg-[#f3f6fa] dark:bg-slate-950 border-r border-slate-200/80 dark:border-slate-800/80 flex flex-col h-screen select-none shrink-0 transition-colors">
      {/* 1. SEÇÃO TOPO & AÇÕES RÁPIDAS */}
      <div className="p-4 pb-3 border-b border-slate-200/60 dark:border-slate-800/60 space-y-3">
        {/* Logo NextCode Engine */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#0066cc] flex items-center justify-center font-extrabold text-white text-xs shadow-sm">
            ❖
          </div>
          <div>
            <h1 className="font-extrabold text-sm tracking-tight text-slate-900 dark:text-white leading-none">
              nextcode
            </h1>
            <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase block mt-0.5">
              OPEN SOURCE ENGINE
            </span>
          </div>
        </div>

        {/* Botão em Destaque: + Nova Sessão Ad-hoc */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onCreateSession(null)}
            className="flex-1 bg-[#0066cc] hover:bg-blue-700 text-white font-semibold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Sessão</span>
          </button>

          {onImportSessionJSON && (
            <label className="cursor-pointer p-2 bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors border border-slate-300/60 dark:border-slate-700" title="Restaurar Sessão a partir de Backup JSON">
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && onImportSessionJSON) {
                    onImportSessionJSON(file);
                  }
                  e.target.value = "";
                }}
              />
              <span className="font-mono text-[10px]">Importar</span>
            </label>
          )}
        </div>

        {/* Link Principal: Orquestração DAG */}
        <button
          onClick={() => onSelectProject(null)}
          className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-colors ${
            activeProjectId === null
              ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-900"
          }`}
        >
          <Cpu className="w-4 h-4 text-[#0066cc]" />
          <span>Orquestração DAG</span>
        </button>
      </div>

      {/* 2. SEÇÃO PROJETOS (Count n & Pinned) */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 text-xs">
        {/* Cabeçalho da Seção PROJETOS */}
        <div className="flex items-center justify-between px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span>PROJETOS ({activeProjects.length})</span>
          <button
            onClick={handleOpenCreateModal}
            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-[#0066cc] transition-colors"
            title="Criar ou Abrir Projeto Local"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Lista de Projetos com Pinned & Nested Sessions */}
        <div className="space-y-1">
          {activeProjects.length === 0 ? (
            <div className="px-3 py-2 text-slate-400 italic text-[11px]">
              Nenhum projeto cadastrado.
            </div>
          ) : (
            activeProjects.map((proj) => {
              const isActiveProj = activeProjectId === proj.id;
              const isExpanded = expandedProjects[proj.id] ?? isActiveProj;
              const projectSessions = proj.sessions || [];

              return (
                <div key={proj.id} className="space-y-0.5">
                  {/* Card do Projeto */}
                  <div
                    onClick={() => {
                      onSelectProject(proj.id);
                      toggleExpand(proj.id);
                    }}
                    className={`group w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                      isActiveProj
                        ? "bg-[#e8f1fb] dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400 font-semibold"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      {proj.isPinned ? (
                        <Pin className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" />
                      ) : proj.path ? (
                        <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className="truncate">{proj.name}</span>
                      {/* Aviso: projeto sem caminho local => análise de contexto indisponível */}
                      {!proj.path && (
                        <span
                          className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0 font-medium"
                          title="Defina a pasta local em Editar Projeto para a IA conseguir analisar o código"
                        >
                          ⚠ sem pasta
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      {/* Botão Ação Rápida: + Nova Sessão vinculada */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateSession(proj.id);
                        }}
                        className="p-1 hover:bg-slate-300/60 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-[#0066cc] transition-colors"
                        title="Nova Sessão neste Projeto"
                      >
                        <Plus className="w-3 h-3" />
                      </button>

                      {/* Menu de Contexto 3 Pontinhos */}
                      <ProjectActionsMenu
                        project={proj}
                        onTogglePin={(p) => onUpdateProject(p.id, { isPinned: !p.isPinned })}
                        onEdit={handleOpenEditModal}
                        onToggleArchive={(p) => onUpdateProject(p.id, { isArchived: !p.isArchived })}
                        onDelete={(p) => onDeleteProject(p.id)}
                      />
                    </div>
                  </div>

                  {/* Sessões Aninhadas (Nested List) */}
                  {isExpanded && (
                    <div className="pl-6 space-y-0.5">
                      {projectSessions.length === 0 ? (
                        <div className="px-2 py-1 text-[11px] text-slate-400 italic">
                          Sem sessões
                        </div>
                      ) : (
                        projectSessions.map((sess) => {
                          const isActiveSession = activeSessionId === sess.id;
                          return (
                            <div
                              key={sess.id}
                              className={`group w-full px-2 py-1 rounded-md flex items-center justify-between text-[11px] transition-colors ${
                                isActiveSession
                                  ? "bg-white dark:bg-slate-900 text-[#0066cc] dark:text-blue-400 font-semibold border border-slate-200 dark:border-slate-800 shadow-sm"
                                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-900"
                              }`}
                            >
                              <button
                                onClick={() => onSelectSession(sess.id)}
                                className="flex items-center gap-2 truncate flex-1 text-left"
                              >
                                <Layers className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="truncate">{sess.title}</span>
                              </button>

                              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <SessionActionsMenu
                                  session={sess}
                                  projects={activeProjects}
                                  onAttachToProject={onAttachSessionToProject}
                                  onDelete={onDeleteSession}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Sessões Ad-hoc Sem Projeto */}
        {adhocSessions.length > 0 && (
          <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800/60 space-y-1">
            <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              SESSÕES AD-HOC ({adhocSessions.length})
            </div>
            {adhocSessions.map((sess) => {
              const isActiveSession = activeSessionId === sess.id;
              return (
                <div
                  key={sess.id}
                  className={`group w-full px-2.5 py-1 rounded-lg flex items-center justify-between text-xs transition-colors ${
                    isActiveSession
                      ? "bg-white dark:bg-slate-900 text-[#0066cc] dark:text-blue-400 font-semibold border border-slate-200 dark:border-slate-800 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-900"
                  }`}
                >
                  <button
                    onClick={() => onSelectSession(sess.id)}
                    className="flex items-center gap-2 truncate flex-1 text-left"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate">{sess.title}</span>
                  </button>

                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <SessionActionsMenu
                      session={sess}
                      projects={activeProjects}
                      onAttachToProject={onAttachSessionToProject}
                      onDelete={onDeleteSession}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. RODAPÉ ENXUTO DA SIDEBAR */}
      <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2 bg-slate-100/50 dark:bg-slate-950/50">
        {/* Botão Único Unificado: Configurações */}
        <button
          onClick={() => setSettingsDialogOpen(true)}
          className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-900 flex items-center gap-2.5 transition-colors"
        >
          <Settings className="w-4 h-4 text-slate-500" />
          <span>Configurações</span>
        </button>

        {/* Perfil & Alternador de Tema */}
        <div className="flex items-center justify-between px-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-slate-700 text-white font-bold text-[10px] flex items-center justify-center">
              O
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">ortiz</span>
          </div>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            title="Alternar Tema Claro / Escuro"
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
          </button>
        </div>
      </div>

      {/* Modal Criar/Abrir Projeto */}
      <OpenProjectDialog
        isOpen={openProjectDialogOpen}
        editingProject={editingProject}
        onClose={() => {
          setOpenProjectDialogOpen(false);
          setEditingProject(null);
        }}
        onSubmit={handleProjectFormSubmit}
      />



      {/* Hub Central de Configurações Unificado */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        settings={settings}
        onClose={() => setSettingsDialogOpen(false)}
        onSave={onSaveSettings}
      />
    </aside>
  );
}
