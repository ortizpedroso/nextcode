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

type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

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

function parseYamlList(lines: YamlLine[], start: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && lines[i].content.startsWith("- ")) {
    const inline = lines[i].content.slice(2).trim();
    const fieldMatch = inline.match(/^(\w+):\s*(.*)$/);
    i++;
    if (fieldMatch) {
      const [, key, rawValue] = fieldMatch;
      const item: Record<string, YamlValue> = {};
      if (rawValue.trim()) item[key] = unquote(rawValue);
      const [rest, nextI] = parseYamlMapping(lines, i, indent + 2);
      Object.assign(item, rest);
      items.push(item);
      i = nextI;
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
    if (i < lines.length && lines[i].indent > indent && lines[i].content.startsWith("- ")) {
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
 * uma frase antes. Extrai o documento "---
..." de dentro do bloco; se não houver bloco,
 * devolve o texto como veio. Sem isto o rascunho nunca era reconhecido nem gravado.
 */
export function unwrapSpecDocument(content: string): string {
  if (!content) return content;
  let trimmed = content.trim();

  // Frontmatter aberto e nunca fechado (visto com gpt-oss-20b via FreeLLMAPI, 06/10): o YAML
  // vai até o primeiro título Markdown. Fecha o bloco ali.
  if (/^---\r?\n/.test(trimmed) && !/\r?\n---[ \t]*(\r?\n|$)/.test(trimmed.slice(3))) {
    const h1 = trimmed.search(/\r?\n#\s/);
    if (h1 > 0) trimmed = `${trimmed.slice(0, h1)}\n---\n${trimmed.slice(h1)}`;
  }

  // Modelos com raciocínio às vezes escrevem o "pensamento" antes da Spec e até repetem o
  // modelo de formato com <placeholders>. Vale o ÚLTIMO frontmatter com titulo real.
  const docs = Array.from(trimmed.matchAll(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*$/gm));
  const real = docs.filter((m) => {
    const titulo = m[1].match(/^titulo\s*:\s*(.*)$/m)?.[1] ?? "";
    return titulo.trim() !== "" && !/<[^>]+>/.test(titulo);
  });
  if (real.length > 0 && !(real.length === 1 && trimmed.startsWith("---") && real[0].index === 0)) {
    const last = real[real.length - 1];
    // Se o documento estava dentro de um bloco ```, o fechamento da cerca fica para trás.
    return trimmed
      .slice(last.index ?? 0)
      .replace(/\r?\n```[ \t]*(\r?\n[\s\S]*)?$/, "")
      .trim();
  }
  if (trimmed.startsWith("---")) return trimmed;

  // Primeiro bloco ```yaml / ```yml / ``` do texto.
  const fence = trimmed.match(/```(?:ya?ml)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  if (!fence) return trimmed;
  const inner = fence[1].trim();
  const after = trimmed.slice((fence.index ?? 0) + fence[0].length).trim();
  // Caso 1: o bloco já traz o documento completo (--- yaml --- markdown).
  if (inner.startsWith("---")) return after ? `${inner}\n\n${after}` : inner;
  // Caso 2 (visto com GLM/DeepSeek): só o YAML, sem os ---; o Markdown vem depois do bloco.
  if (/^titulo\s*:/m.test(inner)) return `---\n${inner}\n---\n\n${after}`.trim();
  return trimmed;
}

export function parseSpecDocument(rawContent: string): ParsedSpec | null {
  const content = unwrapSpecDocument(rawContent);
  if (!content || !content.trim().startsWith("---")) return null;

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const [root] = parseYamlMapping(toYamlLines(frontmatter), 0, 0);

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
    arquivosAfetados: asStringList(root.arquivos_afetados),
    rotas,
    notasImplementacao: asStringList(root.notas_implementacao),
    ...(requisitosIds.length > 0 ? { requisitosIds } : {}),
    ...(requisitos.length > 0 ? { requisitos } : {}),
    objetivo,
    raw: content,
  };
}
