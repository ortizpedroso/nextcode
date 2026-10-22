import * as fs from "fs";
import * as path from "path";
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
  /**
   * Mudança 44: outros arquivos de código citados nos defeitos desta dona (ex.: "o mesmo ocorre em
   * src/middleware.ts:4"). Entram no escopo do reparo — sem eles o contrato não tem como passar.
   */
  escopoExtra: string[];
}

export interface RepairPlan {
  itens: RepairPlanItem[];
  semDono: string[];
}

type TaskLike = Pick<TaskNode, "id" | "title" | "role" | "status" | "filesScope" | "payload" | "createdAt">;

const norm = (f: string) => f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").toLowerCase();

/** Caminhos de código citados num texto (`src/a.ts:5`, `` `lib/b.tsx` ``), sem arquivos de teste. */
const CODE_REF_RE = /(?:^|[\s`'"(\[])((?:[\w.@-]+\/)*[\w.@\[\]()-]+\.(?:ts|tsx|js|jsx|mjs|prisma))\b/g;
export function codeFilesCitedIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CODE_REF_RE)) {
    const f = m[1].replace(/^\(+/, "");
    if (/(^|\/)(tests?|__tests__)\//.test(f) || /\.test\.[jt]sx?$/.test(f) || f.startsWith(".nextcode-repro/")) continue;
    if (!out.some((o) => norm(o) === norm(f))) out.push(f);
  }
  return out;
}

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

/** Outros arquivos de código citados nos defeitos, que pertencem ao plano e não estão no escopo da dona. */
function extraScopeFor(dona: TaskLike, defeitos: string[], ownerOfFile: (f: string) => TaskLike | undefined): string[] {
  const escopo = scopeOf(dona).map(norm);
  const out: string[] = [];
  for (const f of defeitos.flatMap(codeFilesCitedIn)) {
    const dono = ownerOfFile(f);
    if (!dono || escopo.includes(norm(f))) continue;
    const real = scopeOf(dono).find((x) => norm(x) === norm(f)) ?? f;
    if (!out.some((x) => norm(x) === norm(real))) out.push(real);
  }
  return out;
}

function ownerFinder(tasks: TaskLike[]) {
  const candidates = tasks
    .filter((t) => t.role !== "scaffold" && t.status === "completed")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return (file: string) => candidates.find((t) => scopeOf(t).some((f) => norm(f) === norm(file)));
}

/** Acrescenta arquivos ao escopo de uma etapa (filesScope, Microbrief "modificar" e Microbrief de reparo). */
function widenNodeScope(filesScope: string | null, payload: Record<string, unknown>, extra: string[]) {
  const base = (() => {
    try {
      const arr = JSON.parse(filesScope || "[]");
      return Array.isArray(arr) ? (arr as string[]) : [];
    } catch {
      return [];
    }
  })();
  const novos = extra.filter((f) => !base.some((b) => norm(b) === norm(f)));
  const mb = payload.microbrief as { arquivosPermitidos?: { criar?: string[]; modificar?: string[] } } | undefined;
  if (mb?.arquivosPermitidos) {
    const atuais = [...(mb.arquivosPermitidos.criar ?? []), ...(mb.arquivosPermitidos.modificar ?? [])].map(norm);
    mb.arquivosPermitidos.modificar = [...(mb.arquivosPermitidos.modificar ?? []), ...extra.filter((f) => !atuais.includes(norm(f)))];
  }
  const rep = (payload.reparoEntrega as DeliveryRepairPayload | undefined)?.microbriefReparo;
  if (rep && Array.isArray(rep.filesScope)) {
    rep.filesScope = [...rep.filesScope, ...extra.filter((f) => !rep.filesScope.some((b) => norm(b) === norm(f)))];
  }
  return { filesScope: JSON.stringify([...base, ...novos]), payload, novos };
}

/**
 * Mudança 44: no Re-tentar de uma etapa de reparo, o escopo é recalculado pela regra atual a partir dos
 * defeitos que ela carrega (etapa criada antes da regra, ou cujo defeito cita arquivo de outra etapa).
 * Devolve os arquivos acrescentados (vazio = nada mudou ou não é reparo).
 */
export async function rescopeRepairNode(nodeId: string): Promise<string[]> {
  const node = await prisma.taskNode.findUnique({ where: { id: nodeId } });
  const rep = node ? readRepairPayload(node.payload) : null;
  if (!node || !rep) return [];
  const tasks = await prisma.taskNode.findMany({ where: { sessionId: node.sessionId, specVersion: node.specVersion } });
  const extra = extraScopeFor(node, rep.defeitos, ownerFinder(tasks.filter((t) => t.id !== node.id)));
  if (extra.length === 0) return [];
  const widened = widenNodeScope(node.filesScope, JSON.parse(node.payload || "{}") as Record<string, unknown>, extra);
  if (widened.novos.length === 0) return [];
  await prisma.taskNode.update({ where: { id: nodeId }, data: { filesScope: widened.filesScope, payload: JSON.stringify(widened.payload) } });
  TelemetryLogger.log({ sessionId: node.sessionId, action: "REPAIR_SCOPE_WIDENED", details: { nodeId, arquivos: widened.novos } });
  return widened.novos;
}

/**
 * Liga cada lacuna à etapa dona. Dona = a etapa mais recente (o reparo mais novo vence a original) que
 * não é a base sem IA e que tem o arquivo no escopo, ou o REQ entre os seus.
 */
export function planDeliveryRepair(tasks: TaskLike[], gaps: DeliveryGaps): RepairPlan {
  const candidates = tasks
    .filter((t) => t.role !== "scaffold" && t.status === "completed")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const ownerOfFile = ownerFinder(tasks);
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
      ({ dona: full, origemId: readRepairPayload(owner.payload)?.origemId ?? owner.id, defeitos: [], reqs: [], testes: [], escopoExtra: [] } as RepairPlanItem);
    if (!item.defeitos.includes(defeito)) item.defeitos.push(defeito);
    if (teste && !item.testes.some((t) => t.caminho === teste.caminho)) item.testes.push(teste);
    if (req && !item.reqs.includes(req)) item.reqs.push(req);
    byOwner.set(owner.id, item);
    return item;
  };

  for (const file of gaps.missingFiles) add(ownerOfFile(file), `arquivo da Spec ausente no disco: ${file}`);
  for (const line of gaps.buildErrorLines) {
    const file = fileOfTsErrorLine(line);
    add(file ? ownerOfFile(file) : undefined, `type-check do projeto final: ${line}`);
  }
  for (const d of gaps.fileDefects ?? []) {
    const teste = d.teste ? { caminho: d.teste.caminho, conteudo: d.teste.conteudo, existente: d.teste.existente, saida: d.saida } : undefined;
    const owner = d.arquivo ? ownerOfFile(d.arquivo) : undefined;
    // Mudança 44: problema "importante" só acompanha o reparo; sem etapa dona, fica de fora (não vira "sem dono").
    if (!owner && d.defeito.startsWith("revisão final [importante]")) continue;
    const item = add(owner, d.defeito, undefined, teste);
    if (!item) continue;
    for (const f of extraScopeFor(item.dona, [d.defeito], ownerOfFile)) {
      if (!item.escopoExtra.some((x) => norm(x) === norm(f))) item.escopoExtra.push(f);
    }
  }
  for (const req of gaps.unapprovedReqs) add(ownerOfReq(req), `${req} não aprovado (veredito do avaliador abaixo de "implementado")`, req);
  // Sem detalhe do build: só é lacuna sem dono se não houver outra coisa a reparar (a próxima verificação mostra).
  if (gaps.buildGapWithoutDetail && byOwner.size === 0) semDono.push("falha de build sem a lista de erros");
  semDono.push(...gaps.otherGaps);

  return { itens: Array.from(byOwner.values()), semDono };
}

const MAX_REGRESSION_PROOFS_PER_STAGE = 6;

/**
 * Mudança 44: cada etapa de reparo leva, como regressão, as provas anteriores da sessão que tocam o seu
 * escopo e que NÃO estão abertas nesta rodada (as que ainda falham já são defeito de alguma etapa — como
 * regressão de outra, travariam essa outra para sempre).
 */
export async function attachRegressionProofs(sessionId: string, itens: RepairPlanItem[], projectPath?: string | null): Promise<void> {
  const { loadPriorProofs } = await import("@/core/orchestrator/prior-proofs");
  const provas = await loadPriorProofs(sessionId).catch(() => []);
  const abertas = new Set(itens.flatMap((i) => i.testes.map((t) => t.conteudo)));
  const caminhosAbertos = new Set(itens.flatMap((i) => i.testes.map((t) => norm(t.caminho))));
  // Testes do PRÓPRIO projeto que importam um arquivo do escopo (Gateway rodadas 5–7: tests/webhook-asaas.test.ts
  // quebrou e só a revisão final via). Os que falham agora já são defeito de alguma etapa e ficam de fora.
  if (projectPath) {
    for (const t of projectTestFiles(projectPath)) {
      if (caminhosAbertos.has(norm(t.caminho))) continue;
      for (const item of itens) {
        if (item.testes.filter((x) => x.regressao).length >= MAX_REGRESSION_PROOFS_PER_STAGE) continue;
        const usa = repairScopeOf(item).some((f) => {
          const semExt = f.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx|mjs)$/, "");
          const alvo = semExt.replace(/^src\//, "");
          return !/(^|\/)(tests?|__tests__)\//.test(f) && (t.conteudo.includes(`@/${alvo}`) || t.conteudo.includes(alvo));
        });
        if (usa && !item.testes.some((x) => norm(x.caminho) === norm(t.caminho))) {
          item.testes.push({ caminho: t.caminho, conteudo: t.conteudo, existente: true, regressao: true });
        }
      }
    }
  }
  provas.forEach((p, n) => {
    if (!p.arquivo || abertas.has(p.conteudo)) return;
    for (const item of itens) {
      const escopo = repairScopeOf(item).map(norm);
      if (!escopo.includes(norm(p.arquivo))) continue;
      if (item.testes.filter((t) => t.regressao).length >= MAX_REGRESSION_PROOFS_PER_STAGE) continue;
      if (item.testes.some((t) => t.conteudo === p.conteudo)) continue;
      const base = p.caminho.replace(/^.*\//, "").replace(/(\.test)?\.(ts|tsx|js|mjs)$/, "").replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 40);
      item.testes.push({ caminho: `regressao-${n + 1}-${base}.test.ts`, conteudo: p.conteudo, regressao: true });
    }
  });
}

/** Testes do próprio projeto (tests/ e src/), sem node_modules; no máximo 60. */
function projectTestFiles(root: string): Array<{ caminho: string; conteudo: string }> {
  const out: Array<{ caminho: string; conteudo: string }> = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 6 || out.length >= 60) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r, depth + 1);
      else if (/\.test\.(ts|tsx|js|mjs)$/.test(e.name)) {
        try {
          out.push({ caminho: r, conteudo: fs.readFileSync(path.join(root, r), "utf8") });
        } catch {
          // ilegível: ignora
        }
      }
    }
  };
  walk("tests", 0);
  walk("src", 0);
  return out;
}

/** Escopo da etapa de reparo: o da dona + os arquivos citados nos defeitos (mudança 44). */
export function repairScopeOf(item: RepairPlanItem): string[] {
  const base = scopeOf(item.dona);
  return [...base, ...item.escopoExtra.filter((f) => !base.some((b) => norm(b) === norm(f)))];
}

/**
 * Mudança 44: duas etapas da mesma rodada que editam o mesmo arquivo rodam uma depois da outra
 * (a que tem o arquivo no escopo próprio vai primeiro); sem ciclo.
 */
export function repairDependencies(itens: RepairPlanItem[], idOf: (i: RepairPlanItem) => string): Map<string, string[]> {
  const deps = new Map<string, string[]>(itens.map((i) => [idOf(i), []]));
  for (const item of itens) {
    for (const f of item.escopoExtra) {
      for (const other of itens) {
        if (other === item || !scopeOf(other.dona).some((x) => norm(x) === norm(f))) continue;
        const a = idOf(item);
        const b = idOf(other);
        if (deps.get(b)!.includes(a) || deps.get(a)!.includes(b)) continue;
        deps.get(a)!.push(b);
      }
    }
  }
  return deps;
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
    filesScope: repairScopeOf(item),
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
  | {
      started: false;
      motivo: string;
      /** Mudança 43.4: por que não abriu — o aviso muda conforme o tipo. */
      tipo: "esgotado" | "sem_dono" | "erro";
      /** No "esgotado": todos os defeitos têm etapa dona (código) → cabe autorizar mais uma rodada. */
      todosComDono?: boolean;
    };

/** Mudança 43.4: rodadas extras que o fundador autorizou nesta sessão (trilha `REPAIR_ROUND_AUTHORIZED`). */
export async function authorizedExtraRounds(sessionId: string): Promise<number> {
  return prisma.telemetryLog.count({ where: { sessionId, action: "REPAIR_ROUND_AUTHORIZED" } });
}

/**
 * Tenta abrir uma rodada de reparo. `started: false` → o chamador bloqueia (VERIFICACAO_COM_LACUNAS)
 * com `motivo` no aviso.
 */
export async function tryStartDeliveryRepair(
  sessionId: string,
  gaps: DeliveryGaps,
  opts: { perguntasSpec?: string[] } = {}
): Promise<DeliveryRepairOutcome> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { specVersion: true, title: true, project: { select: { path: true } } } });
  const specVersion = session?.specVersion ?? 0;
  const tasks = await prisma.taskNode.findMany({ where: { sessionId, specVersion } });
  const rodadaAnterior = currentRepairRound(tasks);
  const limite = MAX_DELIVERY_REPAIR_ROUNDS + (await authorizedExtraRounds(sessionId));
  const plan = planDeliveryRepair(tasks, gaps);

  if (rodadaAnterior >= limite) {
    const historico = tasks
      .map((t) => ({ t, r: readRepairPayload(t.payload) }))
      .filter((x) => x.r)
      .sort((a, b) => a.r!.rodada - b.r!.rodada)
      .map((x) => `- rodada ${x.r!.rodada}: "${x.t.title}" (${x.t.status}) — ${x.r!.defeitos.length} defeito(s)`);
    TelemetryLogger.log({ sessionId, action: "DELIVERY_REPAIR_EXHAUSTED", details: { rodadas: rodadaAnterior, limite } });
    return {
      started: false,
      tipo: "esgotado",
      todosComDono: plan.semDono.length === 0 && plan.itens.length > 0,
      motivo:
        `**Reparo automático:** ${rodadaAnterior} rodada(s) gastas (limite ${limite}: regra das 3 tentativas${limite > MAX_DELIVERY_REPAIR_ROUNDS ? " + autorizadas" : ""}).\n` +
        historico.join("\n"),
    };
  }

  if (plan.semDono.length > 0 || plan.itens.length === 0) {
    TelemetryLogger.log({ sessionId, action: "DELIVERY_REPAIR_NO_OWNER", details: { semDono: plan.semDono.slice(0, 20) } });
    return {
      started: false,
      tipo: "sem_dono",
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
  if (!toPlanning.ok) return { started: false, tipo: "erro", motivo: `não foi possível abrir o reparo: ${toPlanning.reason}` };

  const idProjeto = session?.title || sessionId;
  await attachRegressionProofs(sessionId, plan.itens, session?.project?.path);
  const repairId = (i: RepairPlanItem) => `${i.origemId}-reparo${rodada}`;
  const deps = repairDependencies(plan.itens, repairId);
  for (const item of plan.itens) {
    const base = (() => {
      try {
        return item.dona.payload ? (JSON.parse(item.dona.payload) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })();
    // Mudança 44: o executor só grava o que o Microbrief permite — os arquivos citados nos defeitos entram em "modificar".
    if (item.escopoExtra.length > 0) widenNodeScope(item.dona.filesScope, base, item.escopoExtra);
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
        id: repairId(item),
        sessionId,
        specVersion,
        title: `Reparo ${rodada}/${limite} — ${originalTitle}`,
        role: item.dona.role,
        cluster: item.dona.cluster,
        status: "pending",
        dependencies: JSON.stringify(deps.get(repairId(item)) ?? []),
        filesScope: JSON.stringify(repairScopeOf(item)),
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
        `🔧 **Entrega reprovada na verificação final — reparo automático, rodada ${rodada}/${limite}.**\n\n` +
        `${plan.itens.length} etapa(s) de reparo, cada uma partindo do código atual e corrigindo só as lacunas dos seus arquivos:\n` +
        plan.itens
          .map(
            (i) =>
              `- **${i.dona.title.replace(/^Reparo \d+\/\d+ — /, "")}**: ${i.defeitos.length} defeito(s)` +
              (i.testes.length ? `, ${i.testes.length} com teste que prova` : "") +
              ` — ${i.defeitos[0].slice(0, 200)}`
          )
          .join("\n") +
        (opts.perguntasSpec?.length
          ? `\n\n**Pergunta(s) sobre a Spec para você** (não vão para o reparo de código):\n${opts.perguntasSpec.map((q) => `- ${q}`).join("\n")}`
          : "") +
        `\n\nNada muda na Spec. Se a entrega continuar reprovada depois da rodada ${limite}, a sessão para e eu aviso com o diagnóstico.`,
    },
  });

  const toExecution = await applyPhaseEvent(sessionId, { type: "PLANO_PRONTO" });
  if (toExecution.ok && toExecution.effects.some((e) => e.type === "INICIAR_EXECUCAO")) {
    await enqueueSessionQueueJob(sessionId);
  }
  return { started: true, rodada, etapas: plan.itens.length };
}
