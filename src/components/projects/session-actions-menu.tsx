"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Trash2, FolderPlus, FolderOpen, Check, Layers, Folder } from "lucide-react";
import { ProjectData } from "@/components/projects/project-actions-menu";

export interface SessionData {
  id: string;
  title: string;
  projectId?: string | null;
}

interface SessionActionsMenuProps {
  session: SessionData;
  projects?: ProjectData[];
  onAttachToProject?: (sessionId: string, projectId: string | null) => Promise<void> | void;
  onDelete: (sessionId: string) => void;
}

export function SessionActionsMenu({
  session,
  projects = [],
  onAttachToProject,
  onDelete,
}: SessionActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectProject = async (targetProjectId: string | null) => {
    if (!onAttachToProject) return;
    setLoading(true);
    try {
      await onAttachToProject(session.id, targetProjectId);
      setShowAttachModal(false);
    } catch (err) {
      console.error("Erro ao vincular sessão ao projeto:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
        title="Opções da Sessão"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-1 w-48 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-50 py-1 text-xs select-none">
          {/* Anexar a um Projeto */}
          {onAttachToProject && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                setShowAttachModal(true);
              }}
              className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#0066cc]" />
              <span>{session.projectId ? "Mover / Anexar a projeto" : "Anexar a um projeto"}</span>
            </button>
          )}

          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

          {/* Excluir sessão */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              setShowDeleteConfirm(true);
            }}
            className="w-full text-left px-3 py-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Excluir sessão</span>
          </button>
        </div>
      )}

      {/* Modal de Anexar Sessão a um Projeto */}
      {showAttachModal && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 text-slate-900 dark:text-slate-100 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 w-full max-w-md shadow-2xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-[#0066cc]" />
                Anexar Sessão a um Projeto
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Selecione o projeto para o qual deseja vincular a sessão <strong>"{session.title}"</strong>.
              </p>
            </div>

            {/* Lista de Projetos Disponíveis */}
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {/* Opção 0: Tornar Ad-hoc (Sem projeto) */}
              <button
                type="button"
                disabled={loading}
                onClick={() => handleSelectProject(null)}
                className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between transition-colors ${
                  !session.projectId
                    ? "bg-blue-50/70 dark:bg-blue-950/40 border-[#0066cc] font-semibold text-[#0066cc] dark:text-blue-400"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="text-xs">Sessão Ad-hoc (Nenhum Projeto)</div>
                    <div className="text-[10px] text-slate-400 font-normal">Sessão avulsa sem contexto de diretório local</div>
                  </div>
                </div>
                {!session.projectId && <Check className="w-4 h-4 text-[#0066cc] shrink-0" />}
              </button>

              {/* Projetos cadastrados */}
              {projects.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 italic">
                  Nenhum projeto cadastrado no momento.
                </div>
              ) : (
                projects.map((proj) => {
                  const isCurrent = session.projectId === proj.id;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectProject(proj.id)}
                      className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between transition-colors ${
                        isCurrent
                          ? "bg-blue-50/70 dark:bg-blue-950/40 border-[#0066cc] font-semibold text-[#0066cc] dark:text-blue-400"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        {proj.path ? (
                          <FolderOpen className="w-4 h-4 text-blue-500 shrink-0" />
                        ) : (
                          <Folder className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <div className="truncate">
                          <div className="text-xs truncate font-medium">{proj.name}</div>
                          {proj.path && (
                            <div className="text-[10px] text-slate-400 truncate font-mono">{proj.path}</div>
                          )}
                        </div>
                      </div>
                      {isCurrent && <Check className="w-4 h-4 text-[#0066cc] shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowAttachModal(false)}
                className="px-4 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão da Sessão */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 text-slate-900 dark:text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-500" />
              Excluir Sessão
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Tem certeza que deseja apagar a sessão <strong>"{session.title}"</strong>? Esta ação excluirá todo o histórico de mensagens e tarefas da DAG.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete(session.id);
                }}
                className="px-4 py-1.5 text-xs bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg shadow-sm"
              >
                Sim, Apagar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
