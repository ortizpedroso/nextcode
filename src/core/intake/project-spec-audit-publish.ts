import * as fs from "fs";
import * as path from "path";
import {
  CANONICAL_SPEC_RELATIVE_PATH,
  writeCanonicalSpecFile,
} from "./spec-file";
import type { ProjectSpecAuditResult } from "./project-repository-survey";

export { SPEC_GAPS_RELATIVE_PATH, SPEC_RECONCILE_RELATIVE_PATH } from "./spec-file";
import { SPEC_GAPS_RELATIVE_PATH, SPEC_RECONCILE_RELATIVE_PATH } from "./spec-file";

/**
 * Grava artefatos da auditoria sob projectRoot/.nextcode/:
 * - spec.md (quando gravouSpec === true e mode !== 'bloqueado')
 * - spec-gaps.md (sempre após auditoria)
 * - spec-reconcile.md (se houver reconcileMarkdown)
 */
export function publishProjectSpecAuditArtifacts(
  projectRoot: string,
  result: ProjectSpecAuditResult
): { specPath?: string; gapsPath: string; reconcilePath?: string } {
  const dotNextcodeDir = path.join(projectRoot, ".nextcode");
  fs.mkdirSync(dotNextcodeDir, { recursive: true });

  const response: { specPath?: string; gapsPath: string; reconcilePath?: string } = {
    gapsPath: SPEC_GAPS_RELATIVE_PATH,
  };

  // 1. Gaps (sempre gravado)
  const gapsFullPath = path.join(projectRoot, SPEC_GAPS_RELATIVE_PATH);
  fs.writeFileSync(gapsFullPath, result.gapsMarkdown, "utf8");
  result.gravouGaps = true;

  // 2. Reconcile (se houver markdown de delta)
  if (result.reconcileMarkdown) {
    const reconcileFullPath = path.join(projectRoot, SPEC_RECONCILE_RELATIVE_PATH);
    fs.writeFileSync(reconcileFullPath, result.reconcileMarkdown, "utf8");
    result.gravouReconcile = true;
    response.reconcilePath = SPEC_RECONCILE_RELATIVE_PATH;
  }

  // 3. Spec canônica (quando permitido e gravouSpec === true)
  if (result.gravouSpec && result.specText && result.mode !== "bloqueado") {
    const writeResult = writeCanonicalSpecFile(projectRoot, result.specText);
    if (writeResult.ok) {
      response.specPath = CANONICAL_SPEC_RELATIVE_PATH;
      result.gravouSpec = true;
    } else {
      result.gravouSpec = false;
    }
  }

  return response;
}
