import * as fs from "fs";
import * as path from "path";
import type { DispatchMessage, SmartRouter } from "@/core/router/smart-router";
import { enforceSkillToolPermission, type LoadedRoleSkill } from "@/core/skills/skill-runtime";
import type { QuarantineManager } from "@/core/governance/quarantine-manager";
import { QuarantineManager as QuarantineManagerClass } from "@/core/governance/quarantine-manager";
import { regeneratePrismaClient, touchesPrismaSchema } from "@/core/execution/project-base";
import { runTestBench, type TestBenchReport } from "@/core/execution/test-bench";
import { contractBenchRequest, type RepairContractTest } from "@/core/orchestrator/repair-payload";
import { withProjectBuildLock } from "@/core/governance/empirical-gate";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { normalizeScopePath } from "@/core/governance/dual-lens-auditor";
import { recordLlmCost } from "@/core/llm/cost";
import type { GatewayConfig } from "@/core/llm/gateways";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";

export const MAX_TOOL_OUTPUT_CHARS = 12_000;
export const MAX_LIST_FILES_ENTRIES = 300;
export const MAX_GREP_MATCHES = 100;
export const MAX_CONSECUTIVE_INVALID_TURNS = 3;
export const LOOP_TOTAL_TIMEOUT_MS = 20 * 60 * 1000;
/** TR1 (12): várias ações independentes por turno (teste real: 1 por turno → 1.724 chamadas). */
export const MAX_ACTIONS_PER_TURN = 8;
/** Teto da soma dos resultados de um turno; o que passar disso volta como "repita no próximo turno". */
export const MAX_TURN_OUTPUT_CHARS = 48_000;
/**
 * TR1 (1): esperas antes de repetir o MESMO turno quando a chamada some (prazo, sem provedor, exceção,
 * resposta vazia). Teste real: 548 pausas `SEM_LLM` — a etapa recomeçava do zero por uma oscilação.
 * `NEXTCODE_TURN_RETRY_DELAYS_MS="5000,20000"` troca o padrão (a suíte usa "0,0").
 */
export function turnRetryDelaysMs(): number[] {
  const raw = process.env.NEXTCODE_TURN_RETRY_DELAYS_MS;
  if (raw !== undefined) {
    return raw
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
  }
  return [5_000, 20_000];
}

const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".nextcode"]);

export interface ParsedToolAction {
  ferramenta: string;
  args: Record<string, unknown>;
}

export type ParseToolActionResult =
  | { ok: true; action: ParsedToolAction }
  | { ok: false; error: string };

const OFFICIAL_FORMAT_REMINDER =
  'Responda com EXATAMENTE UM bloco ```json acao contendo {"ferramenta": "<nome>", "args": { ... }}.';

function validateActionObject(parsed: unknown): ParseToolActionResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `O conteúdo do bloco \`\`\`json acao deve ser um objeto JSON. ${OFFICIAL_FORMAT_REMINDER}`,
    };
  }
  const ferramenta = (parsed as Record<string, unknown>).ferramenta;
  if (typeof ferramenta !== "string" || !ferramenta.trim()) {
    return {
      ok: false,
      error: `O JSON deve conter o campo string "ferramenta". ${OFFICIAL_FORMAT_REMINDER}`,
    };
  }
  const rawArgs = (parsed as Record<string, unknown>).args;
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return {
      ok: false,
      error: `O campo "args" deve ser um objeto JSON. ${OFFICIAL_FORMAT_REMINDER}`,
    };
  }
  return {
    ok: true,
    action: {
      ferramenta: ferramenta.trim(),
      args: (rawArgs as Record<string, unknown>) ?? {},
    },
  };
}

/**
 * Extrai exatamente UMA ação de ferramenta da resposta do modelo, tentando na ordem:
 * 1. Blocos "```json acao" com qualquer espaço em branco (inclusive nenhum) entre "acao" e o JSON;
 * 2. Blocos "```json" ou "```" sem rótulo cujo JSON seja um objeto com "ferramenta" (string não vazia);
 * 3. A resposta inteira (sem espaços nas pontas) como objeto JSON com "ferramenta".
 */
export function parseExecutorToolAction(text: string): ParseToolActionResult {
  // 1. Blocos "```json acao" com qualquer espaço em branco (inclusive nenhum) entre "acao" e o JSON
  const stage1Regex = /```json[ \t]+acao\s*([\s\S]*?)```/gi;
  const stage1Matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = stage1Regex.exec(text)) !== null) {
    stage1Matches.push(match[1].trim());
  }

  if (stage1Matches.length > 1) {
    return {
      ok: false,
      error: `Foram encontrados ${stage1Matches.length} blocos \`\`\`json acao no mesmo turno. Envie EXATAMENTE UM bloco \`\`\`json acao por turno.`,
    };
  }

  if (stage1Matches.length === 1) {
    try {
      const parsed = JSON.parse(stage1Matches[0]);
      return validateActionObject(parsed);
    } catch (err) {
      return {
        ok: false,
        error: `JSON inválido no bloco \`\`\`json acao: ${err instanceof Error ? err.message : String(err)}. ${OFFICIAL_FORMAT_REMINDER}`,
      };
    }
  }

  // 2. Blocos "```json" ou "```" sem rótulo cujo conteúdo, após JSON.parse, seja um objeto com "ferramenta"
  const stage2Regex = /```(?:json)?(?=[ \t]*[\r\n{])\s*([\s\S]*?)```/gi;
  const stage2Candidates: string[] = [];
  while ((match = stage2Regex.exec(text)) !== null) {
    stage2Candidates.push(match[1].trim());
  }

  const stage2ValidActions: ParseToolActionResult[] = [];
  for (const rawBlock of stage2Candidates) {
    try {
      const parsed = JSON.parse(rawBlock);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).ferramenta === "string" &&
        ((parsed as Record<string, unknown>).ferramenta as string).trim().length > 0
      ) {
        stage2ValidActions.push(validateActionObject(parsed));
      }
    } catch {
      // Ignora bloco sem JSON válido; se nenhum candidato for válido, retorna erro ao final
    }
  }

  if (stage2ValidActions.length > 1) {
    return {
      ok: false,
      error: `Foram encontrados ${stage2ValidActions.length} blocos de ação no mesmo turno. ${OFFICIAL_FORMAT_REMINDER}`,
    };
  }

  if (stage2ValidActions.length === 1) {
    return stage2ValidActions[0];
  }

  // 3. A resposta inteira, sem espaços nas pontas, é um objeto JSON com "ferramenta"
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).ferramenta === "string" &&
        ((parsed as Record<string, unknown>).ferramenta as string).trim().length > 0
      ) {
        return validateActionObject(parsed);
      }
    } catch {
      // Segue para o erro padrão abaixo
    }
  }

  return {
    ok: false,
    error: `Nenhum bloco \`\`\`json acao encontrado. ${OFFICIAL_FORMAT_REMINDER}`,
  };
}

export type ParseToolActionsResult =
  | { ok: true; actions: ParsedToolAction[] }
  | { ok: false; error: string };

const MULTI_FORMAT_REMINDER =
  'Responda com UM bloco ```json acao contendo uma ação {"ferramenta": "<nome>", "args": { ... }} ou uma LISTA de até ' +
  `${MAX_ACTIONS_PER_TURN} ações [{...}, {...}].`;

function collectActionObjects(parsed: unknown): unknown[] {
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * G1: dentro das strings do JSON, escapa o que o modelo costuma mandar cru — quebra de linha, tab e
 * barra invertida sem escape válido (`\d` de uma regex). Fora das strings nada muda.
 */
function escapeRawCharsInJsonStrings(raw: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next !== undefined && '"\\/bfnrtu'.includes(next)) {
        out += ch + next;
        i++;
      } else {
        out += "\\\\";
      }
    } else if (ch === '"') {
      inString = false;
      out += ch;
    } else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out;
}

/** Fim do primeiro valor JSON completo (objeto/lista), contando colchetes fora das strings; -1 se não fecha. */
function firstJsonValueEnd(raw: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * G1: lê JSON tolerando os erros mais comuns de modelo (ver `escapeRawCharsInJsonStrings`) e sobra de
 * fechamentos/crases depois de um valor completo (trilha `4d019f00`: `[...]}]` e `[...]\``).
 */
export function parseJsonLenient(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    const fixed = escapeRawCharsInJsonStrings(raw);
    const end = firstJsonValueEnd(fixed);
    const attempts = [fixed];
    if (end > 0 && /^[\s\]}`]*$/.test(fixed.slice(end))) attempts.push(fixed.slice(0, end));
    for (const attempt of attempts) {
      if (attempt === raw) continue;
      try {
        return { ok: true, value: JSON.parse(attempt) };
      } catch {
        /* segue com o erro original */
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    const pos = Number(/position (\d+)/.exec(msg)?.[1]);
    const near = Number.isFinite(pos) ? ` perto de "${raw.slice(Math.max(0, pos - 40), pos + 40).replace(/\s+/g, " ")}"` : "";
    return { ok: false, error: `${msg}${near}` };
  }
}

interface ActionFence {
  labeled: boolean;
  value?: unknown;
  error?: string;
}

/**
 * G1 (mudança 38): acha os blocos de ação do turno. Teste real `4d019f00`: 49 turnos recusados com a ação
 * certa — rótulo `acao` na linha de baixo do ```json, bloco ```json sem rótulo, `conteudo` com ``` dentro
 * (o bloco fechava no meio), resposta cortada sem o ``` final. Abertura = ``` + só "json"/"acao" (qualquer
 * espaço, inclusive quebra de linha) + `{` ou `[`; fechamento = o primeiro ``` seguinte (ou o fim do texto)
 * em que o JSON fecha.
 */
function scanActionFences(text: string): ActionFence[] {
  const out: ActionFence[] = [];
  let i = text.indexOf("```");
  while (i !== -1) {
    const after = text.slice(i + 3);
    const header = /^([ \t]*(?:json)?[\s]*(?:acao)?[ \t]*\r?\n?[ \t]*)([{[])/i.exec(after);
    if (!header) {
      i = text.indexOf("```", i + 3);
      continue;
    }
    const labeled = /acao/i.test(header[1]);
    const bodyStart = i + 3 + header[1].length;
    const closings: number[] = [];
    for (let c = text.indexOf("```", bodyStart); c !== -1; c = text.indexOf("```", c + 3)) closings.push(c);
    closings.push(text.length);
    let found: ActionFence | null = null;
    let firstError = "";
    let nextFrom = text.length;
    for (const c of closings) {
      const parsed = parseJsonLenient(text.slice(bodyStart, c).trim());
      if (parsed.ok) {
        found = { labeled, value: parsed.value };
        nextFrom = c + 3;
        break;
      }
      if (!firstError) {
        firstError =
          c === text.length
            ? `a resposta terminou antes de fechar o bloco (cortada?): ${parsed.error}`
            : parsed.error;
        nextFrom = c + 3;
      }
    }
    out.push(found ?? { labeled, error: firstError });
    i = nextFrom >= text.length ? -1 : text.indexOf("```", nextFrom);
  }
  return out;
}

const hasToolName = (o: unknown): boolean =>
  Boolean(
    o &&
      typeof o === "object" &&
      !Array.isArray(o) &&
      typeof (o as Record<string, unknown>).ferramenta === "string" &&
      ((o as Record<string, unknown>).ferramenta as string).trim().length > 0
  );

/**
 * TR1 (12): extrai as ações do turno. Aceita um bloco ```json acao com um objeto OU uma lista de
 * objetos, e também vários blocos ```json acao (cada um com objeto ou lista). Sem bloco rotulado,
 * vale bloco ```json sem rótulo com "ferramenta" ou a resposta inteira. G1: rótulo em qualquer
 * espaço, ``` dentro do conteúdo, barra invertida sem escape e erro que diz o que está errado.
 */
export function parseExecutorToolActions(text: string): ParseToolActionsResult {
  const fences = scanActionFences(text);
  const labeled = fences.filter((f) => f.labeled);
  const raws: unknown[] = [];
  if (labeled.length > 0) {
    const bad = labeled.find((f) => f.error);
    if (bad) {
      return {
        ok: false,
        error: `JSON inválido no bloco \`\`\`json acao: ${bad.error}. Confira aspas e quebras de linha escapadas dentro de "conteudo". ${MULTI_FORMAT_REMINDER}`,
      };
    }
    for (const f of labeled) raws.push(...collectActionObjects(f.value));
  } else {
    const trimmed = text.trim();
    const candidates: unknown[] = fences.filter((f) => !f.error).map((f) => f.value);
    if (fences.length === 0 && /^[[{][\s\S]*[\]}]$/.test(trimmed)) {
      const whole = parseJsonLenient(trimmed);
      if (whole.ok) candidates.push(whole.value);
    }
    for (const v of candidates) raws.push(...collectActionObjects(v).filter(hasToolName));
    if (raws.length === 0) {
      const bad = fences.find((f) => f.error);
      if (bad) {
        return { ok: false, error: `JSON inválido no bloco de ação: ${bad.error}. ${MULTI_FORMAT_REMINDER}` };
      }
    }
  }

  if (raws.length === 0) {
    return { ok: false, error: `Nenhum bloco \`\`\`json acao encontrado. ${MULTI_FORMAT_REMINDER}` };
  }
  if (raws.length > MAX_ACTIONS_PER_TURN) {
    return {
      ok: false,
      error: `${raws.length} ações no mesmo turno (máximo ${MAX_ACTIONS_PER_TURN}). ${MULTI_FORMAT_REMINDER}`,
    };
  }
  const actions: ParsedToolAction[] = [];
  for (const raw of raws) {
    const one = validateActionObject(raw);
    if (!one.ok) return { ok: false, error: one.error.replace(OFFICIAL_FORMAT_REMINDER, MULTI_FORMAT_REMINDER) };
    actions.push(one.action);
  }
  return { ok: true, actions };
}

export function formatToolResultMessage(toolName: string, rawOutput: string): string {
  const truncated =
    rawOutput.length > MAX_TOOL_OUTPUT_CHARS
      ? `${rawOutput.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n...[resultado cortado em ${MAX_TOOL_OUTPUT_CHARS} caracteres]`
      : rawOutput;
  return `[RESULTADO ${toolName}]\n${truncated}`;
}

export function buildExecutorToolProtocolPrompt(): string {
  return [
    "## Protocolo de ferramentas",
    "Em CADA turno, responda com UM bloco ```json acao contendo UMA ação ou uma LISTA de até " +
      `${MAX_ACTIONS_PER_TURN} ações independentes (executadas na ordem; os resultados voltam juntos no próximo turno):`,
    "```json acao",
    '[{"ferramenta": "read_file", "args": {"caminho": "src/a.ts"}}, {"ferramenta": "read_file", "args": {"caminho": "src/b.ts"}}]',
    "```",
    "Junte no mesmo turno tudo o que não depende de resultado ainda não visto: várias leituras; vários arquivos para gravar; gravar e depois run_check. Cada turno custa uma chamada inteira — poucos turnos é melhor.",
    "`finish` vai SOZINHO, no último turno, depois de ver o resultado do run_check.",
    "Ferramentas e args (nomes EXATOS):",
    '- read_file  {"caminho": "src/x.ts"}',
    "  Lê da quarentena da etapa se existir lá; senão, do projeto. Devolve até 12000 caracteres, com números de linha.",
    '- list_files {"pasta": "src"}',
    "  Lista recursiva no projeto, até 300 entradas, ignorando node_modules, .next, .git e .nextcode.",
    '- grep {"padrao": "texto", "pasta": "src"}',
    "  Busca literal (não regex), até 100 linhas no formato arquivo:linha: trecho.",
    '- write_file {"caminho": "...", "conteudo": "..."}',
    "  Grava UM arquivo inteiro NA QUARENTENA (qm.writeFile). Nunca no projeto.",
    '- edit_file  {"caminho": "...", "trecho_antigo": "...", "trecho_novo": "..."}',
    "  Edita NA QUARENTENA. O trecho_antigo precisa aparecer EXATAMENTE 1 vez. 0 ou 2+ ocorrências devolvem erro e não mudam nada. Se o arquivo ainda não está na quarentena e existe no projeto, copie para a quarentena antes de editar.",
    '- run_check  {"comando": "typecheck"}',
    '  Roda a verificação de tipos (tsc) do projeto com os arquivos da quarentena aplicados temporariamente. Só "typecheck" neste item; "test" devolve "não disponível neste item".',
    '- finish {"relatorio_executor": "<o MESMO YAML do bloco relatorio_executor atual>"}',
    "  Encerra o laço.",
    "",
    "Exemplo de 1 turno (grava 2 arquivos e confere):",
    "```json acao",
    '[{"ferramenta": "write_file", "args": {"caminho": "src/lib/a.ts", "conteudo": "..."}}, {"ferramenta": "write_file", "args": {"caminho": "src/lib/b.ts", "conteudo": "..."}}, {"ferramenta": "run_check", "args": {"comando": "typecheck"}}]',
    "```",
  ].join("\n");
}

function resolveInsideRoot(rootDir: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(rootDir);
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  const resolvedTarget = path.resolve(resolvedRoot, cleaned);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

function addLineNumbers(content: string): string {
  const lines = content.split(/\r?\n/);
  const numbered = lines.map((line, idx) => `${idx + 1}: ${line}`).join("\n");
  if (numbered.length > MAX_TOOL_OUTPUT_CHARS) {
    return `${numbered.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n...[cortado em ${MAX_TOOL_OUTPUT_CHARS} caracteres]`;
  }
  return numbered;
}

function collectProjectFilesRecursive(
  projectRoot: string,
  subFolder: string,
  quarantinedFiles: Map<string, string>
): string[] {
  const results = new Set<string>();
  const cleanSub = subFolder.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  const startAbs = resolveInsideRoot(projectRoot, cleanSub || ".");
  const resolvedRoot = path.resolve(projectRoot);

  const walk = (dir: string) => {
    if (results.size >= MAX_LIST_FILES_ENTRIES) return;
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.size >= MAX_LIST_FILES_ENTRIES) break;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(resolvedRoot, full).replace(/\\/g, "/");
        results.add(rel);
      }
    }
  };

  if (startAbs && fs.existsSync(startAbs)) {
    const stat = fs.statSync(startAbs);
    if (stat.isDirectory()) {
      walk(startAbs);
    } else if (stat.isFile()) {
      results.add(path.relative(resolvedRoot, startAbs).replace(/\\/g, "/"));
    }
  }

  for (const qPath of quarantinedFiles.keys()) {
    if (results.size >= MAX_LIST_FILES_ENTRIES) break;
    const norm = normalizeScopePath(qPath);
    if (!cleanSub || cleanSub === "." || norm === cleanSub || norm.startsWith(`${cleanSub}/`)) {
      results.add(norm);
    }
  }

  return Array.from(results).slice(0, MAX_LIST_FILES_ENTRIES);
}

function countLiteralOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

function formatFinishReportBlock(rawReport: unknown): string {
  if (typeof rawReport === "string") {
    const trimmed = rawReport.trim();
    if (/^```yaml\s+relatorio_executor/i.test(trimmed)) {
      return trimmed;
    }
    const stripped = trimmed
      .replace(/^```(?:yaml|yml)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/i, "")
      .trim();
    return `\`\`\`yaml relatorio_executor\n${stripped}\n\`\`\``;
  }
  if (rawReport && typeof rawReport === "object" && !Array.isArray(rawReport)) {
    const obj = rawReport as Record<string, unknown>;
    if (Array.isArray(obj.reqs)) {
      const lines = ["reqs:"];
      for (const item of obj.reqs) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        lines.push(`  - id: ${String(r.id ?? "")}`);
        lines.push(`    status: ${String(r.status ?? "atendido")}`);
        const refs = Array.isArray(r.arquivo_linha) ? r.arquivo_linha.map(String).join("; ") : String(r.arquivo_linha ?? "");
        lines.push(`    arquivo_linha: "${refs}"`);
        lines.push(`    como: "${String(r.como ?? "").replace(/"/g, '\\"')}"`);
      }
      return `\`\`\`yaml relatorio_executor\n${lines.join("\n")}\n\`\`\``;
    }
  }
  return "";
}

export type RunTypecheckFn = (params: {
  qm: QuarantineManager;
  taskId: string;
  projectRoot: string;
  allowedScopeFiles: string[];
  quarantinedFiles: Map<string, string>;
}) => Promise<string>;

export async function defaultRunTypecheckInQuarantine(params: {
  qm: QuarantineManager;
  taskId: string;
  projectRoot: string;
  allowedScopeFiles: string[];
  quarantinedFiles: Map<string, string>;
}): Promise<string> {
  const { qm, taskId, projectRoot, allowedScopeFiles, quarantinedFiles } = params;
  return withProjectBuildLock(projectRoot, async () => {
    const snapshot = new Map<string, string>(quarantinedFiles);

    qm.promoteToMainRepo(taskId, projectRoot, allowedScopeFiles);
    const schemaTouched = touchesPrismaSchema(Array.from(quarantinedFiles.keys()));
    try {
      if (schemaTouched) await regeneratePrismaClient(projectRoot);
      const buildRes = await TerminalExecutionEngine.verifyProjectBuild(projectRoot);
      if (!buildRes) {
        return "Verificação de tipos indisponível (tsconfig.json ausente).";
      }
      if (buildRes.success) {
        return "tsc --noEmit: 0 erros.";
      }
      const combined = `${buildRes.stdout}\n${buildRes.stderr}`;
      const allErrorLines = combined
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.includes("error TS"));
      const normalizedScope = allowedScopeFiles.map(normalizeScopePath);
      const scopeErrorLines = allErrorLines.filter((line) => {
        const normalizedLine = line.replace(/\\/g, "/");
        return normalizedScope.some((scopeFile) => normalizedLine.includes(scopeFile));
      });
      const selected = scopeErrorLines.slice(0, 10);
      return [
        `tsc --noEmit falhou (${allErrorLines.length} erro(s) no total, ${scopeErrorLines.length} no escopo da etapa):`,
        ...selected.map((e) => `- ${e}`),
      ].join("\n");
    } finally {
      qm.rollbackPromotion(taskId);
      if (schemaTouched) await regeneratePrismaClient(projectRoot);
      qm.prepareWorkspace(taskId);
      for (const [relPath, content] of snapshot.entries()) {
        qm.writeFile(taskId, relPath, content);
      }
    }
  });
}

/** Mudança 43.3: limite de `run_check test` por etapa (cada um sobe a bancada, ~10–60 s). */
export const MAX_CONTRACT_TEST_RUNS = 4;

/** Resumo legível do resultado dos testes do contrato, para o executor. */
export function summarizeContractRun(report: TestBenchReport): string {
  if (!report.ok) return `Bancada de testes indisponível (${report.stage}): ${report.error ?? ""}`;
  const loadErrors = report.files.filter((f) => f.loadError).map((f) => `✗ ${f.file} não carregou: ${f.loadError}`);
  const lines = report.cases.map((c) => `${c.status === "passed" ? "✓" : "✗"} ${c.file} › ${c.name}${c.failure ? `\n    ${c.failure.slice(0, 1200)}` : ""}`);
  const falhas = report.cases.filter((c) => c.status === "failed").length + loadErrors.length;
  return [falhas === 0 ? `Testes do contrato: todos passaram (${report.cases.length}).` : `Testes do contrato: ${falhas} falha(s).`, ...loadErrors, ...lines]
    .join("\n")
    .slice(0, 8000);
}

/**
 * Mudança 43.3: roda os testes do contrato do reparo com o código da quarentena aplicado no projeto
 * (o mesmo vai-e-volta do `run_check typecheck`) — a bancada copia o projeto, então o código tem de estar lá.
 */
export async function defaultRunContractTestsInQuarantine(params: {
  qm: QuarantineManager;
  taskId: string;
  projectRoot: string;
  allowedScopeFiles: string[];
  quarantinedFiles: Map<string, string>;
  testes: RepairContractTest[];
}): Promise<string> {
  const { qm, taskId, projectRoot, allowedScopeFiles, quarantinedFiles } = params;
  return withProjectBuildLock(projectRoot, async () => {
    const snapshot = new Map<string, string>(quarantinedFiles);
    qm.promoteToMainRepo(taskId, projectRoot, allowedScopeFiles);
    const schemaTouched = touchesPrismaSchema(Array.from(quarantinedFiles.keys()));
    try {
      return summarizeContractRun(await runTestBench(projectRoot, contractBenchRequest(params.testes)));
    } finally {
      qm.rollbackPromotion(taskId);
      if (schemaTouched) await regeneratePrismaClient(projectRoot);
      qm.prepareWorkspace(taskId);
      for (const [relPath, content] of snapshot.entries()) {
        qm.writeFile(taskId, relPath, content);
      }
    }
  });
}

export interface ExecutorToolLoopParams {
  sessionId: string;
  nodeId: string;
  taskTitle: string;
  skill: LoadedRoleSkill;
  microbrief: MicrobriefAndReportDocument;
  initialMessages: DispatchMessage[];
  /** TR1 (14): arquivos da tentativa anterior, gravados na quarentena antes do 1º turno. */
  seedFiles?: Record<string, string>;
  smartRouter: SmartRouter;
  qm: QuarantineManager;
  projectRoot: string;
  executorTier: "rapido" | "medio" | "pesado";
  maxTokens: number;
  stepTimeoutMs: number;
  loopTimeoutMs?: number;
  routerKeys: {
    geminiKey?: string | null;
    groqKey?: string | null;
    nvidiaKey?: string | null;
    deepseekKey?: string | null;
    omniRouteUrl?: string | null;
    omniRouteKey?: string | null;
  };
  paidGateways?: GatewayConfig[];
  allowedRoutedViaPrefixes?: string[];
  runTypecheck?: RunTypecheckFn;
  /** Mudança 43.3: testes do contrato do reparo; com eles, `run_check test` roda na bancada. */
  contractTests?: RepairContractTest[];
  runContractTests?: typeof defaultRunContractTestsInQuarantine;
}

export interface ExecutorToolLoopResult {
  finished: boolean;
  noLlmAvailable: boolean;
  codeContentMap: Record<string, string>;
  finishReportText: string;
  stepsUsed: number;
  failureReason?: string;
  lastModelUsed?: string;
  /** TR1 (2): mesma ação negada ≥ 2× por regra do harness (não do escopo do Microbrief). */
  harnessDenials: HarnessDenial[];
}

export async function runExecutorToolLoop(params: ExecutorToolLoopParams): Promise<ExecutorToolLoopResult> {
  const {
    sessionId,
    nodeId,
    skill,
    microbrief,
    initialMessages,
    smartRouter,
    qm,
    projectRoot,
    executorTier,
    maxTokens,
    stepTimeoutMs,
    loopTimeoutMs = LOOP_TOTAL_TIMEOUT_MS,
    routerKeys,
    runTypecheck = defaultRunTypecheckInQuarantine,
    contractTests,
    runContractTests = defaultRunContractTestsInQuarantine,
  } = params;

  qm.prepareWorkspace(nodeId);
  const quarantinedFiles = new Map<string, string>();
  const allowedScopeFiles = Array.from(
    new Set([
      ...(microbrief.arquivosPermitidos.criar ?? []),
      ...(microbrief.arquivosPermitidos.modificar ?? []),
    ])
  );
  const normalizedScope = new Set(allowedScopeFiles.map(normalizeScopePath));
  for (const [file, content] of Object.entries(params.seedFiles ?? {})) {
    const rel = normalizeScopePath(file);
    if (!normalizedScope.has(rel)) continue;
    qm.writeFile(nodeId, rel, content);
    quarantinedFiles.set(rel, QuarantineManagerClass.sanitizeContent(rel, content));
  }

  const messages: DispatchMessage[] = [...initialMessages];
  const loopStartMs = Date.now();
  let consecutiveInvalidTurns = 0;
  let contractTestRuns = 0;
  let currentStep = 0;
  let lastModelUsed = "";
  const denialCounts = new Map<string, HarnessDenial>();
  const repeatedHarnessDenials = (): HarnessDenial[] =>
    Array.from(denialCounts.values()).filter((d) => d.vezes >= HARNESS_DENIAL_REPEAT_THRESHOLD);

  while (true) {
    currentStep += 1;

    if (Date.now() - loopStartMs > loopTimeoutMs) {
      return {
        finished: false,
        noLlmAvailable: false,
        codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
        harnessDenials: repeatedHarnessDenials(),
        finishReportText: "",
        stepsUsed: currentStep - 1,
        failureReason: `[LOOP TIMEOUT] Limite total do laço excedido (${Math.round(loopTimeoutMs / 60000)} min).`,
      };
    }

    if (currentStep > skill.passosMax) {
      const limitCheck = enforceSkillToolPermission({
        skill,
        toolName: "finish",
        currentStep,
      });
      return {
        finished: false,
        noLlmAvailable: false,
        codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
        harnessDenials: repeatedHarnessDenials(),
        finishReportText: "",
        stepsUsed: currentStep - 1,
        failureReason:
          limitCheck.violationReason ||
          `[SKILL STEP LIMIT] Limite de passos excedido (${currentStep}/${skill.passosMax}) na skill "${skill.name}".`,
      };
    }

    // TR1 (1): oscilação (prazo, sem provedor, exceção, resposta vazia) repete o MESMO turno com espera;
    // só depois das esperas a etapa falha ou a sessão pausa — o progresso do laço não se perde à toa.
    let turnText = "";
    const retryDelays = turnRetryDelaysMs();
    for (let retry = 0; ; retry++) {
      let outcome: TurnDispatchOutcome;
      try {
        outcome = await dispatchOneTurn();
      } catch (err) {
        outcome = { kind: "falha", noLlm: false, reason: `Exceção/Timeout no turno #${currentStep}: ${String(err)}` };
      }
      if (outcome.kind === "ok") {
        turnText = outcome.text;
        break;
      }
      if (retry < retryDelays.length) {
        TelemetryLogger.log({
          sessionId,
          action: "EXECUTOR_TURN_RETRY",
          details: { nodeId, passo: currentStep, repeticao: retry + 1, esperaMs: retryDelays[retry], motivo: outcome.reason },
        });
        if (retryDelays[retry] > 0) await new Promise((r) => setTimeout(r, retryDelays[retry]));
        continue;
      }
      // Resposta vazia depois das esperas segue como turno inválido (conta no limite de 3), como antes.
      if (outcome.vazia) break;
      return {
        finished: false,
        noLlmAvailable: outcome.noLlm,
        codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
        harnessDenials: repeatedHarnessDenials(),
        finishReportText: "",
        stepsUsed: outcome.noLlm ? currentStep - 1 : currentStep,
        ...(outcome.noLlm ? {} : { failureReason: outcome.reason }),
      };
    }
    const parsedTurn = parseExecutorToolActions(turnText);
    if (!parsedTurn.ok) {
      consecutiveInvalidTurns += 1;
      TelemetryLogger.log({
        sessionId,
        action: "EXECUTOR_TOOL_CALL",
        details: {
          nodeId,
          passo: currentStep,
          ferramenta: "invalido",
          permitido: false,
          caminho: null,
          duracaoMs: 0,
          amostra: turnText.slice(0, 300),
          tamanho: turnText.length,
          erro: parsedTurn.error.slice(0, 300),
        },
      });
      if (consecutiveInvalidTurns >= MAX_CONSECUTIVE_INVALID_TURNS) {
        return {
          finished: false,
          noLlmAvailable: false,
          codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
          harnessDenials: repeatedHarnessDenials(),
          finishReportText: "",
          stepsUsed: currentStep,
          failureReason: `[PROTOCOL ERROR] ${MAX_CONSECUTIVE_INVALID_TURNS} turnos inválidos seguidos: ${parsedTurn.error}`,
        };
      }
      messages.push({ role: "assistant", content: turnText || "(resposta vazia)" });
      messages.push({
        role: "user",
        content: formatToolResultMessage("erro_protocolo", parsedTurn.error),
      });
      continue;
    }

    consecutiveInvalidTurns = 0;
    const actions = parsedTurn.actions;

    if (actions.length === 1 && actions[0].ferramenta === "finish") {
      const perm = enforceSkillToolPermission({ skill, toolName: "finish", allowedScopeFiles, currentStep });
      if (perm.allowed) {
        TelemetryLogger.log({
          sessionId,
          action: "EXECUTOR_TOOL_CALL",
          details: {
            nodeId,
            passo: currentStep,
            ferramenta: "finish",
            permitido: true,
            caminho: null,
            duracaoMs: 0,
            acoesNoTurno: 1,
          },
        });
        return {
          finished: true,
          noLlmAvailable: false,
          codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
          harnessDenials: repeatedHarnessDenials(),
          finishReportText: formatFinishReportBlock(actions[0].args.relatorio_executor),
          stepsUsed: currentStep,
          lastModelUsed,
        };
      }
    }

    // TR1 (12): executa as ações na ordem e devolve todos os resultados numa só mensagem.
    const results: string[] = [];
    let turnOutputChars = 0;
    for (const action of actions) {
      if (turnOutputChars >= MAX_TURN_OUTPUT_CHARS && !isWriteAction(action.ferramenta)) {
        results.push(
          formatToolResultMessage(
            action.ferramenta,
            `Não executada: o turno já devolveu ${turnOutputChars} caracteres (teto ${MAX_TURN_OUTPUT_CHARS}). Peça de novo no próximo turno.`
          )
        );
        continue;
      }
      const formatted = formatToolResultMessage(action.ferramenta, await runOneAction(action, actions.length));
      turnOutputChars += formatted.length;
      results.push(formatted);
    }

    messages.push({ role: "assistant", content: turnText });
    messages.push({ role: "user", content: results.join("\n\n") });
  }

  async function dispatchOneTurn(): Promise<TurnDispatchOutcome> {
    // O gateway cortava em 120 s (padrão do callGateway) mesmo com a etapa podendo durar stepTimeoutMs:
    // no bench de 20/10 a tela do P2 (deepseek-v4-pro) passou de 120 s 2×, o FreeLLMAPI pôs a rota
    // em espera (~85 s) e as repetições do turno acharam a rota fechada → pausa SEM_LLM.
    const stepSignal = AbortSignal.timeout(stepTimeoutMs);
    const dispatchPromise = params.paidGateways
      ? smartRouter.dispatchWithFallback({
          messages,
          tier: "heavy",
          gateways: params.paidGateways,
          allowedRoutedViaPrefixes: params.allowedRoutedViaPrefixes,
          maxTokens,
          stream: false,
          signal: stepSignal,
          gatewayTimeoutMs: stepTimeoutMs,
        })
      : smartRouter.dispatchWithFallback({
          messages,
          tier: executorTier === "rapido" ? "fast" : "heavy",
          maxTokens,
          geminiKey: routerKeys.geminiKey ?? undefined,
          groqKey: routerKeys.groqKey ?? undefined,
          nvidiaKey: routerKeys.nvidiaKey ?? undefined,
          deepseekKey: routerKeys.deepseekKey ?? undefined,
          omniRouteUrl: routerKeys.omniRouteUrl ?? undefined,
          omniRouteKey: routerKeys.omniRouteKey ?? undefined,
          stream: false,
          signal: stepSignal,
          gatewayTimeoutMs: stepTimeoutMs,
        });

    const timeoutPromise = new Promise<null>((resolve) => {
      if (stepSignal.aborted) return resolve(null);
      stepSignal.addEventListener("abort", () => resolve(null), { once: true });
    });

    const dispatchRes = (await Promise.race([dispatchPromise, timeoutPromise])) as Awaited<
      ReturnType<SmartRouter["dispatchWithFallback"]>
    > | null;

    if (!dispatchRes) {
      return {
        kind: "falha",
        noLlm: false,
        reason: `Timeout de resposta excedido no turno #${currentStep} da etapa (limite ${Math.round(stepTimeoutMs / 1000)}s).`,
      };
    }

    if (dispatchRes.providerUsed === "none" || dispatchRes.tierTag === "exhausted") {
      return { kind: "falha", noLlm: true, reason: "nenhum provedor respondeu" };
    }

    const resJson = await dispatchRes.response.json().catch((err: unknown) => {
      TelemetryLogger.log({
        sessionId,
        action: "EXECUTOR_RESPONSE_UNREADABLE",
        details: { nodeId, passo: currentStep, aborted: stepSignal.aborted, error: String(err).slice(0, 200) },
      });
      return {};
    });

    if (dispatchRes.modelUsed) {
      lastModelUsed = dispatchRes.modelUsed;
    }

    await recordLlmCost({
      sessionId,
      nodeId,
      papel: "executor",
      provider: String(dispatchRes.providerUsed),
      model: String(dispatchRes.modelUsed || ""),
      usage: resJson.usage,
    });

    if (resJson.choices?.[0]?.finish_reason === "length") {
      TelemetryLogger.log({
        sessionId,
        action: "EXECUTOR_OUTPUT_TRUNCATED",
        details: {
          nodeId,
          passo: currentStep,
          modelUsed: dispatchRes.modelUsed,
          providerUsed: dispatchRes.providerUsed,
        },
      });
    }

    let text = "";
    if (resJson.choices?.[0]?.message?.content) {
      text = resJson.choices[0].message.content;
    } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = resJson.candidates[0].content.parts[0].text;
    }
    if (!text.trim()) {
      return { kind: "falha", noLlm: false, vazia: true, reason: `Resposta vazia no turno #${currentStep}.` };
    }
    return { kind: "ok", text };
  }

  async function runOneAction(action: ParsedToolAction, acoesNoTurno: number): Promise<string> {
    const toolStartMs = Date.now();
    const { ferramenta, args } = action;
    const rawTargetPath =
      typeof args.caminho === "string"
        ? args.caminho
        : typeof args.pasta === "string"
          ? args.pasta
          : undefined;
    const isWriteTool = isWriteAction(ferramenta);
    const commandArg =
      ferramenta === "run_check"
        ? typeof args.comando === "string"
          ? args.comando
          : "typecheck"
        : undefined;

    const perm = enforceSkillToolPermission({
      skill,
      toolName: ferramenta,
      targetFile: isWriteTool ? (typeof args.caminho === "string" ? args.caminho : "") : undefined,
      allowedScopeFiles,
      command: commandArg,
      currentStep,
    });

    if (!perm.allowed) {
      const violationReason = perm.violationReason || "[SKILL TOOL DENIED] Permissão negada.";
      TelemetryLogger.log({
        sessionId,
        action: "SKILL_TOOL_DENIED",
        details: {
          nodeId,
          ferramenta,
          motivo: violationReason,
          passo: currentStep,
        },
      });
      TelemetryLogger.log({
        sessionId,
        action: "EXECUTOR_TOOL_CALL",
        details: {
          nodeId,
          passo: currentStep,
          ferramenta,
          permitido: false,
          caminho: rawTargetPath ?? null,
          duracaoMs: Date.now() - toolStartMs,
          acoesNoTurno,
        },
      });
      const regra = violationReason.match(/^\[([A-Z ]+)\]/)?.[1];
      const inScope =
        typeof rawTargetPath === "string" && normalizedScope.has(normalizeScopePath(rawTargetPath));
      if (regra && HARNESS_RULE_CODES.has(regra) && (regra !== "SKILL PROTECTED PATH" || inScope)) {
        const alvo = rawTargetPath ?? commandArg ?? "";
        const key = `${regra}|${ferramenta}|${alvo}`;
        const prev = denialCounts.get(key);
        denialCounts.set(key, { regra, ferramenta, alvo, motivo: violationReason, vezes: (prev?.vezes ?? 0) + 1 });
      }
      return violationReason;
    }

    let toolOutput = "";
    try {
      if (ferramenta === "read_file") {
        const caminho = typeof args.caminho === "string" ? normalizeScopePath(args.caminho) : "";
        if (!caminho) {
          toolOutput = 'Erro em read_file: informe o argumento {"caminho": "src/x.ts"}.';
        } else {
          const fromQuarantine = qm.readFile(nodeId, caminho);
          if (fromQuarantine !== null) {
            toolOutput = addLineNumbers(fromQuarantine);
          } else {
            const abs = resolveInsideRoot(projectRoot, caminho);
            if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
              toolOutput = `Erro em read_file: arquivo "${caminho}" não encontrado na quarentena nem no projeto.`;
            } else {
              toolOutput = addLineNumbers(fs.readFileSync(abs, "utf8"));
            }
          }
        }
      } else if (ferramenta === "list_files") {
        const pasta = typeof args.pasta === "string" ? args.pasta : ".";
        const files = collectProjectFilesRecursive(projectRoot, pasta, quarantinedFiles);
        toolOutput = files.length > 0 ? files.join("\n") : "(nenhum arquivo encontrado)";
      } else if (ferramenta === "grep") {
        const padrao = typeof args.padrao === "string" ? args.padrao : "";
        const pasta = typeof args.pasta === "string" ? args.pasta : ".";
        if (!padrao) {
          toolOutput = 'Erro em grep: informe o argumento {"padrao": "texto", "pasta": "src"}.';
        } else {
          const files = collectProjectFilesRecursive(projectRoot, pasta, quarantinedFiles);
          const matches: string[] = [];
          for (const relFile of files) {
            if (matches.length >= MAX_GREP_MATCHES) break;
            const content =
              quarantinedFiles.get(relFile) ??
              qm.readFile(nodeId, relFile) ??
              (() => {
                const abs = resolveInsideRoot(projectRoot, relFile);
                return abs && fs.existsSync(abs) && fs.statSync(abs).isFile()
                  ? fs.readFileSync(abs, "utf8")
                  : null;
              })();
            if (content === null) continue;
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(padrao)) {
                matches.push(`${relFile}:${i + 1}: ${lines[i]}`);
                if (matches.length >= MAX_GREP_MATCHES) break;
              }
            }
          }
          toolOutput = matches.length > 0 ? matches.join("\n") : "(nenhuma ocorrência encontrada)";
        }
      } else if (ferramenta === "write_file") {
        const caminho = typeof args.caminho === "string" ? normalizeScopePath(args.caminho) : "";
        const conteudo = typeof args.conteudo === "string" ? args.conteudo : null;
        if (!caminho || conteudo === null) {
          toolOutput = 'Erro em write_file: informe {"caminho": "...", "conteudo": "..."}.';
        } else {
          qm.writeFile(nodeId, caminho, conteudo);
          const sanitized = QuarantineManagerClass.sanitizeContent(caminho, conteudo);
          quarantinedFiles.set(caminho, sanitized);
          const lineCount = sanitized.split(/\r?\n/).length;
          toolOutput = `Arquivo "${caminho}" gravado na quarentena (${lineCount} linhas).`;
        }
      } else if (ferramenta === "edit_file") {
        const caminho = typeof args.caminho === "string" ? normalizeScopePath(args.caminho) : "";
        const trechoAntigo = typeof args.trecho_antigo === "string" ? args.trecho_antigo : "";
        const trechoNovo = typeof args.trecho_novo === "string" ? args.trecho_novo : null;
        if (!caminho || !trechoAntigo || trechoNovo === null) {
          toolOutput =
            'Erro em edit_file: informe {"caminho": "...", "trecho_antigo": "...", "trecho_novo": "..."} com trecho_antigo não vazio.';
        } else {
          let currentContent = qm.readFile(nodeId, caminho);
          let cameFromProject = false;
          if (currentContent === null) {
            const abs = resolveInsideRoot(projectRoot, caminho);
            if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              currentContent = fs.readFileSync(abs, "utf8");
              cameFromProject = true;
            }
          }
          if (currentContent === null) {
            toolOutput = `Erro em edit_file: arquivo "${caminho}" não encontrado na quarentena nem no projeto.`;
          } else {
            let workingContent = currentContent;
            let workingOld = trechoAntigo;
            let occurrences = countLiteralOccurrences(workingContent, workingOld);
            if (occurrences === 0 && (workingContent.includes("\r\n") || workingOld.includes("\r\n"))) {
              workingContent = workingContent.replace(/\r\n/g, "\n");
              workingOld = workingOld.replace(/\r\n/g, "\n");
              occurrences = countLiteralOccurrences(workingContent, workingOld);
            }
            if (occurrences !== 1) {
              toolOutput = `Erro em edit_file: trecho_antigo encontrado ${occurrences} vez(es) em "${caminho}" (precisa aparecer EXATAMENTE 1 vez). O arquivo não foi alterado.`;
            } else {
              if (cameFromProject) {
                qm.writeFile(nodeId, caminho, workingContent);
              }
              const idx = workingContent.indexOf(workingOld);
              const updated =
                workingContent.slice(0, idx) + trechoNovo + workingContent.slice(idx + workingOld.length);
              qm.writeFile(nodeId, caminho, updated);
              const sanitized = QuarantineManagerClass.sanitizeContent(caminho, updated);
              quarantinedFiles.set(caminho, sanitized);
              toolOutput = `Arquivo "${caminho}" editado na quarentena com sucesso.`;
            }
          }
        }
      } else if (ferramenta === "run_check") {
        const comando = typeof args.comando === "string" ? args.comando.trim() : "";
        if (comando === "test") {
          if (!contractTests || contractTests.length === 0) {
            toolOutput = "não disponível neste item";
          } else if (contractTestRuns >= MAX_CONTRACT_TEST_RUNS) {
            toolOutput = `Limite de ${MAX_CONTRACT_TEST_RUNS} execuções de teste nesta etapa atingido. Corrija pelo que já viu e encerre com finish.`;
          } else {
            contractTestRuns += 1;
            toolOutput = await runContractTests({ qm, taskId: nodeId, projectRoot, allowedScopeFiles, quarantinedFiles, testes: contractTests });
          }
        } else if (comando !== "typecheck") {
          toolOutput = `Comando "${comando}" não suportado. Use {"comando": "typecheck"}.`;
        } else {
          toolOutput = await runTypecheck({
            qm,
            taskId: nodeId,
            projectRoot,
            allowedScopeFiles,
            quarantinedFiles,
          });
        }
      } else if (ferramenta === "finish") {
        toolOutput = "Ignorado: `finish` vai SOZINHO, no turno seguinte, depois de ver estes resultados.";
      } else {
        toolOutput = `Ferramenta "${ferramenta}" desconhecida.`;
      }
    } catch (toolErr) {
      toolOutput = `Erro ao executar ${ferramenta}: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`;
    }

    TelemetryLogger.log({
      sessionId,
      action: "EXECUTOR_TOOL_CALL",
      details: {
        nodeId,
        passo: currentStep,
        ferramenta,
        permitido: true,
        caminho: rawTargetPath ?? null,
        duracaoMs: Date.now() - toolStartMs,
        acoesNoTurno,
      },
    });
    return toolOutput;
  }
}

export interface HarnessDenial {
  regra: string;
  ferramenta: string;
  alvo: string;
  motivo: string;
  vezes: number;
}

export const HARNESS_DENIAL_REPEAT_THRESHOLD = 2;
/**
 * Negações em que o harness contradiz o próprio plano: caminho protegido que ESTÁ no escopo do Microbrief
 * (caso `.env.example` do teste real) e papel executor sem permissão de escrita. Ferramenta/comando
 * inventado pelo modelo e arquivo fora do escopo (plano, A3) continuam sendo do executor.
 */
const HARNESS_RULE_CODES = new Set(["SKILL PROTECTED PATH", "SKILL WRITE DENIED"]);

type TurnDispatchOutcome =
  | { kind: "ok"; text: string }
  | { kind: "falha"; noLlm: boolean; reason: string; vazia?: boolean };

function isWriteAction(ferramenta: string): boolean {
  return ferramenta === "write_file" || ferramenta === "edit_file";
}
