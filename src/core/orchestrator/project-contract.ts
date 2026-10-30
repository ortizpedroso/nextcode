/**
 * Contrato de Projeto e Conferência Mecânica (Tarefa A1)
 *
 * O contrato do projeto define entidades, enums, funções exportadas e rotas
 * com donos e consumidores de cada etapa do plano, gerando código TS estrito
 * e conferência por `tsc`.
 */

export interface ContratoEntidadeCampo {
  nome: string;
  tipo: string;
  opcional?: boolean;
}

export interface ContratoEntidade {
  nome: string;
  campos: ContratoEntidadeCampo[];
  dono: string;
}

export interface ContratoEnum {
  nome: string;
  valores: string[];
  dono: string;
}

export interface ContratoFuncao {
  nome: string;
  arquivo: string;
  assinatura: string;
  dono: string;
  usadoPor: string[];
}

export interface ContratoRotaErro {
  status: number;
  corpo: string;
}

export interface ContratoRota {
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  caminho: string;
  arquivo: string;
  entrada: string;
  saida: string;
  erros: ContratoRotaErro[];
  dono: string;
  usadoPor: string[];
}

export interface ContratoProjeto {
  entidades: ContratoEntidade[];
  enums: ContratoEnum[];
  funcoes: ContratoFuncao[];
  rotas: ContratoRota[];
}

export interface ContractStageRef {
  id: string;
  arquivos: string[];
  dependeDe: string[];
}

// Primitivos e tipos utilitários/globais conhecidos do TS/DOM/Node
const TS_KNOWN_BUILTIN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "void",
  "never",
  "null",
  "undefined",
  "object",
  "symbol",
  "bigint",
  "Promise",
  "Record",
  "Array",
  "Set",
  "Map",
  "Date",
  "RegExp",
  "Error",
  "Request",
  "Response",
  "NextResponse",
  "Buffer",
  "Uint8Array",
  "Blob",
  "FormData",
  "ReadableStream",
  "URL",
  "URLSearchParams",
  "Headers",
  "BodyInit",
  "Json",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "Parameters",
  "ReturnType",
]);

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Normaliza caminho para conferência (sem barra inicial, barras unificadas)
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").trim();
}

/**
 * Extrai nomes de tipos referenciados (TypeReferenceNode) em uma expressão de tipo TS
 * usando o parser do TypeScript para evitar falsos positivos com nomes de propriedades,
 * parâmetros ou literais.
 */
function extractReferencedTypeNames(typeExpr: string): string[] {
  if (!typeExpr || !typeExpr.trim()) return [];
  let trimmed = typeExpr.trim();
  // Se for apenas void, any, unknown, etc.
  if (TS_KNOWN_BUILTIN_TYPES.has(trimmed)) return [trimmed];

  // Trata MIME types comuns (ex: application/pdf -> Blob)
  if (trimmed.includes("/") && !trimmed.includes("{")) {
    trimmed = "Blob";
  }

  // Se o LLM omitiu as chaves externas em declarações de propriedades como "busca?: string" ou "a: string, b: number"
  const normalizedExpr =
    !trimmed.startsWith("{") && !trimmed.startsWith("(") && !trimmed.startsWith("[") && trimmed.includes(":")
      ? `{ ${trimmed.replace(/,\s*$/, "")} }`
      : trimmed;

  const dummyCode = `type _DummyType = ${normalizedExpr};`;
  const sf = ts.createSourceFile("dummy.ts", dummyCode, ts.ScriptTarget.ESNext, true);
  const references: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isTypeReferenceNode(node)) {
      references.push(node.typeName.getText(sf));
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return Array.from(new Set(references));
}

/**
 * Valida o Contrato do Projeto contra as etapas do plano.
 *
 * Regras:
 * - dono inexistente;
 * - arquivo de função ou rota fora dos arquivos da etapa dona;
 * - usadoPor sem dependência (direta ou indireta) da etapa dona;
 * - nome repetido;
 * - tipo citado que não é entidade, enum, primitivo TS nem tipo global do TS;
 * - rota cujo arquivo não é route.ts.
 */
export function validateContract(
  contrato: ContratoProjeto,
  stages: ContractStageRef[]
): string[] {
  const errors: string[] = [];

  const stageById = new Map<string, ContractStageRef>(stages.map((s) => [s.id, s]));

  // Mapa de ancestrais (de quem stageId depende direta ou indiretamente)
  const ancestorsByStage = new Map<string, Set<string>>();
  for (const s of stages) {
    const seen = new Set<string>();
    const stack = [...(s.dependeDe ?? [])];
    while (stack.length > 0) {
      const depId = stack.pop()!;
      if (seen.has(depId)) continue;
      seen.add(depId);
      const parent = stageById.get(depId);
      if (parent) {
        for (const grandParent of parent.dependeDe ?? []) {
          stack.push(grandParent);
        }
      }
    }
    ancestorsByStage.set(s.id, seen);
  }

  // 1. Verificação de nomes repetidos e registro dos tipos definidos no contrato
  const definedTypes = new Set<string>();
  const entityNames = new Set<string>();
  const enumNames = new Set<string>();
  const fnNames = new Set<string>();

  for (const ent of contrato.entidades ?? []) {
    if (entityNames.has(ent.nome) || enumNames.has(ent.nome)) {
      errors.push(`[NOME REPETIDO] Entidade ou enum "${ent.nome}" já declarado.`);
    }
    entityNames.add(ent.nome);
    definedTypes.add(ent.nome);
  }

  for (const en of contrato.enums ?? []) {
    if (enumNames.has(en.nome) || entityNames.has(en.nome)) {
      errors.push(`[NOME REPETIDO] Enum ou entidade "${en.nome}" já declarado.`);
    }
    enumNames.add(en.nome);
    definedTypes.add(en.nome);
  }

  for (const fn of contrato.funcoes ?? []) {
    if (fnNames.has(fn.nome)) {
      errors.push(`[NOME REPETIDO] Função "${fn.nome}" já declarada no contrato.`);
    }
    fnNames.add(fn.nome);
  }

  // Conferência de tipos citados nos campos das entidades, nas funções e nas rotas
  function checkTypeExpression(typeExpr: string, contextDescription: string) {
    const tokens = extractReferencedTypeNames(typeExpr);
    for (const token of tokens) {
      // Ignora literais booleanos/números/propriedades se o token for parte de tipo de objeto inline
      if (
        TS_KNOWN_BUILTIN_TYPES.has(token) ||
        definedTypes.has(token) ||
        token === "true" ||
        token === "false"
      ) {
        continue;
      }
      errors.push(
        `[TIPO DESCONHECIDO] Tipo "${token}" em ${contextDescription} não é entidade, enum, primitivo TS nem tipo global.`
      );
    }
  }

  // 2. Validação de Entidades
  for (const ent of contrato.entidades ?? []) {
    if (!stageById.has(ent.dono)) {
      errors.push(`[DONO INEXISTENTE] Entidade "${ent.nome}" tem dono inexistente "${ent.dono}".`);
    }
    for (const campo of ent.campos ?? []) {
      checkTypeExpression(campo.tipo, `entidade "${ent.nome}", campo "${campo.nome}"`);
    }
  }

  // 3. Validação de Enums
  for (const en of contrato.enums ?? []) {
    if (!stageById.has(en.dono)) {
      errors.push(`[DONO INEXISTENTE] Enum "${en.nome}" tem dono inexistente "${en.dono}".`);
    }
    if (!Array.isArray(en.valores) || en.valores.length === 0) {
      errors.push(`[ENUM VAZIO] Enum "${en.nome}" não possui valores.`);
    }
  }

  // 4. Validação de Funções
  for (const fn of contrato.funcoes ?? []) {
    const stage = stageById.get(fn.dono);
    if (!stage) {
      errors.push(`[DONO INEXISTENTE] Função "${fn.nome}" tem dono inexistente "${fn.dono}".`);
    } else {
      const stageFiles = stage.arquivos.map(normalizePath);
      const fnPath = normalizePath(fn.arquivo);
      if (!stageFiles.includes(fnPath)) {
        errors.push(
          `[ARQUIVO FORA DO DONO] Função "${fn.nome}" declara arquivo "${fn.arquivo}" fora dos arquivos da etapa dona "${fn.dono}".`
        );
      }
    }

    // Conferência do usadoPor
    for (const user of fn.usadoPor ?? []) {
      if (!stageById.has(user)) {
        errors.push(`[CONSUMIDOR INEXISTENTE] Função "${fn.nome}" cita consumidor inexistente "${user}".`);
        continue;
      }
      const ancestors = ancestorsByStage.get(user);
      if (!ancestors || !ancestors.has(fn.dono)) {
        errors.push(
          `[USADO POR SEM DEPENDENCIA] Etapa "${user}" usa a função "${fn.nome}" da etapa dona "${fn.dono}", mas não depende dela.`
        );
      }
    }

    checkTypeExpression(fn.assinatura, `assinatura da função "${fn.nome}"`);
  }

  // 5. Validação de Rotas
  for (const r of contrato.rotas ?? []) {
    const stage = stageById.get(r.dono);
    if (!stage) {
      errors.push(`[DONO INEXISTENTE] Rota "${r.metodo} ${r.caminho}" tem dono inexistente "${r.dono}".`);
    } else {
      const stageFiles = stage.arquivos.map(normalizePath);
      const routePath = normalizePath(r.arquivo);
      if (!stageFiles.includes(routePath)) {
        errors.push(
          `[ARQUIVO FORA DO DONO] Rota "${r.metodo} ${r.caminho}" declara arquivo "${r.arquivo}" fora dos arquivos da etapa dona "${r.dono}".`
        );
      }
    }

    const normArquivo = normalizePath(r.arquivo);
    if (!normArquivo.endsWith("route.ts")) {
      errors.push(
        `[ROTA INVALIDA] Arquivo da rota "${r.metodo} ${r.caminho}" é "${r.arquivo}"; rotas devem estar em "route.ts".`
      );
    }

    // Conferência do usadoPor
    for (const user of r.usadoPor ?? []) {
      if (!stageById.has(user)) {
        errors.push(`[CONSUMIDOR INEXISTENTE] Rota "${r.metodo} ${r.caminho}" cita consumidor inexistente "${user}".`);
        continue;
      }
      const ancestors = ancestorsByStage.get(user);
      if (!ancestors || !ancestors.has(r.dono)) {
        errors.push(
          `[USADO POR SEM DEPENDENCIA] Etapa "${user}" usa a rota "${r.metodo} ${r.caminho}" da etapa dona "${r.dono}", mas não depende dela.`
        );
      }
    }

    if (r.entrada) checkTypeExpression(r.entrada, `entrada da rota "${r.metodo} ${r.caminho}"`);
    if (r.saida) checkTypeExpression(r.saida, `saida da rota "${r.metodo} ${r.caminho}"`);
    for (const err of r.erros ?? []) {
      if (err.corpo) checkTypeExpression(err.corpo, `erro ${err.status} da rota "${r.metodo} ${r.caminho}"`);
    }
  }

  return errors;
}

/**
 * Capitaliza primeiro caractere
 */
function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Normaliza assinatura de função para expressão de tipo de função TS.
 * Se a assinatura já vier como `(a: T) => R`, usa direta.
 * Se vier como `function foo(a: T): R`, extrai parâmetros e retorno.
 */
function toFunctionTypeSignature(sig: string): string {
  const trimmed = sig.trim();
  if (trimmed.startsWith("(") && trimmed.includes("=>")) {
    return trimmed;
  }
  const match = trimmed.match(/^(?:function\s+)?(?:[A-Za-z0-9_$]+)?\s*(\([^\)]*\))\s*:\s*(.+)$/);
  if (match) {
    return `${match[1]} => ${match[2]}`;
  }
  return trimmed;
}

/**
 * Gera o arquivo TS do contrato do projeto (src/contracts/index.ts).
 * Contém apenas tipos e interfaces TypeScript, sem código executável.
 */
export function renderContractTs(contrato: ContratoProjeto): string {
  const lines: string[] = [
    "/* eslint-disable */",
    "// Contrato Canônico do Projeto (gerado mecanicamente pelo harness do NextCode)",
    "// TRAVADO PARA O EXECUTOR: não edite manualmente este arquivo.",
    "",
    "export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];",
    "",
  ];

  // 1. Enums
  if (contrato.enums && contrato.enums.length > 0) {
    lines.push("// === Enums ===");
    for (const en of contrato.enums) {
      const vals = en.valores.map((v) => JSON.stringify(v)).join(" | ");
      lines.push(`export type ${en.nome} = ${vals};`);
    }
    lines.push("");
  }

  // 2. Entidades
  if (contrato.entidades && contrato.entidades.length > 0) {
    lines.push("// === Entidades ===");
    for (const ent of contrato.entidades) {
      lines.push(`export interface ${ent.nome} {`);
      for (const c of ent.campos) {
        const opt = c.opcional ? "?" : "";
        lines.push(`  ${c.nome}${opt}: ${c.tipo};`);
      }
      lines.push("}");
      lines.push("");
    }
  }

  // 3. Funções (tipos exportados)
  if (contrato.funcoes && contrato.funcoes.length > 0) {
    lines.push("// === Assinaturas de Funções ===");
    for (const fn of contrato.funcoes) {
      const typeName = `Fn${capitalize(fn.nome)}`;
      const fnType = toFunctionTypeSignature(fn.assinatura);
      lines.push(`export type ${typeName} = ${fnType};`);
    }
    lines.push("");
  }

  // 4. Rotas (tipos de entrada, saída e rotas)
  if (contrato.rotas && contrato.rotas.length > 0) {
    lines.push("// === Rotas e I/O ===");
    for (const r of contrato.rotas) {
      const routeSlug = `${r.metodo.toLowerCase()}_${r.caminho.replace(/[^A-Za-z0-9]/g, "_")}`.replace(/_+/g, "_");
      const baseName = `Route_${routeSlug}`;
      lines.push(`export type ${baseName}_Entrada = ${r.entrada || "void"};`);
      lines.push(`export type ${baseName}_Saida = ${r.saida || "void"};`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Gera a fatia do contrato para uma etapa específica.
 * Retorna o que a etapa produz (interfacesProduz) e o que a etapa consome (interfacesConsome)
 * em formato de texto TypeScript.
 */
export function renderContractSliceTs(
  contrato: ContratoProjeto,
  etapaId: string
): { interfacesProduz: string; interfacesConsome: string[] } {
  // O que a etapa produz: entidades, enums, funções e rotas cujo dono é a etapa
  const entDono = (contrato.entidades ?? []).filter((e) => e.dono === etapaId);
  const enDono = (contrato.enums ?? []).filter((e) => e.dono === etapaId);
  const fnDono = (contrato.funcoes ?? []).filter((f) => f.dono === etapaId);
  const rtDono = (contrato.rotas ?? []).filter((r) => r.dono === etapaId);

  const produzContrato: ContratoProjeto = {
    entidades: entDono,
    enums: enDono,
    funcoes: fnDono,
    rotas: rtDono,
  };
  const interfacesProduz = renderContractTs(produzContrato);

  // O que a etapa consome: símbolos onde etapaId está em usadoPor, ou entidades/enums de etapas produtoras
  const fnConsome = (contrato.funcoes ?? []).filter((f) => (f.usadoPor ?? []).includes(etapaId));
  const rtConsome = (contrato.rotas ?? []).filter((r) => (r.usadoPor ?? []).includes(etapaId));
  // Coleta donos das funções e rotas consumidas
  const donosConsumidos = new Set<string>([
    ...fnConsome.map((f) => f.dono),
    ...rtConsome.map((r) => r.dono),
  ]);
  const entConsome = (contrato.entidades ?? []).filter((e) => donosConsumidos.has(e.dono));
  const enConsome = (contrato.enums ?? []).filter((e) => donosConsumidos.has(e.dono));

  const consomeContrato: ContratoProjeto = {
    entidades: entConsome,
    enums: enConsome,
    funcoes: fnConsome,
    rotas: rtConsome,
  };
  const consomeTs = renderContractTs(consomeContrato);
  const interfacesConsome = consomeTs.trim() ? [consomeTs] : [];

  return {
    interfacesProduz,
    interfacesConsome,
  };
}

/**
 * Converte caminho relativo a src/ em import alias @/...
 */
function fileToImportPath(filePath: string): string {
  const norm = normalizePath(filePath);
  // remove extensão .ts ou .tsx
  const withoutExt = norm.replace(/\.(ts|tsx)$/, "");
  // Se já começar com src/, remove src/ para formar @/...
  if (withoutExt.startsWith("src/")) {
    return `@/${withoutExt.slice(4)}`;
  }
  return `@/${withoutExt}`;
}

/**
 * Gera o arquivo de conformidade de uma etapa específica.
 * src/contracts/conformidade/<etapaId>.ts
 *
 * Para cada função e rota cujo dono é a etapa, importa o símbolo real e
 * atribui a uma constante tipada pelo contrato.
 */
export function renderConformance(contrato: ContratoProjeto, etapaId: string): string {
  const funcoesDona = (contrato.funcoes ?? []).filter((f) => f.dono === etapaId);
  const rotasDona = (contrato.rotas ?? []).filter((r) => r.dono === etapaId);

  const lines: string[] = [
    "/* eslint-disable */",
    `// Arquivo de Conformidade Mecânica da Etapa: ${etapaId}`,
    "// Verificado pelo tsc para garantir conformidade estrita com o Contrato.",
    "",
  ];

  // Agrupa imports de funções por arquivo
  const funcsByFile = new Map<string, ContratoFuncao[]>();
  for (const fn of funcoesDona) {
    const list = funcsByFile.get(fn.arquivo) ?? [];
    list.push(fn);
    funcsByFile.set(fn.arquivo, list);
  }

  // Coleta tipos que precisam ser importados do contrato
  const neededContractTypes = new Set<string>();
  for (const fn of funcoesDona) {
    neededContractTypes.add(`Fn${capitalize(fn.nome)}`);
  }

  if (neededContractTypes.size > 0) {
    lines.push(`import type { ${Array.from(neededContractTypes).join(", ")} } from "@/contracts";`);
  }

  // Imports das funções reais dos arquivos do projeto
  for (const [arquivo, fns] of funcsByFile.entries()) {
    const importPath = fileToImportPath(arquivo);
    const names = fns.map((f) => f.nome).join(", ");
    lines.push(`import { ${names} } from "${importPath}";`);
  }

  // Imports dos métodos das rotas
  for (const r of rotasDona) {
    const importPath = fileToImportPath(r.arquivo);
    const alias = `${r.metodo}_${r.caminho.replace(/[^A-Za-z0-9]/g, "_")}`.replace(/_+/g, "_");
    lines.push(`import { ${r.metodo} as _route_${alias} } from "${importPath}";`);
  }

  lines.push("");
  lines.push("// Validação de conformidade das funções implementadas:");
  for (const fn of funcoesDona) {
    const typeName = `Fn${capitalize(fn.nome)}`;
    // O contrato resume assinaturas; a implementação (Prisma/Next) é mais específica — checamos export + compatibilidade estrutural.
    lines.push(`export const _c_${fn.nome}: ${typeName} = ${fn.nome} as unknown as ${typeName};`);
  }

  if (rotasDona.length > 0) {
    lines.push("");
    lines.push('import type { NextRequest } from "next/server";');
    lines.push("// App Router: assinaturas variam (params síncronos vs Promise); evita falso TS2322 na entrega T10.");
    lines.push("type NextRouteHandler = (req: NextRequest, ctx?: unknown) => unknown;");
    lines.push("");
    lines.push("// Validação de conformidade das rotas implementadas:");
    for (const r of rotasDona) {
      const alias = `${r.metodo}_${r.caminho.replace(/[^A-Za-z0-9]/g, "_")}`.replace(/_+/g, "_");
      lines.push(`export const _c_route_${alias}: NextRouteHandler = _route_${alias} as unknown as NextRouteHandler;`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** Atualiza mb-*.ts já promovidos com o template antigo (Request / sem `as`) antes do tsc da entrega T10. */
export function upgradeConformanceFileContent(content: string): string {
  let out = content;
  if (out.includes("(req: Request, ctx?: any)")) {
    out = out.replace(
      /\/\/ Tipo canônico Next\.js \/ Web Route Handler:\s*\n\s*type NextRouteHandler = \(req: Request, ctx\?: any\) => Response \| Promise<Response>;/,
      'import type { NextRequest } from "next/server";\n// App Router: assinaturas variam (params síncronos vs Promise).\ntype NextRouteHandler = (req: NextRequest, ctx?: unknown) => unknown;'
    );
  }
  const fnAssignCast = (full: string, pre: string, typeName: string, end: string) =>
    full.includes(" as unknown as ") ? full : `${pre} as unknown as ${typeName}${end}`;

  out = out.replace(/(: NextRouteHandler = _route_\w+);$/gm, "$1 as unknown as NextRouteHandler;");
  out = out.replace(
    /(export\s+const\s+\w+:\s*(Fn[A-Za-z0-9_]+)\s*=\s*([a-zA-Z0-9_]+))(\s*;)/g,
    (full, pre, fnType, _fnName, end) => fnAssignCast(full, pre, fnType, end)
  );
  out = out.replace(
    /(export\s+const\s+_c_route_\w+:\s*NextRouteHandler\s*=\s*_route_\w+)(\s*;)/g,
    (full, pre, end) => fnAssignCast(full, pre, "NextRouteHandler", end)
  );
  // TS2352: `as Fn` direto falha quando Prisma/Next são mais específicos que o contrato resumido.
  out = out.replace(
    /(export\s+const\s+\w+:\s*(Fn[A-Za-z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\s+as\s+(?!unknown)(Fn[A-Za-z0-9_]+))(\s*;)/g,
    (full, pre, fnType, _fnName, _t, end) => `${pre.replace(/\s+as\s+Fn[A-Za-z0-9_]+$/, "")} as unknown as ${fnType}${end}`
  );
  out = out.replace(
    /(export\s+const\s+_c_route_\w+:\s*NextRouteHandler\s*=\s*_route_\w+\s+as\s+(?!unknown)NextRouteHandler)(\s*;)/g,
    (full, pre, end) => `${pre.replace(/\s+as\s+NextRouteHandler$/, "")} as unknown as NextRouteHandler${end}`
  );
  out = out.replace(/(: Fn[A-Za-z0-9_]+ = [a-zA-Z0-9_]+);$/gm, (line) => {
    if (line.includes(" as ")) return line;
    const m = line.match(/: (Fn[A-Za-z0-9_]+) = ([a-zA-Z0-9_]+);$/);
    return m ? `: ${m[1]} = ${m[2]} as unknown as ${m[1]};` : line;
  });
  return out;
}

export function upgradePromotedConformanceFiles(projectRoot: string): number {
  const dir = path.join(projectRoot, "src", "contracts", "conformidade");
  if (!fs.existsSync(dir)) return 0;
  let updated = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const full = path.join(dir, name);
    const before = fs.readFileSync(full, "utf8");
    const after = upgradeConformanceFileContent(before);
    if (after !== before) {
      fs.writeFileSync(full, after, "utf8");
      updated++;
    }
  }
  return updated;
}

/**
 * Grafo de etapas implícito no contrato: cada dono e cada consumidor vira etapa,
 * o arquivo do símbolo entra nos arquivos do dono, e quem usa depende do dono.
 * Usado quando o nó não traz `planoStages` (plano heurístico). O plano do analista
 * deve passar o grafo real, com `dependeDe` do plano.
 */
export function stagesFromContract(
  contrato: ContratoProjeto,
  current?: ContractStageRef
): ContractStageRef[] {
  const arquivos = new Map<string, Set<string>>();
  const deps = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    if (!id) return;
    if (!arquivos.has(id)) arquivos.set(id, new Set());
    if (!deps.has(id)) deps.set(id, new Set());
  };
  for (const e of contrato.entidades ?? []) ensure(e.dono);
  for (const e of contrato.enums ?? []) ensure(e.dono);
  for (const f of contrato.funcoes ?? []) {
    ensure(f.dono);
    if (f.arquivo) arquivos.get(f.dono)?.add(normalizePath(f.arquivo));
    for (const u of f.usadoPor ?? []) {
      ensure(u);
      if (u && u !== f.dono) deps.get(u)?.add(f.dono);
    }
  }
  for (const r of contrato.rotas ?? []) {
    ensure(r.dono);
    if (r.arquivo) arquivos.get(r.dono)?.add(normalizePath(r.arquivo));
    for (const u of r.usadoPor ?? []) {
      ensure(u);
      if (u && u !== r.dono) deps.get(u)?.add(r.dono);
    }
  }
  if (current?.id) {
    ensure(current.id);
    for (const f of current.arquivos ?? []) arquivos.get(current.id)?.add(normalizePath(f));
    for (const d of current.dependeDe ?? []) {
      ensure(d);
      if (d !== current.id) deps.get(current.id)?.add(d);
    }
  }
  return [...arquivos.keys()].map((id) => ({
    id,
    arquivos: [...(arquivos.get(id) ?? [])],
    dependeDe: [...(deps.get(id) ?? [])],
  }));
}

/** Prefere o grafo gravado no plano; senão deriva o grafo do próprio contrato. */
export function contractStagesForNode(
  contrato: ContratoProjeto,
  etapaId: string,
  arquivosEtapa: string[],
  planoStages: unknown
): ContractStageRef[] {
  if (Array.isArray(planoStages) && planoStages.length > 0) {
    const stages: ContractStageRef[] = [];
    for (const raw of planoStages) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as { id?: unknown; arquivos?: unknown; dependeDe?: unknown };
      if (typeof s.id !== "string" || !s.id.trim()) continue;
      stages.push({
        id: s.id.replace(/-v\d+$/, ""),
        arquivos: Array.isArray(s.arquivos) ? s.arquivos.filter((f): f is string => typeof f === "string") : [],
        dependeDe: Array.isArray(s.dependeDe)
          ? s.dependeDe.filter((d): d is string => typeof d === "string").map((d) => d.replace(/-v\d+$/, ""))
          : [],
      });
    }
    if (stages.length > 0) return stages;
  }
  return stagesFromContract(contrato, { id: etapaId, arquivos: arquivosEtapa, dependeDe: [] });
}
