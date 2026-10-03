/**
 * Normaliza mensagens de erro em uma assinatura estável, removendo caminhos de
 * arquivo, números de linha/coluna e outros detalhes variáveis entre execuções,
 * para que o MESMO bug seja agrupado mesmo quando aparece em tarefas, arquivos
 * ou sessões diferentes.
 */
export function buildErrorSignature(category: string, rawMessage: string): string {
  const normalized = rawMessage
    .replace(/[A-Za-z]:[\\/][^\s:]+|(?:\.{1,2}\/)?[\w-]+(?:\/[\w.-]+)*\.(tsx|ts|jsx|js|css|json)/g, "<file>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return `${category}:${normalized}`;
}
