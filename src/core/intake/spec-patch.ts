import {
  parseSpecDocument,
  renderCanonicalSpecDocument,
  type SpecFrontmatterInput,
  type SpecModule,
  type SpecRequirementItem,
  type SpecRoute,
} from "@/core/intake/spec-format";

/**
 * TR1 (7) / mudança 7 (aprovada 16/10): correção da Spec POR TRECHO. Antes cada ajuste fazia o Opus
 * reescrever a Spec inteira (teste real: 18–19 mil tokens de saída, US$ 0,47 por correção de 1 linha; a
 * Spec do Gateway ocupava 84% do teto). Agora, com Spec existente, o elicitador devolve só o que muda num
 * bloco ```json patch_spec```; o código aplica por âncora (id do REQ, caminho, nome) e toda a conferência
 * (guarda cumulativa, SM1, J11, J8) roda sobre a Spec inteira resultante. Âncora não achada → nada é
 * aplicado e o usuário vê o motivo (nunca reescrita calada).
 */
export interface SpecPatch {
  requisitos?: {
    alterar?: Array<Partial<SpecRequirementItem> & { id: string }>;
    incluir?: Array<Omit<SpecRequirementItem, "id"> & { id?: string }>;
    remover?: string[];
  };
  arquivos_afetados?: { incluir?: string[]; remover?: string[] };
  notas_implementacao?: { incluir?: string[]; remover?: string[] };
  modulos?: { incluir?: Array<Omit<SpecModule, "id"> & { id?: string }>; alterar?: Array<Partial<SpecModule> & { nome: string }>; remover?: string[] };
  rotas?: { incluir?: SpecRoute[]; remover?: string[] };
  /** 1 a 3 frases ao usuário dizendo o que mudou. */
  resposta?: string;
}

export function extractSpecPatch(text: string): SpecPatch | null {
  const m = /```(?:json)?\s*patch_spec\s*\n([\s\S]*?)```/i.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as SpecPatch) : null;
  } catch {
    return null;
  }
}

export interface SpecPatchResult {
  ok: boolean;
  spec?: string;
  erros: string[];
  /** O que foi aplicado, em linguagem simples (vai para o chat). */
  resumo: string[];
}

const reqNum = (id: string) => Number(/REQ-(\d+)/.exec(id)?.[1] ?? NaN);

export function applySpecPatch(previousSpecRaw: string, patch: SpecPatch): SpecPatchResult {
  const prev = parseSpecDocument(previousSpecRaw);
  if (!prev) return { ok: false, erros: ["a Spec atual não pôde ser lida"], resumo: [] };
  const erros: string[] = [];
  const resumo: string[] = [];
  const reqs: SpecRequirementItem[] = (prev.requisitos ?? []).map((r) => ({ ...r }));
  let arquivos = [...prev.arquivosAfetados];
  let notas = [...prev.notasImplementacao];
  let modulos: SpecModule[] = prev.modulos.map((m) => ({ ...m, arquivos: [...(m.arquivos ?? [])] }));
  let rotas: SpecRoute[] = prev.rotas.map((r) => ({ ...r }));

  for (const a of patch.requisitos?.alterar ?? []) {
    const r = reqs.find((x) => x.id === a.id);
    if (!r) {
      erros.push(`${a.id} não existe na Spec (alterar)`);
      continue;
    }
    if (a.titulo) r.titulo = a.titulo;
    if (a.criterio) r.criterio = a.criterio;
    if (a.origem) r.origem = a.origem;
    resumo.push(`alterado ${a.id}`);
  }
  for (const id of patch.requisitos?.remover ?? []) {
    const i = reqs.findIndex((x) => x.id === id);
    if (i < 0) erros.push(`${id} não existe na Spec (remover)`);
    else {
      reqs.splice(i, 1);
      resumo.push(`removido ${id}`);
    }
  }
  let proximo = Math.max(0, ...reqs.map((r) => reqNum(r.id)).filter((n) => !Number.isNaN(n))) + 1;
  for (const n of patch.requisitos?.incluir ?? []) {
    if (!n.titulo || !n.criterio) {
      erros.push(`REQ novo sem titulo ou criterio`);
      continue;
    }
    // O número é do harness (sequência sem buraco nem repetição), não do modelo.
    const id = `REQ-${String(proximo++).padStart(3, "0")}`;
    reqs.push({ id, titulo: n.titulo, criterio: n.criterio, ...(n.origem ? { origem: n.origem } : {}) });
    resumo.push(`incluído ${id}`);
  }

  const lista = (atual: string[], op: { incluir?: string[]; remover?: string[] } | undefined, nome: string) => {
    let out = [...atual];
    for (const r of op?.remover ?? []) {
      if (!out.includes(r)) erros.push(`${nome}: "${r}" não existe (remover)`);
      else {
        out = out.filter((x) => x !== r);
        resumo.push(`${nome}: tirado ${r}`);
      }
    }
    for (const i of op?.incluir ?? []) {
      if (!out.includes(i)) {
        out.push(i);
        resumo.push(`${nome}: incluído ${i}`);
      }
    }
    return out;
  };
  arquivos = lista(arquivos, patch.arquivos_afetados, "arquivo");
  notas = lista(notas, patch.notas_implementacao, "nota");

  for (const nome of patch.modulos?.remover ?? []) {
    if (!modulos.some((m) => m.nome === nome)) erros.push(`módulo "${nome}" não existe (remover)`);
    modulos = modulos.filter((m) => m.nome !== nome);
  }
  for (const a of patch.modulos?.alterar ?? []) {
    const m = modulos.find((x) => x.nome === a.nome);
    if (!m) {
      erros.push(`módulo "${a.nome}" não existe (alterar)`);
      continue;
    }
    if (a.resumo) m.resumo = a.resumo;
    if (a.arquivos) m.arquivos = a.arquivos;
    resumo.push(`módulo alterado: ${a.nome}`);
  }
  for (const n of patch.modulos?.incluir ?? []) {
    if (modulos.some((m) => m.nome === n.nome)) continue;
    modulos.push({ id: n.id || n.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-"), nome: n.nome, resumo: n.resumo, arquivos: n.arquivos ?? [] });
    resumo.push(`módulo incluído: ${n.nome}`);
  }
  for (const c of patch.rotas?.remover ?? []) {
    if (!rotas.some((r) => r.caminho === c)) erros.push(`rota "${c}" não existe (remover)`);
    rotas = rotas.filter((r) => r.caminho !== c);
  }
  for (const r of patch.rotas?.incluir ?? []) {
    if (!rotas.some((x) => x.caminho === r.caminho)) rotas.push(r);
  }

  if (erros.length > 0) return { ok: false, erros, resumo: [] };
  if (resumo.length === 0) return { ok: false, erros: ["o trecho não muda nada na Spec"], resumo: [] };
  const input: SpecFrontmatterInput = {
    titulo: prev.titulo ?? "",
    status: "aguardando_aprovacao",
    data: prev.data ?? new Date().toISOString().slice(0, 10),
    objetivo: prev.objetivo,
    stack: prev.stack,
    modulos,
    entidades: prev.entidades,
    arquivosAfetados: arquivos,
    rotas,
    notasImplementacao: notas,
    requisitosIds: reqs.map((r) => r.id),
    requisitos: reqs,
  };
  return { ok: true, spec: renderCanonicalSpecDocument(input), erros: [], resumo };
}

/** Instrução da correção por trecho (vai no lugar da reescrita cumulativa quando já existe Spec). */
export function buildPatchSpecSystemPrompt(currentSpec: string): string {
  return [
    "📋 [SPEC ATUAL NO SERVIDOR — CORREÇÃO POR TRECHO]",
    "Já existe uma Spec (abaixo). NÃO a reescreva. Responda com 1 a 3 frases ao usuário e UM bloco ```json patch_spec``` só com o que muda:",
    '```json patch_spec\n{"requisitos":{"alterar":[{"id":"REQ-003","criterio":"..."}],"incluir":[{"titulo":"...","criterio":"<cita o arquivo>","origem":"<trecho do pedido | premissa: ...>"}],"remover":["REQ-010"]},' +
      '"arquivos_afetados":{"incluir":["src/..."],"remover":[]},"notas_implementacao":{"incluir":["Premissa: ..."],"remover":[]},' +
      '"modulos":{"incluir":[{"nome":"...","resumo":"...","arquivos":["src/..."]}],"alterar":[{"nome":"...","arquivos":["..."]}],"remover":[]},' +
      '"rotas":{"incluir":[{"caminho":"/api/x","descricao":"..."}],"remover":[]},"resposta":"o que mudou, em 1 frase"}\n```',
    "Use os ids e nomes EXATOS da Spec atual para alterar/remover; o número de REQ novo é dado pelo harness. Arquivo novo precisa estar num módulo e citado por um REQ.",
    "Só se o usuário pedir uma Spec totalmente diferente, devolva a Spec inteira no formato canônico em vez do bloco.",
    "",
    currentSpec.trim(),
  ].join("\n");
}
