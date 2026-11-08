import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import {
  CANONICAL_SPEC_RELATIVE_PATH,
  readCanonicalSpecFile,
  writeCanonicalSpecFile,
} from "@/core/intake/spec-file";
import { parseSpecDocument } from "@/core/intake/spec-format";

export type ProjectSpecArtifactState = {
  sessionChars: number;
  diskSpec: boolean;
  macrobrief: boolean;
  macrobriefSpecVersao: number | null;
  divergente: boolean;
};

const MACROBRIEF_RELATIVE = ".nextcode/macrobrief.md";

export function readMacrobriefSpecVersion(projectRoot: string): number | null {
  if (!projectRoot) return null;
  const file = path.join(projectRoot, MACROBRIEF_RELATIVE);
  try {
    if (!fs.existsSync(file)) return null;
    const head = fs.readFileSync(file, "utf8").slice(0, 4000);
    const match = head.match(/^spec_versao:\s*(\d+)\s*$/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function assessProjectSpecArtifacts(
  projectPath: string | null | undefined,
  sessionSpec: string | null | undefined
): ProjectSpecArtifactState {
  const sessionChars = sessionSpec?.trim().length ?? 0;
  const diskText = projectPath ? readCanonicalSpecFile(projectPath) : null;
  const diskSpec = Boolean(diskText);
  const macrobrief = projectPath ? fs.existsSync(path.join(projectPath, MACROBRIEF_RELATIVE)) : false;
  const macrobriefSpecVersao = projectPath ? readMacrobriefSpecVersion(projectPath) : null;

  let divergente = false;
  if (sessionChars > 0 && diskText) {
    const a = sessionSpec!.trim();
    const b = diskText.trim();
    divergente = a !== b;
  }

  return { sessionChars, diskSpec, macrobrief, macrobriefSpecVersao, divergente };
}

export function formatProjectSpecArtifactStatus(state: ProjectSpecArtifactState): string[] {
  const lines: string[] = ["\n### Documento central"];
  lines.push(
    `- **Spec na sessão:** ${state.sessionChars > 0 ? `${state.sessionChars} caracteres` : "vazia"}`
  );
  lines.push(
    `- **\`${CANONICAL_SPEC_RELATIVE_PATH}\` no projeto:** ${state.diskSpec ? "presente" : "ausente"}`
  );
  if (state.macrobrief) {
    lines.push(
      `- **\`${MACROBRIEF_RELATIVE}\`:** presente` +
        (state.macrobriefSpecVersao != null ? ` (spec_versao: ${state.macrobriefSpecVersao})` : "")
    );
  }
  if (state.divergente) {
    lines.push(
      `\n⚠️ A Spec na sessão e o arquivo \`${CANONICAL_SPEC_RELATIVE_PATH}\` divergem. Alinhe antes de aprovar.`
    );
  } else if (!state.diskSpec && state.sessionChars > 0) {
    lines.push(
      `\nℹ️ A Spec está só na sessão. Na próxima gravação válida o NextCode publica \`${CANONICAL_SPEC_RELATIVE_PATH}\`.`
    );
  } else if (state.sessionChars === 0 && !state.diskSpec && state.macrobrief) {
    lines.push(
      "\n⚠️ Há Macrobrief no disco, mas não há Spec canônica. O Macrobrief não substitui a Spec. Reconstrua ou importe a Spec antes de retomar execução."
    );
  } else if (state.sessionChars === 0 && !state.diskSpec) {
    lines.push("\n⚠️ Não há Spec na sessão nem no disco. Elaboração ou importação necessária.");
  }
  return lines;
}

/**
 * Sessão vazia e arquivo válido no disco → hidrata a sessão.
 * Sessão válida e arquivo ausente ou diferente → republica no disco.
 */
export async function reconcileProjectSpecDocument(
  sessionId: string,
  projectPath: string | null | undefined,
  sessionSpec: string | null | undefined
): Promise<{ hydrated: boolean; published: boolean }> {
  if (!projectPath) return { hydrated: false, published: false };

  const sess = sessionSpec?.trim() ?? "";
  const disk = readCanonicalSpecFile(projectPath);
  let hydrated = false;
  let published = false;

  if (!sess && disk && parseSpecDocument(disk)) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { canonicalSpec: disk, specApproved: false },
    });
    TelemetryLogger.log({
      sessionId,
      action: "SPEC_HIDRATADA_DISCO",
      details: { arquivo: CANONICAL_SPEC_RELATIVE_PATH, caracteres: disk.length },
    });
    hydrated = true;
    return { hydrated, published };
  }

  if (sess && parseSpecDocument(sess)) {
    const write = writeCanonicalSpecFile(projectPath, sess);
    if (write.ok && write.wrote) {
      TelemetryLogger.log({
        sessionId,
        action: "SPEC_ARQUIVO",
        details: { arquivo: write.relativePath, origem: "reconcile" },
      });
      published = true;
    }
  }

  return { hydrated, published };
}
