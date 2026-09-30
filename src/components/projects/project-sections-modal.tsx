"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Edit3,
  X,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface ProjectSection {
  id: string;
  projectId: string;
  title: string;
  content: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectSectionsModalProps {
  isOpen: boolean;
  project: {
    id: string;
    name: string;
  } | null;
  onClose: () => void;
  onSectionsUpdated?: () => void;
}

export function ProjectSectionsModal({
  isOpen,
  project,
  onClose,
  onSectionsUpdated,
}: ProjectSectionsModalProps) {
  const [sections, setSections] = useState<ProjectSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Formulário de criação/edição
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedSectionIds, setExpandedSectionIds] = useState<Record<string, boolean>>({});

  const fetchSections = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/sections`);
      const data = await res.json();
      if (res.ok && data.sections) {
        setSections(data.sections);
      } else {
        setError(data.error || "Erro ao carregar seções.");
      }
    } catch {
      setError("Falha na conexão ao carregar seções.");
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    if (isOpen && project?.id) {
      fetchSections();
      setIsFormOpen(false);
      setEditingSectionId(null);
      setTitle("");
      setContent("");
    }
  }, [isOpen, project?.id, fetchSections]);

  if (!isOpen || !project) return null;

  const handleOpenAddForm = () => {
    setEditingSectionId(null);
    setTitle("");
    setContent("");
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (sec: ProjectSection) => {
    setEditingSectionId(sec.id);
    setTitle(sec.title);
    setContent(sec.content);
    setIsFormOpen(true);
  };

  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingSectionId(null);
    setTitle("");
    setContent("");
  };

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    setError(null);
    try {
      if (editingSectionId) {
        // Atualizar seção existente
        const res = await fetch(`/api/projects/${project.id}/sections/${editingSectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content }),
        });
        if (res.ok) {
          await fetchSections();
          handleCancelForm();
          if (onSectionsUpdated) onSectionsUpdated();
        } else {
          const data = await res.json();
          setError(data.error || "Erro ao atualizar seção.");
        }
      } else {
        // Criar/anexar nova seção
        const res = await fetch(`/api/projects/${project.id}/sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content }),
        });
        if (res.ok) {
          await fetchSections();
          handleCancelForm();
          if (onSectionsUpdated) onSectionsUpdated();
        } else {
          const data = await res.json();
          setError(data.error || "Erro ao anexar seção.");
        }
      }
    } catch {
      setError("Erro ao se comunicar com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm("Tem certeza que deseja remover esta seção do projeto?")) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/sections/${sectionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchSections();
        if (onSectionsUpdated) onSectionsUpdated();
      } else {
        const data = await res.json();
        setError(data.error || "Erro ao excluir seção.");
      }
    } catch {
      setError("Erro ao se comunicar com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  const toggleExpandSection = (id: string) => {
    setExpandedSectionIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col text-xs overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#0066cc] dark:text-blue-400">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Seções do Projeto: <span className="text-[#0066cc]">{project.name}</span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Anexe especificações, diretrizes e notas que serão injetadas no contexto da IA.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notificação de Erro */}
        {error && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 flex items-center gap-2 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Conteúdo Principal */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Botão para abrir formulário de adição */}
          {!isFormOpen && (
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">
                Seções Anexadas ({sections.length})
              </span>
              <button
                type="button"
                onClick={handleOpenAddForm}
                className="bg-[#0066cc] hover:bg-blue-700 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Anexar Nova Seção</span>
              </button>
            </div>
          )}

          {/* Formulário de Criação/Edição */}
          {isFormOpen && (
            <form onSubmit={handleSaveSection} className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5 text-[#0066cc]" />
                  {editingSectionId ? "Editar Seção Anexada" : "Anexar Nova Seção ao Projeto"}
                </h4>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
                >
                  Cancelar
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Título da Seção *
                </label>
                <input
                  type="text"
                  placeholder="Ex: Regras de Negócio & Compliance, Padrão de API REST..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Conteúdo da Seção (Markdown / Instruções)
                </label>
                <textarea
                  rows={6}
                  placeholder="Escreva aqui as diretrizes, regras, trechos de código ou requisitos da seção..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-[#0066cc]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || !title.trim()}
                  className="px-4 py-1.5 text-xs bg-[#0066cc] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{editingSectionId ? "Salvar Alterações" : "Anexar Seção"}</span>
                </button>
              </div>
            </form>
          )}

          {/* Lista de Seções */}
          {sections.length === 0 ? (
            <div className="text-center py-8 px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/50">
              <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-slate-600 dark:text-slate-400 font-medium">
                Nenhuma seção anexada a este projeto.
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Clique no botão acima para adicionar instruções, especificações ou contexto personalizado para a IA.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sections.map((sec) => {
                const isExpanded = expandedSectionIds[sec.id] ?? true;
                return (
                  <div
                    key={sec.id}
                    className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/60 dark:bg-slate-950/40 overflow-hidden transition-all"
                  >
                    <div
                      onClick={() => toggleExpandSection(sec.id)}
                      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-900/60"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <FileText className="w-4 h-4 text-[#0066cc] shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {sec.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditForm(sec);
                          }}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-[#0066cc] transition-colors"
                          title="Editar Seção"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSection(sec.id);
                          }}
                          className="p-1 hover:bg-rose-100 dark:hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-600 transition-colors"
                          title="Remover Seção"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="text-slate-400 pl-1">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-3.5 pt-1 border-t border-slate-200/50 dark:border-slate-800/50 bg-white dark:bg-slate-900">
                        <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800/60">
                          {sec.content || <span className="italic text-slate-400">(Sem conteúdo preenchido)</span>}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
