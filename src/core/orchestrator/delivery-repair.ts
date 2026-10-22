import prisma from "@/lib/prisma";
import type { TaskNode } from "@prisma/client";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";
import { readNodePayload, readNodeMicrobrief } from "@/core/orchestrator/node-executor";
import type { MicrobriefReparoDocument } from "@/core/templates/artifact-templates";
import type { ClusterKind } from "@/core/config/orchestration-policy";
import {
  readRepairPayload,
  currentRepairRound,
  type DeliveryRepairPayload,
  type RepairContractTest,
} from "@/core/orchestrator/repair-payload";

export { readRepairPayload, supersededByRepair, currentRepairRound, type DeliveryRepairPayload } from "@/core/orchestrator/repair-payload";

/**
 * J2b (§5.5; desenho `docs/relatorios/DECISOES-AUTONOMAS-E1-3.md` J1–J8): entrega reprovada na verificação
 * final volta a PLANEJAMENTO com etapas de reparo, até 3 rodadas; depois BLOQUEADA com relatório.
 * O reparo é montado por código, sem LLM (J2): cada lacuna é ligada à etapa dona do arquivo ou do REQ;
 * uma etapa de reparo por etapa dona, partindo do código atual do projeto, com as lacunas como defeitos.
 * Lacuna que não liga a nenhuma etapa → não repara (BLOQUEADA, "Dono: analista").
 */
export const MAX_DELIVERY_REPAIR_ROUNDS = 3;

export interface DeliveryGaps {
  missingFiles: string[];
  unapprovedReqs: string[];
  /** Linhas `error TS` do type-check do projeto final, com posição. */
  buildErrorLines: string[];
  /** Lacuna de build sem detalhe (ex.: "falha em uma ou mais etapas" sem o recheck rodar). */
  buildGapWithoutDetail: boolean;
  /** Lacunas que não ligam a arquivo nem a REQ (tela, auditoria do Jev, build não verificável…). */
  otherGaps: string[];
  /** J3: defeitos da revisão final, com o arquivo citado (null = sem dono). */
  fileDefects?: Array<{ arquivo: string | null; defeito: string; teste?: { caminho: string; conteudo: string; existente?: boolean }; saida?: string }>;
}

export interface RepairPlanItem {
  dona: TaskNode;
  origemId: string;
  defeitos: string[];
  reqs: string[];
  /** Mudança 43.3: testes que provam os defeitos desta dona. */
  testes: RepairContractTest[];
}

export interface RepairPlan {
  itens: RepairPlanItem[];
  semDono: string[];
}

type TaskLike = Pick<TaskNode, "id" | "title" | "role" | "status" | "filesScope" | "payload" | "createdAt">;

const norm = (f: string) => f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").toLowerCase();

/** Arquivo de uma linha `error TS` (`src/a.ts(54,7): error TS…` ou `src/a.ts:54:7 - error TS…`). */
export function fileOfTsErrorLine(line: string): string | null {
  const m = /^\s*(.+?)(?:\(\d+,\d+\)|:\d+:\d+)\s*[:-]\s*error TS\d+/.exec(line);
  return m ? m[1].trim() : null;
}

function scopeOf(t: TaskLike): string[] {
  try {
    const arr = JSON.parse(t.filesScope || "[]");
    return Array.isArray(arr) ? arr.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

function reqsOf(t: TaskLike): string[] {
  const mb = readNodeMicrobrief(t.payload);
  return mb?.reqsCobertos ?? readNodePayload(t.payload).reqsCobertos ?? [];
}

/**
 * Liga cada lacuna à etapa dona. Dona = a etapa mais recente (o reparo mais novo vence a original) que
 * não é a base sem IA e que tem o arquivo no escopo, ou o REQ entre os seus.
 */
export function planDeliveryRepair(tasks: TaskLike[], gaps: DeliveryGaps): RepairPlan {
  const candidates = tasks
    .filter((t) => t.role !== "scaffold" && t.status === "completed")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const ownerOfFile = (file: string) => candidates.find((t) => scopeOf(t).some((f) => norm(f) === norm(file)));
  const ownerOfReq = (req: string) => candidates.find((t) => reqsOf(t).includes(req));

  const byOwner = new Map<string, RepairPlanItem>();
  const semDono: string[] = [];
  const add = (owner: TaskLike | undefined, defeito: string, req?: string, teste?: RepairContractTest) => {
    if (!owner) {
      semDono.push(defeito);
      return;
    }
    const full = owner as TaskNode;
    const item =
      byOwner.get(owner.id) ??
      ({ dona: full, origemId: readRepairPayload(owner.payload)?.origemId ?? owner.id, defeitos: [], reqs: [], testes: [] } as RepairPlanItem);
    if (!item.defeitos.includes(defeito)) item.defeitos.push(defeito);
    if (teste && !item.testes.some((t) => t.caminho === teste.caminho)) item.testes.push(teste);
    if (req && !item.reqs.includes(req)) item.reqs.push(req);
    byOwner.set(owner.id, item);
  };

  for (const file of gaps.missingFiles) add(ownerOfFile(file), `arquivo da Spec ausente no disco: ${file}`);
  for (const line of gaps.buildErrorLines) {
    const file = fileOfTsErrorLine(line);
    add(file ? ownerOfFile(file) : undefined, `type-check do projeto final: ${line}`);
  }
  for (const d of gaps.fileDefects ?? []) {
    const teste = d.teste ? { caminho: d.teste.caminho, conteudo: d.teste.conteudo, existente: d.teste.existente, saida: d.saida } : undefined;
    add(d.arquivo ? ownerOfFile(d.arquivo) : undefined, d.defeito, undefined, teste);
  }
  for (const req of gaps.unapprovedReqs) add(ownerOfReq(req), `${req} não aprovado (veredito do avaliador abaixo de "implementado")`, req);
  // Sem detalhe do build: só é lacuna sem dono se não houver outra coisa a reparar (a próxima verificação mostra).
  if (gaps.buildGapWithoutDetail && byOwner.size === 0) semDono.push("falha de build sem a lista de erros");
  semDono.push(...gaps.otherGaps);

  return { itens: Array.from(byOwner.values()), semDono };
}

function microbriefReparoFor(item: RepairPlanItem, rodada: number, idProjeto: string): MicrobriefReparoDocument {
  const payload = readNodePayload(item.dona.payload);
  return {
    documento: "microbrief_reparo",
    idReparo: `${item.origemId}-reparo${rodada}`,
    cluster: (item.dona.cluster as ClusterKind) || payload.cluster || "backend",
    referenciaEtapaOriginal: item.origemId,
    versaoReparo: rodada,
    idProjeto,
    filesScope: scopeOf(item.dona),
    reqsAlvo: item.reqs.length > 0 ? item.reqs : reqsOf(item.dona),
    diretrizCirurgica:
      "A verificação final do projeto inteiro reprovou a entrega com os defeitos abaixo, nos arquivos desta etapa. " +
      "Parta do código ATUAL desses arquivos (mostrado abaixo) e corrija só o que os defeitos apontam, com edit_file; " +
      "não reescreva do zero e não mexa no que já funciona. Confira com run_check typecheck antes do finish.",
    lacunasParaSanar: item.defeitos,
  };
}

export type DeliveryRepairOutcome =
  | { started: true; rodada: number; etapas: number }
  | { started: false; motivo: string };

/**
 * Tenta abrir uma rodada de reparo. `started: false` → o chamador bloqueia (VERIFICACAO_COM_LACUNAS)
 * com `motivo` no aviso.
 */
export async function tryStartDeliveryRepair(sessionId: string, gaps: DeliveryGaps): Promise<DeliveryRepairOutcome> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { specVersion: true, title: true } });
  const specVersion = session?.specVersion ?? 0;
  const tasks = await prisma.taskNode.findMany({ where: { sessionId, specVersion } });
  const rodadaAnterior = currentRepairRound(tasks);

  if (rodadaAnterior >= MAX_DELIVERY_REPAIR_ROUNDS) {
    const historico = tasks
      .map((t) => ({ t, r: readRepairPayload(t.payload) }))
      .filter((x) => x.r)
      .sort((a, b) => a.r!.rodada - b.r!.rodada)
      .map((x) => `- rodada ${x.r!.rodada}: "${x.t.title}" (${x.t.status}) — ${x.r!.defeitos.length} defeito(s)`);
    TelemetryLogger.log({ sessionId, action: "DELIVERY_REPAIR_EXHAUSTED", details: { rodadas: rodadaAnterior } });
    return {
      started: false,
      motivo:
        `**Reparo automático:** ${MAX_DELIVERY_REPAIR_ROUNDS} rodadas gastas e a entrega continua reprovada (regra das 3 tentativas).\n` +
        historico.join("\n"),
    };
  }

  const plan = planDeliveryRepair(tasks, gaps);
  if (plan.semDono.length > 0 || plan.itens.length === 0) {
    TelemetryLogger.log({ sessionId, action: "DELIVERY_REPAIR_NO_OWNER", details: { semDono: plan.semDono.slice(0, 20) } });
    return {
      started: false,
      motivo:
        "**Dono:** analista — há lacuna que não pertence a nenhuma etapa do plano, então o reparo automático não abre:\n" +
        (plan.semDono.length > 0 ? plan.semDono.slice(0, 15).map((g) => `- ${g}`).join("\n") : "- (nenhuma lacuna ligável)"),
    };
  }

  const rodada = rodadaAnterior + 1;
  const toPlanning = await applyPhaseEvent(
    sessionId,
    { type: "REPARO_NECESSARIO" },
    { extraDetails: { rodada, etapas: plan.itens.map((i) => ({ dona: i.dona.id, defeitos: i.defeitos.length })) } }
  );
  if (!toPlanning.ok) return { started: false, motivo: `não foi possível abrir o reparo: ${toPlanning.reason}` };

  const idProjeto = session?.title || sessionId;
  for (const item of plan.itens) {
    const base = (() => {
      try {
        return item.dona.payload ? (JSON.parse(item.dona.payload) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })();
    const reparoEntrega: DeliveryRepairPayload = {
      rodada,
      origemId: item.origemId,
      etapaAnterior: item.dona.id,
      defeitos: item.defeitos,
      microbriefReparo: microbriefReparoFor(item, rodada, idProjeto),
      ...(item.testes.length > 0 ? { testesReproducao: item.testes } : {}),
    };
    const originalTitle = item.dona.title.replace(/^Reparo \d+\/\d+ — /, "");
    await prisma.taskNode.create({
      data: {
        id: `${item.origemId}-reparo${rodada}`,
        sessionId,
        specVersion,
        title: `Reparo ${rodada}/${MAX_DELIVERY_REPAIR_ROUNDS} — ${originalTitle}`,
        role: item.dona.role,
        cluster: item.dona.cluster,
        status: "pending",
        dependencies: "[]",
        filesScope: item.dona.filesScope,
        mcpScope: item.dona.mcpScope,
        payload: JSON.stringify({ ...base, reparoEntrega }),
      },
    });
  }

  TelemetryLogger.log({
    sessionId,
    action: "DELIVERY_REPAIR_PLANNED",
    details: {
      rodada,
      etapas: plan.itens.map((i) => ({ dona: i.dona.id, origem: i.origemId, defeitos: i.defeitos.slice(0, 10) })),
    },
  });
  await prisma.message.create({
    data: {
      sessionId,
      role: "assistant",
      content:
        `🔧 **Entrega reprovada na verificação final — reparo automático, rodada ${rodada}/${MAX_DELIVERY_REPAIR_ROUNDS}.**\n\n` +
        `${plan.itens.length} etapa(s) de reparo, cada uma partindo do código atual e corrigindo só as lacunas dos seus arquivos:\n` +
        plan.itens
          .map((i) => `- **${i.dona.title.replace(/^Reparo \d+\/\d+ — /, "")}**: ${i.defeitos.length} defeito(s) — ${i.defeitos[0].slice(0, 200)}`)
          .join("\n") +
        "\n\nNada muda na Spec. Se a entrega continuar reprovada depois da 3ª rodada, a sessão para e eu aviso com o relatório.",
    },
  });

  const toExecution = await applyPhaseEvent(sessionId, { type: "PLANO_PRONTO" });
  if (toExecution.ok && toExecution.effects.some((e) => e.type === "INICIAR_EXECUCAO")) {
    await enqueueSessionQueueJob(sessionId);
  }
  return { started: true, rodada, etapas: plan.itens.length };
}
