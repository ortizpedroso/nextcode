/**
 * 3. O chat não publica o raciocínio interno.
 * Devolve content quando for string não vazia depois do trim.
 * Caso contrário devolve null, mesmo que reasoning_content tenha texto.
 */
export function textoVisivelDaResposta(
  message: { content?: unknown; reasoning_content?: unknown } | null | undefined
): string | null {
  if (!message) return null;
  if (typeof message.content === "string") {
    const trimmed = message.content.trim();
    if (trimmed !== "") {
      return message.content;
    }
  }
  return null;
}
