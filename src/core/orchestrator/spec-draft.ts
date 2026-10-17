import {
  parseSpecDocument, unwrapSpecDocument,
  renderCanonicalSpecDocument,
  type SpecEntity,
  type SpecModule,
  type SpecRequirementItem,
  type SpecRoute,
} from "@/core/intake/spec-format";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";

export const CUMULATIVE_SPEC_INSTRUCTION =
  "devolva a Spec COMPLETA atualizada; mantenha todos os módulos, entidades, rotas e arquivos existentes, a menos que o usuário peça para remover; acrescente o que o usuário pediu";

// SM1 (d): remoção E troca. Antes só "remover|tirar|excluir|sem o|não quero": "Remova o REQ-001" (diário 88)
// e "troque X por Y" / "em vez de" reinjetavam o item antigo e renumeravam os REQ (teste real 16/10).
export const REMOVAL_INTENT_REGEX =
  /remov|tir(ar|e|a)\b|exclu|sem o\b|sem a\b|n[aã]o quero|troc|troq|substitu|em vez d|no lugar d|ao inv[eé]s d/i;

export interface CumulativeSpecGuardResult {
  isValidSpec: boolean;
  /** Spec canônica final para gravar em Session.canonicalSpec (sempre com status: aguardando_aprovacao). */
  finalSpec: string | null;
  /** Conteúdo final para a mensagem do assistente (com o aviso de reinjeção anexado quando reinjectedCount > 0). */
  finalMessageContent: string;
  /** Quantidade de itens (módulos + arquivos_afetados) reinjetados da versão anterior. */
  reinjectedCount: number;
}

/**
 * Monta o bloco de instrução cumulativa quando a sessão já possui um rascunho de Spec (4b.3).
 */
/**
 * Papel do chat nas fases de elicitação/revisão: escrever SÓ a Spec. O prompt geral de
 * governança manda gerar e gravar código ("patch_direto", "autonomia_disco"); usado aqui, o
 * modelo devolvia a implementação inteira dentro da Spec (sessão gateway, 06/10).
 */
export function buildSpecWriterSystemPrompt(funnelBrief?: string): string {
  const baseLines = [
    "DIRETIVA DE IDIOMA INEGOCIÁVEL: Responda OBRIGATORIAMENTE em Português do Brasil (pt-BR). É terminantemente proibido responder em inglês ou qualquer outro idioma, mesmo que o usuário ou contexto contenham trechos em inglês.",
    "Você escreve a Spec Canônica de um projeto de software no NextCode. Nesta fase NÃO se escreve código: a implementação é feita depois, pela DAG, a partir da Spec aprovada.",
    "Responda SOMENTE com o documento da Spec, neste formato exato e nada antes ou depois:",
    "---",
    'titulo: "<título>"',
    "status: aguardando_aprovacao",
    'data: "<AAAA-MM-DD>"',
    "stack:",
    '  - "<uma tecnologia por linha>"',
    "modulos:",
    "  - id: <id-curto>",
    '    nome: "<nome>"',
    '    resumo: "<o que o módulo faz, uma frase>"',
    "    arquivos:",
    '      - "<caminho/do/arquivo que implementa o módulo>"',
    "entidades:",
    "  - nome: <Entidade>",
    "    campos:",
    "      - nome: <campo>",
    "        tipo: <tipo>",
    "rotas:",
    "  - caminho: <rota>",
    '    descricao: "<para que serve>"',
    "arquivos_afetados:",
    "  - <caminho/do/arquivo.ts>",
    "requisitos:",
    "  - id: REQ-001",
    '    titulo: "<título curto do requisito>"',
    '    criterio: "<critério verificável citando o caminho do arquivo de arquivos_afetados que o implementa>"',
    "notas_implementacao:",
    '  - "<aviso técnico não óbvio>"',
    "---",
    "",
    "# <título>",
    "",
    "<1 a 2 parágrafos com o objetivo e as regras de negócio principais>",
    "",
    "Regras: listas sempre uma por linha (nunca [a, b]); nenhum bloco de código; não invente que algo já existe ou foi implementado; cubra TODO o pedido do usuário em módulos, entidades, arquivos e requisitos.",
    "IMPORTANTE: `arquivos_afetados` deve conter APENAS caminhos de arquivos concretos com extensão (ex.: src/app/api/cobrancas/route.ts). NUNCA liste nomes de pastas/diretórios (ex.: NUNCA coloque 'src/app/api').",
    "Cada módulo lista em `arquivos` os arquivos que o implementam, e todos eles aparecem em arquivos_afetados. Estado ou lógica usados por mais de um arquivo (ex.: armazenamento em memória, cliente de API, tipos) ficam num arquivo próprio em src/lib/ — nunca duplicados dentro das rotas.",
    "Toda rota HTTP declarada tem o seu arquivo. Em Next.js use o App Router: /api/tarefas → src/app/api/tarefas/route.ts; /api/tarefas/:id → src/app/api/tarefas/[id]/route.ts; páginas em src/app/<caminho>/page.tsx.",
    "A lista `requisitos` é OBRIGATÓRIA: `id` em sequência estrita (REQ-001, REQ-002…), `titulo` e `criterio` verificável que CITA explicitamente o caminho do arquivo de `arquivos_afetados` que o implementa. Todo arquivo de `arquivos_afetados` deve ser citado por pelo menos um requisito.",
    "Exemplo curto de `requisitos`:",
    "requisitos:",
    "  - id: REQ-001",
    '    titulo: "Armazenamento em memória (tarefas-store.ts)"',
    '    criterio: "src/lib/tarefas-store.ts exporta tipo Tarefa {id, titulo, concluida} e funções listar(), criar(titulo) e concluir(id)."',
    "  - id: REQ-002",
    '    titulo: "Listar e criar tarefas (route.ts)"',
    '    criterio: "src/app/api/tarefas/route.ts: GET devolve 200 com a lista; POST com titulo não vazio devolve 201, caso contrário 400."',
    "O parágrafo de objetivo após o título é obrigatório.",
    "IDIOMA: Todo o documento da Spec (título, resumos dos módulos, descrições das rotas, critérios dos requisitos, notas e objetivo) DEVE ser estritamente em Português do Brasil (pt-BR), independentemente do idioma em que a solicitação ou o prompt de contexto foi feito.",
  ];

  if (funnelBrief && funnelBrief.trim()) {
    baseLines.push("", funnelBrief.trim());
  }

  return baseLines.join("\n");
}

/** S2: skill elicitador + contrato YAML/canônico do harness (sem prompt genérico de governança). */
export function buildElicitadorSpecSystemPrompt(funnelBrief?: string): string {
  const skillBlock = buildSkillSystemPrompt(loadRoleSkill("elicitador"));
  const formatBlock = buildSpecWriterSystemPrompt(funnelBrief);
  return [
    skillBlock,
    "",
    "--- FORMATO CANÔNICO DA SPEC (contrato do harness; obedeça junto com a skill elicitador) ---",
    formatBlock,
  ].join("\n");
}

export function buildCumulativeSpecSystemPrompt(currentSpecDraft: string): string {
  return [
    "📋 [RASCUNHO ATUAL DA SPEC NO SERVIDOR — ATUALIZAÇÃO CUMULATIVA OBRIGATÓRIA]",
    `Instrução: ${CUMULATIVE_SPEC_INSTRUCTION}.`,
    "Abaixo está a Spec atual inteira:",
    "",
    currentSpecDraft.trim(),
  ].join("\n");
}

/**
 * Guarda no servidor contra perda de itens na Spec cumulativa e sobrescrita obrigatória de
 * `status: aguardando_aprovacao` (Passo 4b - 4b.3):
 * - Compara `modulos` e `arquivos_afetados` do rascunho anterior com o novo;
 * - Se o novo perdeu itens sem a mensagem do usuário pedir remoção (regex: remover|tirar|excluir|sem o|não quero),
 *   reinjeta os itens perdidos e anexa na resposta:
 *   "Mantive X itens da versão anterior que não apareceram na nova."
 * - Sempre sobrescreve `status` no YAML para `"aguardando_aprovacao"` antes de gravar.
 */
export function applyCumulativeSpecGuard(
  previousSpecRaw: string | null | undefined,
  newCandidateRaw: string,
  userMessageText: string
): CumulativeSpecGuardResult {
  // A Spec gravada é sempre o documento puro, sem o bloco ```yaml em volta.
  newCandidateRaw = unwrapSpecDocument(newCandidateRaw);
  const newParsed = parseSpecDocument(newCandidateRaw.trim());
  if (!newParsed) {
    return {
      isValidSpec: false,
      finalSpec: null,
      finalMessageContent: newCandidateRaw,
      reinjectedCount: 0,
    };
  }

  const prevParsed = previousSpecRaw ? parseSpecDocument(previousSpecRaw.trim()) : null;
  const userAskedRemoval = REMOVAL_INTENT_REGEX.test(userMessageText);

  let mergedModulos: SpecModule[] = [...newParsed.modulos];
  let mergedArquivos: string[] = [...newParsed.arquivosAfetados];
  let mergedEntidades: SpecEntity[] = [...newParsed.entidades];
  let mergedRotas: SpecRoute[] = [...newParsed.rotas];
  let mergedStack: string[] = [...newParsed.stack];
  let mergedRequisitos: SpecRequirementItem[] = [...(newParsed.requisitos ?? [])];
  let reinjectedCount = 0;

  if (prevParsed && !userAskedRemoval) {
    const lostModules: SpecModule[] = [];
    for (const prevMod of prevParsed.modulos) {
      const stillPresent = newParsed.modulos.some(
        (m) =>
          (prevMod.id && m.id && m.id.trim().toLowerCase() === prevMod.id.trim().toLowerCase()) ||
          (prevMod.nome &&
            m.nome &&
            m.nome.trim().toLowerCase() === prevMod.nome.trim().toLowerCase())
      );
      if (!stillPresent) {
        lostModules.push(prevMod);
      }
    }

    const lostFiles: string[] = [];
    for (const prevFile of prevParsed.arquivosAfetados) {
      const normalizedPrev = prevFile.trim();
      if (!normalizedPrev) continue;
      const stillPresent = newParsed.arquivosAfetados.some(
        (f) => f.trim() === normalizedPrev
      );
      if (!stillPresent) {
        lostFiles.push(normalizedPrev);
      }
    }

    reinjectedCount = lostModules.length + lostFiles.length;

    if (lostModules.length > 0) {
      mergedModulos = [...lostModules, ...newParsed.modulos];
    }
    if (lostFiles.length > 0) {
      mergedArquivos = [...lostFiles, ...newParsed.arquivosAfetados];
    }

    // Preserva requisitos da versão anterior se não apareceram na nova
    const prevReqs = prevParsed.requisitos ?? [];
    if (prevReqs.length > 0) {
      const lostReqs: SpecRequirementItem[] = [];
      for (const prevReq of prevReqs) {
        const stillPresent = (newParsed.requisitos ?? []).some(
          (r) =>
            (prevReq.titulo &&
              r.titulo &&
              r.titulo.trim().toLowerCase() === prevReq.titulo.trim().toLowerCase()) ||
            (prevReq.criterio &&
              r.criterio &&
              r.criterio.trim().toLowerCase() === prevReq.criterio.trim().toLowerCase()) ||
            (prevReq.id &&
              r.id &&
              r.id.trim().toUpperCase() === prevReq.id.trim().toUpperCase() &&
              !prevReq.titulo &&
              !prevReq.criterio)
        );
        if (!stillPresent) {
          lostReqs.push(prevReq);
        }
      }
      if (lostReqs.length > 0) {
        mergedRequisitos = [...lostReqs, ...(newParsed.requisitos ?? [])];
        const seenIds = new Set<string>();
        let hasDuplicateId = false;
        for (const r of mergedRequisitos) {
          const idUpper = r.id.trim().toUpperCase();
          if (seenIds.has(idUpper)) hasDuplicateId = true;
          seenIds.add(idUpper);
        }
        if (hasDuplicateId) {
          mergedRequisitos = mergedRequisitos.map((r, idx) => ({
            ...r,
            id: `REQ-${String(idx + 1).padStart(3, "0")}`,
          }));
        }
      }
    }

    // Preserva também entidades, rotas e stack existentes se não foram repetidos
    for (const prevEnt of prevParsed.entidades) {
      const exists = mergedEntidades.some(
        (e) => e.nome.trim().toLowerCase() === prevEnt.nome.trim().toLowerCase()
      );
      if (!exists) {
        mergedEntidades.push(prevEnt);
      }
    }
    for (const prevRota of prevParsed.rotas) {
      const exists = mergedRotas.some(
        (r) => r.caminho.trim().toLowerCase() === prevRota.caminho.trim().toLowerCase()
      );
      if (!exists) {
        mergedRotas.push(prevRota);
      }
    }
    for (const prevTech of prevParsed.stack) {
      const exists = mergedStack.some(
        (s) => s.trim().toLowerCase() === prevTech.trim().toLowerCase()
      );
      if (!exists) {
        mergedStack.push(prevTech);
      }
    }
  }

  // Correção mecânica: todo arquivo declarado num módulo entra em arquivos_afetados (a DAG nasce
  // de arquivos_afetados; um arquivo só do módulo nunca seria executado).
  for (const m of mergedModulos) {
    for (const f of m.arquivos ?? []) {
      if (!mergedArquivos.includes(f)) mergedArquivos.push(f);
    }
  }

  const finalSpec = renderCanonicalSpecDocument({
    titulo: newParsed.titulo || prevParsed?.titulo || "Especificação Técnica",
    status: "aguardando_aprovacao",
    data: newParsed.data || prevParsed?.data || new Date().toISOString().slice(0, 10),
    objetivo: newParsed.objetivo || prevParsed?.objetivo || "Especificação atualizada.",
    stack: mergedStack,
    modulos: mergedModulos,
    entidades: mergedEntidades,
    rotas: mergedRotas,
    arquivosAfetados: mergedArquivos,
    notasImplementacao: newParsed.notasImplementacao,
    requisitosIds: newParsed.requisitosIds ?? prevParsed?.requisitosIds,
    requisitos: mergedRequisitos,
  });

  const reinjectionNotice =
    reinjectedCount > 0
      ? `\n\nMantive ${reinjectedCount} itens da versão anterior que não apareceram na nova.`
      : "";

  return {
    isValidSpec: true,
    finalSpec,
    finalMessageContent: `${finalSpec}${reinjectionNotice}`,
    reinjectedCount,
  };
}
