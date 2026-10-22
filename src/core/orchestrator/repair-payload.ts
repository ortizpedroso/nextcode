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
  /** Mudança 43.3: testes que provam os defeitos — o contrato do reparo (têm de passar sem ser alterados). */
  testesReproducao?: RepairContractTest[];
}

/** Teste que prova um defeito: escrito pela revisão (`.nextcode-repro/`) ou um teste do próprio projeto. */
export interface RepairContractTest {
  caminho: string;
  conteudo: string;
  /** Saída da falha quando o defeito foi provado. */
  saida?: string;
  existente?: boolean;
  /**
   * Mudança 44: prova de rodada anterior que já passa e toca o escopo desta etapa — tem de continuar
   * passando (o portão roda junto com o contrato). Gateway 22/10: a rodada 6 quebrou o reprocessamento do
   * webhook consertado na 5 e só a verificação final viu.
   */
  regressao?: boolean;
}

/** Pedido à bancada para rodar só os testes do contrato. */
export function contractBenchRequest(testes: RepairContractTest[]): { reproTests: Record<string, string>; files: string[] } {
  const repro = testes.filter((t) => !t.existente);
  return {
    reproTests: Object.fromEntries(repro.map((t) => [t.caminho, t.conteudo])),
    files: [...repro.map((t) => `.nextcode-repro/${t.caminho}`), ...testes.filter((t) => t.existente).map((t) => t.caminho)],
  };
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
