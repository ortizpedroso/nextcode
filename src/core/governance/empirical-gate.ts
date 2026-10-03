/**
 * Empirical Gate (NextCode v5 - Trava T4)
 * Prova empírica real (type-check do projeto já mesclado) com rollback: se a promoção
 * introduzir erros de build NOVOS, os arquivos promovidos são restaurados ao estado anterior
 * — o código reprovado nunca permanece no repositório principal. Antes, a verificação só
 * reportava a falha e o código quebrado ficava no disco.
 *
 * Erros que já existiam antes da promoção (projeto previamente quebrado) não reprovam a
 * mudança: comparamos o conjunto de erros com e sem ela, ignorando linha/coluna.
 */

import { QuarantineManager } from "./quarantine-manager";
import { TerminalExecutionEngine, CommandResult } from "../execution/terminal-execution-engine";

export interface EmpiricalGateResult {
  /** true quando a promoção não introduziu nenhum erro novo (ou o projeto não tem tsconfig). */
  passed: boolean;
  /** Resultado do type-check com a mudança aplicada (null = verificação indisponível). */
  buildResult: CommandResult | null;
  /** true quando a promoção foi desfeita por introduzir erros novos. */
  rolledBack: boolean;
  /** true quando o build já falhava antes da mudança e ela não acrescentou erros. */
  preexistingFailure: boolean;
  /** Erros "error TS" presentes só com a mudança aplicada (sem linha/coluna). */
  newErrors: string[];
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

export async function promoteWithEmpiricalGate(
  qm: QuarantineManager,
  taskId: string,
  projectRoot: string,
  filesScope: string[]
): Promise<EmpiricalGateResult> {
  qm.promoteToMainRepo(taskId, projectRoot, filesScope);

  const after = await TerminalExecutionEngine.verifyProjectBuild(projectRoot);
  if (!after || after.success) {
    return { passed: true, buildResult: after, rolledBack: false, preexistingFailure: false, newErrors: [] };
  }

  qm.rollbackPromotion(taskId);
  const baseline = await TerminalExecutionEngine.verifyProjectBuild(projectRoot);
  const baselineKeys = baseline && !baseline.success ? tsErrorKeys(baseline) : new Set<string>();
  const newErrors = Array.from(tsErrorKeys(after)).filter((k) => !baselineKeys.has(k));

  if (baseline && !baseline.success && newErrors.length === 0) {
    qm.reapplyPromotion(taskId);
    return { passed: true, buildResult: after, rolledBack: false, preexistingFailure: true, newErrors };
  }

  return { passed: false, buildResult: after, rolledBack: true, preexistingFailure: false, newErrors };
}
