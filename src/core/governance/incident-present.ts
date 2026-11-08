/**
 * Texto do incidente que o painel mostra. Este arquivo entra no bundle do browser:
 * não importar prisma, fs, child_process nem o porteiro do pedido único.
 */

/** Lacunas com arquivo e linha. Re-tentar abre outro ciclo. A Spec só muda se o diagnóstico disser que o requisito não define o comportamento. */
export const SEMANTIC_HUMAN_ACTION =
  "O código compilou. A auditoria cega apontou lacunas nas linhas desta etapa. Re-tentar abre um ciclo novo e a tentativa anterior entra no pedido. A Spec permanece. Altere a Spec só quando o diagnóstico disser que o requisito não define o comportamento.";

const OLD_SEMANTIC_ACTION =
  "O código compila, mas não implementa o que a Spec pede. Revise as pendências listadas abaixo: se o requisito estiver ambíguo ou grande demais para uma etapa, detalhe-o ou divida-o na Spec Canônica antes de liberar o nó.";

/** Horário local curto, o mesmo relógio do balão do chat. */
export function formatIncidentClock(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Cabeçalho do bloco de erro: rótulo e horário, para o card mostrar copiar e o relógio. */
export function errorFenceMeta(language: string): { label: string; clock?: string } | null {
  const match = /^(?:text|erro)\b\s*(.*)$/i.exec(language.trim());
  if (!match) return null;
  const clock = match[1].trim();
  return { label: "Erro", ...(clock ? { clock } : {}) };
}

const ISO_CLOCK = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/**
 * O incidente já gravado no chat também ganha horário local, copiar em cada erro
 * e a orientação que não manda dividir a Spec.
 */
export function presentIncidentMarkdown(md: string): string {
  if (!md.includes("Relatório de Incidente")) return md;
  let out = md.replace(/\r\n/g, "\n").replace(OLD_SEMANTIC_ACTION, SEMANTIC_HUMAN_ACTION);
  if (out.includes("Requisitos do Brief não implementados") || out.includes(SEMANTIC_HUMAN_ACTION)) {
    out = out.replace(
      'depois de ajustar, clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo de tentativas começa do zero.',
      'A Spec não muda. Clique em "Desbloquear / Re-tentar Etapa" no painel da DAG — um novo ciclo começa do zero.'
    );
  }
  out = out.replace(
    /^- \*\*Data\/Hora:\*\* (.+)\n- \*\*Escopo:\*\* (.+)\n- \*\*Motivo:\*\* (.+)$/gm,
    (_all, when: string, scope: string, motivo: string) => {
      const clock = formatIncidentClock(when.trim());
      return `- **Horário:** ${clock}\n- **Escopo:** ${scope}\n\n\`\`\`erro ${clock}\n${motivo}\n\`\`\``;
    }
  );
  const registro = out.match(/\*\*Data de Registro:\*\*\s*(\S+)/);
  const registroClock = registro ? formatIncidentClock(registro[1]) : "";
  out = out.replace(ISO_CLOCK, (iso) => formatIncidentClock(iso));
  out = out.replace(/```(?:text|erro)\n/g, registroClock ? `\`\`\`erro ${registroClock}\n` : "```erro\n");
  return out;
}
