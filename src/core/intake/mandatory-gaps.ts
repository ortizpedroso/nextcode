import { askJevBatch, type JevQuestionSpec, type JevBatchAnswer } from "@/core/decision/jev";
import type { IntakeFunnelResult } from "@/core/intake/universal-funnel";
import type { SpecRequirementItem } from "@/core/intake/spec-format";

/**
 * J8 (E2, mudança 44): lacunas obrigatórias. O funil M0 diz QUE o projeto mexe com pagamento, login,
 * comunicação, API pública ou vários clientes; aqui se confere, item a item, se a Spec COBRE o que isso
 * exige. Palavra-chave primeiro (de graça); o que não for achado vai ao Jev em UMA chamada com perguntas
 * atômicas (pergunta estreita separa; pergunta larga não — J1, `medicoes.md` 15/10). O que faltar aparece
 * para o usuário na revisão (sem 2ª chamada escondida ao modelo; a aprovação é dele, T2).
 */
export interface MandatoryItem {
  id: string;
  categoria: string;
  descricao: string;
  /** Qualquer uma no texto dos REQ (sem acento) → coberto sem perguntar ao Jev. */
  chaves: RegExp;
}

const ITENS: Array<MandatoryItem & { quando: (f: IntakeFunnelResult) => boolean }> = [
  { id: "valor_centavos", categoria: "pagamento", descricao: "valores de dinheiro guardados como inteiros (centavos), sem ponto flutuante", chaves: /centavo|inteiro/, quando: (f) => f.hasFinancialPayments },
  { id: "webhook_idempotente", categoria: "pagamento", descricao: "notificação (webhook) do provedor de pagamento processada uma vez só, mesmo se chegar repetida", chaves: /idempot|ja processad|reprocess|duplicad/, quando: (f) => f.hasFinancialPayments },
  { id: "webhook_autenticado", categoria: "pagamento", descricao: "webhook só aceito com o token/assinatura do provedor", chaves: /webhook[^.]{0,120}(token|assinatura|401)|(token|assinatura)[^.]{0,120}webhook/, quando: (f) => f.hasFinancialPayments },
  { id: "estorno", categoria: "pagamento", descricao: "estorno, reembolso ou chargeback e o status que a cobrança assume", chaves: /estorn|reembols|chargeback/, quando: (f) => f.hasFinancialPayments },
  { id: "login", categoria: "acesso", descricao: "como o usuário entra (login) e sai, e o que acontece sem sessão", chaves: /login|entrar|sessao/, quando: (f) => f.hasAuth },
  { id: "senha_hash", categoria: "acesso", descricao: "senha guardada só como hash (nunca em texto)", chaves: /hash|bcrypt|argon|scrypt/, quando: (f) => f.hasAuth },
  { id: "permissao", categoria: "acesso", descricao: "quem pode ver e fazer o quê (papéis/permissões) e a resposta quando não pode (401/403)", chaves: /papel|perfil|permiss|admin|403/,
    // Medido 22/10 (P3, login simples): com um tipo só de usuário, "sem sessão → 401" já está no item de login.
    quando: (f) => f.hasAuth && f.userModel !== "authenticated_users" && f.userModel !== "public_open" },
  { id: "isolamento_tenant", categoria: "vários clientes", descricao: "isolamento entre clientes: um cliente nunca vê nem altera dado de outro", chaves: /tenant|isolad|outro lojista|outra organiza|pertencer ao|do lojista da sessao/, quando: (f) => f.userModel === "multi_tenant_saas" || f.hasWhitelabel },
  { id: "falha_envio", categoria: "comunicação", descricao: "o que acontece quando o envio de e-mail/WhatsApp/SMS falha (registro, nova tentativa)", chaves: /falha[^.]{0,80}(envio|notifica)|retentativ|tentar novamente|erro[^.]{0,40}notifica/, quando: (f) => f.hasExternalComms },
  { id: "api_chave", categoria: "API pública", descricao: "como a API pública autentica quem chama (chave) e a resposta sem chave", chaves: /chave de api|api key|x-api-key|bearer/, quando: (f) => f.hasPublicApi },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface MandatoryGapResult {
  aplicaveis: string[];
  cobertosPorChave: string[];
  cobertosPeloJev: string[];
  faltando: MandatoryItem[];
  /** Jev fora: os não achados por chave ficam como "não confirmado" (aviso), nunca como coberto. */
  jevDisponivel: boolean;
}

type JevAsk = typeof askJevBatch;

export async function checkMandatoryGaps(params: {
  funnel: IntakeFunnelResult;
  requisitos: SpecRequirementItem[];
  notas?: string[];
  sessionId?: string | null;
  ask?: JevAsk;
}): Promise<MandatoryGapResult> {
  const aplicaveis = ITENS.filter((i) => i.quando(params.funnel));
  const texto = norm([...params.requisitos.map((r) => `${r.titulo}. ${r.criterio}`), ...(params.notas ?? [])].join("\n"));
  const porChave = aplicaveis.filter((i) => i.chaves.test(texto));
  const resto = aplicaveis.filter((i) => !porChave.includes(i));
  const out: MandatoryGapResult = {
    aplicaveis: aplicaveis.map((i) => i.id),
    cobertosPorChave: porChave.map((i) => i.id),
    cobertosPeloJev: [],
    faltando: [],
    jevDisponivel: true,
  };
  if (resto.length === 0) return out;

  const state = JSON.stringify({
    requisitos: params.requisitos.map((r) => ({ id: r.id, titulo: r.titulo, criterio: r.criterio.slice(0, 400) })),
    notas: (params.notas ?? []).slice(0, 30),
  }).slice(0, 22_000);
  const questions: Record<string, JevQuestionSpec> = Object.fromEntries(
    resto.map((i) => [
      i.id,
      {
        type: "noul",
        instructions: `Does the specification in \`requisitos\`/\`notas\` explicitly cover this rule: ${i.descricao}? Answer true only if some requirement or note states the behavior.`,
      } as JevQuestionSpec,
    ])
  );
  const answers: Record<string, JevBatchAnswer> | null = await (params.ask ?? askJevBatch)({
    purpose: "j8_lacunas_obrigatorias",
    state,
    questions,
    sessionId: params.sessionId,
  }).catch(() => null);
  if (!answers) {
    out.jevDisponivel = false;
    out.faltando = resto.map(({ quando: _q, ...i }) => i);
    return out;
  }
  for (const i of resto) {
    const a = answers[i.id];
    const coberto = a?.type === "noul" && a.noul >= 0.5;
    if (coberto) out.cobertosPeloJev.push(i.id);
    else out.faltando.push({ id: i.id, categoria: i.categoria, descricao: i.descricao, chaves: i.chaves });
  }
  return out;
}

export function renderMandatoryGapsNotice(r: MandatoryGapResult): string {
  if (r.faltando.length === 0) return "";
  return (
    `\n\n⚠️ **Regras que projetos assim costumam precisar e a Spec não diz** (J8${r.jevDisponivel ? "" : " — Jev fora, não confirmado"}). ` +
    "Responda como quer cada uma, ou diga \"pode decidir\" para eu registrar o padrão mais seguro como premissa:\n" +
    r.faltando.map((i) => `- **${i.categoria}:** ${i.descricao}`).join("\n")
  );
}
