"use client";

import React, { useState } from "react";
import {
  FileText,
  Lock,
  Unlock,
  ShieldCheck,
  CheckCircle2,
  Code2,
  ListFilter,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Workflow,
} from "lucide-react";

interface SpecMessageRendererProps {
  content: string;
  onOpenSpecModal?: () => void;
  role?: string;
}

export function SpecMessageRenderer({ content, onOpenSpecModal, role }: SpecMessageRendererProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"formatted" | "raw">("formatted");

  // Verifica se o texto é uma Spec Canônica NextCode v5
  const isSpec =
    content.includes("SPEC CANÔNICA") ||
    content.includes("DIRECTIVES & MECHANICAL LOCKS") ||
    content.includes("SPEC-TEMPLATE-NEXTCODE-V5");

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = content;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Erro ao copiar spec:", err);
    }
  };

  if (isSpec) {
    return (
      <div className="w-full my-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/90 shadow-sm overflow-hidden transition-all">
        {/* Spec Header Card Limpo com Botão de Minimizar no Canto Direito */}
        <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0066cc] text-white flex items-center justify-center font-bold shadow-sm">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900 dark:text-white">
                  Especificação Executiva NextCode
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Trava T1 (Aguardando Aprovação)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab(activeTab === "formatted" ? "raw" : "formatted")}
              className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              {activeTab === "formatted" ? "Ver Texto Puro" : "Ver Formatado"}
            </button>

            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              title="Copiar Spec"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>

            {onOpenSpecModal && (
              <button
                onClick={onOpenSpecModal}
                className="px-3 py-1 bg-[#0066cc] hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Editar / Aprovar Spec</span>
              </button>
            )}

            {/* Botão Retrátil no Canto Direito */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700 flex items-center gap-1 text-[11px]"
              title={expanded ? "Recolher Spec" : "Expandir Spec"}
            >
              <span>{expanded ? "Ocultar" : "Mostrar"}</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Spec Body Limpo sem Fundo Escuro */}
        {expanded && (
          <div className="p-5 space-y-4 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
            {activeTab === "raw" ? (
              <pre className="p-4 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded-xl text-[11px] font-mono whitespace-pre-wrap overflow-x-auto border border-slate-200 dark:border-slate-800 leading-relaxed max-h-[500px]">
                {content}
              </pre>
            ) : (
              <RenderParsedMarkdown text={content} />
            )}
          </div>
        )}
      </div>
    );
  }

  // Se for mensagem padrão de chat (não spec completa), renderiza Markdown elegante
  return <RenderParsedMarkdown text={content} />;
}

/**
 * Componente interno que transforma Markdown em componentes visuais limpos
 */
function RenderParsedMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  let blockKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Trata blocos de código markdown (```lang)
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.trim().replace(/^```/, "");
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        const codeContent = codeBuffer.join("\n");
        elements.push(
          <CodeBlockCard key={`code-${blockKey++}`} code={codeContent} language={codeLang} />
        );
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Cabeçalhos (H1, H2, H3)
    if (line.startsWith("# ")) {
      elements.push(
        <h1
          key={`h1-${i}`}
          className="text-base font-bold text-slate-900 dark:text-white mt-4 mb-2 pb-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2"
        >
          <span>{formatInlineMarkdown(line.replace("# ", ""))}</span>
        </h1>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2
          key={`h2-${i}`}
          className="text-xs font-bold uppercase tracking-wider text-[#0066cc] dark:text-blue-400 mt-4 mb-2 flex items-center gap-1.5"
        >
          <span>{formatInlineMarkdown(line.replace("## ", ""))}</span>
        </h2>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3
          key={`h3-${i}`}
          className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-3 mb-1"
        >
          {formatInlineMarkdown(line.replace("### ", ""))}
        </h3>
      );
    } else if (line.startsWith("> ")) {
      // Citação / Callout
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="pl-3.5 py-1.5 my-2 border-l-3 border-[#0066cc] bg-blue-50/50 dark:bg-blue-950/30 text-slate-700 dark:text-slate-300 rounded-r-lg text-xs italic"
        >
          {formatInlineMarkdown(line.replace("> ", ""))}
        </blockquote>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      // Listas não ordenadas
      const listContent = line.replace(/^[-*]\s+/, "");
      elements.push(
        <div key={`li-${i}`} className="flex items-start gap-2 my-1 pl-1 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0066cc] dark:bg-blue-400 mt-1.5 shrink-0" />
          <span className="flex-1 text-slate-800 dark:text-slate-200 leading-relaxed">
            {formatInlineMarkdown(listContent)}
          </span>
        </div>
      );
    } else if (/^\d+\.\s+/.test(line)) {
      // Listas ordenadas
      const match = line.match(/^(\d+)\.\s+(.*)/);
      if (match) {
        elements.push(
          <div key={`oli-${i}`} className="flex items-start gap-2 my-1 pl-1 text-xs">
            <span className="font-bold text-[#0066cc] dark:text-blue-400 shrink-0 text-[11px]">
              {match[1]}.
            </span>
            <span className="flex-1 text-slate-800 dark:text-slate-200 leading-relaxed">
              {formatInlineMarkdown(match[2])}
            </span>
          </div>
        );
      }
    } else if (line.trim() === "---") {
      // Linha separadora
      elements.push(
        <hr key={`hr-${i}`} className="my-3 border-slate-200 dark:border-slate-800/80" />
      );
    } else if (line.trim() === "") {
      elements.push(<div key={`space-${i}`} className="h-1.5" />);
    } else {
      // Parágrafo comum
      elements.push(
        <p key={`p-${i}`} className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed my-1">
          {formatInlineMarkdown(line)}
        </p>
      );
    }
  }

  return <div className="space-y-0.5">{elements}</div>;
}

/**
 * Formata inline markdown (**negrito**, *itálico*, `código inline`)
 */
function formatInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 bg-slate-200/80 dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-mono text-[11px] rounded border border-slate-300/60 dark:border-slate-700 mx-0.5"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-bold text-slate-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={idx} className="italic text-slate-700 dark:text-slate-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

/**
 * Card estilizado para exibição de blocos de código e diagramas Mermaid
 */
function CodeBlockCard({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [showRawMermaid, setShowRawMermaid] = useState(false);

  const handleCopyCode = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Erro ao copiar código:", err);
    }
  };

  // Suporte a Diagramas Mermaid
  if (language.toLowerCase() === "mermaid") {
    const steps = code
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("graph") && !l.startsWith("flowchart") && !l.startsWith("subgraph") && !l.startsWith("end"));

    return (
      <div className="my-3 border border-indigo-200 dark:border-indigo-900/60 rounded-xl bg-indigo-50/30 dark:bg-slate-950 overflow-hidden shadow-sm">
        <div className="px-3.5 py-2 bg-indigo-100/60 dark:bg-indigo-950/60 border-b border-indigo-200 dark:border-indigo-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              Diagrama Visual de Fluxo (Mermaid)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRawMermaid(!showRawMermaid)}
              className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
            >
              {showRawMermaid ? "Ver Fluxo" : "Ver Código"}
            </button>
            <button
              onClick={handleCopyCode}
              className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
              title="Copiar Diagrama"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {showRawMermaid ? (
          <pre className="p-3.5 text-slate-100 font-mono text-[11px] overflow-x-auto leading-relaxed max-h-96 bg-slate-950">
            {code}
          </pre>
        ) : (
          <div className="p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {steps.map((step, idx) => (
                <React.Fragment key={idx}>
                  <div className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 shadow-sm flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span>{step.replace(/-->|--/g, "➔").replace(/["\[\]]/g, "")}</span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-3 border border-slate-800 rounded-xl bg-slate-950 overflow-hidden shadow-sm">
      <div className="px-3.5 py-1.5 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          {language || "code"}
        </span>
        <button
          onClick={handleCopyCode}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1 text-[10px]"
          title="Copiar Código"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 text-slate-100 font-mono text-[11px] overflow-x-auto leading-relaxed max-h-96">
        {code}
      </pre>
    </div>
  );
}
