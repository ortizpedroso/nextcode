"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Github,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Zap,
  Globe,
  Bot,
  Brain,
  FileCode2,
} from "lucide-react";
import { SkillItemInfo } from "@/app/api/skills/list/route";

interface GithubSkillInstallerCardProps {
  projectId?: string | null;
}

export function GithubSkillInstallerCard({ projectId }: GithubSkillInstallerCardProps) {
  const [githubUrl, setGithubUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    skillName: string;
    detectedType: string;
    message: string;
    riskFlags?: string[];
  } | null>(null);

  const [skills, setSkills] = useState<SkillItemInfo[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);

  const fetchInstalledSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const res = await fetch(`/api/skills/list${query}`);
      const data = await res.json();
      if (res.ok && data.skills) {
        setSkills(data.skills);
      }
    } catch {
      console.error("Erro ao carregar skills instaladas.");
    } finally {
      setLoadingSkills(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchInstalledSkills();
  }, [fetchInstalledSkills]);

  const handleInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl.trim() || loading) return;

    setLoading(true);
    setError(null);
    setSuccessResult(null);

    try {
      const res = await fetch("/api/skills/install-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUrl: githubUrl.trim(),
          projectId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessResult({
          skillName: data.skillName,
          detectedType: data.detectedType,
          message: data.message,
          riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags : [],
        });
        setGithubUrl("");
        // Nada é gravado em disco ainda — a skill só aparecerá na lista abaixo após
        // aprovação explícita na fila de revisão (quarantine gate).
      } else {
        setError(data.details || data.error || "Erro ao importar skill do GitHub.");
      }
    } catch {
      setError("Falha na comunicação ao tentar instalar a skill.");
    } finally {
      setLoading(false);
    }
  };

  const renderTypeBadge = (type: string) => {
    switch (type) {
      case "google":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
            <Globe className="w-3 h-3 text-blue-500" />
            Google Antigravity / Gemini
          </span>
        );
      case "claude":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full">
            <Brain className="w-3 h-3 text-purple-500" />
            Claude Code
          </span>
        );
      case "cursor":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
            <Zap className="w-3 h-3 text-amber-500" />
            Cursor Rules (.mdc)
          </span>
        );
      case "codex":
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
            <Bot className="w-3 h-3 text-emerald-500" />
            OpenAI Codex
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
            <Sparkles className="w-3 h-3 text-blue-500" />
            Skill de IA
          </span>
        );
    }
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4 shadow-sm text-xs select-none">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-[#0066cc] dark:text-blue-400">
            <Github className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-xs">
              Instalador de Habilidades & Skills via GitHub
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Cole o link de um repositório ou arquivo do GitHub. O conteúdo é analisado e enviado para revisão antes de ser ativado — nada é gravado em disco sem aprovação explícita.
            </p>
          </div>
        </div>
      </div>

      {/* Formulário de Download */}
      <form onSubmit={handleInstall} className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
            URL da Skill no GitHub
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ex: https://github.com/usuario/repo ou https://github.com/user/repo/blob/main/SKILL.md"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              disabled={loading}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-[#0066cc]"
              required
            />
            <button
              type="submit"
              disabled={loading || !githubUrl.trim()}
              className="bg-[#0066cc] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 text-xs shadow-sm transition-colors shrink-0"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analisando...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Enviar para Revisão</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Notificação: enviado para revisão (quarantine gate) */}
      {successResult && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 flex items-start gap-2.5 text-xs">
          <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">{successResult.message}</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-700 dark:text-amber-400">Formato Detectado:</span>
              {renderTypeBadge(successResult.detectedType)}
            </div>
            {successResult.riskFlags && successResult.riskFlags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {successResult.riskFlags.map((flag, idx) => (
                  <span
                    key={idx}
                    className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-800"
                    title={flag}
                  >
                    ⚠ {flag.split(":")[0]}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
              Revise e aprove em "Propostas de Skills" para ativá-la.
            </p>
          </div>
        </div>
      )}

      {/* Notificação de Erro */}
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 flex items-center gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Lista de Skills Instaladas */}
      <div className="pt-2">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          <span>Skills Ativas no Projeto ({skills.length})</span>
        </div>

        {loadingSkills ? (
          <div className="text-slate-400 italic text-xs py-2 text-center">Carregando skills...</div>
        ) : skills.length === 0 ? (
          <div className="text-slate-400 italic text-[11px] py-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
            Nenhuma skill customizada instalada. Cole uma URL do GitHub acima para adicionar.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {skills.map((s) => (
              <div
                key={s.path}
                className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <FileCode2 className="w-4 h-4 text-[#0066cc] shrink-0" />
                  <div className="truncate">
                    <div className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                      <span>/{s.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{s.description}</div>
                  </div>
                </div>
                {renderTypeBadge(s.type)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
