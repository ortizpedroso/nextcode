"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FolderPlus,
  FolderOpen,
  Folder,
  FileText,
  CheckCircle2,
  AlertCircle,
  Search,
  ChevronUp,
  HardDrive,
  Check,
  X,
} from "lucide-react";

export interface ProjectFormData {
  id?: string;
  name: string;
  description?: string;
  path?: string;
}

interface OpenProjectDialogProps {
  isOpen: boolean;
  editingProject?: ProjectFormData | null;
  onClose: () => void;
  onSubmit: (data: ProjectFormData) => Promise<void>;
}

interface DirectoryEntry {
  name: string;
  path: string;
}

export function OpenProjectDialog({
  isOpen,
  editingProject,
  onClose,
  onSubmit,
}: OpenProjectDialogProps) {
  const [tab, setTab] = useState<"create" | "open">(editingProject?.path ? "open" : "create");
  const [name, setName] = useState(editingProject?.name || "");
  const [description, setDescription] = useState(editingProject?.description || "");
  const [path, setPath] = useState(editingProject?.path || "");
  const [loading, setLoading] = useState(false);
  const [pathValid, setPathValid] = useState<{ checked: boolean; exists: boolean; message: string }>({
    checked: false,
    exists: false,
    message: "",
  });

  // Estado do Explorador de Arquivos do Servidor Local
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [explorerCurrentPath, setExplorerCurrentPath] = useState("");
  const [explorerParentPath, setExplorerParentPath] = useState<string | null>(null);
  const [explorerDirs, setExplorerDirs] = useState<DirectoryEntry[]>([]);
  const [explorerDrives, setExplorerDrives] = useState<string[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);

  useEffect(() => {
    if (editingProject) {
      setName(editingProject.name || "");
      setDescription(editingProject.description || "");
      setPath(editingProject.path || "");
    } else {
      setName("");
      setDescription("");
      setPath("");
    }
  }, [editingProject]);

  useEffect(() => {
    if (!path || !path.trim()) {
      setPathValid({ checked: false, exists: false, message: "" });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/fs/validate-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPath: path }),
        });
        const data = await res.json();
        setPathValid({
          checked: true,
          exists: data.exists && data.isDirectory,
          message: data.message || "",
        });
      } catch {
        setPathValid({ checked: true, exists: false, message: "Erro ao verificar caminho." });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [path]);

  const fetchExplorerDirs = useCallback(async (targetPath?: string) => {
    setExplorerLoading(true);
    try {
      const query = targetPath ? `?targetPath=${encodeURIComponent(targetPath)}` : "";
      const res = await fetch(`/api/fs/list-dirs${query}`);
      const data = await res.json();
      if (res.ok) {
        setExplorerCurrentPath(data.currentPath || "");
        setExplorerParentPath(data.parentPath || null);
        setExplorerDirs(data.directories || []);
        setExplorerDrives(data.drives || []);
      }
    } catch (err) {
      console.error("Erro ao listar diretórios:", err);
    } finally {
      setExplorerLoading(false);
    }
  }, []);

  const handleOpenBrowser = () => {
    fetchExplorerDirs(path || undefined);
    setIsBrowserOpen(true);
  };

  const handleSelectExplorerPath = (selectedPath: string) => {
    setPath(selectedPath);

    // Se o nome do projeto estiver vazio, auto-preenche com o nome da pasta selecionada
    if (!name.trim()) {
      const parts = selectedPath.replace(/\\/g, "/").split("/").filter(Boolean);
      const folderName = parts[parts.length - 1];
      if (folderName) setName(folderName);
    }

    setIsBrowserOpen(false);
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await onSubmit({
        id: editingProject?.id,
        name: name.trim(),
        description: description.trim() || undefined,
        path: path.trim() || undefined,
      });
      onClose();
    } catch (err) {
      console.error("Erro ao salvar projeto:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {editingProject ? (
              <>
                <Folder className="w-4 h-4 text-[#0066cc]" />
                Editar Projeto
              </>
            ) : (
              <>
                <FolderPlus className="w-4 h-4 text-[#0066cc]" />
                Gestão de Projetos Locais
              </>
            )}
          </h3>
        </div>

        {!editingProject && (
          <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400">
            <button
              type="button"
              onClick={() => setTab("create")}
              className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${
                tab === "create"
                  ? "bg-white dark:bg-slate-900 text-[#0066cc] shadow-sm font-semibold"
                  : "hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Criar Novo Projeto</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("open")}
              className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${
                tab === "open"
                  ? "bg-white dark:bg-slate-900 text-[#0066cc] shadow-sm font-semibold"
                  : "hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Abrir Pasta Local</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Nome do Projeto
            </label>
            <input
              type="text"
              placeholder="Ex: NextCode Engine Core"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                Caminho Absoluto da Pasta Local
              </span>
              {pathValid.checked && (
                <span className={`flex items-center gap-1 font-normal text-[11px] ${pathValid.exists ? "text-emerald-600" : "text-amber-600"}`}>
                  {pathValid.exists ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {pathValid.exists ? "Diretório Válido" : "Não Encontrado"}
                </span>
              )}
            </label>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ex: c:\projetos\meu-app ou /Users/dev/projeto"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  if (!name && e.target.value) {
                    const parts = e.target.value.replace(/\\/g, "/").split("/");
                    const folderName = parts[parts.length - 1] || parts[parts.length - 2];
                    if (folderName) setName(folderName);
                  }
                }}
                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]"
              />

              <button
                type="button"
                onClick={handleOpenBrowser}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 text-xs transition-colors shrink-0"
                title="Navegar no sistema de arquivos local"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Navegar...</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              Descrição (Opcional)
            </label>
            <textarea
              placeholder="Descrição técnica do projeto..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-4 py-1.5 text-xs bg-[#0066cc] hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 shadow-sm"
            >
              {loading ? "Salvando..." : editingProject ? "Salvar Alterações" : "Vincular Projeto"}
            </button>
          </div>
        </form>

        {/* Modal do Explorador de Pastas do Servidor Local */}
        {isBrowserOpen && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 w-full max-w-lg shadow-2xl space-y-3.5 text-xs flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#0066cc]" />
                  Explorador de Pastas Locais
                </h4>
                <button
                  type="button"
                  onClick={() => setIsBrowserOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Botões de Unidades de Disco no Windows */}
              {explorerDrives.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold text-slate-400 self-center mr-1">Discos:</span>
                  {explorerDrives.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => fetchExplorerDirs(d)}
                      className={`px-2 py-1 rounded border text-[11px] font-mono flex items-center gap-1 transition-colors ${
                        explorerCurrentPath.toUpperCase().startsWith(d.toUpperCase().substring(0, 2))
                          ? "bg-blue-50 dark:bg-blue-950 border-[#0066cc] text-[#0066cc] font-bold"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <HardDrive className="w-3 h-3 text-slate-400" />
                      <span>{d}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Barra de Caminho Atual & Subir Nível */}
              <div className="flex gap-2 items-center">
                {explorerParentPath && (
                  <button
                    type="button"
                    onClick={() => fetchExplorerDirs(explorerParentPath)}
                    className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-200 transition-colors shrink-0"
                    title="Ir para pasta pai"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                )}
                <input
                  type="text"
                  value={explorerCurrentPath}
                  onChange={(e) => setExplorerCurrentPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      fetchExplorerDirs(explorerCurrentPath);
                    }
                  }}
                  className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>

              {/* Lista de Subdiretórios */}
              <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg p-2 min-h-48 max-h-64 space-y-1 bg-slate-50/50 dark:bg-slate-950/50">
                {explorerLoading ? (
                  <div className="p-4 text-center text-slate-400 italic">Carregando pastas...</div>
                ) : explorerDirs.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 italic">Nenhuma subpasta encontrada.</div>
                ) : (
                  explorerDirs.map((dir) => (
                    <button
                      key={dir.path}
                      type="button"
                      onClick={() => fetchExplorerDirs(dir.path)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 flex items-center gap-2 transition-colors truncate"
                    >
                      <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate">{dir.name}</span>
                    </button>
                  ))
                )}
              </div>

              {/* Botão de Confirmação */}
              <div className="flex justify-between items-center pt-2">
                <div className="text-[11px] text-slate-400 truncate max-w-[240px]">
                  Caminho: <span className="font-mono text-slate-600 dark:text-slate-300">{explorerCurrentPath}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsBrowserOpen(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectExplorerPath(explorerCurrentPath)}
                    className="px-4 py-1.5 text-xs bg-[#0066cc] hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Selecionar Esta Pasta</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
