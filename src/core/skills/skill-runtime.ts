import * as fs from "fs";
import * as path from "path";
import type { ClusterKind } from "@/core/config/orchestration-policy";

export type SkillRoleKind = "elicitador" | "analista" | "executor" | "avaliador";

export interface SkillLocalReference {
  caminho: string;
  origemRepo?: string;
  origemArquivo?: string;
  commitFixado?: string;
}

export interface LoadedRoleSkill {
  name: string;
  papel: SkillRoleKind;
  cluster: ClusterKind | null;
  herdaDe: string | null;
  nivelModelo: "rapido" | "medio" | "forte";
  modeloDiferenteDoExecutor: boolean;
  ferramentas: string[];
  permissoes: {
    escrever: "nunca" | "escopo";
    comandos: string[];
    redeExternaBloqueada: boolean;
  };
  passosMax: number;
  referenciasLocaisFixas: SkillLocalReference[];
  checagens: string[];
  bodyMarkdown: string;
  inheritedBodyMarkdown: string | null;
  resolvedReferencesContent: Record<string, string>;
  filePath: string;
}

function extractFrontmatterAndBody(raw: string): { frontmatter: string; body: string } | null {
  const match = raw.trim().match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2].trim() };
}

function extractStringField(fm: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*:\\s*["']?([^"'#\\r\\n]+?)["']?\\s*(?:#.*)?$`, "m");
  const m = fm.match(re);
  if (!m) return null;
  const val = m[1].trim();
  return val && val !== ">" && val !== "|" ? val : null;
}

function extractBooleanField(fm: string, key: string, defaultVal: boolean): boolean {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(true|false)\\b`, "m");
  const m = fm.match(re);
  if (!m) return defaultVal;
  return m[1] === "true";
}

function extractNumberField(fm: string, key: string, defaultVal: number): number {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(\\d+)\\b`, "m");
  const m = fm.match(re);
  if (!m) return defaultVal;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : defaultVal;
}

function extractTopLevelList(fm: string, key: string): string[] {
  const inlineRe = new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, "m");
  const inlineMatch = fm.match(inlineRe);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  const lines = fm.split(/\r?\n/);
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock) {
      if (new RegExp(`^${key}\\s*:\\s*(?:#.*)?$`).test(line)) {
        inBlock = true;
      }
      continue;
    }
    if (/^\S/.test(line)) break;
    const itemMatch = line.match(/^\s*-\s*([^\r\n#]+)/);
    if (itemMatch) {
      const cleaned = itemMatch[1].trim().replace(/^["']|["']$/g, "");
      if (cleaned && !cleaned.includes(":")) {
        out.push(cleaned);
      }
    }
  }
  return out;
}

function extractNestedCommands(fm: string): string[] {
  const inlineMatch = fm.match(/^\s*comandos\s*:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const lines = fm.split(/\r?\n/);
  const out: string[] = [];
  let inComandos = false;
  for (const line of lines) {
    if (!inComandos) {
      if (/^\s+comandos\s*:\s*$/.test(line)) {
        inComandos = true;
      }
      continue;
    }
    if (/^\S/.test(line) || (/^\s{2}[a-z_]+\s*:/.test(line) && !line.trim().startsWith("-"))) {
      break;
    }
    const m = line.match(/^\s*-\s*["']?([^"'#\r\n]+?)["']?\s*(?:#.*)?$/);
    if (m && m[1].trim()) {
      out.push(m[1].trim());
    }
  }
  return out;
}

function extractFixedReferences(fm: string): SkillLocalReference[] {
  const lines = fm.split(/\r?\n/);
  const refs: SkillLocalReference[] = [];
  let inRefs = false;
  let current: SkillLocalReference | null = null;

  for (const line of lines) {
    if (!inRefs) {
      if (/^referencias_locais_fixas\s*:\s*$/.test(line)) {
        inRefs = true;
      }
      continue;
    }
    if (/^\S/.test(line)) break;
    const pathMatch = line.match(/^\s*-\s*caminho\s*:\s*(\S+)/);
    if (pathMatch) {
      if (current) refs.push(current);
      current = { caminho: pathMatch[1].trim() };
      continue;
    }
    if (current) {
      const repoMatch = line.match(/^\s+origem_repo\s*:\s*(\S+)/);
      if (repoMatch) current.origemRepo = repoMatch[1].trim();
      const fileMatch = line.match(/^\s+origem_arquivo\s*:\s*(\S+)/);
      if (fileMatch) current.origemArquivo = fileMatch[1].trim();
      const commitMatch = line.match(/^\s+commit_fixado\s*:\s*(\S+)/);
      if (commitMatch) current.commitFixado = commitMatch[1].trim();
    }
  }
  if (current) refs.push(current);
  return refs;
}

/**
 * Carrega uma skill declarativa do papel (`skills/<nome>/SKILL.md`), resolve herança
 * (`herda_de`) e carrega as cópias locais fixas de referências (ex.: 104 regras do
 * `web-interface-guidelines` e 22 regras `CRITICAL`/`HIGH` do `react-best-practices`).
 */
export function loadRoleSkill(
  skillRelativePathOrName: string,
  rootDir: string = process.cwd()
): LoadedRoleSkill {
  const normalized = skillRelativePathOrName.endsWith(".md")
    ? skillRelativePathOrName
    : path.join("skills", skillRelativePathOrName, "SKILL.md");

  const fullPath = path.isAbsolute(normalized) ? normalized : path.join(rootDir, normalized);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Skill não encontrada no disco: ${fullPath}`);
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  const split = extractFrontmatterAndBody(raw);
  if (!split) {
    throw new Error(`Frontmatter YAML ausente ou inválido na skill: ${fullPath}`);
  }

  const { frontmatter: fm, body } = split;
  const name = extractStringField(fm, "name") || path.basename(path.dirname(fullPath));
  const papelRaw = extractStringField(fm, "papel") || "executor";
  // S3 (mudança 44): papel desconhecido falha fechado — antes virava "executor" calado, com escrita no escopo.
  if (!["elicitador", "analista", "executor", "avaliador"].includes(papelRaw)) {
    throw new Error(`skill "${name}": papel "${papelRaw}" não é um papel do harness (elicitador, analista, executor, avaliador)`);
  }
  const papel = papelRaw as SkillRoleKind;

  const clusterRaw = extractStringField(fm, "cluster");
  const cluster = (
    clusterRaw && ["core", "backend", "frontend", "integration"].includes(clusterRaw)
      ? clusterRaw
      : null
  ) as ClusterKind | null;

  const herdaDe = extractStringField(fm, "herda_de");
  const nivelRaw = extractStringField(fm, "nivel_modelo") || "forte";
  const nivelModelo = (["rapido", "medio", "forte"].includes(nivelRaw)
    ? nivelRaw
    : "forte") as "rapido" | "medio" | "forte";

  const modeloDiferenteDoExecutor = extractBooleanField(
    fm,
    "modelo_diferente_do_executor",
    papel === "avaliador"
  );

  const ferramentas = extractTopLevelList(fm, "ferramentas");
  const checagens = extractTopLevelList(fm, "checagens");

  const escreverRaw = fm.match(/^\s*escrever\s*:\s*(\S+)/m)?.[1]?.trim() || (papel === "executor" ? "escopo" : "nunca");
  const escrever: "nunca" | "escopo" = escreverRaw === "escopo" ? "escopo" : "nunca";
  const comandos = extractNestedCommands(fm);
  const redeExternaBloqueada = /^\s*rede_externa\s*:\s*bloqueada\b/m.test(fm);
  const passosMax = extractNumberField(fm, "passos_max", 25);
  const referenciasLocaisFixas = extractFixedReferences(fm);

  let inheritedBodyMarkdown: string | null = null;
  if (herdaDe) {
    const parentPath = path.join(rootDir, herdaDe);
    if (fs.existsSync(parentPath)) {
      const parentSplit = extractFrontmatterAndBody(fs.readFileSync(parentPath, "utf8"));
      inheritedBodyMarkdown = parentSplit ? parentSplit.body : null;
    }
  }

  const resolvedReferencesContent: Record<string, string> = {};
  for (const ref of referenciasLocaisFixas) {
    const refAbs = path.join(rootDir, ref.caminho);
    if (fs.existsSync(refAbs)) {
      resolvedReferencesContent[ref.caminho] = fs.readFileSync(refAbs, "utf8");
    }
  }

  return {
    name,
    papel,
    cluster,
    herdaDe,
    nivelModelo,
    modeloDiferenteDoExecutor,
    ferramentas,
    permissoes: {
      escrever,
      comandos,
      redeExternaBloqueada,
    },
    passosMax,
    referenciasLocaisFixas,
    checagens,
    bodyMarkdown: body,
    inheritedBodyMarkdown,
    resolvedReferencesContent,
    filePath: fullPath,
  };
}

/**
 * Aplica mecanicamente as permissões declaradas na skill quando o agente tenta invocar uma ferramenta.
 * Uma regra só no prompt é apenas um pedido; esta função é a trava em código do harness.
 */
export function enforceSkillToolPermission(params: {
  skill: LoadedRoleSkill;
  toolName: string;
  targetFile?: string;
  allowedScopeFiles?: string[];
  command?: string;
  currentStep: number;
}): { allowed: boolean; violationReason?: string } {
  const { skill, toolName, targetFile, allowedScopeFiles, command, currentStep } = params;

  if (currentStep > skill.passosMax) {
    return {
      allowed: false,
      violationReason: `[SKILL STEP LIMIT] Limite de passos excedido (${currentStep}/${skill.passosMax}) na skill "${skill.name}".`,
    };
  }

  if (!skill.ferramentas.includes(toolName)) {
    return {
      allowed: false,
      violationReason: `[SKILL TOOL DENIED] A ferramenta "${toolName}" não está autorizada na skill "${skill.name}" (permitidas: ${skill.ferramentas.join(", ")}).`,
    };
  }

  const isWriteTool = toolName === "write_file" || toolName === "edit_file" || toolName === "smart_patch";
  if (isWriteTool) {
    if (skill.permissoes.escrever === "nunca") {
      return {
        allowed: false,
        violationReason: `[SKILL WRITE DENIED] O papel "${skill.papel}" (${skill.name}) possui 'escrever: nunca' e jamais pode alterar arquivos.`,
      };
    }
    if (!targetFile) {
      return {
        allowed: false,
        violationReason: `[SKILL SCOPE DENIED] Tentativa de escrita sem caminho de arquivo explícito.`,
      };
    }
    const cleanTarget = targetFile.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
    if (
      cleanTarget.includes("..") ||
      cleanTarget === ".env" ||
      // Modelos sem segredo (`.env.example`, `.env.sample`, `.env.template`) são permitidos; o conteúdo
      // continua passando pela guarda de segredos. Antes `.env.*` inteiro era bloqueado e a etapa que a
      // Spec mandava criar `.env.example` nunca passava (teste real Multi_Gateway, 18/10, etapa 3).
      (cleanTarget.startsWith(".env.") && !/^\.env\.(example|sample|template)$/.test(cleanTarget)) ||
      cleanTarget.endsWith("prisma/dev.db")
    ) {
      return {
        allowed: false,
        violationReason: `[SKILL PROTECTED PATH] Escrita bloqueada em caminho protegido: "${targetFile}".`,
      };
    }
    const normalizedAllowed = new Set(
      (allowedScopeFiles ?? []).map((f) => f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, ""))
    );
    if (!normalizedAllowed.has(cleanTarget)) {
      return {
        allowed: false,
        violationReason: `[SKILL SCOPE VIOLATION] O arquivo "${cleanTarget}" está fora do escopo permitido do Microbrief (${Array.from(normalizedAllowed).join(", ")}).`,
      };
    }
  }

  if (command !== undefined) {
    if (skill.permissoes.comandos.length === 0) {
      return {
        allowed: false,
        violationReason: `[SKILL COMMAND DENIED] A skill "${skill.name}" não possui permissão para executar comandos.`,
      };
    }
    const cmdTrimmed = command.trim();
    const allowedCmd = skill.permissoes.comandos.some(
      (allowedPrefix) => cmdTrimmed === allowedPrefix || cmdTrimmed.startsWith(`${allowedPrefix} `)
    );
    if (!allowedCmd) {
      return {
        allowed: false,
        violationReason: `[SKILL COMMAND DENIED] O comando "${cmdTrimmed}" não está na allowlist da skill "${skill.name}" (${skill.permissoes.comandos.join(", ")}).`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Monta o prompt de sistema completo a partir da skill carregada (incluindo a skill base herdada,
 * se houver, e observando a trava de Lente 1 Cega do Avaliador).
 */
export function buildSkillSystemPrompt(
  skill: LoadedRoleSkill,
  options: {
    includeLocalReferences?: boolean;
    includeTasteSkillPublic?: boolean;
    includeReactPerf?: boolean;
  } = {}
): string {
  const parts: string[] = [];
  if (skill.inheritedBodyMarkdown) {
    parts.push(skill.inheritedBodyMarkdown);
  }
  parts.push(skill.bodyMarkdown);

  const includeReact = options.includeReactPerf ?? true;

  if (options.includeLocalReferences) {
    for (const [refPath, content] of Object.entries(skill.resolvedReferencesContent)) {
      if (refPath.includes("taste-skill") && !options.includeTasteSkillPublic) {
        continue;
      }
      if (refPath.includes("react-best-practices") && !includeReact) {
        continue;
      }
      parts.push(`--- REFERÊNCIA LOCAL FIXA (${refPath}) ---\n${content}`);
    }
  }

  return parts.join("\n\n");
}
