import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { SmartRouter, type DispatchMessage } from "@/core/router/smart-router";
import { askJevChoice } from "@/core/decision/jev";
import type {
  InterventionChoice,
  MessageIntention,
  Phase,
} from "@/core/orchestrator/phase-machine";

const VALID_INTENTIONS: ReadonlySet<MessageIntention> = new Set<MessageIntention>([
  "criar_novo",
  "corrigir_existente",
  "incerto",
  "duvida_avulsa",
  "mudanca_durante_execucao",
  "status",
]);

const CLASSIFIER_TIMEOUT_MS = 3000;
const JEV_MIN_CONFIDENCE = Number(process.env.JEV_MIN_CONFIDENCE) || 0.6;
const JEV_BUDGET_MS = 1500;

/**
 * Detecta deterministamente se o texto é um pedido de status/progresso da sessão.
 */
export function isStatusRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Evita classificar uma Spec YAML inteira colada pelo usuário como pedido de status
  if (trimmed.startsWith("---")) return false;

  const normalized = trimmed.toLowerCase();

  // Palavra única ou comando curto de status/andamento/progresso
  if (/^\/?(status|andamento|progresso)\s*\??$/i.test(normalized)) {
    return true;
  }

  // Expressões inequívocas de consulta de progresso/status/conclusão
  if (
    /\b(qual\s+(o\s+|é\s+o\s+)?status|como\s+est[aá]\s+(o\s+)?(status|andamento|progresso|a\s+execu[cç][aã]o)|ver\s+(o\s+)?status|mostrar\s+(o\s+)?status|me\s+d[êe]\s+o\s+status)\b/i.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    /\b(andamento|o\s+que\s+falta(\s+implementar|\s+fazer|\s+entregar)?|(foi|foram)\s+conclu[ií]d[oa]s?|j[aá]\s+(terminou|terminaram|acabou|concluiu)|terminou|terminaram)\b/i.test(
      normalized
    )
  ) {
    return true;
  }

  // Se contém "status" em uma pergunta curta sem ser "campo status" / "coluna status" / "propriedade status"
  if (
    /\bstatus\b/i.test(normalized) &&
    !/\b(campo|coluna|propriedade|atributo|enum|tabela)\s+status\b/i.test(normalized) &&
    (normalized.endsWith("?") || normalized.split(/\s+/).length <= 8)
  ) {
    return true;
  }

  return false;
}

/**
 * Regras determinísticas de intenção (executadas ANTES de qualquer chamada ao LLM).
 * Retorna null apenas quando a mensagem é genuinamente ambígua e precisa do classificador fast (<= 3000 ms).
 */
export function classifyMessageDeterministic(
  text: string,
  phase: Phase
): MessageIntention | null {
  const trimmed = text.trim();
  if (!trimmed) return "incerto";

  // 1. Pedido de status/progresso em qualquer fase -> 'status'
  if (isStatusRequest(trimmed)) {
    return "status";
  }

  const isQuestion = trimmed.endsWith("?");

  // 2. Dúvida avulsa explícita (pergunta conceitual / explicação / detalhamento)
  if (
    isQuestion &&
    /^(pode\s+(detalhar|explicar|me\s+explicar)|como\s+(funciona|ser[aá]|posso|fa[cç]o)|o\s+que\s+[eé]|qual\s+(a\s+diferen[cç]a|[eé]\s+a\s+fun[cç][aã]o|o\s+papel)|quais\s+s[aã]o|por\s+que|me\s+explica|explica\b|onde\s+fica)/i.test(
      trimmed
    )
  ) {
    return "duvida_avulsa";
  }

  // 3. Durante EXECUCAO (ou BLOQUEADA), pedido de alteração/adição/remoção -> 'mudanca_durante_execucao'
  if (phase === "EXECUCAO" || phase === "BLOQUEADA") {
    if (isQuestion) {
      return "duvida_avulsa";
    }
    if (
      /\b(adicionar|adicione|acrescentar|acrescente|incluir|inclua|mudar|mude|alterar|altere|ajustar|ajuste|trocar|troque|remover|remova|tirar|tire|excluir|exclua|modificar|modifique|atualizar|atualize|criar|crie|implementar|implemente|quero\s+que|preciso\s+que|agora\s+fa[cç]a|tamb[eé]m\s+quero|novo\s+m[oó]dulo|nova\s+rota|novo\s+campo|nova\s+p[aá]gina|nova\s+entidade)\b/i.test(
        trimmed
      )
    ) {
      return "mudanca_durante_execucao";
    }
  }

  // 4. Pedido claro de correção de bug/erro existente
  if (
    !isQuestion &&
    /\b(corrigir|corrija|consertar|conserte|arrumar|arrume|resolver\s+(o\s+)?(bug|erro|problema|defeito)|est[aá]\s+(com\s+erro|quebrado|falhando|dando\s+erro)|fix\s+bug|bug\s+no|erro\s+ao)\b/i.test(
      trimmed
    )
  ) {
    return "corrigir_existente";
  }

  // 5. Pedido claro de criação / implementação / ajuste de Spec
  if (
    !isQuestion &&
    (/^\/(autonomo|plan|goal)\b/i.test(trimmed) ||
      /\b(criar|crie|implementar|implemente|desenvolver|desenvolva|construir|construa|gerar|gere|fazer\s+(um|uma)|fa[cç]a\s+(um|uma)|adicionar|adicione|acrescentar|acrescente|incluir|inclua|remover|remova|tirar|tire|excluir|exclua|alterar|altere|ajustar|ajuste|mudar|mude|atualizar|atualize|quero\s+(um|uma|que|adicionar|criar|incluir|um\s+sistema)|preciso\s+de\s+(um|uma)|m[oó]dulo\s+de|sistema\s+de|api\s+de|p[aá]gina\s+de|cadastro\s+de|crud\s+de)\b/i.test(
        trimmed
      ))
  ) {
    return "criar_novo";
  }

  // 6. Pergunta sem verbo de mudança ("o que o zod faz em nosso projeto?") é dúvida avulsa.
  // Sem esta regra ela ia ao LLM, que costuma passar dos 3 s → 'incerto' → em SPEC_REVISAO
  // virava pedido de ajuste e a sessão voltava para ELICITACAO (visto com o FreeLLMAPI real).
  if (
    isQuestion &&
    !/\b(adicion|acrescent|inclu|remov|tir[ae]|exclu|alter|ajust|mud[ae]|troc|modific|atualiz|cri[ae]|implement|desenvolv|constru|ger[ae]|corrig|consert|arrum)\w*/i.test(
      trimmed
    )
  ) {
    return "duvida_avulsa";
  }

  return null;
}

/**
 * Extrai a escolha do usuário na fase INTERVENCAO por regex (criar / corrigir / conversar).
 * TODO(passo-6): adicionar botões dedicados de escolha de intervenção na interface.
 */
export function parseInterventionChoice(text: string): InterventionChoice | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  if (/\b(criar|novo|nova|construir|implementar|1)\b/i.test(trimmed)) {
    return "criar";
  }
  if (/\b(corrigir|corre[cç][aã]o|consertar|bug|erro|2)\b/i.test(trimmed)) {
    return "corrigir";
  }
  if (/\b(conversar|conversa|d[uú]vida|explicar|perguntar|3)\b/i.test(trimmed)) {
    return "conversar";
  }
  return null;
}

/**
 * Classifica a mensagem do usuário para a máquina de fases:
 * 1. Regras determinísticas PRIMEIRO, sem LLM (0 chamadas de rede).
 * 2. Só se as regras não decidirem: UMA chamada ao tier "fast" com resposta JSON
 *    {"intencao": "..."} e timeout estrito de 3000 ms. Timeout, erro ou JSON inválido -> 'incerto'.
 */
export async function classifyMessage(
  text: string,
  phase: Phase,
  sessionId?: string | null
): Promise<MessageIntention> {
  const deterministic = classifyMessageDeterministic(text, phase);
  if (deterministic !== null) {
    return deterministic;
  }

  // 2. Jev (motor de decisão): pergunta tipada, ~0,3-0,7 s, com confiança. Abaixo do limiar ou
  // indisponível → classificador LLM como reserva. O teto total da classificação continua sendo
  // CLASSIFIER_TIMEOUT_MS: o Jev usa no máximo JEV_BUDGET_MS e a reserva fica com o restante.
  const startedAt = Date.now();
  const jev = await askJevChoice<MessageIntention>({
    signal: AbortSignal.timeout(JEV_BUDGET_MS),
    purpose: "classificacao_mensagem",
    sessionId,
    state: `Fase da sessão no NextCode: ${phase}.
Mensagem do usuário: """${text.slice(0, 2000)}"""`,
    instructions: "Qual é a intenção desta mensagem do usuário em relação ao projeto de software?",
    criteria: {
      criar_novo: "pede para criar um software novo ou acrescentar/alterar requisitos do que está sendo especificado",
      corrigir_existente: "relata um erro ou bug e pede correção em algo que já existe",
      duvida_avulsa: "faz uma pergunta ou pede explicação, sem pedir mudança no projeto",
      mudanca_durante_execucao: "pede para mudar o projeto enquanto ele já está sendo implementado",
      status: "pergunta pelo andamento, progresso ou o que falta",
      incerto: "não dá para saber o que a pessoa quer",
    },
  });
  if (jev && jev.confidence >= JEV_MIN_CONFIDENCE) {
    return jev.choice;
  }
  const remainingMs = Math.max(500, CLASSIFIER_TIMEOUT_MS - (Date.now() - startedAt));

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<MessageIntention>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve("incerto");
    }, remainingMs);
  });

  const llmPromise = (async (): Promise<MessageIntention> => {
    try {
      const setting = await prisma.setting
        .findUnique({ where: { id: "default" } })
        .catch(() => null);

      const classifierMessages: DispatchMessage[] = [
        {
          role: "system",
          content:
            `Você classifica a intenção da mensagem do usuário na fase "${phase}" do NextCode. ` +
            "Responda SOMENTE com um JSON válido de uma linha no formato exato: " +
            '{"intencao":"criar_novo"|"corrigir_existente"|"duvida_avulsa"|"mudanca_durante_execucao"|"status"|"incerto"}.',
        },
        {
          role: "user",
          content: text.slice(0, 2000),
        },
      ];

      const smartRouter = new SmartRouter();
      const dispatchRes = await smartRouter.dispatchWithFallback({
        messages: classifierMessages,
        tier: "fast",
        geminiKey: readSecret(setting?.geminiKey),
        groqKey: readSecret((setting as any)?.groqKey),
        nvidiaKey: readSecret((setting as any)?.nvidiaKey),
        deepseekKey: readSecret((setting as any)?.deepseekKey),
        omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
        omniRouteKey: readSecret(setting?.omniRouteKey),
        stream: false,
        signal: controller.signal,
      });

      const json = await dispatchRes.response.json().catch(() => null);
      const raw: string =
        json?.choices?.[0]?.message?.content ??
        json?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";

      const match = raw.match(/\{[^{}]*"intencao"\s*:\s*"([^"]+)"[^{}]*\}/i);
      if (!match) return "incerto";
      const parsed = JSON.parse(match[0]);
      const candidate = String(parsed.intencao || "").trim() as MessageIntention;
      if (VALID_INTENTIONS.has(candidate)) {
        return candidate;
      }
      return "incerto";
    } catch {
      return "incerto";
    }
  })();

  try {
    return await Promise.race([llmPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
