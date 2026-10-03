"use client";

import { Boxes, Database, FolderTree, Lightbulb, Route, Target } from "lucide-react";
import type { ParsedSpec } from "@/core/intake/spec-format";

interface SpecSummaryCardProps {
  spec: ParsedSpec;
}

const STATUS_STYLES: Record<string, string> = {
  aprovada: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  aguardando_aprovacao: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
};

/** Resumo simplificado de uma Spec (YAML + Markdown enxuto) para aprovação do usuário. */
export function SpecSummaryCard({ spec }: SpecSummaryCardProps) {
  const statusKey = (spec.status || "aguardando_aprovacao").toLowerCase();
  const statusStyle = STATUS_STYLES[statusKey] || STATUS_STYLES.aguardando_aprovacao;
  const statusLabel = statusKey === "aprovada" ? "Aprovada" : "Aguardando aprovação";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
          {spec.titulo || "Especificação sem título"}
        </h4>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusStyle}`}>
          {statusLabel}
        </span>
      </div>

      {spec.objetivo && (
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{spec.objetivo}</p>
      )}

      {spec.stack.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Boxes className="w-3 h-3" /> Stack
          </div>
          <div className="flex flex-wrap gap-1.5">
            {spec.stack.map((item, idx) => (
              <span
                key={idx}
                className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {spec.modulos.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Target className="w-3 h-3" /> Módulos
          </div>
          <div className="space-y-1.5">
            {spec.modulos.map((m, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <span className="font-bold text-[#0066cc] dark:text-blue-400 shrink-0">{m.id || idx + 1}</span>
                <span className="text-slate-800 dark:text-slate-200">
                  <strong>{m.nome}</strong>
                  {m.resumo ? <> — {m.resumo}</> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {spec.entidades.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Database className="w-3 h-3" /> Entidades
          </div>
          <div className="flex flex-wrap gap-1.5">
            {spec.entidades.map((e, idx) => (
              <span
                key={idx}
                title={e.campos.map((c) => `${c.nome}: ${c.tipo}`).join(", ")}
                className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              >
                {e.nome}
                {e.campos.length > 0 && (
                  <span className="text-slate-400 dark:text-slate-500"> ({e.campos.length} campos)</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {spec.rotas.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Route className="w-3 h-3" /> Rotas
          </div>
          <div className="space-y-1.5">
            {spec.rotas.map((r, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-[#0066cc] dark:text-blue-400 shrink-0">{r.caminho}</span>
                {r.descricao ? <span className="text-slate-700 dark:text-slate-300">— {r.descricao}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {spec.arquivosAfetados.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <FolderTree className="w-3 h-3" /> Arquivos afetados
          </div>
          <div className="space-y-0.5">
            {spec.arquivosAfetados.map((item, idx) => (
              <div key={idx} className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                {item}
              </div>
            ))}
          </div>
        </div>
      )}

      {spec.notasImplementacao.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" /> Notas de implementação
          </div>
          <ul className="space-y-1 list-disc list-inside">
            {spec.notasImplementacao.map((item, idx) => (
              <li key={idx} className="text-[11px] text-slate-600 dark:text-slate-400">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
