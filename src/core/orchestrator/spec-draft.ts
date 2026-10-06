import {
  parseSpecDocument,
  renderCanonicalSpecDocument,
  type SpecEntity,
  type SpecModule,
  type SpecRoute,
} from "@/core/intake/spec-format";

export const CUMULATIVE_SPEC_INSTRUCTION =
  "devolva a Spec COMPLETA atualizada; mantenha todos os módulos, entidades, rotas e arquivos existentes, a menos que o usuário peça para remover; acrescente o que o usuário pediu";

const REMOVAL_INTENT_REGEX = /remover|tirar|excluir|sem o|n[aã]o quero/i;

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
