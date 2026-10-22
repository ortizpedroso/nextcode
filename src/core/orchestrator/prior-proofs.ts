import prisma from "@/lib/prisma";
import type { PriorProof } from "@/core/governance/defect-reproducer";
import { readRepairPayload } from "@/core/orchestrator/repair-payload";

/**
 * Mudança 44: provas anteriores da sessão — testes que reproduziram defeitos na revisão final
 * (`FINAL_REVIEW_PROOFS`) e contratos das etapas de reparo. Sem repetir conteúdo; as 40 mais recentes.
 */
export async function loadPriorProofs(sessionId: string): Promise<PriorProof[]> {
  const out: PriorProof[] = [];
  const seen = new Set<string>();
  const push = (p: PriorProof) => {
    if (!p.conteudo || seen.has(p.conteudo)) return;
    seen.add(p.conteudo);
    out.push(p);
  };
  const logs = await prisma.telemetryLog.findMany({
    where: { sessionId, action: "FINAL_REVIEW_PROOFS" },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  for (const l of logs) {
    try {
      for (const p of (JSON.parse(l.details || "{}").provas ?? []) as PriorProof[]) push(p);
    } catch {
      // registro ilegível: ignora
    }
  }
  const nodes = await prisma.taskNode.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, select: { title: true, payload: true, filesScope: true } });
  for (const n of nodes) {
    const rep = readRepairPayload(n.payload);
    for (const t of rep?.testesReproducao ?? []) {
      if (t.existente) continue;
      const escopo = (() => {
        try {
          return (JSON.parse(n.filesScope || "[]") as string[]).filter((f) => !/(^|\/)(tests?|__tests__)\//.test(f));
        } catch {
          return [];
        }
      })();
      push({ caminho: t.caminho, conteudo: t.conteudo, arquivo: escopo[0] ?? null, defeito: `contrato do "${n.title}" (${rep!.defeitos[0]?.slice(0, 200) ?? ""})` });
    }
  }
  // 40: o Gateway passou de 20 provas em 3 rodadas; cortar em 20 deixava de proteger os consertos mais antigos.
  return out.slice(0, 40);
}
