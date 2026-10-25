/**
 * Lacuna de cluster na conferência do Macrobrief.
 *
 * Sistema novo: se a Spec descreve domínio, tela, API ou consumo entre clusters
 * e o Macrobrief não tem o dono correspondente, a conferência devolve UMA vez
 * ao elicitador (fora do contador de 3 voltas). Se a lacuna continuar, a pergunta
 * vai ao humano. Exceção confirmada (humano nomeia o cluster) não volta a disparar.
 * Cluster sem requisito correspondente não é lacuna: fica `nada_a_fazer`.
 */

import { inferClusterFromFilePath } from "@/core/templates/artifact-templates";
import type { ClusterKind } from "@/core/config/orchestration-policy";

export type ClusterGapKind =
  | "core_ausente"
  | "frontend_ausente"
  | "backend_ausente"
  | "integracao_ausente";

export interface ClusterException {
  gap: ClusterGapKind;
  cluster: ClusterKind;
}

export interface ClusterGapFinding {
  gap: ClusterGapKind;
  pergunta: string;
}

const DOMAIN_RE =
  /\b(entidades?|regras? de neg[oó]cio|invariantes?|dom[ií]nio|modelo de dados)\b/i;
const SCREEN_RE =
  /\b(telas?|p[aá]ginas?|formul[aá]rios?|interface do usu[aá]rio|componente react)\b/i;
const API_RE =
  /\b(apis?|endpoints?|persist[eê]ncia|banco de dados|prisma|rotas? http)\b/i;
const UI_CALLS_API_RE =
  /\b(tela|p[aá]gina|frontend|interface).{0,80}\b(api|endpoint|backend)\b|\b(api|backend).{0,80}\b(tela|p[aá]gina|frontend)\b/i;

export function detectClusterGaps(input: {
  arquivos: string[];
  requisitosTexto: string;
  notas: string[];
  entidades: number;
  clustersPresentes: string[];
  excecoes?: ClusterException[];
}): ClusterGapFinding[] {
  const present = new Set(input.clustersPresentes);
  const excused = new Set((input.excecoes ?? []).map((e) => e.gap));
  const files = input.arquivos.map((f) => f.replace(/\\/g, "/"));
  const blob = `${input.requisitosTexto}\n${input.notas.join("\n")}`;
  const fileClusters = new Set(files.map((f) => inferClusterFromFilePath(f)));

  const needsCore = input.entidades > 0 || DOMAIN_RE.test(blob);
  const needsFrontend =
    fileClusters.has("frontend") ||
    files.some((f) => /\.(tsx|jsx)$/i.test(f)) ||
    SCREEN_RE.test(blob);
  const needsBackend =
    fileClusters.has("backend") ||
    files.some((f) => /\/api\/|route\.ts$|\/prisma\//i.test(f)) ||
    API_RE.test(blob);
  const needsIntegration =
    (needsFrontend && needsBackend) ||
    fileClusters.has("integration") ||
    UI_CALLS_API_RE.test(blob);

  const findings: ClusterGapFinding[] = [];
  const ask = (gap: ClusterGapKind, pergunta: string, needed: boolean, cluster: string) => {
    if (!needed || present.has(cluster) || excused.has(gap)) return;
    findings.push({ gap, pergunta });
  };

  ask(
    "core_ausente",
    "A Spec descreve domínio (entidades, regras ou invariantes) e o Macrobrief não tem cluster core. O domínio fica sem dono de propósito? Reescreva o Macrobrief com um dono em core, ou confirme com o humano em qual cluster esse domínio fica.",
    needsCore,
    "core"
  );
  ask(
    "frontend_ausente",
    "A Spec descreve telas e o Macrobrief não tem cluster frontend. Faltou a interface ou o sistema não tem tela?",
    needsFrontend,
    "frontend"
  );
  ask(
    "backend_ausente",
    "A Spec descreve API ou persistência e o Macrobrief não tem cluster backend. Faltou o servidor ou isso não é uma API?",
    needsBackend,
    "backend"
  );
  ask(
    "integracao_ausente",
    "A interface consome a API (ou um cluster consome outro) e o Macrobrief não tem cluster integration. Quem junta as partes?",
    needsIntegration,
    "integration"
  );

  return findings;
}

/** Cluster nomeado numa resposta humana. Integração casa antes de core/front/back. */
export function clusterNamedByHuman(text: string): ClusterKind | null {
  const t = text.toLowerCase();
  if (/\bintegration\b|integra[cç][aã]o/.test(t)) return "integration";
  if (/\bfrontend\b|front-end|front end/.test(t)) return "frontend";
  if (/\bbackend\b|back-end|back end/.test(t)) return "backend";
  if (/\bcore\b/.test(t)) return "core";
  return null;
}
