/**
 * Evolution Incident Reporter (NextCode v5 - Trava T6 D-RANHO)
 * Compila o histórico de falhas de auditoria e gera um Relatório de Incidente de Evolução
 * quando uma tarefa esgota o ciclo de tentativas automáticas (maxAttempts, padrão 3) — o
 * ponto em que a engine para de tentar sozinha e devolve a decisão ao humano.
 *
 * O relatório é DIRECIONADO AO ERRO: classifica cada rejeição pela causa real (build, escopo,
 * auditoria cega, módulo ausente...), aponta se o mesmo erro se repetiu em todas as tentativas
 * e recomenda a ação humana específica para essa causa — não um texto genérico.
 */

import {
  construirAvisoLacunaPermanente,
  extrairCitacoesArquivoLinha,
} from "@/core/governance/pedido-unico";
import { SEMANTIC_HUMAN_ACTION, formatIncidentClock } from "@/core/governance/incident-present";

export { errorFenceMeta, formatIncidentClock, presentIncidentMarkdown, SEMANTIC_HUMAN_ACTION } from "@/core/governance/incident-present";

export interface FailureAttemptDiagnosis {
  causa: string;
  confianca: number;
  probabilidades: Record<string, number>;
}

export interface FailureAttemptRecord {
  attemptNumber: number;
  rejectionReason: string;
  filesScope: string[];
  timestamp: string;
  diagnostico?: FailureAttemptDiagnosis | null;
}

export interface IncidentReportOptions {
  /** Limite de tentativas que foi atingido (padrão 3). */
  maxAttempts?: number;
  /** Títulos dos nós dependentes bloqueados em cascata por este bloqueio. */
  blockedDependents?: string[];
  /** Onde o humano libera o nó (DAG: botão do painel; chat: reenviar o pedido). */
  unblockHint?: string;
  /** Dono roteado pela política A3 (opcional). */
  dono?: string;
  /** TR1 (5): placar da sessão já formatado (`sessionScoreboardMarkdown`). */
  placar?: string;
}

export interface FailureCategory {
  key: string;
  label: string;
  humanAction: string;
}

const CATEGORIES: { match: RegExp; category: FailureCategory }[] = [
  {
    match: /TRAVA T2 VIOLADA/i,
    category: {
      key: "scope",
      label: "Violação de escopo (Trava T2)",
      humanAction:
        "O worker gerou arquivos fora do `files_scope`. Se esses arquivos são de fato necessários, inclua-os em `arquivos_afetados` da Spec Canônica e reaprove; caso contrário, reforce no Brief que só os arquivos do escopo podem ser alterados.",
    },
  },
  {
    match: /Auditoria cega \(Tipo 2\) indispon[ií]vel/i,
    category: {
      key: "auditor_unavailable",
      label: "Auditor cego (LLM) indisponível",
      humanAction:
        "Nenhum provedor respondeu um veredito válido para a Lente Cega. Verifique as chaves e gateways em Configurações (FreeLLMAPI, Gemini, Groq...) e, se o provedor for lento, aumente `BLIND_AUDIT_TIMEOUT_MS`. O código em si pode estar correto. Ele só não pôde ser verificado.",
    },
  },
  {
    match: /Auditoria cega \(LLM\) concluiu|Diverg[eê]ncia sem[aâ]ntica/i,
    category: {
      key: "semantic",
      label: "Requisitos do Brief não implementados (Auditoria Cega)",
      humanAction: SEMANTIC_HUMAN_ACTION,
    },
  },
  {
    match: /\[ESLINT\]|ESLint real p[oó]s-promo[cç][aã]o/i,
    category: {
      key: "lint",
      label: "ESLint do projeto reprovado (promoção desfeita)",
      humanAction:
        "O código compila, mas viola regras do ESLint configuradas no próprio projeto (ex.: react-hooks, imports). Veja a regra citada em cada erro abaixo: ajuste o requisito na Spec para respeitá-la ou, se a regra não se aplica a esse caso, ajuste a configuração do ESLint do projeto.",
    },
  },
  {
    match: /teste de aceite falha[\s\S]*não carregou:[\s\S]*before initialization/i,
    category: {
      key: "acceptance_test_broken",
      label: "Teste de aceite não carregou",
      humanAction:
        "O teste de aceite não chegou a rodar: ele passa um mock para vi.mock antes de inicializar esse nome. A Spec e o código da etapa permanecem. O porteiro descarta esse teste. Uma falha de asserção, com o teste carregado, continua bloqueando a etapa.",
    },
  },
  {
    // E5 (mudança 44): a etapa só promove com os testes de aceite (do testador, cegos ao código) passando.
    match: /teste de aceite falha/i,
    category: {
      key: "acceptance",
      label: "Teste de aceite da etapa falhando",
      humanAction:
        "O código compila e o avaliador pode até ter aprovado, mas o teste de aceite (escrito pelo testador só a partir do Microbrief, sem ver o código) falha — a saída está abaixo. Confira se o teste pede o que a Spec diz: se pede, o defeito é do código (clique em **Re-tentar**); se o teste exige algo que a Spec não pede, ajuste o critério do REQ na Spec.",
    },
  },
  {
    match: /\[SILENCIO\]/i,
    category: {
      key: "compiler_silence",
      label: "Código escondeu o compilador",
      humanAction:
        "As tentativas trocaram um silêncio por outro (diretiva, cast ou import variável) em vez de corrigir o erro de tipo. O que o silêncio escondia está no motivo, com a marca [ESCONDIDO], quando o porteiro conseguiu medi-lo. Re-tentar esta etapa abre um ciclo novo. A Spec e o escopo da etapa permanecem.",
    },
  },
  {
    // Mudança 43.3/44: a etapa de reparo só promove com o teste que prova o defeito passando.
    match: /teste do contrato do reparo|teste do contrato ainda falha/i,
    category: {
      key: "repair_contract",
      label: "Teste que prova o defeito ainda falha (contrato do reparo)",
      humanAction:
        "O código compila, mas o teste que prova o defeito continua falhando (a saída está abaixo). Confira primeiro se o próprio teste está certo (mock que não zera entre casos, expectativa diferente da Spec): se estiver errado, a revisão final escreve outro na próxima verificação — clique em **Retomar**. Se o teste estiver certo, o defeito é de código fora do alcance desta etapa: clique em **Re-tentar** (o escopo do reparo é recalculado pelos arquivos citados no defeito).",
    },
  },
  {
    match: /Verifica[cç][aã]o emp[ií]rica|error TS/i,
    category: {
      key: "build",
      label: "Type-check real do projeto reprovado (promoção desfeita)",
      humanAction:
        "O código passou nas auditorias isoladas, mas quebra o build do projeto mesclado. Abra os arquivos citados nos erros `TS` abaixo — normalmente é uma assinatura/export que o resto do projeto espera e o código gerado mudou. Corrija a interface esperada na Spec ou ajuste o arquivo manualmente.",
    },
  },
  {
    match: /PRISMA MODEL HALLUCINATION/i,
    category: {
      key: "prisma_model",
      label: "Uso de modelo Prisma inexistente",
      humanAction:
        "O código usa `prisma.<modelo>` que não existe no `schema.prisma`. Decida: o modelo deve existir (inclua `prisma/schema.prisma` no escopo e declare o modelo na Spec) ou o código deve usar um modelo já existente (cite o nome correto na Spec).",
    },
  },
  {
    match: /MISSING MODULE ERROR/i,
    category: {
      key: "missing_module",
      label: "Import de módulo inexistente",
      humanAction:
        "O código importa um módulo que não existe nem no lote nem no projeto. Crie o módulo (ou inclua-o no escopo do nó) ou corrija o caminho do import na Spec.",
    },
  },
  {
    match: /OWASP VIOLATION|SECRETS LEAK/i,
    category: {
      key: "security",
      label: "Violação de segurança",
      humanAction:
        "O código gerado usa construções proibidas (eval/exec/new Function) ou segredo hardcoded. Revise o requisito que leva a isso e deixe explícita na Spec a alternativa segura esperada.",
    },
  },
  {
    match: /Timeout de resposta excedido/i,
    category: {
      key: "turn_timeout",
      label: "O modelo não concluiu o turno no tempo da etapa",
      humanAction:
        "O provedor aceitou o turno e não devolveu a resposta dentro do limite. Não houve arquivo para o compilador julgar. Re-tentar esta etapa abre um ciclo novo. A Spec e o escopo da etapa permanecem.",
    },
  },
  {
    match: /SYNTAX ERROR|JSON SYNTAX|CSS SYNTAX|NEXT\.JS APP ROUTER ERROR|PRISMA SCHEMA ERROR|PACKAGE\.JSON ERROR|Falha no Validador Tipo 1/i,
    category: {
      key: "mechanical",
      label: "Erro mecânico/sintático (Validador Tipo 1)",
      humanAction:
        "O worker não conseguiu produzir um arquivo sintaticamente válido em nenhuma tentativa. Veja o erro exato abaixo; se ele se repete, o modelo provavelmente está truncando a resposta — reduza o escopo do nó (menos arquivos por etapa).",
    },
  },
  {
    match: /Timeout|abortad|Exce[cç][aã]o n[aã]o tratada|travar em 'running'/i,
    category: {
      key: "runtime",
      label: "Falha de execução (timeout/exceção)",
      humanAction:
        "A etapa não chegou a ser auditada: o provedor estourou o tempo ou o processo falhou. Verifique a disponibilidade do provedor e, para etapas grandes, aumente `DAG_STEP_TIMEOUT_MS`.",
    },
  },
];

const UNKNOWN_CATEGORY: FailureCategory = {
  key: "unknown",
  label: "Falha não classificada",
  humanAction: "Leia o motivo exato de cada tentativa abaixo e ajuste a Spec ou os arquivos do escopo conforme o erro.",
};

export function classifyFailure(rejectionReason: string): FailureCategory {
  return CATEGORIES.find((c) => c.match.test(rejectionReason))?.category || UNKNOWN_CATEGORY;
}

/** Remove números de linha/coluna e espaços para comparar se o MESMO erro se repetiu. */
function errorFingerprint(reason: string): string {
  return reason.replace(/\(\d+,\d+\)|:\d+:\d+/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Extrai as citações `arquivo:linha` de tentativas anteriores que permaneceram na última tentativa.
 */
export function extractRemainingFileLineGaps(attemptsHistory: FailureAttemptRecord[]): string[] {
  if (attemptsHistory.length < 2) return [];
  const last = attemptsHistory[attemptsHistory.length - 1];
  const lastCits = extrairCitacoesArquivoLinha(last.rejectionReason);
  if (lastCits.length === 0) return [];

  const prevRefs = new Set<string>();
  for (const prev of attemptsHistory.slice(0, -1)) {
    for (const cit of extrairCitacoesArquivoLinha(prev.rejectionReason)) {
      prevRefs.add(cit.referencia);
    }
  }

  return lastCits
    .filter((cit) => prevRefs.has(cit.referencia))
    .map((cit) => cit.descricaoCompleta || cit.referencia);
}

export class IncidentReporter {
  /**
   * Compila o relatório markdown de incidente quando a política D-RANHO é acionada.
   */
  public static generateIncidentReport(
    taskId: string,
    taskTitle: string,
    cluster: string,
    attemptsHistory: FailureAttemptRecord[],
    options: IncidentReportOptions = {}
  ): string {
    const maxAttempts = options.maxAttempts || 3;
    const last = attemptsHistory[attemptsHistory.length - 1];
    const lastCategory = last ? classifyFailure(last.rejectionReason) : UNKNOWN_CATEGORY;
    const categories = attemptsHistory.map((a) => classifyFailure(a.rejectionReason));
    const sameCategoryEveryTime = categories.length > 1 && categories.every((c) => c.key === lastCategory.key);
    const sameErrorEveryTime =
      attemptsHistory.length > 1 &&
      attemptsHistory.every((a) => errorFingerprint(a.rejectionReason) === errorFingerprint(last.rejectionReason));
    const affectedFiles = Array.from(new Set(attemptsHistory.flatMap((a) => a.filesScope)));

    const remainingGaps = extractRemainingFileLineGaps(attemptsHistory);
    const remainingGapNote =
      remainingGaps.length > 0 ? ` ${construirAvisoLacunaPermanente(remainingGaps)}` : "";

    const semanticFingerprints = attemptsHistory
      .filter((_, index) => categories[index]?.key === "semantic")
      .map((attempt) => errorFingerprint(attempt.rejectionReason));
    const semanticMoved =
      remainingGaps.length === 0 && semanticFingerprints.length >= 2 && new Set(semanticFingerprints).size > 1;
    const persistenceNote = sameErrorEveryTime
      ? `⚠️ **O MESMO erro se repetiu em todas as ${attemptsHistory.length} tentativas** — o feedback automático não foi suficiente para o modelo corrigir; repetir sem intervenção vai falhar de novo.${remainingGapNote}`
      : sameCategoryEveryTime
        ? `⚠️ Todas as tentativas falharam pela mesma causa (**${lastCategory.label}**), com variações no detalhe.${remainingGapNote || (semanticMoved ? " A lacuna citada mudou entre as tentativas. A Spec permanece." : "")}`
        : `As tentativas falharam por causas diferentes: ${Array.from(new Set(categories.map((c) => c.label))).join("; ")}.${remainingGapNote || (semanticMoved ? " Nas auditorias cegas, a lacuna citada mudou entre as tentativas. A Spec permanece." : "")}`;
    const defaultUnblock =
      remainingGaps.length > 0
        ? 'A Spec permanece. Botão: **Re-tentar** (clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo começa do zero).'
        : lastCategory.key === "semantic"
          ? 'A Spec não muda. Clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo começa do zero.'
          : 'depois de ajustar, clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo de tentativas começa do zero.';

    const dependentsBlock =
      options.blockedDependents && options.blockedDependents.length > 0
        ? `- **Etapas dependentes bloqueadas em cascata:** ${options.blockedDependents.map((t) => `"${t}"`).join(", ")}\n`
        : "";

    return `# Relatório de Incidente de Evolução (Política D-RANHO - Trava T6)

> **Severidade:** ALTA — ciclo de tentativas automáticas esgotado (${attemptsHistory.length}/${maxAttempts})
> **Tarefa:** \`${taskId}\` — ${taskTitle}
> **Cluster Afetado:** \`${cluster}\`
> **Data de Registro:** ${formatIncidentClock(new Date())}

---

## 1. Causa principal
${options.dono ? `**Dono:** ${options.dono}\n\n` : ""}**${lastCategory.label}**

${persistenceNote}

**Último erro (tentativa ${last?.attemptNumber ?? "-"}):**
\`\`\`erro ${last ? formatIncidentClock(last.timestamp) : ""}
${(last?.rejectionReason || "Falha não especificada.").replace(/```/g, "'''").slice(0, 1500)}
\`\`\`

## 2. O que você precisa fazer
${lastCategory.humanAction}

- **Arquivos envolvidos:** ${affectedFiles.length ? affectedFiles.map((f) => `\`${f}\``).join(", ") : "_nenhum declarado_"}
${dependentsBlock}- **Para liberar:** ${options.unblockHint || defaultUnblock}

## 3. Histórico das tentativas rejeitadas

${attemptsHistory
  .map((att) => {
    const clock = formatIncidentClock(att.timestamp);
    const motivo = (att.rejectionReason || "").replace(/```/g, "'''");
    return `### Tentativa ${att.attemptNumber} — ${classifyFailure(att.rejectionReason).label}
- **Horário:** ${clock}
- **Escopo:** \`${att.filesScope.join(", ") || "-"}\`

\`\`\`erro ${clock}
${motivo}
\`\`\`
${
  att.diagnostico
    ? `- **Diagnóstico Jev:** \`${att.diagnostico.causa}\` (confiança: ${(att.diagnostico.confianca * 100).toFixed(0)}%)\n`
    : ""
}`;
  })
  .join("\n")}
## 4. Estado do grafo (DAG)
${options.placar ? `${options.placar}

` : ""}- Esta etapa está \`blocked\` e não será executada de novo automaticamente (nem pelo botão "Executar nó").
- Etapas que não dependem dela seguem executando normalmente.
`;
  }
}
