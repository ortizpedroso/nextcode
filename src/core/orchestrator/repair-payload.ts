import type { TaskNode } from "@prisma/client";
import type { MicrobriefReparoDocument } from "@/core/templates/artifact-templates";

/** J2b: o que a etapa de reparo da entrega leva no payload (além do payload da etapa dona). */
export interface DeliveryRepairPayload {
  rodada: number;
  /** Etapa original do plano (raiz), mesmo quando a dona da vez já era um reparo. */
  origemId: string;
  /** Etapa cujo trabalho este reparo substitui (a dona da vez). */
  etapaAnterior: string;
  defeitos: string[];
  microbriefReparo: MicrobriefReparoDocument;
}

export function readRepairPayload(payload?: string | null): DeliveryRepairPayload | null {
  try {
    const r = payload ? JSON.parse(payload)?.reparoEntrega : null;
    return r && typeof r.rodada === "number" && typeof r.etapaAnterior === "string" ? (r as DeliveryRepairPayload) : null;
  } catch {
    return null;
  }
}

/** Etapas cujo trabalho foi substituído por um reparo concluído (a T10 julga o reparo, não a antiga). */
export function supersededByRepair(tasks: Array<Pick<TaskNode, "status" | "payload">>): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    const r = readRepairPayload(t.payload);
    if (r && t.status === "completed") out.add(r.etapaAnterior);
  }
  return out;
}

/** Rodada de reparo já usada nesta versão da Spec (0 = nenhuma). */
export function currentRepairRound(tasks: Array<Pick<TaskNode, "payload">>): number {
  return tasks.reduce((max, t) => Math.max(max, readRepairPayload(t.payload)?.rodada ?? 0), 0);
}
