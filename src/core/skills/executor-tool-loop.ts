import * as fs from "fs";
import * as path from "path";
import type { DispatchMessage, SmartRouter } from "@/core/router/smart-router";
import { enforceSkillToolPermission, type LoadedRoleSkill } from "@/core/skills/skill-runtime";
import type { QuarantineManager } from "@/core/governance/quarantine-manager";
import { QuarantineManager as QuarantineManagerClass } from "@/core/governance/quarantine-manager";
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
 * TR1 (12): extrai as ações do turno. Aceita um bloco ```json acao com um objeto OU uma lista de
 * objetos, e também vários blocos ```json acao (cada um com objeto ou lista). Sem bloco rotulado,
 * cai nas mesmas regras de `parseExecutorToolAction` (bloco ```json sem rótulo / resposta inteira).
 */
export function parseExecutorToolActions(text: string): ParseToolActionsResult {
  const labeled = Array.from(text.matchAll(/```json[ \t]+acao\s*([\s\S]*?)```/gi)).map((m) => m[1].trim());
  const raws: unknown[] = [];
  if (labeled.length > 0) {
    for (const block of labeled) {
      try {
        raws.push(...collectActionObjects(JSON.parse(block)));
      } catch (err) {
        return {
          ok: false,
          error: `JSON inválido no bloco \`\`\`json acao: ${err instanceof Error ? err.message : String(err)}. ${MULTI_FORMAT_REMINDER}`,
        };
      }
    }
  } else {
    const unlabeled = Array.from(text.matchAll(/```(?:json)?(?=[ \t]*[\r\n{[])\s*([\s\S]*?)```/gi)).map((m) =>
      m[1].trim()
    );
    const trimmed = text.trim();
    const candidates = unlabeled.length > 0 ? unlabeled : /^[[{][\s\S]*[\]}]$/.test(trimmed) ? [trimmed] : [];
    for (const block of candidates) {
      try {
        const objs = collectActionObjects(JSON.parse(block)).filter(
          (o) =>
            o &&
            typeof o === "object" &&
            !Array.isArray(o) &&
            typeof (o as Record<string, unknown>).ferramenta === "string" &&
            ((o as Record<string, unknown>).ferramenta as string).trim().length > 0
        );
        raws.push(...objs);
      } catch {
        // Ignora bloco sem JSON válido; se nenhum candidato for válido, retorna erro ao final
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
        lines.push(`    arquivo_linha: "${String(r.arquivo_linha ?? "")}"`);
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
    try {
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
}

export interface ExecutorToolLoopResult {
  finished: boolean;
  noLlmAvailable: boolean;
  codeContentMap: Record<string, string>;
  finishReportText: string;
  stepsUsed: number;
  failureReason?: string;
  lastModelUsed?: string;
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
  } = params;

  qm.prepareWorkspace(nodeId);
  const quarantinedFiles = new Map<string, string>();
  const allowedScopeFiles = Array.from(
    new Set([
      ...(microbrief.arquivosPermitidos.criar ?? []),
      ...(microbrief.arquivosPermitidos.modificar ?? []),
    ])
  );

  const messages: DispatchMessage[] = [...initialMessages];
  const loopStartMs = Date.now();
  let consecutiveInvalidTurns = 0;
  let currentStep = 0;
  let lastModelUsed = "";

  while (true) {
    currentStep += 1;

    if (Date.now() - loopStartMs > loopTimeoutMs) {
      return {
        finished: false,
        noLlmAvailable: false,
        codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
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
        finishReportText: "",
        stepsUsed: currentStep - 1,
        failureReason:
          limitCheck.violationReason ||
          `[SKILL STEP LIMIT] Limite de passos excedido (${currentStep}/${skill.passosMax}) na skill "${skill.name}".`,
      };
    }

    let turnText = "";
    try {
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
          finished: false,
          noLlmAvailable: false,
          codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
          finishReportText: "",
          stepsUsed: currentStep,
          failureReason: `Timeout de resposta excedido no turno #${currentStep} da etapa (limite ${Math.round(stepTimeoutMs / 1000)}s).`,
        };
      }

      if (dispatchRes.providerUsed === "none" || dispatchRes.tierTag === "exhausted") {
        return {
          finished: false,
          noLlmAvailable: true,
          codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
          finishReportText: "",
          stepsUsed: currentStep - 1,
        };
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

      if (resJson.choices?.[0]?.message?.content) {
        turnText = resJson.choices[0].message.content;
      } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
        turnText = resJson.candidates[0].content.parts[0].text;
      }
    } catch (err) {
      return {
        finished: false,
        noLlmAvailable: false,
        codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
        finishReportText: "",
        stepsUsed: currentStep,
        failureReason: `Exceção/Timeout no turno #${currentStep}: ${String(err)}`,
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
        },
      });
      if (consecutiveInvalidTurns >= MAX_CONSECUTIVE_INVALID_TURNS) {
        return {
          finished: false,
          noLlmAvailable: false,
          codeContentMap: Object.fromEntries(quarantinedFiles.entries()),
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
          toolOutput = "não disponível neste item";
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

function isWriteAction(ferramenta: string): boolean {
  return ferramenta === "write_file" || ferramenta === "edit_file";
}
