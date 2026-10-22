import type { SpecRequirementItem } from "@/core/intake/spec-format";

/**
 * J11 (E2, mudança 44): cada REQ vem do que o usuário pediu — nenhum inventado. Conferência mecânica, sem
 * LLM e sem mandar a conversa para fora: o `origem` do REQ é um trecho literal do pedido (procurado na
 * conversa, sem acento/pontuação/caixa), uma premissa declarada do elicitador ou derivado de outro REQ.
 */
export type ReqOriginStatus = "rastreado" | "premissa" | "derivado" | "nao_encontrado" | "sem_origem";

export interface ReqOriginResult {
  id: string;
  status: ReqOriginStatus;
  origem?: string;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function checkReqOrigins(reqs: SpecRequirementItem[], conversaDoUsuario: string): ReqOriginResult[] {
  const conversa = ` ${norm(conversaDoUsuario)} `;
  const palavras = new Set(conversa.split(" ").filter(Boolean));
  const ids = new Set(reqs.map((r) => r.id));
  return reqs.map((r) => {
    const origem = r.origem?.trim();
    if (!origem) return { id: r.id, status: "sem_origem" };
    if (/^premissa\s*:/i.test(origem)) return { id: r.id, status: "premissa", origem };
    const derivado = /^derivad[oa]\s*:\s*(REQ-\d+)/i.exec(origem);
    if (derivado) return { id: r.id, status: ids.has(derivado[1].toUpperCase()) ? "derivado" : "nao_encontrado", origem };
    const alvo = norm(origem.replace(/^["“']|["”']$/g, ""));
    if (alvo && conversa.includes(` ${alvo} `)) return { id: r.id, status: "rastreado", origem };
    // Tolerância para a paráfrase mínima (plural, artigo): ≥ 85% das palavras de 3+ letras estão no pedido.
    const tokens = alvo.split(" ").filter((t) => t.length >= 3);
    const achadas = tokens.filter((t) => palavras.has(t)).length;
    if (tokens.length >= 3 && achadas / tokens.length >= 0.85) return { id: r.id, status: "rastreado", origem };
    return { id: r.id, status: "nao_encontrado", origem };
  });
}

/** Aviso na revisão da Spec: o usuário vê o que não veio do pedido dele (e as premissas, para trocar se quiser). */
export function renderReqOriginNotice(resultados: ReqOriginResult[]): string {
  if (resultados.length === 0) return "";
  const suspeitos = resultados.filter((r) => r.status === "nao_encontrado" || r.status === "sem_origem");
  const premissas = resultados.filter((r) => r.status === "premissa");
  // Spec antiga ou elicitador sem o campo em nenhum REQ: nada a afirmar (não é invenção, é formato antigo).
  if (resultados.every((r) => r.status === "sem_origem")) return "";
  const linhas: string[] = [];
  if (suspeitos.length > 0) {
    linhas.push(
      `\n\n🔎 **Requisitos sem origem no seu pedido** (J11 — confira se você quer cada um; se não, peça para tirar): ` +
        suspeitos.map((r) => `${r.id}${r.origem ? ` ("${r.origem.slice(0, 80)}")` : ""}`).join(", ")
    );
  }
  if (premissas.length > 0) {
    linhas.push(`\n\n📝 **Premissas do elicitador** (decididas sem resposta sua; troque na revisão se quiser): ${premissas.map((r) => `${r.id} — ${r.origem!.replace(/^premissa\s*:\s*/i, "").slice(0, 120)}`).join("; ")}`);
  }
  return linhas.join("");
}
