import prisma from "@/lib/prisma";

/**
 * TR1 (5): placar da sessão para as mensagens de bloqueio/espera — quantas etapas terminaram, quantas
 * esperam, quais estão bloqueadas e qual roda agora. Numeração = ordem do plano (criação), não de execução.
 */
export interface SessionScoreboard {
  total: number;
  concluidas: number;
  naFila: number;
  rodando: { numero: number; titulo: string }[];
  bloqueadas: { numero: number; titulo: string }[];
  /** Etapas que esperam alguma bloqueada (direta ou indiretamente). */
  esperandoBloqueio: number;
}

interface StageRow {
  id: string;
  title: string;
  status: string;
  dependencies: string | null;
}

export function computeScoreboard(stages: StageRow[]): SessionScoreboard {
  const active = stages.filter((s) => s.status !== "superseded");
  const numero = new Map(active.map((s, i) => [s.id, i + 1]));
  const blockedIds = new Set(active.filter((s) => s.status === "blocked").map((s) => s.id));
  const depsOf = (s: StageRow): string[] => {
    try {
      return JSON.parse(s.dependencies || "[]");
    } catch {
      return [];
    }
  };
  const byId = new Map(active.map((s) => [s.id, s]));
  const waitsOnBlocked = (s: StageRow, seen = new Set<string>()): boolean =>
    depsOf(s).some((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      const dep = byId.get(d);
      return blockedIds.has(d) || (dep ? waitsOnBlocked(dep, seen) : false);
    });
  const pending = active.filter((s) => ["pending", "failed"].includes(s.status));
  return {
    total: active.length,
    concluidas: active.filter((s) => s.status === "completed").length,
    naFila: pending.length,
    rodando: active.filter((s) => s.status === "running").map((s) => ({ numero: numero.get(s.id)!, titulo: s.title })),
    bloqueadas: active.filter((s) => s.status === "blocked").map((s) => ({ numero: numero.get(s.id)!, titulo: s.title })),
    esperandoBloqueio: pending.filter((s) => waitsOnBlocked(s)).length,
  };
}

export function formatScoreboard(p: SessionScoreboard): string {
  const parts = [
    `**Placar:** ${p.concluidas}/${p.total} concluídas`,
    `${p.naFila} na fila${p.esperandoBloqueio > 0 ? ` (${p.esperandoBloqueio} esperando etapa bloqueada)` : ""}`,
    `${p.bloqueadas.length} bloqueada(s)`,
  ];
  const lines = [parts.join(" · ")];
  if (p.bloqueadas.length > 0) {
    lines.push(`**Bloqueadas:** ${p.bloqueadas.map((b) => `#${b.numero} "${b.titulo}"`).join(", ")}`);
  }
  if (p.rodando.length > 0) {
    lines.push(`**Rodando agora:** ${p.rodando.map((r) => `#${r.numero} "${r.titulo}"`).join(", ")}`);
  }
  return lines.join("\n");
}

/** Placar da versão atual do plano da sessão, já formatado; "" se a sessão não tem etapas. */
export async function sessionScoreboardMarkdown(sessionId: string): Promise<string> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { specVersion: true } });
  const stages = await prisma.taskNode.findMany({
    where: { sessionId, specVersion: session?.specVersion ?? 0 },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, status: true, dependencies: true },
  });
  if (stages.length === 0) return "";
  return formatScoreboard(computeScoreboard(stages));
}
