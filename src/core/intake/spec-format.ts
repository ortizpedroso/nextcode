/**
 * Formato canônico enxuto de Spec: YAML Frontmatter + Markdown curto.
 * Usado tanto para gerar (servidor) quanto para interpretar (UI) a Spec,
 * evitando o antigo template de prosa com headers decorativos repetidos.
 */

export interface SpecModule {
  id: string;
  nome: string;
  resumo: string;
  /** Arquivos que implementam o módulo (rastreabilidade módulo → arquivo, P12). */
  arquivos?: string[];
}

export interface SpecEntityField {
  nome: string;
  tipo: string;
}

export interface SpecEntity {
  nome: string;
  campos: SpecEntityField[];
}

export interface SpecRoute {
  caminho: string;
  descricao: string;
}

export interface SpecRequirementItem {
  id: string;
  titulo: string;
  criterio: string;
  /**
   * J11 (E2, mudança 44): de onde o REQ vem — trecho literal do pedido do usuário, "premissa: …" (decisão do
   * elicitador registrada) ou "derivado: REQ-xxx". Opcional (Specs antigas não têm); conferido por código.
   */
  origem?: string;
}

export interface SpecFrontmatterInput {
  titulo: string;
  status: string;
  data: string;
  objetivo: string;
  stack: string[];
  modulos: SpecModule[];
  entidades: SpecEntity[];
  arquivosAfetados: string[];
  rotas?: SpecRoute[];
  notasImplementacao?: string[];
  requisitosIds?: string[];
  requisitos?: SpecRequirementItem[];
}

export interface ParsedSpec {
  titulo: string | null;
  status: string | null;
  data: string | null;
  stack: string[];
  modulos: SpecModule[];
  entidades: SpecEntity[];
  arquivosAfetados: string[];
  rotas: SpecRoute[];
  notasImplementacao: string[];
  requisitosIds?: string[];
  requisitos?: SpecRequirementItem[];
  objetivo: string;
  raw: string;
}

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^"(.*)"$/);
  return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : trimmed;
}

function yamlStringList(key: string, items: string[]): string[] {
  if (items.length === 0) return [];
  const lines = [`${key}:`];
  items.forEach((item) => lines.push(`  - ${yamlEscape(item)}`));
  return lines;
}

function renderEntidades(entidades: SpecEntity[]): string[] {
  if (entidades.length === 0) return [];
  const lines = ["entidades:"];
  entidades.forEach((e) => {
    lines.push(`  - nome: ${yamlEscape(e.nome)}`);
    if (e.campos.length > 0) {
      lines.push("    campos:");
      e.campos.forEach((c) => {
        lines.push(`      - nome: ${yamlEscape(c.nome)}`);
        lines.push(`        tipo: ${yamlEscape(c.tipo)}`);
      });
    }
  });
  return lines;
}

function renderRotas(rotas: SpecRoute[]): string[] {
  if (rotas.length === 0) return [];
  const lines = ["rotas:"];
  rotas.forEach((r) => {
    lines.push(`  - caminho: ${yamlEscape(r.caminho)}`);
    lines.push(`    descricao: ${yamlEscape(r.descricao)}`);
  });
  return lines;
}

/** Monta o documento completo: bloco YAML (frontmatter) + corpo Markdown curto. */
export function renderCanonicalSpecDocument(spec: SpecFrontmatterInput): string {
  const lines: string[] = ["---"];
  lines.push(`titulo: ${yamlEscape(spec.titulo)}`);
  lines.push(`status: ${spec.status}`);
  lines.push(`data: ${spec.data}`);
  lines.push(...yamlStringList("stack", spec.stack));

  if (spec.modulos.length > 0) {
    lines.push("modulos:");
    spec.modulos.forEach((m) => {
      lines.push(`  - id: ${m.id}`);
      lines.push(`    nome: ${yamlEscape(m.nome)}`);
      lines.push(`    resumo: ${yamlEscape(m.resumo)}`);
      if (m.arquivos && m.arquivos.length > 0) {
        lines.push("    arquivos:");
        m.arquivos.forEach((f) => lines.push(`      - ${yamlEscape(f)}`));
      }
    });
  }

  lines.push(...renderEntidades(spec.entidades));
  lines.push(...renderRotas(spec.rotas ?? []));
  lines.push(...yamlStringList("arquivos_afetados", spec.arquivosAfetados));
  lines.push(...yamlStringList("notas_implementacao", spec.notasImplementacao ?? []));
  lines.push(...yamlStringList("requisitos_ids", spec.requisitosIds ?? []));
  if (spec.requisitos && spec.requisitos.length > 0) {
    lines.push("requisitos:");
    spec.requisitos.forEach((req) => {
      lines.push(`  - id: ${req.id}`);
      lines.push(`    titulo: ${yamlEscape(req.titulo)}`);
      lines.push(`    criterio: ${yamlEscape(req.criterio)}`);
      if (req.origem) lines.push(`    origem: ${yamlEscape(req.origem)}`);
    });
  }
  lines.push("---");

  const yaml = lines.join("\n");
  const body = `# ${spec.titulo}\n\n${spec.objetivo}`;
  return `${yaml}\n\n${body}`;
}

// --- Parser genérico de indentação para o subconjunto de YAML usado acima ---
// Suporta: mapeamentos escalares, listas de escalares e listas de mapeamentos
// com um nível de aninhamento (ex.: entidades -> campos), o suficiente para o
// schema desta Spec sem precisar de uma dependência de YAML completa.

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

interface YamlLine {
  indent: number;
  content: string;
}

function toYamlLines(block: string): YamlLine[] {
  return block
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => ({ indent: l.length - l.replace(/^ +/, "").length, content: l.trim() }));
}

const ROOT_KEYS = new Set([
  "titulo",
  "status",
  "data",
  "stack",
  "modulos",
  "entidades",
  "rotas",
  "arquivos_afetados",
  "notas_implementacao",
  "requisitos_ids",
  "requisitos",
  "documento",
  "spec_versao",
  "clusters_ativos",
  "clusters",
  "microbriefs",
  "enums",
  "funcoes",
  "contrato",
]);

function parseYamlList(lines: YamlLine[], start: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  let i = start;
  while (i < lines.length && lines[i].content.startsWith("- ") && (lines[i].indent === indent || indent === 0)) {
    const inline = lines[i].content.slice(2).trim();
    const fieldMatch = inline.match(/^(\w+):\s*(.*)$/);
    i++;
    if (fieldMatch) {
      const [, key, rawValue] = fieldMatch;
      const item: Record<string, YamlValue> = {};
      if (rawValue.trim()) item[key] = unquote(rawValue);
      if (i < lines.length && lines[i].indent > indent) {
        const [rest, nextI] = parseYamlMapping(lines, i, lines[i].indent);
        Object.assign(item, rest);
        i = nextI;
      } else {
        // Fallback: se o LLM emitiu campos sem indentação extra (indent 0)
        while (i < lines.length && !lines[i].content.startsWith("- ")) {
          const match = lines[i].content.match(/^(\w+):\s*(.*)$/);
          if (!match) {
            i++;
            continue;
          }
          const [, subKey, subVal] = match;
          if (indent === 0 && ROOT_KEYS.has(subKey)) {
            break;
          }
          i++;
          if (subVal.trim()) {
            item[subKey] = unquote(subVal);
          } else if (i < lines.length && lines[i].content.startsWith("- ")) {
            const [subList, nextI] = parseYamlList(lines, i, lines[i].indent);
            item[subKey] = subList;
            i = nextI;
          } else {
            item[subKey] = [];
          }
        }
      }
      items.push(item);
    } else {
      items.push(unquote(inline));
    }
  }
  return [items, i];
}

function parseYamlMapping(
  lines: YamlLine[],
  start: number,
  indent: number
): [Record<string, YamlValue>, number] {
  const result: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].content.startsWith("- ")) {
    const match = lines[i].content.match(/^(\w+):\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }
    const [, key, rawValue] = match;
    i++;
    if (rawValue.trim()) {
      result[key] = unquote(rawValue);
      continue;
    }
    // Suporta listas mesmo com indentação relaxada (>= indent ou 0)
    if (i < lines.length && lines[i].content.startsWith("- ") && lines[i].indent >= indent) {
      const [list, nextI] = parseYamlList(lines, i, lines[i].indent);
      result[key] = list;
      i = nextI;
    } else {
      result[key] = [];
    }
  }
  return [result, i];
}

/**
 * Interpreta um documento no formato YAML Frontmatter + Markdown.
 * Retorna null se o conteúdo não seguir esse formato (ex.: specs antigas em prosa livre),
 * permitindo que a UI caia de volta para a exibição em texto corrido.
 */
/**
 * LLMs reais costumam embrulhar a Spec num bloco de código (```yaml ... ```), às vezes com
 * uma frase antes, ou emitem sem delimitadores '---' ou truncadas por limite de tokens.
 * Extrai o documento "--- ... ---" tratando cercas abertas, falta de delimitadores e linhas truncadas.
 */
export function unwrapSpecDocument(content: string): string {
  if (!content) return content;
  let trimmed = content.trim();

  // Caso A: Cerca de código aberta sem fechamento (truncamento por tokens)
  const unclosedFence = trimmed.match(/^```(?:ya?ml)?[ \t]*\r?\n([\s\S]*)$/i);
  if (unclosedFence && !trimmed.slice(3).includes("```")) {
    trimmed = unclosedFence[1].trim();
  }

  // Caso B: Cerca de código fechada (```yaml ... ```)
  const fence = trimmed.match(/```(?:ya?ml)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  if (fence) {
    const inner = fence[1].trim();
    const after = trimmed.slice((fence.index ?? 0) + fence[0].length).trim();
    if (inner.startsWith("---")) {
      trimmed = after ? `${inner}\n\n${after}` : inner;
    } else if (/^titulo\s*:/m.test(inner)) {
      trimmed = `---\n${inner}\n---\n\n${after}`.trim();
    }
  }

  // Caso C: Se o conteúdo tiver texto solto antes da Spec (ex.: "Aqui está a spec:\n--- ..."),
  // isola a partir do primeiro delimitador '---' que contém 'titulo:' logo a seguir
  const embeddedFence = trimmed.search(/(?:^|\r?\n)---\r?\n\s*titulo\s*:/i);
  if (embeddedFence > 0) {
    trimmed = trimmed.slice(embeddedFence).replace(/^[\r\n]+/, "");
  }

  // Caso C: O documento não tem delimitadores '---' no texto mas começa com 'titulo:' (Bare YAML)
  if (!trimmed.includes("---") && /^titulo\s*:/m.test(trimmed)) {
    const tituloIdx = trimmed.search(/^titulo\s*:/m);
    if (tituloIdx >= 0) {
      trimmed = `---\n${trimmed.slice(tituloIdx)}`;
    }
  }

  // Caso D: Frontmatter aberto e nunca fechado (truncamento ou falta de delimitador de fechamento)
  if (/^---\r?\n/.test(trimmed) && !/\r?\n---[ \t]*(\r?\n|$)/.test(trimmed.slice(3))) {
    const h1 = trimmed.search(/\r?\n#\s/);
    if (h1 > 0) {
      trimmed = `${trimmed.slice(0, h1)}\n---\n${trimmed.slice(h1)}`;
    } else {
      // Repara última linha se truncada no meio de aspas
      const lines = trimmed.split(/\r?\n/);
      const lastLine = lines[lines.length - 1];
      const quoteCount = (lastLine.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) {
        lines[lines.length - 1] = `${lastLine}"`;
      }
      trimmed = `${lines.join("\n")}\n---`;
    }
  }

  // Modelos com raciocínio às vezes escrevem o "pensamento" antes da Spec e até repetem o
  // modelo de formato com <placeholders>. Vale o ÚLTIMO frontmatter com titulo real.
  const docs = Array.from(trimmed.matchAll(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*$/gm));
  const real = docs.filter((m) => {
    const titulo = m[1].match(/^titulo\s*:\s*(.*)$/m)?.[1] ?? "";
    return titulo.trim() !== "" && !/<[^>]+>/.test(titulo);
  });
  if (docs.length > 0 && real.length === 0) {
    // Todos os blocos encontrados continham apenas <placeholders> de template: não é Spec real
    return "";
  }
  if (real.length > 0 && !(real.length === 1 && trimmed.startsWith("---") && real[0].index === 0)) {
    const last = real[real.length - 1];
    return trimmed
      .slice(last.index ?? 0)
      .replace(/\r?\n```[ \t]*(\r?\n[\s\S]*)?$/, "")
      .trim();
  }

  return trimmed;
}

export function parseSpecDocument(rawContent: string): ParsedSpec | null {
  const content = unwrapSpecDocument(rawContent);
  if (!content || !content.trim().startsWith("---")) return null;

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const [root] = parseYamlMapping(toYamlLines(frontmatter), 0, 0);

  const titulo = typeof root.titulo === "string" ? root.titulo : null;
  if (!titulo || /<[^>]+>/.test(titulo)) return null;

  // Defensivo: LLMs às vezes emitem uma lista como escalar único separado por
  // vírgulas (ex.: stack: "Next.js, Prisma, Tailwind") em vez de sequência YAML.
  // Sem isso, a seção some silenciosamente da UI em vez de aparecer vazia.
  // Também aceita lista no estilo JSON/flow (stack: ["Next.js", "Prisma"]) e limpa itens que
  // já chegaram quebrados de uma gravação anterior ('["Next.js"', '"Prisma"]').
  const cleanItem = (s: string) =>
    s.trim().replace(/^\[/, "").replace(/\]$/, "").trim().replace(/^["']|["']$/g, "").trim();
  const asStringList = (v: YamlValue | undefined): string[] =>
    (Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : typeof v === "string"
        ? v.split(",")
        : []
    )
      .map(cleanItem)
      .filter(Boolean);

  const modulos: SpecModule[] = Array.isArray(root.modulos)
    ? (root.modulos as Record<string, YamlValue>[]).map((m) => ({
        id: typeof m.id === "string" ? m.id : "",
        nome: typeof m.nome === "string" ? m.nome : "",
        resumo: typeof m.resumo === "string" ? m.resumo : "",
        ...(asStringList(m.arquivos).length ? { arquivos: asStringList(m.arquivos) } : {}),
      }))
    : [];

  const entidades: SpecEntity[] = Array.isArray(root.entidades)
    ? (root.entidades as YamlValue[]).map((e): SpecEntity => {
        if (typeof e === "string") return { nome: e, campos: [] };
        const obj = e as Record<string, YamlValue>;
        const campos = Array.isArray(obj.campos)
          ? (obj.campos as Record<string, YamlValue>[]).map((c) => ({
              nome: typeof c.nome === "string" ? c.nome : "",
              tipo: typeof c.tipo === "string" ? c.tipo : "",
            }))
          : [];
        return { nome: typeof obj.nome === "string" ? obj.nome : "", campos };
      })
    : [];

  const rotas: SpecRoute[] = Array.isArray(root.rotas)
    ? (root.rotas as Record<string, YamlValue>[]).map((r) => ({
        caminho: typeof r.caminho === "string" ? r.caminho : "",
        descricao: typeof r.descricao === "string" ? r.descricao : "",
      }))
    : [];

  const requisitosIds = asStringList(root.requisitos_ids);
  const requisitos: SpecRequirementItem[] = Array.isArray(root.requisitos)
    ? (root.requisitos as Record<string, YamlValue>[]).map((req) => ({
        id: typeof req.id === "string" ? req.id : "",
        titulo: typeof req.titulo === "string" ? req.titulo : "",
        criterio: typeof req.criterio === "string" ? req.criterio : "",
        ...(typeof req.origem === "string" && req.origem.trim() ? { origem: req.origem.trim() } : {}),
      }))
    : [];

  const trimmedBody = body.trim();
  const objetivoMatch = trimmedBody.match(/^#.*(?:\r?\n)+([\s\S]*?)(?:\r?\n#{1,6}\s|$)/);
  // A Spec é conceitual: blocos de código no corpo (implementação) são descartados.
  const objetivo = (objetivoMatch ? objetivoMatch[1] : trimmedBody)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    titulo: typeof root.titulo === "string" ? root.titulo : null,
    status: typeof root.status === "string" ? root.status : null,
    data: typeof root.data === "string" ? root.data : null,
    stack: asStringList(root.stack),
    modulos,
    entidades,
    arquivosAfetados: asStringList(root.arquivos_afetados ?? root.arquivosAfetados),
    rotas,
    notasImplementacao: asStringList(root.notas_implementacao),
    ...(requisitosIds.length > 0 ? { requisitosIds } : {}),
    ...(requisitos.length > 0 ? { requisitos } : {}),
    objetivo,
    raw: content,
  };
}

/**
 * Frontmatter YAML + corpo Markdown, o mesmo recipiente da Spec.
 * Serve ao Macrobrief do elicitador e ao plano do analista.
 */
export function parseYamlFrontmatter(
  content: string
): { root: Record<string, YamlValue>; body: string; texto: string } | null {
  if (!content?.trim()) return null;
  let trimmed = content.trim();
  const fence = trimmed.match(/```(?:ya?ml|markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  if (fence) trimmed = fence[1].trim();
  if (!trimmed.startsWith("---")) {
    const idx = trimmed.search(/(?:^|\r?\n)---\r?\n/);
    if (idx >= 0) trimmed = trimmed.slice(idx).replace(/^[\r\n]+/, "");
  }
  if (!trimmed.startsWith("---") && /^(documento|microbriefs|clusters)\s*:/m.test(trimmed)) {
    trimmed = `---\n${trimmed}\n---`;
  }
  if (!trimmed.startsWith("---")) return null;
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const [root] = parseYamlMapping(toYamlLines(match[1]), 0, 0);
  const body = match[2].trim();
  const texto = `---\n${match[1].trim()}\n---${body ? `\n\n${body}` : ""}`;
  return { root, body, texto };
}
