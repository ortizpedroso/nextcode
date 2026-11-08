/**
 * Porteiro do microbrief antes do executor (ideia de arquivo exato + consome/produz).
 * Separado do pedido único: aqui o critério nomeia arquivo ou símbolo produzido;
 * campos de retorno continuam em pedido-unico.ts. Não há escolha humana.
 */

import { extractFilePathsFromText } from "@/core/shared/file-path-extractor";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";

const VERBO_PRODUZ =
  /\b(?:export(?:a|ar)?|produz(?:ir)?|implement(?:a|ar)|fun[cç][aã]o|function|interface|m[eé]todo)\b/gi;

const CONSOME_ANTES = /\b(?:usa|usar|consome|consumir|chama|chamar|importa|importar)\b/i;

const PALAVRA_IGNORADA = new Set([
  "promise",
  "string",
  "number",
  "boolean",
  "void",
  "null",
  "undefined",
  "true",
  "false",
  "input",
  "inputs",
  "output",
  "params",
  "options",
  "props",
  "args",
  "record",
  "array",
  "partial",
  "required",
  "unknown",
  "any",
  "object",
  "never",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "um",
  "uma",
  "o",
  "a",
  "e",
  "ou",
  "que",
  "para",
  "com",
  "sem",
  "por",
  "se",
  "ao",
  "aos",
  "as",
]);

export interface VerificacaoEscopoMicrobrief {
  coerente: boolean;
  semArquivoDeEscrita: boolean;
  arquivosCitadosNoCriterio: string[];
  arquivosForaDoMicrobrief: string[];
  simbolosCitadosNoCriterio: string[];
  simbolosForaDoMicrobrief: string[];
}

export interface EscopoMicrobriefMarca {
  incompleto: true;
  arquivosFora: string[];
  simbolosFora: string[];
  semArquivoDeEscrita: boolean;
}

function normalizarArquivo(caminho: string): string {
  return String(caminho || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

function textosDoCriterio(criterios: MicrobriefAndReportDocument["criteriosAceitePorReq"] | null | undefined): string[] {
  if (!criterios) return [];
  const textos: string[] = [];
  for (const valor of Object.values(criterios)) {
    for (const item of valor) {
      if (item.trim()) textos.push(item.trim());
    }
  }
  return textos;
}

function arquivoListado(citado: string, declarados: string[]): boolean {
  const alvo = normalizarArquivo(citado).toLowerCase();
  if (!alvo) return false;
  return declarados.some((declarado) => {
    const nome = normalizarArquivo(declarado).toLowerCase();
    return nome === alvo || nome.endsWith(`/${alvo}`);
  });
}

function escapeRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function simboloListado(simbolo: string, contrato: string): boolean {
  if (!simbolo || !contrato) return false;
  const formas = new Set<string>([simbolo]);
  if (simbolo.length > 1) {
    formas.add(`Fn${simbolo[0].toUpperCase()}${simbolo.slice(1)}`);
  }
  if (/^Fn[A-Z]/.test(simbolo) && simbolo.length > 2) {
    formas.add(simbolo[2].toLowerCase() + simbolo.slice(3));
  }
  for (const forma of formas) {
    if (new RegExp(`\\b${escapeRegExp(forma)}\\b`).test(contrato)) return true;
  }
  return false;
}

function clausulaDepoisDoVerbo(texto: string, indice: number, tamanhoVerbo: number): string {
  const resto = texto.slice(indice + tamanhoVerbo, indice + tamanhoVerbo + 200);
  return resto.split(/[.\n]/)[0] ?? "";
}

const LIMITE_DO_SIMBOLO =
  /\b(?:que\s+devolve|que\s+retorna|devolve|retorna|retornar|persiste|persistir)\b/i;

function semGrupos(texto: string): string {
  let fora = "";
  let depth = 0;
  for (const ch of texto) {
    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) fora += ch;
  }
  return fora;
}

function nomeDeTipoOuFuncao(nome: string): boolean {
  return /[A-Z]/.test(nome) && /[a-z]/.test(nome);
}

/** Nome colado em de, do, da ou via é o tipo ou o meio, não o que a etapa exporta. */
function nomeDepoisDeTipoOuMeio(texto: string, indice: number): boolean {
  const antes = texto.slice(Math.max(0, indice - 12), indice);
  return /\b(?:de|do|da|dos|das|via)\s+$/i.test(antes);
}

/**
 * O verbo introduz o que a etapa produz: chamada, nome entre crases, ou nome de tipo ou função.
 * Parâmetro e campo dentro de () ou {} ficam de fora. Sigla só em maiúsculas também.
 * Depois de devolve, retorna ou persiste o texto descreve o resultado, não outra exportação.
 * Nome depois de de, do, da ou via é o tipo ou o meio. Se houve um, não se inventa símbolo com o resto da frase.
 * Se não houver nenhum desses nomes, vale o primeiro identificador, para não perder exporta recibo.
 */
function coletarSimbolosDaClausula(clausula: string): string[] {
  const corte = clausula.search(LIMITE_DO_SIMBOLO);
  const introducao = corte >= 0 ? clausula.slice(0, corte) : clausula;
  const foraDeGrupo = semGrupos(introducao);
  const achados: string[] = [];
  const vistos = new Set<string>();
  let pulouTipoOuMeio = false;
  const guardar = (nome: string | undefined) => {
    if (!nome || PALAVRA_IGNORADA.has(nome.toLowerCase()) || vistos.has(nome)) return;
    vistos.add(nome);
    achados.push(nome);
  };
  for (const nome of introducao.matchAll(/`([A-Za-z_$][\w$]*)`/g)) guardar(nome[1]);
  for (const chamada of introducao.matchAll(/([A-Za-z_$][\w$]*)\s*[({\[]/g)) guardar(chamada[1]);
  for (const identificador of foraDeGrupo.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (!nomeDeTipoOuFuncao(identificador[1])) continue;
    if (nomeDepoisDeTipoOuMeio(foraDeGrupo, identificador.index ?? 0)) {
      pulouTipoOuMeio = true;
      continue;
    }
    guardar(identificador[1]);
  }
  if (achados.length > 0 || pulouTipoOuMeio) return achados;
  for (const identificador of foraDeGrupo.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (PALAVRA_IGNORADA.has(identificador[1].toLowerCase())) continue;
    if (nomeDepoisDeTipoOuMeio(foraDeGrupo, identificador.index ?? 0)) continue;
    guardar(identificador[1]);
    break;
  }
  return achados;
}

/** Símbolos que o critério manda a etapa produzir (exporta, função, tipo de contrato). */
export function simbolosProduzidosCitadosNoCriterio(texto: string): string[] {
  const simbolos = new Set<string>();
  const re = new RegExp(VERBO_PRODUZ.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const verbo = m[0];
    const depois = texto[m.index + verbo.length] ?? "";
    if (/[A-Za-zÀ-ÿ]/.test(depois)) continue;
    if (/^(?:fun[cç][aã]o|function|m[eé]todo)$/i.test(verbo)) {
      const antes = texto.slice(Math.max(0, m.index - 40), m.index);
      if (CONSOME_ANTES.test(antes)) continue;
    }
    for (const simbolo of coletarSimbolosDaClausula(clausulaDepoisDoVerbo(texto, m.index, verbo.length))) {
      simbolos.add(simbolo);
    }
  }
  return Array.from(simbolos);
}

function textoProduz(interfacesProduz: MicrobriefAndReportDocument["interfacesProduz"] | null | undefined): string {
  if (!interfacesProduz) return "";
  return Array.isArray(interfacesProduz) ? interfacesProduz.join("\n") : String(interfacesProduz);
}

function arquivosDeclarados(microbrief: {
  arquivosPermitidos?: { criar?: string[]; modificar?: string[]; lerContratos?: string[] } | null;
}): { escrita: string[]; todos: string[] } {
  const criar = microbrief.arquivosPermitidos?.criar ?? [];
  const modificar = microbrief.arquivosPermitidos?.modificar ?? [];
  const ler = microbrief.arquivosPermitidos?.lerContratos ?? [];
  const escrita = [...criar, ...modificar].map((f) => String(f).trim()).filter(Boolean);
  const todos = [...escrita, ...ler.map((f) => String(f).trim()).filter(Boolean)];
  return { escrita, todos };
}

/**
 * O microbrief nomeia os arquivos que pode criar ou modificar.
 * Arquivo ou símbolo produzido citado no critério e ausente dessa lista para a etapa.
 */
export function verificarEscopoMicrobrief(microbrief: {
  arquivosPermitidos?: { criar?: string[]; modificar?: string[]; lerContratos?: string[] } | null;
  interfacesProduz?: MicrobriefAndReportDocument["interfacesProduz"] | null;
  criteriosAceitePorReq?: MicrobriefAndReportDocument["criteriosAceitePorReq"] | null;
}): VerificacaoEscopoMicrobrief {
  const { escrita, todos } = arquivosDeclarados(microbrief);
  const contrato = textoProduz(microbrief.interfacesProduz);
  const criterios = textosDoCriterio(microbrief.criteriosAceitePorReq);
  const texto = criterios.join("\n");

  const arquivosCitados = extractFilePathsFromText(texto);
  const arquivosFora = arquivosCitados.filter((arquivo) => !arquivoListado(arquivo, todos));

  const simbolosCitados = simbolosProduzidosCitadosNoCriterio(texto);
  const simbolosFora = simbolosCitados.filter((simbolo) => !simboloListado(simbolo, contrato));

  const semArquivoDeEscrita = escrita.length === 0;
  return {
    coerente: !semArquivoDeEscrita && arquivosFora.length === 0 && simbolosFora.length === 0,
    semArquivoDeEscrita,
    arquivosCitadosNoCriterio: arquivosCitados,
    arquivosForaDoMicrobrief: arquivosFora,
    simbolosCitadosNoCriterio: simbolosCitados,
    simbolosForaDoMicrobrief: simbolosFora,
  };
}

export function mensagemEscopoMicrobriefIncompleto(titulo: string, verificacao: VerificacaoEscopoMicrobrief): string {
  const partes = [`Etapa "${titulo}" parou antes do executor. Nenhuma tentativa foi gasta.`];
  if (verificacao.semArquivoDeEscrita) {
    partes.push("O microbrief não nomeia arquivo para criar ou modificar.");
  }
  if (verificacao.arquivosForaDoMicrobrief.length > 0) {
    partes.push(
      `O critério nomeia arquivo que o microbrief não lista: ${verificacao.arquivosForaDoMicrobrief.join(", ")}.`
    );
  }
  if (verificacao.simbolosForaDoMicrobrief.length > 0) {
    partes.push(
      `O critério nomeia símbolo produzido que o contrato da etapa não lista: ${verificacao.simbolosForaDoMicrobrief.join(", ")}.`
    );
  }
  partes.push("Etapas com falha própria não entram em cascata.");
  return partes.join(" ");
}

export function gravarEscopoMicrobriefNoPayload(
  payloadJson: string | null | undefined,
  verificacao: VerificacaoEscopoMicrobrief
): string {
  let base: Record<string, unknown> = {};
  try {
    base = payloadJson ? (JSON.parse(payloadJson) as Record<string, unknown>) : {};
  } catch {
    base = {};
  }
  const marca: EscopoMicrobriefMarca = {
    incompleto: true,
    arquivosFora: verificacao.arquivosForaDoMicrobrief,
    simbolosFora: verificacao.simbolosForaDoMicrobrief,
    semArquivoDeEscrita: verificacao.semArquivoDeEscrita,
  };
  return JSON.stringify({ ...base, escopoMicrobrief: marca });
}

export function lerMarcaEscopoMicrobrief(payloadJson?: string | null): EscopoMicrobriefMarca | null {
  try {
    const marca = payloadJson ? (JSON.parse(payloadJson) as { escopoMicrobrief?: EscopoMicrobriefMarca }).escopoMicrobrief : null;
    return marca?.incompleto === true ? marca : null;
  } catch {
    return null;
  }
}

function microbriefDoPayload(payloadJson?: string | null): {
  arquivosPermitidos?: { criar?: string[]; modificar?: string[]; lerContratos?: string[] };
  interfacesProduz?: string;
  criteriosAceitePorReq?: MicrobriefAndReportDocument["criteriosAceitePorReq"];
} | null {
  try {
    const mb = payloadJson ? JSON.parse(payloadJson)?.microbrief : null;
    if (!mb || mb.documento !== "microbrief" || !mb.arquivosPermitidos) return null;
    return mb;
  } catch {
    return null;
  }
}

/** A etapa concluiu. A marca antiga não pode esconder um bloqueio novo. */
export function stripEscopoMicrobriefAposConclusao(payload: string | null | undefined): string | undefined {
  try {
    const obj = payload ? JSON.parse(payload) : null;
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || !("escopoMicrobrief" in obj)) return undefined;
    delete (obj as Record<string, unknown>).escopoMicrobrief;
    return JSON.stringify(obj);
  } catch {
    return undefined;
  }
}

/** A etapa está parada por este porteiro (marca no payload ou no resultado). */
export function etapaBloqueadaPorEscopoMicrobrief(task: {
  payload?: string | null;
  result?: string | null;
}): boolean {
  if (lerMarcaEscopoMicrobrief(task.payload)) return true;
  try {
    const res = task.result ? JSON.parse(task.result) : null;
    return res?.erro === "ESCOPO_MICROBRIEF_INCOMPLETO" || res?.escopoMicrobriefIncompleto === true;
  } catch {
    return false;
  }
}

/** A marca continua e o microbrief atual ainda não lista o que o critério nomeia. */
export function escopoMicrobriefAindaImpede(task: { payload?: string | null; result?: string | null }): boolean {
  if (!etapaBloqueadaPorEscopoMicrobrief(task)) return false;
  const mb = microbriefDoPayload(task.payload);
  if (!mb) return true;
  return !verificarEscopoMicrobrief(mb).coerente;
}
