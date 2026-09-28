"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";

export interface SessionData {
  id: string;
  title: string;
}

interface SessionActionsMenuProps {
  session: SessionData;
  onDelete: (sessionId: string) => void;
}

export function SessionActionsMenu({ session, onDelete }: SessionActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
        title="Opções da Sessão"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-1 w-40 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-50 py-1 text-xs select-none">
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
