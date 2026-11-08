import * as fs from "fs";
import prisma from "@/lib/prisma";
import { loadRoleSkill, type LoadedRoleSkill } from "@/core/skills/skill-runtime";
import { ownTestLoadFailure, type AcceptanceTest } from "@/core/governance/acceptance-tests";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";
import type { BlindAuditProblem, ValidationType2Result } from "@/core/governance/dual-lens-auditor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { writeCanonicalSpecFile } from "@/core/intake/spec-file";

export const PEDIDO_UNICO_SKILL_NAME = "pedido-unico";

export const PEDIDO_UNICO_CHECAGENS_OBRIGATORIAS = [
  "retorno_do_contrato_e_criterio",
  "lacuna_anterior_permanece",
  "prova_carrega",
] as const;

/** A terceira checagem (`prova_carrega`) aponta para `ownTestLoadFailure` sem reimplementá-la. */
export const PROVA_CARREGA_CHECK = ownTestLoadFailure;

export type DecisaoPedidoUnico = "vale o contrato" | "vale o critério";
export type DecisaoPedidoUnicoNormalizada = "vale_contrato" | "vale_criterio";

export interface CampoSugeridoContrato {
  rotulo: string;
  propriedade: string;
  tipo: string;
}

export interface PedidoUnicoConflitoDetalhe {
  camposRetornoContrato: string[];
  camposFaltantes: string[];
  criteriosEmConflito: string[];
  opcoes: readonly [DecisaoPedidoUnico, DecisaoPedidoUnico];
}

export interface PedidoUnicoResultado {
  coerente: boolean;
  status: "coerente" | "conflito";
  camposRetornoContrato: string[];
  camposExigidosNoCriterio: string[];
  camposFaltantes: string[];
  camposFaltantesNoContrato: string[];
  camposSugeridosParaContrato: CampoSugeridoContrato[];
  criteriosEmConflito: string[];
  criteriosCoerentes: string[];
  conflito: PedidoUnicoConflitoDetalhe | null;
  mensagemDecisao?: string;
}

export interface EstadoPedidoUnicoEtapa {
  status: "conflito" | "resolvido";
  camposRetornoContrato: string[];
  camposFaltantes: string[];
  camposSugeridosParaContrato: CampoSugeridoContrato[];
  criteriosEmConflito: string[];
  criteriosOriginaisNoRegistro?: Record<string, string[]>;
  decisao: DecisaoPedidoUnico | null;
  decisaoNormalizada: DecisaoPedidoUnicoNormalizada | null;
  opcoes: readonly [DecisaoPedidoUnico, DecisaoPedidoUnico];
  registradoEm: string;
}

export type CriteriosReqInput =
  | string
  | readonly (
      | string
      | {
          id?: string;
          descricao?: string;
          criterio?: string;
          criterios?: readonly string[];
        }
    )[]
  | Record<string, string | readonly string[]>
  | null
  | undefined;

/**
 * Carrega e valida a skill declarativa `pedido-unico` (papel `conferente`, `escrever: nunca`, `ferramentas: []`).
 * Se a skill não carregar ou violar as restrições do porteiro, lança erro para impedir a execução da etapa.
 */
export function carregarSkillPedidoUnico(skillsRoot: string = process.cwd()): LoadedRoleSkill {
  const skill = loadRoleSkill(PEDIDO_UNICO_SKILL_NAME, skillsRoot);
  if (skill.papel !== "conferente") {
    throw new Error(`[PEDIDO_UNICO] A skill "${PEDIDO_UNICO_SKILL_NAME}" deve ter papel "conferente" (atual: "${skill.papel}").`);
  }
  if (skill.permissoes.escrever !== "nunca") {
    throw new Error(
      `[PEDIDO_UNICO] A skill "${PEDIDO_UNICO_SKILL_NAME}" deve ter permissoes.escrever="nunca" (atual: "${skill.permissoes.escrever}").`
    );
  }
  if (skill.ferramentas.length > 0) {
    throw new Error(`[PEDIDO_UNICO] A skill "${PEDIDO_UNICO_SKILL_NAME}" deve ter ferramentas vazias.`);
  }
  for (const checagem of PEDIDO_UNICO_CHECAGENS_OBRIGATORIAS) {
    if (!skill.checagens.includes(checagem)) {
      throw new Error(`[PEDIDO_UNICO] A skill "${PEDIDO_UNICO_SKILL_NAME}" não declara a checagem obrigatória "${checagem}".`);
    }
  }
  return skill;
}

function normalizarTokenCampo(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extrairPropriedadesDeBlocoObjeto(bloco: string): string[] {
  const props: string[] = [];
  const limpo = bloco.replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const partes: string[] = [];
  let atual = "";
  let depthBrace = 0;
  let depthBracket = 0;
  let depthParen = 0;
  let depthAngle = 0;

  for (let i = 0; i < limpo.length; i++) {
    const ch = limpo[i];
    if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "<") depthAngle++;
    else if (ch === ">" && limpo[i - 1] !== "=") depthAngle = Math.max(0, depthAngle - 1);

    if (
      depthBrace === 0 &&
      depthBracket === 0 &&
      depthParen === 0 &&
      depthAngle === 0 &&
      (ch === ";" || ch === "," || ch === "\n")
    ) {
      if (atual.trim()) partes.push(atual.trim());
      atual = "";
    } else {
      atual += ch;
    }
  }
  if (atual.trim()) partes.push(atual.trim());

  for (const parte of partes) {
    const m = /^\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(\?)?\s*:/.exec(parte);
    // Campo opcional não cumpre o critério: `{ id; qrPix?: string }` ainda aceita devolver só o id.
    if (m && m[1] && !m[2]) {
      props.push(m[1]);
      const abre = parte.indexOf("{");
      if (abre >= 0) {
        const interno = encontrarBlocoChavesBalanceado(parte, abre);
        if (interno) props.push(...extrairPropriedadesDeBlocoObjeto(interno.conteudoInterno));
      }
    }
  }
  return props;
}

function identificadorEhStatus(nome: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(nome);
}

interface BlocoBalanceado {
  conteudoInterno: string;
  inicioChave: number;
  fimChaveExclusivo: number;
}

function encontrarBlocoChavesBalanceado(texto: string, indiceAbertura: number): BlocoBalanceado | null {
  if (texto[indiceAbertura] !== "{") return null;
  let depth = 0;
  for (let i = indiceAbertura; i < texto.length; i++) {
    if (texto[i] === "{") depth++;
    else if (texto[i] === "}") {
      depth--;
      if (depth === 0) {
        return {
          conteudoInterno: texto.slice(indiceAbertura + 1, i),
          inicioChave: indiceAbertura,
          fimChaveExclusivo: i + 1,
        };
      }
    }
  }
  return null;
}

function encontrarRetornoAposAssinaturaNaLinha(linha: string): BlocoBalanceado | null {
  const alias = /\b(?:type|interface)\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=\s*/.exec(linha);
  if (alias && /(?:Saida|Output|Retorno|Response|Resultado|Result)$/i.test(alias[1])) {
    const inicioValor = alias.index + alias[0].length;
    const valor = linha.slice(inicioValor).trimStart();
    if (!valor.startsWith("(")) {
      const abre = linha.indexOf("{", inicioValor);
      if (abre < 0) return null;
      return encontrarBlocoChavesBalanceado(linha, abre);
    }
  }

  // Se houver lista de parâmetros `(...)`, avança até o fechamento do `)` externo antes de procurar `=>` ou `:`
  let posBusca = 0;
  const idxParen = linha.indexOf("(");
  if (idxParen !== -1) {
    let depth = 0;
    for (let i = idxParen; i < linha.length; i++) {
      if (linha[i] === "(") depth++;
      else if (linha[i] === ")") {
        depth--;
        if (depth === 0) {
          posBusca = i + 1;
          break;
        }
      }
    }
  }

  const sufixo = linha.slice(posBusca);
  const m = /(?:=>|:)\s*(?:Promise\s*<\s*)?\{/.exec(sufixo);
  if (m) {
    const idxChave = posBusca + m.index + m[0].lastIndexOf("{");
    return encontrarBlocoChavesBalanceado(linha, idxChave);
  }

  const mSaida = /\b[A-Za-z0-9_]*(?:Saida|Output|Retorno|Response|Result|Resultado)\b[^=]*=\s*(?:Promise\s*<\s*)?\{/i.exec(
    linha
  );
  if (mSaida) {
    const idxChave = mSaida.index + mSaida[0].lastIndexOf("{");
    return encontrarBlocoChavesBalanceado(linha, idxChave);
  }

  return null;
}

interface DeclaracaoRetornoContrato {
  simbolos: string[];
  campos: string[];
  linhaOriginal: string;
}

function extrairSimbolosDaLinhaContrato(linha: string): string[] {
  const simbolos = new Set<string>();
  const mType = /\b(?:export\s+)?(?:type|interface|function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(linha);
  if (mType && mType[1]) {
    const nome = mType[1];
    simbolos.add(nome);
    if (/^Fn[A-Z]/.test(nome) && nome.length > 2) {
      simbolos.add(nome[2].toLowerCase() + nome.slice(3));
    }
  }
  const mFnDirect = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(linha);
  if (mFnDirect && mFnDirect[1]) {
    simbolos.add(mFnDirect[1]);
  }
  return Array.from(simbolos);
}

function extrairDeclaracoesRetornoContrato(
  interfacesProduz: string | readonly string[] | null | undefined
): DeclaracaoRetornoContrato[] {
  if (!interfacesProduz) return [];
  const linhas = (Array.isArray(interfacesProduz) ? interfacesProduz.join("\n") : String(interfacesProduz))
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const declaracoes: DeclaracaoRetornoContrato[] = [];
  for (const linha of linhas) {
    if (/\b(?:type|interface)\s+\w*(?:Input|Entrada|Params|Request|Body|Args|Payload)\b/i.test(linha)) continue;
    const bloco = encontrarRetornoAposAssinaturaNaLinha(linha);
    if (bloco) {
      const campos = extrairPropriedadesDeBlocoObjeto(bloco.conteudoInterno);
      if (campos.length > 0) {
        declaracoes.push({
          simbolos: extrairSimbolosDaLinhaContrato(linha),
          campos,
          linhaOriginal: linha,
        });
      }
    }
  }

  if (declaracoes.length === 0) {
    const texto = linhas.join("\n");
    for (const linha of linhas) {
      if (/\b[A-Za-z0-9_]*(?:Input|Entrada|Params|Request|Body|Args|Payload)\b\s*=/i.test(linha)) continue;
      const idxChave = linha.indexOf("{");
      if (idxChave !== -1) {
        const bloco = encontrarBlocoChavesBalanceado(linha, idxChave);
        if (bloco) {
          const campos = extrairPropriedadesDeBlocoObjeto(bloco.conteudoInterno);
          if (campos.length > 0) {
            declaracoes.push({
              simbolos: extrairSimbolosDaLinhaContrato(linha),
              campos,
              linhaOriginal: linha,
            });
          }
        }
      }
    }
    if (declaracoes.length === 0) {
      const idxChave = texto.indexOf("{");
      if (idxChave !== -1) {
        const bloco = encontrarBlocoChavesBalanceado(texto, idxChave);
        if (bloco) {
          const campos = extrairPropriedadesDeBlocoObjeto(bloco.conteudoInterno);
          if (campos.length > 0) {
            declaracoes.push({ simbolos: [], campos, linhaOriginal: texto });
          }
        }
      }
    }
  }

  return declaracoes;
}

/**
 * Extrai os nomes dos campos do tipo de retorno prometido no texto do contrato da etapa (`interfacesProduz`).
 * Ignora objetos de parâmetros de entrada (`input: { ... }`, `*Input`, `*Entrada`).
 */
export function extrairCamposRetornoContrato(interfacesProduz: string | readonly string[] | null | undefined): string[] {
  const declaracoes = extrairDeclaracoesRetornoContrato(interfacesProduz);
  const campos = new Set<string>();
  for (const d of declaracoes) {
    for (const c of d.campos) {
      campos.add(c);
    }
  }
  return Array.from(campos);
}

interface CriterioComContexto {
  texto: string;
  contextoGrupo: string;
}

function normalizarListaCriteriosComContexto(criteriosReqs: CriteriosReqInput): CriterioComContexto[] {
  if (!criteriosReqs) return [];
  if (typeof criteriosReqs === "string") {
    const lista = criteriosReqs
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const contextoGrupo = lista.join(" ");
    return lista.map((texto) => ({ texto, contextoGrupo }));
  }
  if (Array.isArray(criteriosReqs)) {
    const out: CriterioComContexto[] = [];
    const textosSoltos: string[] = [];
    for (const item of criteriosReqs) {
      if (typeof item === "string") {
        if (item.trim()) textosSoltos.push(item.trim());
      } else if (item && typeof item === "object") {
        const grupo: string[] = [];
        if (Array.isArray(item.criterios)) {
          for (const c of item.criterios) {
            if (typeof c === "string" && c.trim()) grupo.push(c.trim());
          }
        }
        if (typeof item.criterio === "string" && item.criterio.trim()) {
          grupo.push(item.criterio.trim());
        }
        if (
          (!item.criterios || item.criterios.length === 0) &&
          !item.criterio &&
          typeof item.descricao === "string" &&
          item.descricao.trim()
        ) {
          grupo.push(item.descricao.trim());
        }
        const contextoGrupo = grupo.join(" ");
        for (const texto of grupo) {
          out.push({ texto, contextoGrupo });
        }
      }
    }
    if (textosSoltos.length > 0) {
      const ctx = textosSoltos.join(" ");
      for (const texto of textosSoltos) {
        out.push({ texto, contextoGrupo: ctx });
      }
    }
    return out;
  }
  if (typeof criteriosReqs === "object") {
    const out: CriterioComContexto[] = [];
    for (const val of Object.values(criteriosReqs)) {
      if (typeof val === "string" && val.trim()) {
        out.push({ texto: val.trim(), contextoGrupo: val.trim() });
      } else if (Array.isArray(val)) {
        const grupo = val.filter((c): c is string => typeof c === "string" && Boolean(c.trim())).map((c) => c.trim());
        const ctx = grupo.join(" ");
        for (const texto of grupo) {
          out.push({ texto, contextoGrupo: ctx });
        }
      }
    }
    return out;
  }
  return [];
}

function normalizarListaCriterios(criteriosReqs: CriteriosReqInput): string[] {
  return normalizarListaCriteriosComContexto(criteriosReqs).map((c) => c.texto);
}

interface ConceitoCampoRetorno {
  rotulo: string;
  propriedade: string;
  tipo: string;
  padraoCriterio: RegExp;
  padraoCampoContrato: RegExp;
}

const CONCEITOS_RETORNO_CONHECIDOS: ConceitoCampoRetorno[] = [
  {
    rotulo: "QR Pix",
    propriedade: "qrPix",
    tipo: "string",
    padraoCriterio: /\bqr\s*(?:code)?(?:\s*pix)?\b|\bqr[-_]?pix\b|\bqr[-_]?code\b|\bimagem\s+qr\b|\bpayload\s+pix\b/i,
    padraoCampoContrato: /^(?:qr|qrcode|qrpix|qrcodepix|qrcodeurl|qrcodebase64|imagemqr|payloadpix|pixqr|pixqrcode)$/i,
  },
  {
    rotulo: "copia-e-cola",
    propriedade: "copiaECola",
    tipo: "string",
    padraoCriterio: /\bcopia(?:\s*-\s*e\s*-\s*|\s+e\s+|\s*-\s*|\s*_e_\s*|\s*_\s*)cola\b|\bpix\s+copia\s+e\s+cola\b|\bbr[-_]?code\b/i,
    padraoCampoContrato: /^(?:copiaecola|pixcopiaecola|brcode|emv|codigopix|payloadcopiaecola)$/i,
  },
  {
    rotulo: "linha digitável",
    propriedade: "linhaDigitavel",
    tipo: "string",
    padraoCriterio: /\blinha\s+digit[aá]vel\b|\blinha[-_]?digitavel\b|\bc[oó]digo\s+de\s+barras\b|\bcodigo[-_]?de[-_]?barras\b/i,
    padraoCampoContrato: /^(?:linhadigitavel|boletoLinhadigitavel|codigobarras|codigodebarras|barras)$/i,
  },
];

const PALAVRAS_GENERICAS_RETORNO = new Set([
  "objeto",
  "dados",
  "dado",
  "valor",
  "valores",
  "resultado",
  "resposta",
  "retorno",
  "saida",
  "erro",
  "erros",
  "sucesso",
  "falha",
  "lista",
  "array",
  "string",
  "number",
  "boolean",
  "promise",
  "json",
  "void",
  "null",
  "undefined",
  "true",
  "false",
  "cobranca",
  "registro",
  "entidade",
  "item",
  "status",
  "http",
]);

/** Grupo `{ ... }?` é opcional. O que está dentro não é campo obrigatório do retorno. */
function indiceDentroDeGrupoOpcional(texto: string, indice: number): boolean {
  const abertos: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === "{") abertos.push(i);
    else if (texto[i] === "}" && abertos.length > 0) {
      const abre = abertos.pop() as number;
      let j = i + 1;
      while (j < texto.length && texto[j] === " ") j++;
      if (texto[j] === "?" && indice > abre && indice < i) return true;
    }
  }
  return false;
}

/** Trecho depois do verbo de retorno até ponto, ponto-e-vírgula ou fim de linha. */
function janelasClausulaRetornoNoCriterio(criterio: string): string[] {
  const out: string[] = [];
  const re =
    /\b(?:retorn(?:a|ar|ando|e|am)|devolv(?:e|er|endo|a|em)|retorno|sa[ií]da|resposta)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(criterio))) {
    const start = m.index + m[0].length;
    let end = start;
    while (end < criterio.length && criterio[end] !== "." && criterio[end] !== ";" && criterio[end] !== "\n") {
      end++;
    }
    const fatia = criterio.slice(start, end).trim();
    if (fatia) out.push(fatia);
  }
  return out;
}

/** Onde procurar conceitos (QR, linha digitável): cláusula de retorno ou pedido explícito de incluir/devolver. */
function janelasPedidoConceitoNoCriterio(criterio: string): string[] {
  const out = janelasClausulaRetornoNoCriterio(criterio);
  const rePedido =
    /\b(?:deve\s+)?(?:incluir|conter|inclui|cont[eé]m|retornar|retorna|devolver|devolve)\b[^.;\n]*/gi;
  let m: RegExpExecArray | null;
  while ((m = rePedido.exec(criterio))) {
    const fatia = m[0].trim();
    if (fatia && !out.includes(fatia)) out.push(fatia);
  }
  return out;
}

function nomesObrigatoriosNoObjetoDoCriterio(interior: string): string[] {
  const nomes: string[] = [];
  const partes: string[] = [];
  let atual = "";
  let depth = 0;
  let depthParen = 0;
  let depthAngle = 0;
  for (const ch of interior) {
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "<") depthAngle++;
    else if (ch === ">" && (atual.length === 0 || atual[atual.length - 1] !== "=")) depthAngle = Math.max(0, depthAngle - 1);
    else if ((ch === "," || ch === ";") && depth === 0 && depthParen === 0 && depthAngle === 0) {
      if (atual.trim()) partes.push(atual.trim());
      atual = "";
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  for (const parte of partes) {
    const m = /^([A-Za-z_$][\w$]*)\s*(\?)?/.exec(parte);
    if (!m) continue;
    if (m[2] === "?") continue;
    if (/\}\s*\?\s*$/.test(parte)) continue;
    const norm = normalizarTokenCampo(m[1]);
    if (!PALAVRAS_GENERICAS_RETORNO.has(norm)) nomes.push(m[1]);
    const abre = parte.indexOf("{");
    if (abre >= 0) {
      const interno = encontrarBlocoChavesBalanceado(parte, abre);
      if (interno) nomes.push(...nomesObrigatoriosNoObjetoDoCriterio(interno.conteudoInterno));
    }
  }
  return nomes;
}

function extrairCamposExplicitosDeClausulaRetorno(criterio: string): CampoSugeridoContrato[] {
  const encontrados: CampoSugeridoContrato[] = [];
  const vistos = new Set<string>();

  // Ex.: `retornar { id, qrPix, linkPagamento }` ou `retorno deve conter { id: string, url: string }`
  for (const m of criterio.matchAll(
    /\b(?:retorn(?:a|ar|ando|e)|devolv(?:e|er|endo|a)|retorno|sa[ií]da|resposta)\b[^{;\n.]*/gi
  )) {
    const depois = criterio.slice((m.index ?? 0) + m[0].length);
    if (!/^\s*\{/.test(depois)) continue;
    if (/\b[45]\d\d\b/.test(m[0])) continue;
    const abre = (m.index ?? 0) + m[0].length + depois.indexOf("{");
    const bloco = encontrarBlocoChavesBalanceado(criterio, abre);
    if (!bloco) continue;
    for (const nome of nomesObrigatoriosNoObjetoDoCriterio(bloco.conteudoInterno)) {
      const norm = normalizarTokenCampo(nome);
      if (vistos.has(norm)) continue;
      vistos.add(norm);
      encontrados.push({ rotulo: nome, propriedade: nome, tipo: "string" });
    }
  }

  // Ex.: `retornar \`qrPix\` e \`copiaECola\``, `retorno deve incluir o campo \`urlBoleto\``
  // ou listas de identificadores entre parênteses após o verbo de retorno: `retornam totais (recebido, pendente, valorLiquido)`
  for (const m of criterio.matchAll(
    /\b(?:retorn(?:a|am|ar|ando|e)|devolv(?:e|em|er|endo|a)|retorno\s+(?:deve\s+)?(?:conter|cont[eé]m|incluir|inclui|ter|trazer|traz)|sa[ií]da\s+(?:deve\s+)?(?:conter|cont[eé]m|incluir|inclui|ter|trazer|traz))\b([^.;\n]*)/gi
  )) {
    const trecho = m[1] || "";
    for (const tick of trecho.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)) {
      const nome = tick[1];
      const norm = normalizarTokenCampo(nome);
      if (!PALAVRAS_GENERICAS_RETORNO.has(norm) && !vistos.has(norm)) {
        vistos.add(norm);
        encontrados.push({ rotulo: nome, propriedade: nome, tipo: "string" });
      }
    }
    for (const paren of trecho.matchAll(/\(([^)]+)\)/g)) {
      const idxParen = paren.index ?? 0;
      if (idxParen > 0 && /[A-Za-z0-9_$]$/.test(trecho.slice(0, idxParen))) continue;
      const partes = paren[1]
        .split(/\s*(?:,|;|\bou\b|\be\b)\s*/i)
        .map((p) => p.trim())
        .filter(Boolean);
      // Um token só entre parênteses é glosa de status (`inadimplente (VENCIDA)`), não campo.
      // Sigla em maiúsculas também não é propriedade de retorno.
      if (partes.length < 2 || !partes.every((p) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p))) continue;
      for (const nome of partes) {
        if (identificadorEhStatus(nome)) continue;
        const norm = normalizarTokenCampo(nome);
        if (!PALAVRAS_GENERICAS_RETORNO.has(norm) && !vistos.has(norm)) {
          vistos.add(norm);
          encontrados.push({ rotulo: nome, propriedade: nome, tipo: "unknown" });
        }
      }
    }
  }

  return encontrados;
}

export function buildMensagemConflitoPedidoUnico(
  etapaTitulo: string,
  camposRetornoContrato: string[],
  camposFaltantes: string[]
): string {
  const retornoFormatado = `{ ${camposRetornoContrato.map((c) => `${c}: ...`).join("; ")} }`;
  const faltantesFormatados = camposFaltantes.join(", ");
  return (
    `🛑 **Conflito de pedido único na etapa "${etapaTitulo}"** — o executor não foi chamado e nenhuma tentativa foi gasta.\n\n` +
    `- **Retorno no contrato da etapa:** \`${retornoFormatado}\`\n` +
    `- **Campos pedidos no critério e ausentes no retorno do contrato:** ${faltantesFormatados}\n\n` +
    `Escolha **uma única decisão** para a etapa voltar à fila:\n` +
    `- **"vale o contrato"**: a auditoria e o teste de aceite desta etapa não reprovam por campo que o retorno do contrato não nomeia (o critério continua no registro e sai do pedido desta etapa).\n` +
    `- **"vale o critério"**: a etapa continua sem executor até o texto do contrato guardado na sessão nomear esses campos (quem alarga o retorno é o harness, no contrato da sessão, só depois da escolha).`
  );
}

function extrairRadicaisAssinatura(d: DeclaracaoRetornoContrato): string[] {
  const idxRetorno = d.linhaOriginal.indexOf("=>");
  const cabecalho = idxRetorno !== -1 ? d.linhaOriginal.slice(0, idxRetorno) : d.linhaOriginal;
  const palavrasCamel = cabecalho
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((p) => normalizarTokenCampo(p))
    .filter((p) => p.length >= 5 && !["export", "promise", "string", "number", "boolean", "array"].includes(p));
  return Array.from(new Set(palavrasCamel));
}

function selecionarDeclaracoesDoCriterio(
  declaracoes: DeclaracaoRetornoContrato[],
  criterio: string,
  contextoGrupo?: string
): DeclaracaoRetornoContrato[] {
  if (declaracoes.length <= 1) return declaracoes;

  const casarPorSimbolo = (texto: string): DeclaracaoRetornoContrato[] => {
    const norm = normalizarTokenCampo(texto);
    if (!norm) return [];
    return declaracoes.filter((d) =>
      d.simbolos.some((sym) => {
        const symNorm = normalizarTokenCampo(sym);
        return symNorm.length >= 3 && norm.includes(symNorm);
      })
    );
  };

  const diretas = casarPorSimbolo(criterio);
  if (diretas.length > 0) return diretas;

  if (contextoGrupo) {
    const porGrupo = casarPorSimbolo(contextoGrupo);
    if (porGrupo.length > 0) return porGrupo;
  }

  const textoCombinado = normalizarTokenCampo(`${criterio} ${contextoGrupo ?? ""}`);
  const porRadical = declaracoes.filter((d) =>
    extrairRadicaisAssinatura(d).some((rad) => textoCombinado.includes(rad))
  );
  if (porRadical.length > 0) return porRadical;

  return declaracoes;
}

/**
 * FATIA 1 — Função pura, sem chamada de modelo.
 * Entrada: texto do contrato da etapa (`interfacesProduz`) e os critérios dos REQ dessa etapa.
 * Saída: coerente, ou conflito com os campos que o critério pede e o tipo de retorno do contrato não nomeia.
 */
export function verificarPedidoUnico(
  interfacesProduz: string | readonly string[] | null | undefined,
  criteriosReqs: CriteriosReqInput,
  opcoes?: { tituloEtapa?: string }
): PedidoUnicoResultado {
  const declaracoes = extrairDeclaracoesRetornoContrato(interfacesProduz);
  const todosCamposRetorno = extrairCamposRetornoContrato(interfacesProduz);
  const criteriosComContexto = normalizarListaCriteriosComContexto(criteriosReqs);
  const criterios = criteriosComContexto.map((c) => c.texto);

  // Se o contrato não restringe um objeto de retorno `{ ... }`, não há conflito de campos de retorno.
  if (todosCamposRetorno.length === 0 || criterios.length === 0) {
    return {
      coerente: true,
      status: "coerente",
      camposRetornoContrato: todosCamposRetorno,
      camposExigidosNoCriterio: [],
      camposFaltantes: [],
      camposFaltantesNoContrato: [],
      camposSugeridosParaContrato: [],
      criteriosEmConflito: [],
      criteriosCoerentes: criterios,
      conflito: null,
    };
  }

  const camposExigidosNoCriterio: string[] = [];
  const camposFaltantes: string[] = [];
  const camposSugeridosParaContrato: CampoSugeridoContrato[] = [];
  const criteriosEmConflito: string[] = [];
  const criteriosCoerentes: string[] = [];
  const declaracoesConflitantes = new Set<DeclaracaoRetornoContrato>();

  for (const itemCriterio of criteriosComContexto) {
    const criterio = itemCriterio.texto;
    let criterioConflitou = false;
    const declsAlvo = selecionarDeclaracoesDoCriterio(declaracoes, criterio, itemCriterio.contextoGrupo);
    const camposAlvo = Array.from(new Set(declsAlvo.flatMap((d) => d.campos)));
    const retornoNormalizado = (camposAlvo.length > 0 ? camposAlvo : todosCamposRetorno).map(normalizarTokenCampo);

    const janelasRetorno = janelasPedidoConceitoNoCriterio(criterio);
    for (const conceito of CONCEITOS_RETORNO_CONHECIDOS) {
      let achadoConceito: RegExpExecArray | null = null;
      for (const janela of janelasRetorno) {
        conceito.padraoCriterio.lastIndex = 0;
        const achado = conceito.padraoCriterio.exec(janela);
        if (achado && !indiceDentroDeGrupoOpcional(janela, achado.index)) {
          achadoConceito = achado;
          break;
        }
      }
      if (achadoConceito) {
        if (!camposExigidosNoCriterio.includes(conceito.rotulo)) {
          camposExigidosNoCriterio.push(conceito.rotulo);
        }
        const presenteNoContrato = retornoNormalizado.some(
          (campoNorm) =>
            conceito.padraoCampoContrato.test(campoNorm) ||
            campoNorm === normalizarTokenCampo(conceito.propriedade) ||
            campoNorm === normalizarTokenCampo(conceito.rotulo)
        );
        if (!presenteNoContrato) {
          criterioConflitou = true;
          if (!camposFaltantes.includes(conceito.rotulo)) {
            camposFaltantes.push(conceito.rotulo);
            camposSugeridosParaContrato.push({
              rotulo: conceito.rotulo,
              propriedade: conceito.propriedade,
              tipo: conceito.tipo,
            });
          }
        }
      }
    }

    const explicitos = extrairCamposExplicitosDeClausulaRetorno(criterio);
    for (const exp of explicitos) {
      const expNorm = normalizarTokenCampo(exp.propriedade);
      // Evita duplicar se já foi coberto por um conceito conhecido
      const jaCobertoPorConceito = CONCEITOS_RETORNO_CONHECIDOS.some(
        (c) => c.padraoCampoContrato.test(expNorm) || normalizarTokenCampo(c.propriedade) === expNorm
      );
      if (jaCobertoPorConceito) continue;

      if (!camposExigidosNoCriterio.includes(exp.rotulo)) {
        camposExigidosNoCriterio.push(exp.rotulo);
      }
      const presenteNoContrato = retornoNormalizado.includes(expNorm);
      if (!presenteNoContrato) {
        criterioConflitou = true;
        if (!camposFaltantes.includes(exp.rotulo)) {
          camposFaltantes.push(exp.rotulo);
          camposSugeridosParaContrato.push(exp);
        }
      }
    }

    if (criterioConflitou) {
      criteriosEmConflito.push(criterio);
      for (const d of declsAlvo) declaracoesConflitantes.add(d);
    } else {
      criteriosCoerentes.push(criterio);
    }
  }

  const coerente = camposFaltantes.length === 0;
  const camposRetornoContrato =
    !coerente && declaracoesConflitantes.size > 0
      ? Array.from(new Set(Array.from(declaracoesConflitantes).flatMap((d) => d.campos)))
      : todosCamposRetorno;

  const conflito: PedidoUnicoConflitoDetalhe | null = coerente
    ? null
    : {
        camposRetornoContrato,
        camposFaltantes,
        criteriosEmConflito,
        opcoes: ["vale o contrato", "vale o critério"] as const,
      };

  return {
    coerente,
    status: coerente ? "coerente" : "conflito",
    camposRetornoContrato,
    camposExigidosNoCriterio,
    camposFaltantes,
    camposFaltantesNoContrato: camposFaltantes,
    camposSugeridosParaContrato,
    criteriosEmConflito,
    criteriosCoerentes,
    conflito,
    mensagemDecisao: coerente
      ? undefined
      : buildMensagemConflitoPedidoUnico(
          opcoes?.tituloEtapa || "Etapa",
          camposRetornoContrato,
          camposFaltantes
        ),
  };
}

export const checkPedidoUnico = verificarPedidoUnico;
export const checkSingleOrderContractAndCriteria = verificarPedidoUnico;

export function normalizarDecisaoPedidoUnico(
  entrada: string | null | undefined
): { rotulo: DecisaoPedidoUnico; normalizada: DecisaoPedidoUnicoNormalizada } | null {
  if (!entrada) return null;
  const limpo = entrada
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (limpo === "vale o contrato" || limpo === "vale_contrato" || limpo === "valecontrato" || limpo === "contrato") {
    return { rotulo: "vale o contrato", normalizada: "vale_contrato" };
  }
  if (limpo === "vale o criterio" || limpo === "vale_criterio" || limpo === "valecriterio" || limpo === "criterio") {
    return { rotulo: "vale o critério", normalizada: "vale_criterio" };
  }
  return null;
}

export function lerEstadoPedidoUnico(payloadJson?: string | null): EstadoPedidoUnicoEtapa | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson);
    const pu = parsed?.pedidoUnico;
    if (!pu || typeof pu !== "object") return null;
    const dec = normalizarDecisaoPedidoUnico(pu.decisao ?? pu.decisaoNormalizada);
    return {
      status: pu.status === "resolvido" ? "resolvido" : "conflito",
      camposRetornoContrato: Array.isArray(pu.camposRetornoContrato) ? pu.camposRetornoContrato : [],
      camposFaltantes: Array.isArray(pu.camposFaltantes) ? pu.camposFaltantes : [],
      camposSugeridosParaContrato: Array.isArray(pu.camposSugeridosParaContrato) ? pu.camposSugeridosParaContrato : [],
      criteriosEmConflito: Array.isArray(pu.criteriosEmConflito) ? pu.criteriosEmConflito : [],
      criteriosOriginaisNoRegistro:
        pu.criteriosOriginaisNoRegistro && typeof pu.criteriosOriginaisNoRegistro === "object"
          ? pu.criteriosOriginaisNoRegistro
          : undefined,
      decisao: dec?.rotulo ?? null,
      decisaoNormalizada: dec?.normalizada ?? null,
      opcoes: ["vale o contrato", "vale o critério"],
      registradoEm: typeof pu.registradoEm === "string" ? pu.registradoEm : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function gravarConflitoPedidoUnicoNoPayload(
  payloadJson: string | null | undefined,
  resultado: PedidoUnicoResultado,
  decisaoAtual?: { rotulo: DecisaoPedidoUnico; normalizada: DecisaoPedidoUnicoNormalizada } | null
): string {
  let base: Record<string, unknown> = {};
  try {
    base = payloadJson ? (JSON.parse(payloadJson) as Record<string, unknown>) : {};
  } catch {
    base = {};
  }
  const mb = base.microbrief as MicrobriefAndReportDocument | undefined;
  const existente = lerEstadoPedidoUnico(payloadJson);
  const criteriosOriginaisNoRegistro =
    existente?.criteriosOriginaisNoRegistro ??
    (mb?.criteriosAceitePorReq ? JSON.parse(JSON.stringify(mb.criteriosAceitePorReq)) : undefined);

  const estado: EstadoPedidoUnicoEtapa = {
    status: "conflito",
    camposRetornoContrato: resultado.camposRetornoContrato,
    camposFaltantes: resultado.camposFaltantes,
    camposSugeridosParaContrato: resultado.camposSugeridosParaContrato,
    criteriosEmConflito: resultado.criteriosEmConflito,
    ...(criteriosOriginaisNoRegistro ? { criteriosOriginaisNoRegistro } : {}),
    decisao: decisaoAtual?.rotulo ?? existente?.decisao ?? null,
    decisaoNormalizada: decisaoAtual?.normalizada ?? existente?.decisaoNormalizada ?? null,
    opcoes: ["vale o contrato", "vale o critério"],
    registradoEm: existente?.registradoEm ?? new Date().toISOString(),
  };

  return JSON.stringify({
    ...base,
    pedidoUnico: estado,
  });
}

/** Critérios completos da etapa; subconjunto em conflito não substitui leitura do contrato. */
function criteriosReqComConteudo(criterios: CriteriosReqInput): boolean {
  if (criterios == null) return false;
  if (typeof criterios === "string") return criterios.trim().length > 0;
  if (Array.isArray(criterios)) return criterios.length > 0;
  if (typeof criterios === "object") {
    return Object.values(criterios).some((lista) => {
      if (typeof lista === "string") return lista.trim().length > 0;
      return Array.isArray(lista) && lista.some((item) => String(item).trim().length > 0);
    });
  }
  return false;
}

function criteriosCompletosParaLeituraPedidoUnico(
  payload: string | null | undefined
): CriteriosReqInput | undefined {
  try {
    const parsed = payload ? JSON.parse(payload) : null;
    const mbCrit = parsed?.microbrief?.criteriosAceitePorReq as CriteriosReqInput | undefined;
    if (criteriosReqComConteudo(mbCrit)) return mbCrit;
    const estado = lerEstadoPedidoUnico(payload);
    const registro = estado?.criteriosOriginaisNoRegistro as CriteriosReqInput | undefined;
    if (criteriosReqComConteudo(registro)) return registro;
    return undefined;
  } catch {
    return undefined;
  }
}

export function leituraAtualDoPedidoUnicoCoerente(
  task: { payload?: string | null },
  canonicalSpecSessao?: string | null
): boolean {
  try {
    const criterios = criteriosCompletosParaLeituraPedidoUnico(task.payload);
    if (!criterios) return false;
    return verificarPedidoUnico(extrairContratoDaSessaoOuPayload(task.payload, canonicalSpecSessao), criterios).coerente;
  } catch {
    return false;
  }
}

export type MotivoRecusaRetry =
  | "no_nao_encontrado"
  | "escopo_microbrief"
  | "pedido_unico_aberto"
  | "vale_criterio_contrato_incompleto";

export function registroPossuiMarcaPedidoUnicoObsoleta(task: {
  payload?: string | null;
  result?: string | null;
}): boolean {
  const estado = lerEstadoPedidoUnico(task.payload);
  if (estado?.status === "conflito" && !estado.decisaoNormalizada) return true;
  if (!task.result) return false;
  try {
    const res = JSON.parse(task.result) as { pedidoUnicoAguardandoDecisao?: boolean; erro?: string };
    return res.pedidoUnicoAguardandoDecisao === true || res.erro === "CONFLITO_PEDIDO_UNICO";
  } catch {
    return false;
  }
}

export function reconciliarPedidoUnicoObsoletoNoRegistro(
  task: { payload?: string | null; result?: string | null },
  canonicalSpecSessao?: string | null
): { alterou: boolean; payload?: string; result?: string } {
  if (!registroPossuiMarcaPedidoUnicoObsoleta(task)) return { alterou: false };
  if (!leituraAtualDoPedidoUnicoCoerente(task, canonicalSpecSessao)) return { alterou: false };
  if (etapaBloqueadaPorPedidoUnicoSemResolucao(task, canonicalSpecSessao)) return { alterou: false };

  let basePayload: Record<string, unknown> = {};
  try {
    basePayload = task.payload ? (JSON.parse(task.payload) as Record<string, unknown>) : {};
  } catch {
    basePayload = {};
  }
  const { pedidoUnico: _removido, ...semPedidoUnico } = basePayload;
  const payload = JSON.stringify(semPedidoUnico);

  let result = task.result ?? undefined;
  if (task.result) {
    try {
      const parsed = JSON.parse(task.result) as Record<string, unknown>;
      const {
        pedidoUnicoAguardandoDecisao: _aguarda,
        erro,
        ...resto
      } = parsed;
      const proximo: Record<string, unknown> = {
        ...resto,
        pedidoUnicoAguardandoDecisao: false,
        pedidoUnicoReconciliadoEm: new Date().toISOString(),
      };
      if (erro === "CONFLITO_PEDIDO_UNICO") {
        proximo.conflitoPedidoUnicoObsoleto = true;
      } else if (erro !== undefined) {
        proximo.erro = erro;
      }
      result = JSON.stringify(proximo);
    } catch {
      result = JSON.stringify({
        pedidoUnicoAguardandoDecisao: false,
        pedidoUnicoReconciliadoEm: new Date().toISOString(),
      });
    }
  }

  return { alterou: true, payload, result };
}

export async function persistirReconciliacaoPedidoUnicoObsoleto(
  taskId: string,
  canonicalSpecSessao?: string | null
): Promise<boolean> {
  const task = await prisma.taskNode.findUnique({ where: { id: taskId } });
  if (!task) return false;
  const patch = reconciliarPedidoUnicoObsoletoNoRegistro(task, canonicalSpecSessao);
  if (!patch.alterou) return false;
  await prisma.taskNode.update({
    where: { id: taskId },
    data: {
      ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
      ...(patch.result !== undefined ? { result: patch.result } : {}),
    },
  });
  return true;
}

export async function reconciliarPedidoUnicoObsoletoNasTarefas(
  tasks: Array<{ id: string; payload?: string | null; result?: string | null }>,
  canonicalSpecSessao?: string | null
): Promise<number> {
  let alteradas = 0;
  for (const task of tasks) {
    const patch = reconciliarPedidoUnicoObsoletoNoRegistro(task, canonicalSpecSessao);
    if (!patch.alterou) continue;
    await prisma.taskNode.update({
      where: { id: task.id },
      data: {
        ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
        ...(patch.result !== undefined ? { result: patch.result } : {}),
      },
    });
    alteradas += 1;
  }
  return alteradas;
}

/**
 * Verifica se um nó bloqueado está aguardando a decisão "vale o contrato" ou "vale o critério"
 * (ou se "vale o critério" foi escolhido mas o contrato na sessão ainda não nomeia os campos).
 */
export function etapaBloqueadaPorPedidoUnicoSemResolucao(
  task: { payload?: string | null; result?: string | null; status?: string | null },
  canonicalSpecSessao?: string | null
): boolean {
  let res: { erro?: string; pedidoUnicoAguardandoDecisao?: boolean } | null = null;
  try {
    res = task.result ? JSON.parse(task.result) : null;
    if (res?.erro === "SKILL_PEDIDO_UNICO_INVALIDA") return false;
  } catch {
    res = null;
  }
  const estado = lerEstadoPedidoUnico(task.payload);
  const aguardando = res?.pedidoUnicoAguardandoDecisao === true;
  // Sem marca de conflito, reler o contrato inteiro não muda o booleano e travava o poll da DAG.
  if (!estado && !aguardando) return false;
  if (estado?.decisaoNormalizada === "vale_contrato") return false;
  if (leituraAtualDoPedidoUnicoCoerente(task, canonicalSpecSessao)) return false;
  if (!estado) return aguardando;
  if (!estado.decisaoNormalizada) return true;
  // "vale_criterio": continua sem executor até o texto do contrato guardado na sessão nomear os campos
  const contratoTexto = extrairContratoDaSessaoOuPayload(task.payload, canonicalSpecSessao);
  const mb = (() => {
    try {
      return task.payload ? (JSON.parse(task.payload)?.microbrief as MicrobriefAndReportDocument | undefined) : undefined;
    } catch {
      return undefined;
    }
  })();
  const ver = verificarPedidoUnico(contratoTexto, mb?.criteriosAceitePorReq ?? estado.criteriosEmConflito);
  return !ver.coerente;
}

/**
 * O painel não relê o contrato. Quem lê é o porteiro, na resposta da sessão.
 * A marca não é gravada: escolha antiga que não deixou o campo obrigatório volta a aparecer.
 */
export function marcarEscolhaPedidoUnicoNoPainel<
  T extends { payload?: string | null; result?: string | null; status?: string | null },
>(tasks: T[], canonicalSpecSessao?: string | null): Array<T & { pedidoUnicoAguardandoDecisao: boolean }> {
  return tasks.map((task) => ({
    ...task,
    pedidoUnicoAguardandoDecisao: etapaBloqueadaPorPedidoUnicoSemResolucao(task, canonicalSpecSessao),
  }));
}

/**
 * Troca o texto do contrato na sessão pelo texto alargado.
 * Se o bloco inteiro não estiver contíguo, troca cada linha de retorno que ainda está lá.
 * Devolve null quando alguma linha nova não pôde entrar: a sessão não fica pela metade.
 */
export function substituirContratoAlargadoNaSpec(
  canonicalSpec: string,
  original: string,
  alargado: string
): string | null {
  if (!canonicalSpec || !original || !alargado) return null;
  if (canonicalSpec.includes(original)) return canonicalSpec.replace(original, alargado);
  const origem = original
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
  const destino = alargado
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
  if (origem.length === 0 || origem.length !== destino.length) return null;
  let spec = canonicalSpec;
  for (let i = 0; i < origem.length; i++) {
    if (origem[i] === destino[i]) continue;
    const idx = spec.indexOf(origem[i]);
    if (idx < 0) return null;
    spec = spec.slice(0, idx) + destino[i] + spec.slice(idx + origem[i].length);
  }
  return spec;
}

/**
 * Lê o texto do contrato da etapa considerando qualquer atualização já feita pelo harness
 * no contrato guardado na sessão (`canonicalSpec`) ou no `payload` da etapa.
 */
export function extrairContratoDaSessaoOuPayload(
  payloadJson?: string | null,
  canonicalSpecSessao?: string | null
): string | string[] {
  let mbInterfaces: string | string[] = "";
  let etapaId = "";
  try {
    const parsed = payloadJson ? JSON.parse(payloadJson) : null;
    mbInterfaces = parsed?.microbrief?.interfacesProduz ?? "";
    etapaId = parsed?.etapaId ?? parsed?.microbrief?.idMicrobrief ?? "";
  } catch {
    mbInterfaces = "";
  }

  if (!canonicalSpecSessao) return mbInterfaces;

  // Se o contrato da sessão (`canonicalSpec`) já foi alargado pelo harness para esta etapa ou para os símbolos de `interfacesProduz`,
  // combina as assinaturas atualizadas da sessão.
  const baseText = Array.isArray(mbInterfaces) ? mbInterfaces.join("\n") : String(mbInterfaces || "");
  const simbolos = Array.from(
    baseText.matchAll(/\b(?:export\s+(?:type|interface|function|const)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[=:(\s]/g)
  )
    .map((m) => m[1])
    .filter((s) => s && !["export", "type", "interface", "function", "const", "Promise"].includes(s));

  const linhasSessao: string[] = [];
  for (const sym of simbolos) {
    const re = new RegExp(`[^\\n]*\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^\\n]*`, "g");
    for (const m of canonicalSpecSessao.matchAll(re)) {
      if (m[0].includes("{") && m[0].includes("}")) {
        linhasSessao.push(m[0].trim());
      }
    }
  }
  if (etapaId && canonicalSpecSessao.includes(etapaId)) {
    for (const m of canonicalSpecSessao.matchAll(/"interfacesProduz"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) {
      linhasSessao.push(m[1]);
    }
  }

  if (linhasSessao.length > 0) {
    return [baseText, ...linhasSessao].filter(Boolean).join("\n");
  }
  return mbInterfaces;
}

function removerExigenciasForaDoContratoDoCriterio(criterio: string, camposFaltantes: string[]): string {
  let limpo = criterio;
  for (const conceito of CONCEITOS_RETORNO_CONHECIDOS) {
    if (camposFaltantes.includes(conceito.rotulo)) {
      limpo = limpo
        .replace(
          new RegExp(
            `(?:,?\\s*(?:com|incluindo|contendo|gerando|retornando|exibindo|e|ou)\\s+)?${conceito.padraoCriterio.source}`,
            "gi"
          ),
          ""
        )
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }
  for (const campo of camposFaltantes) {
    const esc = campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    limpo = limpo.replace(new RegExp(`\`${esc}\``, "gi"), "").replace(/\s{2,}/g, " ").trim();
  }
  return limpo || "Cumprir estritamente o retorno declarado no contrato da etapa.";
}

/**
 * Quando a decisão humana é "vale o contrato":
 * - O critério original permanece no registro (`payload`).
 * - Do pedido ativo desta etapa (para teste de aceite, executor e auditor cego) saem os campos que o retorno do contrato não nomeia.
 */
export function filtrarMicrobriefPorValeContrato(
  microbrief: MicrobriefAndReportDocument,
  camposFaltantes: string[],
  camposRetornoContrato: string[]
): MicrobriefAndReportDocument {
  if (camposFaltantes.length === 0) return microbrief;
  const novosCriteriosPorReq: Record<string, string[]> = {};
  for (const [reqId, lista] of Object.entries(microbrief.criteriosAceitePorReq ?? {})) {
    const filtrados = (lista ?? [])
      .map((crit) => {
        const check = verificarPedidoUnico(microbrief.interfacesProduz, [crit]);
        if (check.coerente) return crit;
        return removerExigenciasForaDoContratoDoCriterio(crit, camposFaltantes);
      })
      .filter(Boolean);
    novosCriteriosPorReq[reqId] =
      filtrados.length > 0
        ? filtrados
        : [`Retornar apenas os campos do contrato da etapa ({ ${camposRetornoContrato.join(", ")} }).`];
  }

  return {
    ...microbrief,
    criteriosAceitePorReq: novosCriteriosPorReq,
  };
}

function textoMencionaCampoIgnorado(texto: string, camposIgnorados: string[]): boolean {
  if (!texto || camposIgnorados.length === 0) return false;
  const normTexto = normalizarTokenCampo(texto);
  for (const campo of camposIgnorados) {
    const conceito = CONCEITOS_RETORNO_CONHECIDOS.find((c) => c.rotulo === campo || c.propriedade === campo);
    if (conceito && conceito.padraoCriterio.test(texto)) return true;
    const normCampo = normalizarTokenCampo(campo);
    if (normCampo && normTexto.includes(normCampo)) return true;
  }
  return false;
}

/**
 * Filtra testes de aceite e falhas de aceite quando "vale o contrato" está ativo:
 * não reprova por campo que o retorno do contrato não nomeia.
 */
export function filtrarFalhasAceitePorValeContrato<T extends { file: string; txt: string }>(
  falhas: T[],
  testes: ReadonlyArray<Pick<AcceptanceTest, "caminho" | "conteudo">>,
  camposIgnorados: string[]
): { contar: T[]; descartadosPorValeContrato: T[] } {
  if (camposIgnorados.length === 0) return { contar: falhas, descartadosPorValeContrato: [] };
  const contar: T[] = [];
  const descartadosPorValeContrato: T[] = [];
  for (const f of falhas) {
    if (textoMencionaCampoIgnorado(f.txt, camposIgnorados)) {
      descartadosPorValeContrato.push(f);
    } else {
      contar.push(f);
    }
  }
  return { contar, descartadosPorValeContrato };
}

/**
 * Filtra o resultado da auditoria cega quando "vale o contrato" está ativo:
 * remove reprovações por campos que o retorno do contrato não nomeia.
 */
export function filtrarAuditoriaPorValeContrato(
  type2Res: ValidationType2Result,
  camposIgnorados: string[]
): ValidationType2Result {
  if (camposIgnorados.length === 0 || type2Res.verdict === "APPROVED") return type2Res;

  const problemasRestantes = (type2Res.problemas ?? []).filter(
    (p) => !textoMencionaCampoIgnorado(`${p.descricao ?? ""} ${p.arquivoLinha ?? ""}`, camposIgnorados)
  );
  const criticosRestantes = problemasRestantes.filter((p) => p.severidade === "critico");

  const reqVerdictsAtualizados = (type2Res.reqVerdicts ?? []).map((rv) => {
    if (rv.status !== "implementado" && textoMencionaCampoIgnorado(rv.evidencia ?? "", camposIgnorados)) {
      return { ...rv, status: "implementado" as const };
    }
    return rv;
  });
  const algumReqNaoImplementado = reqVerdictsAtualizados.some((rv) => rv.status !== "implementado");

  // Se toda a razão da rejeição era por campo fora do contrato e não restou problema crítico nem erro mecânico:
  if (
    criticosRestantes.length === 0 &&
    !algumReqNaoImplementado &&
    textoMencionaCampoIgnorado(type2Res.rejectionReason ?? "", camposIgnorados)
  ) {
    return {
      ...type2Res,
      verdict: "APPROVED",
      rawVerdict: problemasRestantes.length > 0 ? "APROVADO_COM_RESSALVA" : "APROVADO",
      problemas: problemasRestantes,
      reqVerdicts: reqVerdictsAtualizados,
      rejectionReason: undefined,
    };
  }

  return {
    ...type2Res,
    problemas: problemasRestantes,
    reqVerdicts: reqVerdictsAtualizados,
  };
}

/**
 * Alarga puramente o texto do tipo de retorno do contrato (`interfacesProduz`) para incluir os campos exigidos.
 * Quando a etapa tem múltiplas funções em `interfacesProduz`, alarga apenas a declaração associada ao critério conflitante
 * (usando chaves balanceadas para não corromper objetos aninhados de outras funções).
 */
function sugerirCamposDosCriterios(criterios: readonly string[]): CampoSugeridoContrato[] {
  const out: CampoSugeridoContrato[] = [];
  const vistos = new Set<string>();
  const push = (campo: CampoSugeridoContrato) => {
    if (identificadorEhStatus(campo.propriedade)) return;
    const norm = normalizarTokenCampo(campo.propriedade);
    if (!norm || vistos.has(norm)) return;
    vistos.add(norm);
    out.push({
      ...campo,
      tipo: !campo.tipo || campo.tipo === "unknown" ? "string" : campo.tipo,
    });
  };
  for (const criterio of criterios) {
    for (const conceito of CONCEITOS_RETORNO_CONHECIDOS) {
      if (conceito.padraoCriterio.test(criterio)) {
        push({ rotulo: conceito.rotulo, propriedade: conceito.propriedade, tipo: conceito.tipo });
      }
    }
    for (const exp of extrairCamposExplicitosDeClausulaRetorno(criterio)) {
      const expNorm = normalizarTokenCampo(exp.propriedade);
      const jaCoberto = CONCEITOS_RETORNO_CONHECIDOS.some(
        (c) => c.padraoCampoContrato.test(expNorm) || normalizarTokenCampo(c.propriedade) === expNorm
      );
      if (!jaCoberto) push(exp);
    }
  }
  return out;
}

function promoverCamposNoBloco(
  conteudo: string,
  novos: CampoSugeridoContrato[]
): { texto: string; alterou: boolean } {
  let texto = conteudo;
  let alterou = false;
  for (const novo of novos) {
    const re = new RegExp(`\\b${novo.propriedade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\?\\s*:\\s*[^;]+`, "i");
    if (re.test(texto)) {
      const tipo = !novo.tipo || novo.tipo === "unknown" ? "string" : novo.tipo;
      texto = texto.replace(re, `${novo.propriedade}: ${tipo}`);
      alterou = true;
    }
  }
  const semStatus = texto.replace(/\b[A-Z][A-Z0-9_]*\s*\?\s*:\s*unknown\b\s*;?/g, "");
  if (semStatus !== texto) {
    texto = semStatus;
    alterou = true;
  }
  const obrigatorios = new Set(extrairPropriedadesDeBlocoObjeto(texto).map(normalizarTokenCampo));
  const faltam = novos.filter((c) => !obrigatorios.has(normalizarTokenCampo(c.propriedade)));
  if (faltam.length > 0) {
    const adicao = faltam
      .map((c) => `${c.propriedade}: ${!c.tipo || c.tipo === "unknown" ? "string" : c.tipo}`)
      .join("; ");
    const limpo = texto.trim().replace(/;+\s*$/, "");
    texto = limpo ? `${limpo}; ${adicao}` : adicao;
    alterou = true;
  }
  return { texto: texto.replace(/\s{2,}/g, " ").replace(/;\s*;/g, ";").trim(), alterou };
}

function removerOpcionaisDoBloco(
  conteudo: string,
  propriedades: readonly string[]
): { texto: string; alterou: boolean } {
  let texto = conteudo;
  let alterou = false;
  for (const prop of propriedades) {
    const re = new RegExp(`\\b${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\?\\s*:\\s*[^;]+;?`, "gi");
    const proximo = texto.replace(re, "");
    if (proximo !== texto) {
      texto = proximo;
      alterou = true;
    }
  }
  const semStatus = texto.replace(/\b[A-Z][A-Z0-9_]*\s*\?\s*:\s*unknown\b\s*;?/g, "");
  if (semStatus !== texto) {
    texto = semStatus;
    alterou = true;
  }
  return { texto: texto.replace(/\s{2,}/g, " ").replace(/;\s*;/g, ";").trim(), alterou };
}

export function alargarTextoContratoComCampos(
  interfacesProduz: string | readonly string[],
  camposSugeridos: CampoSugeridoContrato[],
  opcoes?: { criteriosEmConflito?: string[] }
): string {
  const textoBase = Array.isArray(interfacesProduz) ? interfacesProduz.join("\n") : String(interfacesProduz ?? "");
  if (!textoBase || camposSugeridos.length === 0) return textoBase;

  const declaracoes = extrairDeclaracoesRetornoContrato(textoBase);
  const variosRetornos = declaracoes.length > 1;
  const criterios = opcoes?.criteriosEmConflito ?? [];

  const camposDaLinha = (linha: string): CampoSugeridoContrato[] => {
    const exigidos = camposSugeridos.filter((c) => !identificadorEhStatus(c.propriedade));
    if (!variosRetornos) return exigidos;
    if (criterios.length === 0) return [];
    const criteriosDesta = criterios.filter((crit) => {
      const alvo = selecionarDeclaracoesDoCriterio(declaracoes, crit);
      return alvo.length < declaracoes.length && alvo.some((d) => d.linhaOriginal.trim() === linha.trim());
    });
    if (criteriosDesta.length === 0) return [];
    return sugerirCamposDosCriterios(criteriosDesta);
  };

  const reescreverBloco = (
    linha: string,
    transformar: (conteudo: string) => { texto: string; alterou: boolean }
  ): { linhaAlargada: string; alterou: boolean } => {
    const bloco =
      encontrarRetornoAposAssinaturaNaLinha(linha) ??
      (linha.includes("{") ? encontrarBlocoChavesBalanceado(linha, linha.indexOf("{")) : null);
    if (!bloco) return { linhaAlargada: linha, alterou: false };
    const resultado = transformar(bloco.conteudoInterno);
    if (!resultado.alterou) return { linhaAlargada: linha, alterou: false };
    return {
      linhaAlargada: linha.slice(0, bloco.inicioChave) + `{ ${resultado.texto} }` + linha.slice(bloco.fimChaveExclusivo),
      alterou: true,
    };
  };

  const linhas = textoBase.split("\n");
  const camposPorLinha = linhas.map((linha) => camposDaLinha(linha));
  const propriedadesAlvo = Array.from(
    new Set(camposPorLinha.flatMap((lista) => lista.map((c) => c.propriedade)))
  );
  if (variosRetornos && propriedadesAlvo.length === 0) return textoBase;

  let algumaLinhaAlterada = false;
  const novasLinhas = linhas.map((linha, indice) => {
    const trim = linha.trim();
    if (!trim) return linha;
    const desta = camposPorLinha[indice];
    if (desta.length > 0) {
      const { linhaAlargada, alterou } = reescreverBloco(linha, (conteudo) => promoverCamposNoBloco(conteudo, desta));
      if (alterou) algumaLinhaAlterada = true;
      return linhaAlargada;
    }
    if (!variosRetornos) return linha;
    const { linhaAlargada, alterou } = reescreverBloco(linha, (conteudo) =>
      removerOpcionaisDoBloco(conteudo, propriedadesAlvo)
    );
    if (alterou) algumaLinhaAlterada = true;
    return linhaAlargada;
  });

  if (algumaLinhaAlterada) return novasLinhas.join("\n");
  if (variosRetornos) return textoBase;

  const { linhaAlargada } = reescreverBloco(textoBase, (conteudo) =>
    promoverCamposNoBloco(conteudo, camposSugeridos.filter((c) => !identificadorEhStatus(c.propriedade)))
  );
  return linhaAlargada;
}

/**
 * Registra a escolha humana ("vale o contrato" ou "vale o critério") na etapa bloqueada pelo porteiro Pedido Único.
 * - "vale o contrato": mantém o critério no registro, tira os campos conflitantes do pedido desta etapa e devolve a etapa à fila.
 * - "vale o critério": grava a escolha; só depois da escolha o harness pode alargar o retorno no contrato da sessão (sem editar arquivo do projeto alvo).
 *   Enquanto o contrato guardado na sessão não nomear esses campos, a etapa não volta à fila e não chama o executor.
 */
export async function registrarEscolhaPedidoUnico(
  nodeId: string,
  escolha: string,
  opcoes: { alargarContratoNaSessao?: boolean } = {}
): Promise<{
  ok: boolean;
  decisao?: DecisaoPedidoUnico;
  statusEtapa?: string;
  contratoAlargado?: string;
  message: string;
}> {
  const dec = normalizarDecisaoPedidoUnico(escolha);
  if (!dec) {
    return {
      ok: false,
      message: 'Escolha inválida. Informe exatamente "vale o contrato" ou "vale o critério".',
    };
  }

  const task = await prisma.taskNode.findUnique({
    where: { id: nodeId },
    include: { session: { include: { project: true } } },
  });
  if (!task) {
    return { ok: false, message: "Etapa não encontrada." };
  }

  let parsedPayload: Record<string, any> = {};
  try {
    parsedPayload = task.payload ? JSON.parse(task.payload) : {};
  } catch {
    parsedPayload = {};
  }

  const mb = parsedPayload.microbrief as MicrobriefAndReportDocument | undefined;
  const verAtual = verificarPedidoUnico(
    extrairContratoDaSessaoOuPayload(task.payload, task.session?.canonicalSpec),
    mb?.criteriosAceitePorReq ?? []
  );
  const estadoAnterior = lerEstadoPedidoUnico(task.payload);

  const camposSugeridos =
    verAtual.camposSugeridosParaContrato.length > 0
      ? verAtual.camposSugeridosParaContrato
      : (estadoAnterior?.camposSugeridosParaContrato ?? []);
  const camposFaltantes =
    verAtual.camposFaltantes.length > 0 ? verAtual.camposFaltantes : (estadoAnterior?.camposFaltantes ?? []);
  const camposRetorno =
    verAtual.camposRetornoContrato.length > 0
      ? verAtual.camposRetornoContrato
      : (estadoAnterior?.camposRetornoContrato ?? []);
  const criteriosConflitantesAtuais = verAtual.criteriosEmConflito.length
    ? verAtual.criteriosEmConflito
    : (estadoAnterior?.criteriosEmConflito ?? []);

  if (dec.normalizada === "vale_contrato") {
    const novoEstado: EstadoPedidoUnicoEtapa = {
      status: "resolvido",
      camposRetornoContrato: camposRetorno,
      camposFaltantes,
      camposSugeridosParaContrato: camposSugeridos,
      criteriosEmConflito: criteriosConflitantesAtuais,
      criteriosOriginaisNoRegistro:
        estadoAnterior?.criteriosOriginaisNoRegistro ??
        (mb?.criteriosAceitePorReq ? JSON.parse(JSON.stringify(mb.criteriosAceitePorReq)) : undefined),
      decisao: "vale o contrato",
      decisaoNormalizada: "vale_contrato",
      opcoes: ["vale o contrato", "vale o critério"],
      registradoEm: estadoAnterior?.registradoEm ?? new Date().toISOString(),
    };

    const novoPayload = JSON.stringify({
      ...parsedPayload,
      pedidoUnico: novoEstado,
    });

    await prisma.taskNode.update({
      where: { id: task.id },
      data: {
        status: "pending",
        payload: novoPayload,
        result: JSON.stringify({
          pedidoUnicoAguardandoDecisao: false,
          decisaoPedidoUnico: "vale o contrato",
        }),
      },
    });

    TelemetryLogger.log({
      sessionId: task.sessionId,
      action: "PEDIDO_UNICO_DECISION",
      details: { nodeId: task.id, decisao: "vale o contrato", camposIgnorados: camposFaltantes },
    });

    return {
      ok: true,
      decisao: "vale o contrato",
      statusEtapa: "pending",
      message:
        `Decisão registrada: **vale o contrato**. O critério continua no registro e os campos fora do retorno (${camposFaltantes.join(", ")}) ` +
        `saíram do pedido desta etapa. A etapa "${task.title}" voltou à fila.`,
    };
  }

  // Decisão: "vale o critério"
  let contratoAlargado: string | undefined;
  let parsedPayPos = { ...parsedPayload };
  if (opcoes.alargarContratoNaSessao === true && mb?.interfacesProduz) {
    const originalInterfacesTexto = Array.isArray(mb.interfacesProduz)
      ? mb.interfacesProduz.join("\n")
      : String(mb.interfacesProduz);
    contratoAlargado = alargarTextoContratoComCampos(originalInterfacesTexto, camposSugeridos, {
      criteriosEmConflito: criteriosConflitantesAtuais,
    });
    const novasLinhasInterfaces = contratoAlargado
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Se o payload também guarda `contrato.funcoes`, sincroniza a assinatura da função conflitante da etapa
    let contratoObjetoAtualizado = parsedPayPos.contrato;
    if (parsedPayPos.contrato && Array.isArray(parsedPayPos.contrato.funcoes)) {
      const declsOriginais = extrairDeclaracoesRetornoContrato(originalInterfacesTexto);
      const simbolosAlvo = new Set<string>();
      for (const crit of criteriosConflitantesAtuais) {
        const alvo = selecionarDeclaracoesDoCriterio(declsOriginais, crit);
        if (declsOriginais.length > 1 && alvo.length >= declsOriginais.length) continue;
        for (const d of alvo) {
          for (const sym of d.simbolos) simbolosAlvo.add(normalizarTokenCampo(sym));
        }
      }
      contratoObjetoAtualizado = {
        ...parsedPayPos.contrato,
        funcoes: parsedPayPos.contrato.funcoes.map((fn: any) => {
          const pertenceEtapa = !parsedPayPos.etapaId || !fn?.dono || fn.dono === parsedPayPos.etapaId;
          const nomeMatch =
            declsOriginais.length <= 1 ||
            (typeof fn?.nome === "string" && simbolosAlvo.has(normalizarTokenCampo(fn.nome)));
          if (pertenceEtapa && nomeMatch && typeof fn?.assinatura === "string") {
            return {
              ...fn,
              assinatura: alargarTextoContratoComCampos(fn.assinatura, camposSugeridos, {
                criteriosEmConflito: criteriosConflitantesAtuais,
              }),
            };
          }
          return fn;
        }),
      };
    }

    parsedPayPos = {
      ...parsedPayPos,
      contrato: contratoObjetoAtualizado,
      microbrief: {
        ...mb,
        interfacesProduz: Array.isArray(mb.interfacesProduz) ? novasLinhasInterfaces : contratoAlargado,
      },
    };
    if (task.session?.canonicalSpec && originalInterfacesTexto && contratoAlargado) {
      const novaSpec = substituirContratoAlargadoNaSpec(
        task.session.canonicalSpec,
        originalInterfacesTexto,
        contratoAlargado
      );
      if (novaSpec && novaSpec !== task.session.canonicalSpec) {
        await prisma.session.update({
          where: { id: task.sessionId },
          data: { canonicalSpec: novaSpec },
        });
        task.session.canonicalSpec = novaSpec;
        const projectPath = task.session.project?.path;
        if (projectPath) writeCanonicalSpecFile(projectPath, novaSpec);
      }
    }
  }

  const contratoParaChecar = extrairContratoDaSessaoOuPayload(
    JSON.stringify(parsedPayPos),
    task.session?.canonicalSpec
  );
  const verPos = verificarPedidoUnico(contratoParaChecar, mb?.criteriosAceitePorReq ?? camposFaltantes);
  const contratoJaNomeiaCampos = verPos.coerente;

  const novoEstado: EstadoPedidoUnicoEtapa = {
    status: contratoJaNomeiaCampos ? "resolvido" : "conflito",
    camposRetornoContrato: verPos.camposRetornoContrato.length ? verPos.camposRetornoContrato : camposRetorno,
    camposFaltantes: verPos.camposFaltantes,
    camposSugeridosParaContrato: camposSugeridos,
    criteriosEmConflito: verPos.criteriosEmConflito,
    criteriosOriginaisNoRegistro:
      estadoAnterior?.criteriosOriginaisNoRegistro ??
      (mb?.criteriosAceitePorReq ? JSON.parse(JSON.stringify(mb.criteriosAceitePorReq)) : undefined),
    decisao: "vale o critério",
    decisaoNormalizada: "vale_criterio",
    opcoes: ["vale o contrato", "vale o critério"],
    registradoEm: estadoAnterior?.registradoEm ?? new Date().toISOString(),
  };

  const novoStatus = contratoJaNomeiaCampos ? "pending" : "blocked";
  await prisma.taskNode.update({
    where: { id: task.id },
    data: {
      status: novoStatus,
      payload: JSON.stringify({
        ...parsedPayPos,
        pedidoUnico: novoEstado,
      }),
      result: JSON.stringify({
        pedidoUnicoAguardandoDecisao: !contratoJaNomeiaCampos,
        decisaoPedidoUnico: "vale o critério",
        camposFaltantes: verPos.camposFaltantes,
      }),
    },
  });

  TelemetryLogger.log({
    sessionId: task.sessionId,
    action: "PEDIDO_UNICO_DECISION",
    details: {
      nodeId: task.id,
      decisao: "vale o critério",
      contratoJaNomeiaCampos,
      contratoAlargado: Boolean(contratoAlargado),
    },
  });

  return {
    ok: true,
    decisao: "vale o critério",
    statusEtapa: novoStatus,
    ...(contratoAlargado ? { contratoAlargado } : {}),
    message: contratoJaNomeiaCampos
      ? `Decisão registrada: **vale o critério**. O harness alargou o retorno no contrato da sessão e a etapa "${task.title}" voltou à fila.`
      : `Decisão registrada: **vale o critério**. A etapa "${task.title}" continua sem executor até o texto do contrato guardado na sessão nomear os campos (${camposFaltantes.join(", ")}).`,
  };
}

/**
 * Alarga o retorno no contrato guardado na sessão (e no payload da etapa) pelo harness,
 * SOMENTE DEPOIS que a escolha "vale o critério" foi gravada na etapa.
 * Nunca edita nenhum arquivo do projeto alvo no disco.
 */
export async function alargarContratoDaSessaoAposEscolha(nodeId: string): Promise<{
  ok: boolean;
  contratoAlargado?: string;
  message: string;
}> {
  const task = await prisma.taskNode.findUnique({
    where: { id: nodeId },
    include: { session: true },
  });
  if (!task) return { ok: false, message: "Etapa não encontrada." };

  const estado = lerEstadoPedidoUnico(task.payload);
  if (!estado || estado.decisaoNormalizada !== "vale_criterio") {
    return {
      ok: false,
      message: 'O harness só alarga o retorno no contrato da sessão depois da escolha "vale o critério".',
    };
  }

  const res = await registrarEscolhaPedidoUnico(nodeId, "vale o critério", { alargarContratoNaSessao: true });
  return {
    ok: res.ok,
    contratoAlargado: res.contratoAlargado,
    message: res.message,
  };
}

// ============================================================================
// FATIA 2 — A MESMA LACUNA NA TENTATIVA SEGUINTE
// ============================================================================

export interface CitacaoArquivoLinha {
  referencia: string;
  arquivo: string;
  linhaInicio: number;
  linhaFim: number;
  descricaoCompleta: string;
  severidade?: "critico" | "menor";
}

function normalizarCaminhoArquivo(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Extrai todas as citações `arquivo:linha` (ou `arquivo:inicio-fim`) de uma rejeição ou lista de problemas.
 */
export function extrairCitacoesArquivoLinha(
  rejeicaoTexto?: string | null,
  problemas?: ReadonlyArray<{ severidade?: string; arquivoLinha?: string; descricao?: string }> | null
): CitacaoArquivoLinha[] {
  const resultados: CitacaoArquivoLinha[] = [];
  const chavesVistas = new Set<string>();

  const adicionar = (
    arquivoRaw: string,
    inicioRaw: number,
    fimRaw: number,
    descricaoCompleta: string,
    severidade?: "critico" | "menor"
  ) => {
    const arquivo = normalizarCaminhoArquivo(arquivoRaw);
    if (!arquivo || /^(?:https?|ftp|file)$/i.test(arquivo)) return;
    const linhaInicio = Math.max(1, inicioRaw);
    const linhaFim = Math.max(linhaInicio, fimRaw);
    const referencia = linhaFim > linhaInicio ? `${arquivo}:${linhaInicio}-${linhaFim}` : `${arquivo}:${linhaInicio}`;
    const chave = `${arquivo}:${linhaInicio}-${linhaFim}`;
    if (chavesVistas.has(chave)) return;
    chavesVistas.add(chave);
    resultados.push({
      referencia,
      arquivo,
      linhaInicio,
      linhaFim,
      descricaoCompleta: descricaoCompleta.trim(),
      severidade,
    });
  };

  if (Array.isArray(problemas)) {
    for (const p of problemas) {
      if (p?.severidade === "menor") continue;
      const al = (p?.arquivoLinha ?? "").trim();
      const m = /^([A-Za-z0-9_.$@()[\]/\\-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?$/.exec(al);
      if (m) {
        const ini = Number(m[2]);
        const fim = m[3] ? Number(m[3]) : ini;
        const sev = p.severidade === "menor" ? "menor" : "critico";
        const desc = p.descricao ? `[${sev}] ${al} — ${p.descricao}` : `[${sev}] ${al}`;
        adicionar(m[1], ini, fim, desc, sev);
      }
    }
  }

  if (rejeicaoTexto) {
    const segmentos = rejeicaoTexto
      .split(/\n|;\s*(?=\[(?:critico|menor)\]|\b[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+:\d+)/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const seg of segmentos) {
      if (/^\[menor\]/i.test(seg)) continue;
      const re = /([A-Za-z0-9_.$@()[\]/\\-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?(?::\d+)?/g;
      for (const m of seg.matchAll(re)) {
        const ini = Number(m[2]);
        const fim = m[3] ? Number(m[3]) : ini;
        adicionar(m[1], ini, fim, seg, "critico");
      }
    }
  }

  return resultados;
}

function encontrarConteudoArquivoNoMapa(
  mapa: Record<string, string> | null | undefined,
  arquivoAlvo: string
): string | null {
  if (!mapa) return null;
  const alvo = normalizarCaminhoArquivo(arquivoAlvo);
  for (const [k, v] of Object.entries(mapa)) {
    const normK = normalizarCaminhoArquivo(k);
    if (normK === alvo || normK.endsWith(`/${alvo}`) || alvo.endsWith(`/${normK}`)) {
      return typeof v === "string" ? v : null;
    }
  }
  return null;
}

function extrairFatiasDeLinhas(conteudo: string, linhaInicio: number, linhaFim: number): string {
  const linhas = conteudo.replace(/\r\n/g, "\n").split("\n");
  const idxIni = Math.max(0, linhaInicio - 1);
  const idxFim = Math.min(linhas.length, linhaFim);
  if (idxIni >= linhas.length) return conteudo.replace(/\r\n/g, "\n").trim();
  return linhas
    .slice(idxIni, idxFim)
    .map((l) => l.trim())
    .join("\n");
}

/**
 * Verifica se o código novo mostra que o trecho citado (`arquivo:linha` ou `arquivo:inicio-fim`) mudou
 * em relação ao código da tentativa anterior.
 */
export function trechoCitadoMudouNoCodigoNovo(
  citacao: Pick<CitacaoArquivoLinha, "arquivo" | "linhaInicio" | "linhaFim">,
  codigoAnterior: Record<string, string> | null | undefined,
  codigoNovo: Record<string, string> | null | undefined
): boolean {
  const antes = encontrarConteudoArquivoNoMapa(codigoAnterior, citacao.arquivo);
  const depois = encontrarConteudoArquivoNoMapa(codigoNovo, citacao.arquivo);

  // Se o código novo nem entregou o arquivo citado, o trecho não foi corrigido.
  if (depois === null) return false;
  // Se não havia snapshot anterior do arquivo, não há como provar que o trecho permaneceu igual sem base anterior.
  if (antes === null) return false;

  const trechoAntes = extrairFatiasDeLinhas(antes, citacao.linhaInicio, citacao.linhaFim);
  const trechoDepois = extrairFatiasDeLinhas(depois, citacao.linhaInicio, citacao.linhaFim);

  return trechoAntes !== trechoDepois;
}

export interface ReguaMesmaLacunaInput {
  rejeicaoAnterior?: string | null;
  problemasAnteriores?: ReadonlyArray<{ severidade?: string; arquivoLinha?: string; descricao?: string }> | null;
  codigoAnterior?: Record<string, string> | null;
  codigoNovo?: Record<string, string> | null;
  rejeicaoNova?: string | null;
  problemasNovos?: ReadonlyArray<BlindAuditProblem> | null;
}

export interface ReguaMesmaLacunaOutput {
  rejeicaoFinal: string | undefined;
  problemasFinais: BlindAuditProblem[];
  lacunasQuePermaneceram: CitacaoArquivoLinha[];
  forcarRejeicao: boolean;
}

/**
 * FATIA 2 — Se a rejeição anterior cita `arquivo:linha`, a rejeição nova tem de repetir essa citação
 * enquanto o código novo não mostrar que aquele trecho mudou.
 * Lacuna nova pode ser acrescentada e não apaga a anterior.
 * Não trata auditorias com listas diferentes como "já corrigido".
 */
export function aplicarReguaMesmaLacuna(input: ReguaMesmaLacunaInput): ReguaMesmaLacunaOutput {
  const citacoesAnteriores = extrairCitacoesArquivoLinha(input.rejeicaoAnterior, input.problemasAnteriores);
  const problemasNovos = [...(input.problemasNovos ?? [])];
  const rejeicaoNovaBase = (input.rejeicaoNova ?? "").trim();

  if (citacoesAnteriores.length === 0 || !input.codigoAnterior) {
    return {
      rejeicaoFinal: rejeicaoNovaBase || undefined,
      problemasFinais: problemasNovos,
      lacunasQuePermaneceram: [],
      forcarRejeicao: false,
    };
  }

  const lacunasQuePermaneceram: CitacaoArquivoLinha[] = [];
  for (const cit of citacoesAnteriores) {
    const mudou = trechoCitadoMudouNoCodigoNovo(cit, input.codigoAnterior, input.codigoNovo);
    if (!mudou) {
      lacunasQuePermaneceram.push(cit);
    }
  }

  if (lacunasQuePermaneceram.length === 0) {
    return {
      rejeicaoFinal: rejeicaoNovaBase || undefined,
      problemasFinais: problemasNovos,
      lacunasQuePermaneceram: [],
      forcarRejeicao: false,
    };
  }

  const problemasFinais: BlindAuditProblem[] = [];
  for (const perm of lacunasQuePermaneceram) {
    const jaExisteEmProblemasNovos = problemasNovos.some(
      (p) => normalizarCaminhoArquivo(p.arquivoLinha ?? "") === perm.referencia
    );
    if (!jaExisteEmProblemasNovos) {
      const descLimpa = perm.descricaoCompleta
        .replace(/^\[(?:critico|menor)\]\s*/i, "")
        .replace(new RegExp(`^${perm.referencia.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—:-]?\\s*`), "")
        .trim();
      problemasFinais.push({
        severidade: "critico",
        arquivoLinha: perm.referencia,
        descricao: descLimpa || `Trecho em ${perm.referencia} permaneceu sem alteração.`,
      });
    }
  }
  problemasFinais.push(...problemasNovos);

  const faltandoNoTextoNovo = lacunasQuePermaneceram.filter((perm) => !rejeicaoNovaBase.includes(perm.referencia));
  const prefixoRepetido = faltandoNoTextoNovo.map((perm) => perm.descricaoCompleta).join("; ");

  let rejeicaoFinal: string;
  if (prefixoRepetido && rejeicaoNovaBase) {
    rejeicaoFinal = `${prefixoRepetido}; ${rejeicaoNovaBase}`;
  } else if (prefixoRepetido) {
    rejeicaoFinal = `Auditoria cega (LLM) concluiu que o Brief NÃO foi implementado: ${prefixoRepetido}`;
  } else {
    rejeicaoFinal = rejeicaoNovaBase;
  }

  return {
    rejeicaoFinal,
    problemasFinais,
    lacunasQuePermaneceram,
    forcarRejeicao: true,
  };
}

export const preservarLacunaAnteriorNaRejeicao = aplicarReguaMesmaLacuna;

/**
 * Aviso para quando a etapa para porque a mesma lacuna (`arquivo:linha`) permaneceu entre tentativas:
 * nomeia a lacuna que permaneceu, mantém a Spec (sem pedir para dividir a Spec) e apresenta um botão: Re-tentar.
 */
export function construirAvisoLacunaPermanente(
  lacunas: ReadonlyArray<string | CitacaoArquivoLinha>
): string {
  const descricoes = lacunas
    .map((l) => (typeof l === "string" ? l.trim() : `${l.referencia} (${l.descricaoCompleta})`))
    .filter(Boolean);
  const lista = descricoes.length > 0 ? descricoes.join("; ") : "lacuna anterior não alterada";
  return (
    `Lacuna que permaneceu: ${lista}. ` +
    `A Spec permanece. ` +
    `Botão: **Re-tentar**.`
  );
}

export const formatRemainingGapNotice = construirAvisoLacunaPermanente;
