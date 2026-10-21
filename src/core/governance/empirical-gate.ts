/**
 * Empirical Gate (NextCode v5 - Travas T4/T5)
 * Prova empírica real com rollback, em duas etapas sobre o projeto já mesclado:
 *  1. type-check (`tsc --noEmit`) do projeto inteiro;
 *  2. ESLint nos arquivos promovidos, quando o projeto-alvo tem ESLint instalado.
 * Se a promoção introduzir erros NOVOS em qualquer etapa, os arquivos promovidos são
 * restaurados ao estado anterior — o código reprovado nunca permanece no repositório.
 *
 * Erros que já existiam antes da promoção não reprovam a mudança: comparamos o conjunto de
 * erros com e sem ela, ignorando linha/coluna.
 *
 * Testes gerados pela IA NÃO são executados aqui: rodar Vitest/Jest executa o código gerado
 * com as permissões do usuário, fora de qualquer sandbox. tsc e ESLint só analisam o código.
 */

import * as path from "path";
import { QuarantineManager } from "./quarantine-manager";
import { TerminalExecutionEngine, CommandResult } from "../execution/terminal-execution-engine";
import { installDeclaredDependencies, repairEnvironment, type Installer } from "../execution/project-base";

export type EmpiricalStage = "typecheck" | "lint";

const projectBuildLocks = new Map<string, Promise<unknown>>();

/**
 * Mutex em memória por projectRoot para serializar promoções temporárias (run_check) e
 * promoções definitivas (promoteWithEmpiricalGate) entre etapas paralelas no mesmo projeto.
 */
export async function withProjectBuildLock<T>(
  projectRoot: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = path.resolve(projectRoot).replace(/\\/g, "/").toLowerCase();
  const prev = projectBuildLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => current);
  projectBuildLocks.set(key, chained);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (projectBuildLocks.get(key) === chained) {
      projectBuildLocks.delete(key);
    }
  }
}

export interface EmpiricalGateResult {
  /** true quando a promoção não introduziu nenhum erro novo (ou as verificações não se aplicam). */
  passed: boolean;
  /** Resultado do type-check com a mudança aplicada (null = verificação indisponível). */
  buildResult: CommandResult | null;
  /** Resultado do ESLint nos arquivos promovidos (null = projeto sem ESLint / não executado). */
  lintResult: CommandResult | null;
  /** true quando a promoção foi desfeita por introduzir erros novos. */
  rolledBack: boolean;
  /** true quando o projeto já tinha erros antes da mudança e ela não acrescentou nenhum. */
  preexistingFailure: boolean;
  /** Erros presentes só com a mudança aplicada (sem linha/coluna). */
  newErrors: string[];
  /** Etapa que reprovou a mudança (null quando passou). */
  failedStage: EmpiricalStage | null;
  /** Primeiro erro novo, pronto para relatório/feedback (undefined quando passou). */
  failureLine?: string;
}

/** Extrai as linhas "error TS" sem posição (linha/coluna), para comparar antes vs. depois. */
export function tsErrorKeys(result: CommandResult): Set<string> {
  return new Set(
    `${result.stdout}\n${result.stderr}`
      .split("\n")
      .filter((l) => l.includes("error TS"))
      .map((l) => l.replace(/\(\d+,\d+\)/, "").replace(/:\d+:\d+/, "").trim())
  );
}

/** Primeira linha "error TS" (ou mensagem genérica), para relatórios e telemetria. */
export function firstBuildErrorLine(result: CommandResult, newErrors: string[] = []): string {
  return (
    newErrors[0] ||
    `${result.stdout}\n${result.stderr}`.split("\n").find((l) => l.includes("error TS")) ||
    "falha no type-check pós-promoção"
  );
}

export interface FinalBuildRecheck {
  /** false = sem tsconfig.json (nada para conferir). */
  checked: boolean;
  ok: boolean;
  errors: string[];
}

/**
 * Mudança 34: a entrega (T10) julga o projeto FINAL. Uma etapa do meio marcada com "falha
 * preexistente" pode ter sido resolvida depois; o tsc roda de novo no projeto inteiro, com o mesmo
 * conserto de ambiente do portão (pacotes, tipos, `prisma generate`), e só esse resultado decide.
 */
export async function recheckFinalBuild(
  projectRoot: string,
  deps: {
    verify?: (root: string) => Promise<CommandResult | null>;
    repair?: (root: string, output: string) => Promise<{ changed: boolean }>;
  } = {}
): Promise<FinalBuildRecheck> {
  const verify = deps.verify ?? ((root: string) => TerminalExecutionEngine.verifyProjectBuild(root, 120000));
  const repair = deps.repair ?? ((root: string, output: string) => repairEnvironment(root, output));
  let result = await verify(projectRoot);
  if (!result) return { checked: false, ok: false, errors: [] };
  if (!result.success) {
    const fixed = await repair(projectRoot, `${result.stdout}\n${result.stderr}`);
    if (fixed.changed) result = (await verify(projectRoot)) ?? result;
  }
  return { checked: true, ok: result.success, errors: result.success ? [] : Array.from(tsErrorKeys(result)) };
}

/** Rótulo legível da etapa, para mensagens de rejeição. */
export function empiricalStageLabel(stage: EmpiricalStage | null): string {
  return stage === "lint" ? "ESLint real pós-promoção" : "type-check real pós-promoção";
}

export async function promoteWithEmpiricalGate(
  qm: QuarantineManager,
  taskId: string,
  projectRoot: string,
  filesScope: string[],
  opts: { checkOnly?: boolean; install?: Installer } = {}
): Promise<EmpiricalGateResult> {
  return withProjectBuildLock(projectRoot, async () => {
    const result = await runEmpiricalGate(qm, taskId, projectRoot, filesScope, opts.install);
    // AV1.4 (porteiro): no modo "só conferir", o projeto volta ao estado de antes mesmo quando passa —
    // a promoção de verdade só acontece depois da aprovação do avaliador.
    if (opts.checkOnly && !result.rolledBack) qm.rollbackPromotion(taskId);
    return result;
  });
}

async function runEmpiricalGate(
  qm: QuarantineManager,
  taskId: string,
  projectRoot: string,
  filesScope: string[],
  install?: Installer
): Promise<EmpiricalGateResult> {
  {
    let promotedFiles = qm.promoteToMainRepo(taskId, projectRoot, filesScope) ? qm.lastPromotedFiles(taskId) : [];
    // AV1.4: depois do porteiro a quarentena já foi limpa; a promoção real reaplica o mesmo conteúdo
    // conferido e roda o tsc de novo (outra etapa pode ter mudado o projeto nesse meio-tempo).
    if (promotedFiles.length === 0 && qm.hasPromotionSnapshot(taskId)) {
      qm.reapplyPromotion(taskId);
      promotedFiles = qm.lastPromotedFiles(taskId);
    }
    let preexistingFailure = false;

    // TR1 (6): a etapa é dona do conteúdo do package.json; o harness instala o que ela declarou.
    if (promotedFiles.some((f) => f.replace(/\\/g, "/") === "package.json")) {
      await installDeclaredDependencies(projectRoot, install);
    }

    // Etapa 1: type-check do projeto inteiro. Se faltar pacote/tipos ou o client do Prisma, o
    // ambiente é corrigido (nunca o código) e o tsc roda mais uma vez antes de julgar.
    let after = await TerminalExecutionEngine.verifyProjectBuild(projectRoot);
    if (after && !after.success) {
      const repair = await repairEnvironment(projectRoot, `${after.stdout}\n${after.stderr}`);
      if (repair.changed) after = await TerminalExecutionEngine.verifyProjectBuild(projectRoot);
    }
    if (after && !after.success) {
      qm.rollbackPromotion(taskId);
      const baseline = await TerminalExecutionEngine.verifyProjectBuild(projectRoot);
      const baselineKeys = baseline && !baseline.success ? tsErrorKeys(baseline) : new Set<string>();
      const newErrors = Array.from(tsErrorKeys(after)).filter((k) => !baselineKeys.has(k));

      if (!(baseline && !baseline.success && newErrors.length === 0)) {
        return {
          passed: false,
          buildResult: after,
          lintResult: null,
          rolledBack: true,
          preexistingFailure: false,
          newErrors,
          failedStage: "typecheck",
          failureLine: firstBuildErrorLine(after, newErrors),
        };
      }
      qm.reapplyPromotion(taskId);
      preexistingFailure = true;
    }

    // Etapa 2: ESLint só nos arquivos promovidos (erros de lint são por arquivo).
    const lintAfter = await TerminalExecutionEngine.verifyProjectLint(projectRoot, promotedFiles);
    if (lintAfter && lintAfter.errors.length > 0) {
      qm.rollbackPromotion(taskId);
      // Baseline: as versões anteriores dos mesmos arquivos (os que não existiam somem do lint).
      const lintBaseline = await TerminalExecutionEngine.verifyProjectLint(projectRoot, promotedFiles);
      const baselineKeys = new Set(lintBaseline?.errors || []);
      const newErrors = lintAfter.errors.filter((k) => !baselineKeys.has(k));

      if (newErrors.length > 0) {
        return {
          passed: false,
          buildResult: after,
          lintResult: lintAfter.result,
          rolledBack: true,
          preexistingFailure: false,
          newErrors,
          failedStage: "lint",
          failureLine: newErrors[0],
        };
      }
      qm.reapplyPromotion(taskId);
      preexistingFailure = true;
    }

    return {
      passed: true,
      buildResult: after,
      lintResult: lintAfter?.result || null,
      rolledBack: false,
      preexistingFailure,
      newErrors: [],
      failedStage: null,
    };
  }
}
