"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Pin, Edit3, Archive, Trash2, PinOff, X } from "lucide-react";

export interface ProjectData {
  id: string;
  name: string;
  description?: string | null;
  path?: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isClosed?: boolean;
}

interface ProjectActionsMenuProps {
  project: ProjectData;
  onTogglePin: (project: ProjectData) => void;
  onEdit: (project: ProjectData) => void;
  onToggleArchive: (project: ProjectData) => void;
  onClose: (project: ProjectData) => void;
  onDelete: (project: ProjectData, apagarPasta: boolean) => void;
}

export function ProjectActionsMenu({
  project,
  onTogglePin,
  onEdit,
  onToggleArchive,
  onClose,
  onDelete,
}: ProjectActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
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

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
        title="Opções do Projeto"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-1 w-56 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-50 py-1 text-xs select-none">
          {/* Fixar / Desafixar */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onTogglePin(project);
            }}
            className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            {project.isPinned ? (
              <>
                <PinOff className="w-3.5 h-3.5 text-amber-500" />
                <span>Desafixar</span>
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 text-slate-400" />
                <span>Fixar no topo</span>
              </>
            )}
          </button>

          {/* Editar */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onEdit(project);
            }}
            className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Edit3 className="w-3.5 h-3.5 text-slate-400" />
            <span>Editar projeto</span>
          </button>



          {/* PJ2b: fechar (guarda onde parou; a fila para) / reabrir (continua de onde parou) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onToggleArchive(project);
            }}
            className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Archive className="w-3.5 h-3.5 text-slate-400" />
            <span>{project.isArchived ? "Reabrir" : "Arquivar"}</span>
          </button>

          {!project.isClosed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                setShowCloseConfirm(true);
              }}
              className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Fechar
                <span className="block text-[10px] text-slate-400">Sai da lista. A pasta fica no computador.</span>
              </span>
            </button>
          )}

          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

          {/* Apagar */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              setShowDeleteConfirm(true);
            }}
            className="w-full text-left px-3 py-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Apagar projeto</span>
          </button>
        </div>
      )}

      {showCloseConfirm && (
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 text-slate-900 dark:text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Fechar projeto</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <strong>&quot;{project.name}&quot;</strong> sai da área de trabalho. A pasta continua no computador.
              Para trazer de volta, abra a mesma pasta.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCloseConfirm(false);
                  onClose(project);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-[#0066cc] text-white hover:bg-[#005bb5]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 text-slate-900 dark:text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-500" />
              Excluir Projeto
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Como deseja remover o projeto <strong>&quot;{project.name}&quot;</strong>?
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete(project, false);
                }}
                className="w-full text-left px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                Remover só do NextCode (a pasta fica no computador)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete(project, true);
                }}
                className="w-full text-left px-3 py-2 text-xs rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-300"
              >
                Remover e apagar a pasta do computador
                {project.path ? (
                  <span className="block mt-1 font-mono text-[10px] text-rose-600/90 dark:text-rose-400/90 break-all">
                    {project.path}
                  </span>
                ) : null}
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
