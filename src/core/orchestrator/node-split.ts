/**
 * Divisão de etapa quando o Jev julga que ela mistura responsabilidades (decisão do fundador, 07/10).
 *
 * Regras (para não quebrar o que a conferência T8b garantiu):
 * - Só divide etapa com 2+ arquivos e Microbrief.
 * - Cada REQ precisa caber em UM arquivo (o critério cita o arquivo). Se algum REQ não puder ser
 *   atribuído a um único arquivo, NÃO divide — dividir faria o avaliador julgar meio REQ como "parcial".
 * - As partes rodam em sequência (parte 2 depende da 1…), porque arquivos da mesma etapa costumam
 *   importar uns aos outros; quem dependia da etapa original passa a depender da última parte.
 */
import type { DAGNode } from "@/core/dag/dag-engine";
import type { MicrobriefAndReportDocument } from "@/core/templates/artifact-templates";

export interface SplitOutcome {
  nodes: DAGNode[];
  split: { nodeId: string; parts: string[] }[];
  skipped: { nodeId: string; reason: string }[];
}

function baseName(file: string): string {
  return file.split("/").pop() || file;
}

/** Arquivo do qual o REQ trata: o critério cita o caminho (ou o nome, se único na etapa). */
function fileForReq(criteria: string, files: string[]): string | null {
  const byPath = files.filter((f) => criteria.includes(f));
  if (byPath.length === 1) return byPath[0];
  if (byPath.length > 1) return null;
  const byName = files.filter((f) => criteria.includes(baseName(f)));
  return byName.length === 1 ? byName[0] : null;
}

export function splitNodesByJev(nodes: DAGNode[], shouldSplit: (nodeId: string) => boolean): SplitOutcome {
  const out: DAGNode[] = [];
  const split: SplitOutcome["split"] = [];
  const skipped: SplitOutcome["skipped"] = [];
  const lastPartOf = new Map<string, string>();

  for (const node of nodes) {
    const files = node.filesScope ?? [];
    const payload = (typeof node.payload === "object" && node.payload) || {};
    const mb = (payload as { microbrief?: MicrobriefAndReportDocument }).microbrief;
    if (!shouldSplit(node.id) || files.length < 2 || !mb) {
      out.push(node);
      continue;
    }

    const reqsByFile = new Map<string, string[]>(files.map((f) => [f, []]));
    let unassigned: string | null = null;
    for (const req of mb.reqsCobertos) {
      const file = fileForReq((mb.criteriosAceitePorReq[req] ?? []).join(" "), files);
      if (!file) {
        unassigned = req;
        break;
      }
      reqsByFile.get(file)!.push(req);
    }
    if (unassigned) {
      skipped.push({ nodeId: node.id, reason: `${unassigned} não cabe em um único arquivo` });
      out.push(node);
      continue;
    }

    const parts: DAGNode[] = [];
    files.forEach((file, i) => {
      const reqs = reqsByFile.get(file)!;
      const partId = `${node.id}-p${i + 1}`;
      const criterios = Object.fromEntries(reqs.map((r) => [r, mb.criteriosAceitePorReq[r] ?? []]));
      parts.push({
        ...node,
        id: partId,
        title: `${node.title} (parte ${i + 1}/${files.length}: ${baseName(file)})`,
        filesScope: [file],
        dependencies: i === 0 ? node.dependencies : [parts[i - 1].id],
        payload: {
          ...payload,
          nodeFiles: [file],
          reqsCobertos: reqs,
          microbrief: {
            ...mb,
            idMicrobrief: partId,
            dependeDe: i === 0 ? mb.dependeDe : [parts[i - 1].id],
            reqsCobertos: reqs,
            arquivosPermitidos: {
              ...mb.arquivosPermitidos,
              criar: mb.arquivosPermitidos.criar.filter((f) => f === file),
              modificar: mb.arquivosPermitidos.modificar.filter((f) => f === file),
            },
            criteriosAceitePorReq: criterios,
            registroCumprimento: mb.registroCumprimento.filter((r) => reqs.includes(r.reqId)),
          },
        },
      });
    });
    out.push(...parts);
    lastPartOf.set(node.id, parts[parts.length - 1].id);
    split.push({ nodeId: node.id, parts: parts.map((p) => p.id) });
  }

  // Quem dependia da etapa original passa a depender da última parte.
  for (const n of out) {
    n.dependencies = (n.dependencies ?? []).map((d) => lastPartOf.get(d) ?? d);
  }
  return { nodes: out, split, skipped };
}
