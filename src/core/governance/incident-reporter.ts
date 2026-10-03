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

export interface FailureAttemptRecord {
  attemptNumber: number;
  rejectionReason: string;
  filesScope: string[];
  timestamp: string;
}

export interface IncidentReportOptions {
  /** Limite de tentativas que foi atingido (padrão 3). */
  maxAttempts?: number;
  /** Títulos dos nós dependentes bloqueados em cascata por este bloqueio. */
  blockedDependents?: string[];
  /** Onde o humano libera o nó (DAG: botão do painel; chat: reenviar o pedido). */
  unblockHint?: string;
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
        "Nenhum provedor respondeu um veredito válido para a Lente Cega. Verifique as chaves/endpoint em Configurações (OmniRoute, Gemini, Groq...) e, se o provedor for lento, aumente `BLIND_AUDIT_TIMEOUT_MS`. O código em si pode estar correto — ele só não pôde ser verificado.",
    },
  },
  {
    match: /Auditoria cega \(LLM\) concluiu|Diverg[eê]ncia sem[aâ]ntica/i,
    category: {
      key: "semantic",
      label: "Requisitos do Brief não implementados (Auditoria Cega)",
      humanAction:
        "O código compila, mas não implementa o que a Spec pede. Revise as pendências listadas abaixo: se o requisito estiver ambíguo ou grande demais para uma etapa, detalhe-o ou divida-o na Spec Canônica antes de liberar o nó.",
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

    const persistenceNote = sameErrorEveryTime
      ? `⚠️ **O MESMO erro se repetiu em todas as ${attemptsHistory.length} tentativas** — o feedback automático não foi suficiente para o modelo corrigir; repetir sem intervenção vai falhar de novo.`
      : sameCategoryEveryTime
        ? `⚠️ Todas as tentativas falharam pela mesma causa (**${lastCategory.label}**), com variações no detalhe.`
        : `As tentativas falharam por causas diferentes: ${Array.from(new Set(categories.map((c) => c.label))).join("; ")}.`;

    const dependentsBlock =
      options.blockedDependents && options.blockedDependents.length > 0
        ? `- **Etapas dependentes bloqueadas em cascata:** ${options.blockedDependents.map((t) => `"${t}"`).join(", ")}\n`
        : "";

    return `# Relatório de Incidente de Evolução (Política D-RANHO - Trava T6)

> **Severidade:** ALTA — ciclo de tentativas automáticas esgotado (${attemptsHistory.length}/${maxAttempts})
> **Tarefa:** \`${taskId}\` — ${taskTitle}
> **Cluster Afetado:** \`${cluster}\`
> **Data de Registro:** ${new Date().toISOString()}

---

## 1. Causa principal
**${lastCategory.label}**

${persistenceNote}

**Último erro (tentativa ${last?.attemptNumber ?? "-"}):**
\`\`\`text
${(last?.rejectionReason || "Falha não especificada.").slice(0, 1500)}
\`\`\`

## 2. O que você precisa fazer
${lastCategory.humanAction}

- **Arquivos envolvidos:** ${affectedFiles.length ? affectedFiles.map((f) => `\`${f}\``).join(", ") : "_nenhum declarado_"}
${dependentsBlock}- **Para liberar:** ${options.unblockHint || 'depois de ajustar, clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo de tentativas começa do zero.'}

## 3. Histórico das tentativas rejeitadas

${attemptsHistory
  .map(
    (att) => `### Tentativa ${att.attemptNumber} — ${classifyFailure(att.rejectionReason).label}
- **Data/Hora:** ${att.timestamp}
- **Escopo:** \`${att.filesScope.join(", ") || "-"}\`
- **Motivo:** ${att.rejectionReason}
`
  )
  .join("\n")}
## 4. Estado do grafo (DAG)
- Esta etapa está \`blocked\` e não será executada de novo automaticamente (nem pelo botão "Executar nó").
- Etapas que não dependem dela seguem executando normalmente.
`;
  }
}
