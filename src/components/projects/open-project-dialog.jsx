"use client";
import { useState, useEffect } from "react";
import { FolderPlus, FolderOpen, Folder, FileText, CheckCircle2, AlertCircle, Search } from "lucide-react";
export function OpenProjectDialog({ isOpen, editingProject, onClose, onSubmit, }) {
    const [tab, setTab] = useState(editingProject?.path ? "open" : "create");
    const [name, setName] = useState(editingProject?.name || "");
    const [description, setDescription] = useState(editingProject?.description || "");
    const [path, setPath] = useState(editingProject?.path || "");
    const [loading, setLoading] = useState(false);
    const [pathValid, setPathValid] = useState({
        checked: false,
        exists: false,
        message: "",
    });
    useEffect(() => {
        if (editingProject) {
            setName(editingProject.name || "");
            setDescription(editingProject.description || "");
            setPath(editingProject.path || "");
        }
        else {
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
            }
            catch {
                setPathValid({ checked: true, exists: false, message: "Erro ao verificar caminho." });
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [path]);
    if (!isOpen)
        return null;
    const handlePickDirectory = async () => {
        try {
            if ("showDirectoryPicker" in window) {
                // @ts-expect-error - File System Access API nativa do navegador
                const dirHandle = await window.showDirectoryPicker();
                if (dirHandle && dirHandle.name) {
                    const selectedName = dirHandle.name;
                    if (!name)
                        setName(selectedName);
                    setPath(selectedName);
                }
            }
            else {
                alert("O seu navegador não possui suporte direto a showDirectoryPicker. Insira o caminho absoluto no campo de texto.");
            }
        }
        catch (err) {
            if (err.name !== "AbortError") {
                console.error("Erro ao selecionar diretório:", err);
            }
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim())
            return;
        setLoading(true);
        try {
            await onSubmit({
                id: editingProject?.id,
                name: name.trim(),
                description: description.trim() || undefined,
                path: path.trim() || undefined,
            });
            onClose();
        }
        catch (err) {
            console.error("Erro ao salvar projeto:", err);
        }
        finally {
            setLoading(false);
        }
    };
    return (<div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {editingProject ? (<>
                <Folder className="w-4 h-4 text-[#0066cc]"/>
                Editar Projeto
              </>) : (<>
                <FolderPlus className="w-4 h-4 text-[#0066cc]"/>
                Gestão de Projetos Locais
              </>)}
          </h3>
        </div>

        {!editingProject && (<div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400">
            <button type="button" onClick={() => setTab("create")} className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${tab === "create"
                ? "bg-white dark:bg-slate-900 text-[#0066cc] shadow-sm font-semibold"
                : "hover:text-slate-900 dark:hover:text-white"}`}>
              <FolderPlus className="w-3.5 h-3.5"/>
              <span>Criar Novo Projeto</span>
            </button>
            <button type="button" onClick={() => setTab("open")} className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-colors ${tab === "open"
                ? "bg-white dark:bg-slate-900 text-[#0066cc] shadow-sm font-semibold"
                : "hover:text-slate-900 dark:hover:text-white"}`}>
              <FolderOpen className="w-3.5 h-3.5"/>
              <span>Abrir Pasta Local</span>
            </button>
          </div>)}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Nome do Projeto
            </label>
            <input type="text" placeholder="Ex: NextCode Engine Core" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]" required/>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5 text-slate-400"/>
                Caminho Absoluto da Pasta Local
              </span>
              {pathValid.checked && (<span className={`flex items-center gap-1 font-normal text-[11px] ${pathValid.exists ? "text-emerald-600" : "text-amber-600"}`}>
                  {pathValid.exists ? <CheckCircle2 className="w-3 h-3"/> : <AlertCircle className="w-3 h-3"/>}
                  {pathValid.exists ? "Diretório Válido" : "Não Encontrado"}
                </span>)}
            </label>

            <div className="flex gap-2">
              <input type="text" placeholder="Ex: c:\projetos\meu-app ou /Users/dev/projeto" value={path} onChange={(e) => {
            setPath(e.target.value);
            if (!name && e.target.value) {
                const parts = e.target.value.replace(/\\/g, "/").split("/");
                const folderName = parts[parts.length - 1] || parts[parts.length - 2];
                if (folderName)
                    setName(folderName);
            }
        }} className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]"/>

              <button type="button" onClick={handlePickDirectory} className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 text-xs transition-colors shrink-0" title="Escolher pasta nativa via File System API">
                <Search className="w-3.5 h-3.5"/>
                <span>Navegar...</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400"/>
              Descrição (Opcional)
            </label>
            <textarea placeholder="Descrição técnica do projeto..." value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0066cc]" rows={2}/>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
              Cancelar
            </button>
            <button type="submit" disabled={loading || !name.trim()} className="px-4 py-1.5 text-xs bg-[#0066cc] hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 shadow-sm">
              {loading ? "Salvando..." : editingProject ? "Salvar Alterações" : "Vincular Projeto"}
            </button>
          </div>
        </form>
      </div>
    </div>);
}
