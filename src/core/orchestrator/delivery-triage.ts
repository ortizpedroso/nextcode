import { fileOfTsErrorLine } from "@/core/orchestrator/delivery-repair";

/** Classes globais de lacuna na entrega (T10 + J3) — roteiam reparo, ambiente ou Spec. */
export type DeliveryLacunaClasse = "ambiente" | "codigo" | "harness" | "spec" | "outro";

export type DeliveryLacunaItem = {
  classe: DeliveryLacunaClasse;
  texto: string;
  arquivo: string | null;
  codigoTs: string | null;
};

export type DeliveryTriageSummary = {
  total: number;
  porClasse: Record<DeliveryLacunaClasse, number>;
  dominante: DeliveryLacunaClasse;
  acaoRecomendada:
    | "retomar_ambiente"
    | "reparo_automatico"
    | "autorizar_rodada"
    | "analista_microbrief"
    | "revisar_spec";
  itens: DeliveryLacunaItem[];
};

const TS2307 = /error TS2307:/;
const TS7016 = /error TS7016:/;
const TS_ENV = /error TS2307:|error TS7016:|Cannot find module|Could not find a declaration file/;

export function classifyBuildErrorLine(line: string): DeliveryLacunaItem {
  const arquivo = fileOfTsErrorLine(line);
  const codigoTs = line.match(/error TS(\d+)/)?.[1] ?? null;
  let classe: DeliveryLacunaClasse = "codigo";
  if (TS_ENV.test(line)) classe = "ambiente";
  else if (arquivo && /src\/contracts\/(conformidade\/|index\.ts)/.test(arquivo.replace(/\\/g, "/"))) classe = "harness";
  return { classe, texto: line.slice(0, 400), arquivo, codigoTs: codigoTs ? `TS${codigoTs}` : null };
}

export function classifyFreeformLacuna(texto: string): DeliveryLacunaItem {
  const lower = texto.toLowerCase();
  let classe: DeliveryLacunaClasse = "outro";
  if (lower.includes("requisitos não aprovados")) classe = "codigo";
  else if (
    lower.includes("build next") ||
    lower.includes("next build") ||
    (lower.includes("type-check do projeto final") && lower.includes("next.js"))
  ) {
    classe =
      /non-standard\s+"node_env"|compiled successfully/i.test(texto) && !/\.\/(?:src|app)\/[^\s:]+\.(?:tsx?|jsx?):/i.test(texto)
        ? "ambiente"
        : "codigo";
  } else if (lower.includes("type-check do projeto final") && TS_ENV.test(texto)) classe = "ambiente";
  else if (lower.includes("pergunta") && lower.includes("spec")) classe = "spec";
  else if (/src\/contracts\/conformidade\//.test(texto) || lower.includes("sem dono") && lower.includes("conformidade"))
    classe = "harness";
  else if (lower.includes("revisão final") || lower.includes("reproduzido")) classe = "codigo";
  else if (lower.includes("arquivo da spec ausente")) classe = "codigo";
  else if (/verificação de tela reprovada \((install|docker|copy|start|preflight)\)/.test(lower)) classe = "ambiente";
  else if (/ambiente t10:/i.test(texto)) classe = "ambiente";
  const arquivo =
    texto.match(/((?:src\/|prisma\/)[^\s:(]+)/)?.[1]?.replace(/\\/g, "/") ??
    fileOfTsErrorLine(texto) ??
    null;
  return { classe, texto: texto.slice(0, 400), arquivo, codigoTs: null };
}

export function triageDeliveryLacunas(input: {
  buildErrorLines: string[];
  outrasLacunas: string[];
  semDonoReparo: string[];
  perguntasSpecCount: number;
  reparoTipo: "esgotado" | "sem_dono" | "erro" | "aberto";
  reparoTodosComDono?: boolean;
}): DeliveryTriageSummary {
  const itens: DeliveryLacunaItem[] = [
    ...input.buildErrorLines.map(classifyBuildErrorLine),
    ...input.outrasLacunas.map(classifyFreeformLacuna),
    ...input.semDonoReparo.map((t) => classifyFreeformLacuna(t)),
  ];
  const porClasse: Record<DeliveryLacunaClasse, number> = {
    ambiente: 0,
    codigo: 0,
    harness: 0,
    spec: 0,
    outro: 0,
  };
  for (const i of itens) porClasse[i.classe]++;
  if (input.perguntasSpecCount > 0) porClasse.spec += input.perguntasSpecCount;

  const ranked = (Object.entries(porClasse) as [DeliveryLacunaClasse, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const dominante = (ranked[0]?.[0] ??
    (input.reparoTipo === "esgotado" ? "codigo" : "outro")) as DeliveryLacunaClasse;

  let acaoRecomendada: DeliveryTriageSummary["acaoRecomendada"] = "analista_microbrief";
  if (input.reparoTipo === "aberto") acaoRecomendada = "reparo_automatico";
  else if (input.reparoTipo === "esgotado" && input.reparoTodosComDono) acaoRecomendada = "autorizar_rodada";
  else if (
    input.reparoTipo === "esgotado" &&
    dominante === "ambiente" &&
    porClasse.codigo <= porClasse.ambiente + (input.outrasLacunas.some((l) => /requisitos não aprovados/i.test(l)) ? 1 : 0)
  ) {
    acaoRecomendada = "retomar_ambiente";
  } else if (input.reparoTipo === "esgotado" && (dominante === "codigo" || porClasse.codigo > 0)) {
    acaoRecomendada = "autorizar_rodada";
  } else if (dominante === "ambiente") acaoRecomendada = "retomar_ambiente";
  else if (dominante === "codigo" && input.reparoTipo !== "sem_dono") acaoRecomendada = "reparo_automatico";
  else if (dominante === "spec" || input.perguntasSpecCount > 0) acaoRecomendada = "revisar_spec";
  else if (dominante === "harness" || input.reparoTipo === "sem_dono") acaoRecomendada = "analista_microbrief";

  const total =
    itens.length + (input.perguntasSpecCount > 0 && !itens.some((i) => i.classe === "spec") ? input.perguntasSpecCount : 0);

  return {
    total,
    porClasse,
    dominante,
    acaoRecomendada,
    itens: itens.slice(0, 40),
  };
}

import type { HumanAction } from "@/core/orchestrator/phase-machine";

/** Ação do painel/chat alinhada à triagem (evita “revisar Spec” quando é código/harness/ambiente). */
export function humanActionFromTriage(
  summary: DeliveryTriageSummary,
  reparoAberto: boolean
): HumanAction {
  if (reparoAberto) return "retomar";
  switch (summary.acaoRecomendada) {
    case "retomar_ambiente":
      return "retomar";
    case "autorizar_rodada":
      return "autorizar_rodada";
    case "revisar_spec":
      return "ajustar_spec";
    case "reparo_automatico":
      return "retomar";
    case "analista_microbrief":
      return summary.dominante === "spec" ? "ajustar_spec" : "reparo_encaixe";
    default:
      return "ajustar_spec";
  }
}

export function formatTriageForHumans(summary: DeliveryTriageSummary): string {
  const rotulo: Record<DeliveryLacunaClasse, string> = {
    ambiente: "ambiente / dependências",
    codigo: "código (com etapa dona)",
    harness: "contrato / conformidade (harness)",
    spec: "especificação",
    outro: "outros",
  };
  const acao: Record<DeliveryTriageSummary["acaoRecomendada"], string> = {
    retomar_ambiente: "**Próximo passo:** corrigir ambiente (install/tipos) e **Retomar** — não revisar a Spec.",
    reparo_automatico: "**Próximo passo:** deixar o **reparo automático** + microbrief do analista corrigir por etapa.",
    autorizar_rodada:
      "**Próximo passo:** se o código no disco já está corrigido, escreva **`retomar`** ou **`reverificar entrega`** para rodar a T10 de novo; se ainda faltar patch, **Autorizar mais uma rodada** (`autorizar rodada`).",
    analista_microbrief: "**Próximo passo:** analista gera **microbrief(s) de reparo/encaixe** (lacunas harness ou sem dono mapeado).",
    revisar_spec: "**Próximo passo:** responder perguntas ou **ajustar a Spec** no chat.",
  };
  const contagem = (Object.entries(summary.porClasse) as [DeliveryLacunaClasse, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${rotulo[k]}: ${n}`)
    .join(" · ");
  return [
    "**Triagem da entrega (automática):**",
    `- Classe dominante: **${rotulo[summary.dominante]}** (${contagem || "sem contagem"}).`,
    acao[summary.acaoRecomendada],
  ].join("\n");
}

/**
 * Devolve true só quando todas as lacunas são de ambiente ou harness —
 * sem defeitos de arquivo, arquivos ausentes ou requisitos não aprovados.
 * Entrada vazia devolve false.
 */
export function lacunasSoAmbienteOuHarness(input: {
  buildErrorLines: string[];
  outrasLacunas: string[];
  defeitosDeArquivo: string[];
  arquivosAusentes: string[];
  reqsNaoAprovados: string[];
}): boolean {
  // Se há defeitos de arquivo, arquivos ausentes ou requisitos não aprovados, não é só ambiente/harness
  if (
    input.defeitosDeArquivo.length > 0 ||
    input.arquivosAusentes.length > 0 ||
    input.reqsNaoAprovados.length > 0
  ) {
    return false;
  }

  // Se não há nenhuma lacuna, devolve false
  if (input.buildErrorLines.length === 0 && input.outrasLacunas.length === 0) {
    return false;
  }

  // Classifica todas as linhas de build error
  for (const line of input.buildErrorLines) {
    const classified = classifyBuildErrorLine(line);
    if (classified.classe !== "ambiente" && classified.classe !== "harness") {
      return false;
    }
  }

  // Classifica todas as outras lacunas
  for (const lacuna of input.outrasLacunas) {
    const classified = classifyFreeformLacuna(lacuna);
    if (classified.classe !== "ambiente" && classified.classe !== "harness") {
      return false;
    }
  }

  return true;
}
