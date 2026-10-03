/**
 * Approval Intent (NextCode v5 - Trava T1)
 * Detecta, no texto livre do chat, (a) aprovação explícita da Spec Canônica e (b) pedido de
 * nova Spec. Antes era `includes()` de substring: "não vou aprovar" ou "o que acontece se eu
 * aprovar?" liberavam a trava, e "aspecto"/"especial"/"respectivo" (contêm "spec") a
 * re-travavam. Agora: palavra inteira, negação próxima anula, e pergunta não é aprovação.
 */

const APPROVAL_RE =
  /\b(aprovo|aprovada|aprovado|aprovar|aprova a spec|validar e aprovar|iniciar (?:a )?dag|pode rodar|pode executar)\b/;

// "não"/"nunca"/"jamais" até ~4 palavras antes do termo de aprovação.
const NEGATED_APPROVAL_RE =
  /\b(?:n[aã]o|nunca|jamais|nem)\b(?:\s+\S+){0,4}?\s+(?:aprov\w*|iniciar|pode\s+(?:rodar|executar))/;

const NEW_SPEC_RE = /\b(?:specs?|nova spec|quero criar|crie um|crie uma|montar um|montar uma|reescreva)\b/;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** true só para aprovação afirmativa: termo de aprovação, sem negação próxima e sem ser pergunta. */
export function isExplicitSpecApproval(text: string): boolean {
  const t = normalize(text);
  if (!APPROVAL_RE.test(t)) return false;
  if (NEGATED_APPROVAL_RE.test(t)) return false;
  if (t.includes("?")) return false;
  return true;
}

/** true quando o texto pede uma Spec nova/reescrita (palavra inteira, não substring). */
export function isNewSpecRequest(text: string): boolean {
  return NEW_SPEC_RE.test(normalize(text));
}
