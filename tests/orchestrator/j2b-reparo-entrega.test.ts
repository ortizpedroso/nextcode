import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import type { TaskNode } from "@prisma/client";
import { planDeliveryRepair, fileOfTsErrorLine, MAX_DELIVERY_REPAIR_ROUNDS } from "../../src/core/orchestrator/delivery-repair.js";
import { enqueueSessionQueueJob, claimJob, executeClaimedJob } from "../../src/core/orchestrator/job-queue.js";
import * as sessionQueueModule from "../../src/core/orchestrator/session-queue.js";
import * as nodeExecutorModule from "../../src/core/orchestrator/node-executor.js";

// J2b (§5.5; desenho DECISOES-AUTONOMAS-E1-3.md J1–J8): entrega reprovada → reparo por etapa dona, até 3 rodadas.
const created: string[] = [];
async function cleanup() {
  if (created.length === 0) return;
  await prisma.job.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.taskNode.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.message.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.telemetryLog.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  created.length = 0;
}

const node = (over: Partial<TaskNode>): TaskNode =>
  ({
    id: "n1",
    sessionId: "s",
    specVersion: 0,
    title: "Etapa 1/2: src/x.ts",
    role: "worker",
    cluster: "backend",
    filesScope: JSON.stringify(["src/x.ts"]),
    attempts: 0,
    maxAttempts: 3,
    quarantinePath: null,
    status: "completed",
    dependencies: "[]",
    mcpScope: null,
    payload: JSON.stringify({ reqsCobertos: ["REQ-001"] }),
    result: null,
    failureHistory: "[]",
    createdAt: new Date("2026-10-21T10:00:00Z"),
    updatedAt: new Date("2026-10-21T10:00:00Z"),
    ...over,
  }) as TaskNode;

const noGaps = { missingFiles: [], unapprovedReqs: [], buildErrorLines: [], buildGapWithoutDetail: false, otherGaps: [] };

describe("J2b — plano de reparo ligado à etapa dona (sem LLM)", () => {
  it("lê o arquivo da linha do tsc nos dois formatos", () => {
    expect(fileOfTsErrorLine("src/middleware.ts(54,7): error TS2345: x")).toBe("src/middleware.ts");
    expect(fileOfTsErrorLine("src/a.ts:3:1 - error TS2304: y")).toBe("src/a.ts");
    expect(fileOfTsErrorLine("Found 2 errors.")).toBeNull();
  });

  it("erro de tipo, arquivo ausente e REQ reprovado vão para a etapa dona; sem dono fica de fora", () => {
    const n1 = node({});
    const n2 = node({ id: "n2", title: "Etapa 2/2", filesScope: JSON.stringify(["src/y.ts"]), payload: JSON.stringify({ reqsCobertos: ["REQ-002"] }) });
    const plan = planDeliveryRepair([n1, n2], {
      ...noGaps,
      buildErrorLines: ["src/x.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.", "src/z.ts(2,2): error TS1: z"],
      missingFiles: ["src/y.ts"],
      unapprovedReqs: ["REQ-002"],
    });
    expect(plan.itens.map((i) => i.dona.id).sort()).toEqual(["n1", "n2"]);
    expect(plan.itens.find((i) => i.dona.id === "n2")?.defeitos).toHaveLength(2);
    expect(plan.semDono).toEqual(["type-check do projeto final: src/z.ts(2,2): error TS1: z"]);
  });

  it("2ª rodada: a dona é o reparo mais novo, e a origem continua a etapa do plano", () => {
    const n1 = node({});
    const r1 = node({
      id: "n1-reparo1",
      createdAt: new Date("2026-10-21T11:00:00Z"),
      payload: JSON.stringify({ reqsCobertos: ["REQ-001"], reparoEntrega: { rodada: 1, origemId: "n1", etapaAnterior: "n1", defeitos: [], microbriefReparo: {} } }),
    });
    const plan = planDeliveryRepair([n1, r1], { ...noGaps, buildErrorLines: ["src/x.ts(1,1): error TS2322: x"] });
    expect(plan.itens[0].dona.id).toBe("n1-reparo1");
    expect(plan.itens[0].origemId).toBe("n1");
  });

  it("base sem IA (scaffold) nunca é dona; lacuna de tela/Jev não tem dono", () => {
    const base = node({ id: "base", role: "scaffold", filesScope: JSON.stringify(["package.json"]) });
    const plan = planDeliveryRepair([base], { ...noGaps, missingFiles: ["package.json"], otherGaps: ["Verificação de tela reprovada (build)."] });
    expect(plan.itens).toHaveLength(0);
    expect(plan.semDono).toHaveLength(2);
  });

  it("T10 julga o reparo concluído, não a etapa que ele substituiu", () => {
    const spec = "---\ntitulo: T\nrequisitos:\n  - id: REQ-001\n    titulo: x\n    criterio: y\n---\n";
    const n1 = node({ result: JSON.stringify({ reqVerdicts: [{ id: "REQ-001", status: "parcial" }] }) });
    const r1 = node({
      id: "n1-reparo1",
      result: JSON.stringify({ reqVerdicts: [{ id: "REQ-001", status: "implementado" }] }),
      payload: JSON.stringify({ reqsCobertos: ["REQ-001"], reparoEntrega: { rodada: 1, origemId: "n1", etapaAnterior: "n1", defeitos: [], microbriefReparo: {} } }),
    });
    const sem = nodeExecutorModule.verifyProjectDeliveryT10({ canonicalSpec: spec, tasks: [n1] });
    const com = nodeExecutorModule.verifyProjectDeliveryT10({ canonicalSpec: spec, tasks: [n1, r1] });
    expect(sem.unapprovedReqs).toContain("REQ-001");
    expect(com.unapprovedReqs).not.toContain("REQ-001");
  });
});

describe("J2b — fila: VERIFICACAO reprovada abre o reparo ou bloqueia com relatório", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });
  afterAll(cleanup);

  async function sessionWith(tasks: Array<Partial<TaskNode>>) {
    const session = await prisma.session.create({ data: { title: "J2b", phase: "EXECUCAO" } });
    created.push(session.id);
    for (const t of tasks) {
      await prisma.taskNode.create({
        data: {
          id: `${session.id}-${t.id}`,
          sessionId: session.id,
          title: t.title ?? "Etapa 1/1: src/x.ts",
          role: t.role ?? "worker",
          status: t.status ?? "completed",
          filesScope: t.filesScope ?? JSON.stringify(["src/x.ts"]),
          payload: t.payload ?? JSON.stringify({ reqsCobertos: ["REQ-001"] }),
        },
      });
    }
    const all = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({
      processedCount: 0,
      allCompleted: true,
      tasks: all,
      specCompleteness: { complete: false, declaredFiles: ["src/x.ts"], missingFiles: ["src/x.ts"] },
    } as never);
    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: false,
      specFilesComplete: false,
      allReqsApproved: true,
      buildVerified: true,
      missingFiles: ["src/x.ts"],
      unapprovedReqs: [],
      gaps: ["Arquivos da Spec ausentes no disco: src/x.ts"],
    });
    return session;
  }

  async function runJob(sessionId: string) {
    const jobId = await enqueueSessionQueueJob(sessionId);
    await claimJob(jobId, "w-j2b");
    await executeClaimedJob(jobId, "w-j2b");
  }

  it("lacuna com dono → PLANEJAMENTO → EXECUCAO com a etapa de reparo na fila, sem bloquear", async () => {
    const s = await sessionWith([{ id: "n1" }]);
    await runJob(s.id);
    const after = await prisma.session.findUnique({ where: { id: s.id } });
    expect(after?.phase).toBe("EXECUCAO");
    const reparo = await prisma.taskNode.findUnique({ where: { id: `${s.id}-n1-reparo1` } });
    expect(reparo?.status).toBe("pending");
    expect(reparo?.title).toBe("Reparo 1/3 — Etapa 1/1: src/x.ts");
    expect(JSON.parse(reparo!.payload!).reparoEntrega.defeitos).toEqual(["arquivo da Spec ausente no disco: src/x.ts"]);
    const fases = (await prisma.telemetryLog.findMany({ where: { sessionId: s.id, action: "PHASE_TRANSITION" }, orderBy: { createdAt: "asc" } }))
      .map((l) => JSON.parse(l.details!).to);
    expect(fases).toEqual(["VERIFICACAO", "PLANEJAMENTO", "EXECUCAO"]);
    const msgs = await prisma.message.findMany({ where: { sessionId: s.id } });
    expect(msgs.some((m) => m.content.includes("reparo automático, rodada 1/3"))).toBe(true);
    expect(msgs.some((m) => m.content.includes("Sessão bloqueada"))).toBe(false);
    expect(await prisma.job.count({ where: { sessionId: s.id, status: "queued" } })).toBe(1);
  });

  it(`depois de ${MAX_DELIVERY_REPAIR_ROUNDS} rodadas, lacuna de código com dona → BLOQUEADA com o histórico e "Autorizar mais uma rodada" (43.4)`, async () => {
    const rounds = [1, 2, 3].map((r) => ({
      id: `n1-reparo${r}`,
      title: `Reparo ${r}/3 — Etapa 1/1: src/x.ts`,
      payload: JSON.stringify({ reqsCobertos: ["REQ-001"], reparoEntrega: { rodada: r, origemId: "n1", etapaAnterior: "n1", defeitos: ["d"], microbriefReparo: {} } }),
    }));
    const s = await sessionWith([{ id: "n1" }, ...rounds]);
    await runJob(s.id);
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("BLOQUEADA");
    const msg = (await prisma.message.findMany({ where: { sessionId: s.id } })).map((m) => m.content).join("\n");
    expect(msg).toContain("3 rodada(s) gastas");
    expect(msg).toContain("rodada 3:");
    expect(msg).toContain("A Spec está certa");
    expect(msg).toContain("Autorizar mais uma rodada");
  });

  it("lacuna sem dono → BLOQUEADA com 'Dono: analista', nenhum reparo criado", async () => {
    const s = await sessionWith([{ id: "n1", filesScope: JSON.stringify(["src/outro.ts"]) }]);
    await runJob(s.id);
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("BLOQUEADA");
    const msg = (await prisma.message.findMany({ where: { sessionId: s.id } })).map((m) => m.content).join("\n");
    expect(msg).toContain("**Dono:** analista");
    expect(await prisma.taskNode.count({ where: { sessionId: s.id, id: { contains: "reparo" } } })).toBe(0);
  });
});

describe("43.3 — o teste que prova o defeito vai junto para a etapa dona", () => {
  it("plano leva os testes; o pedido à bancada separa teste novo de teste do projeto", async () => {
    const { contractBenchRequest } = await import("../../src/core/orchestrator/repair-payload.js");
    const n9 = node({ id: "n9", filesScope: JSON.stringify(["src/lib/cobrancas-service.ts", "tests/cobrancas-service.test.ts"]) });
    const plan = planDeliveryRepair([n9], {
      ...noGaps,
      fileDefects: [
        { arquivo: "src/lib/cobrancas-service.ts", defeito: "REQ-026", teste: { caminho: "D2-contato.test.ts", conteudo: "c1" }, saida: "resolveu em vez de rejeitar" },
        { arquivo: "src/lib/cobrancas-service.ts", defeito: "REQ-052", teste: { caminho: "tests/cobrancas-service.test.ts", conteudo: "c2", existente: true } },
      ],
    });
    expect(plan.itens[0].testes.map((t) => t.caminho)).toEqual(["D2-contato.test.ts", "tests/cobrancas-service.test.ts"]);
    expect(plan.itens[0].testes[0].saida).toBe("resolveu em vez de rejeitar");
    expect(contractBenchRequest(plan.itens[0].testes)).toEqual({
      reproTests: { "D2-contato.test.ts": "c1" },
      files: [".nextcode-repro/D2-contato.test.ts", "tests/cobrancas-service.test.ts"],
    });
  });
});

describe("43.4 — rodada autorizada soma 1 ao limite", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });
  afterAll(cleanup);

  it("3 rodadas gastas + 1 autorização → abre a rodada 4 (Reparo 4/4)", async () => {
    const session = await prisma.session.create({ data: { title: "J2b-43.4", phase: "EXECUCAO" } });
    created.push(session.id);
    const mk = (id: string, payload: object) =>
      prisma.taskNode.create({ data: { id: `${session.id}-${id}`, sessionId: session.id, title: "Etapa 1/1: src/x.ts", status: "completed", filesScope: JSON.stringify(["src/x.ts"]), payload: JSON.stringify(payload) } });
    await mk("n1", { reqsCobertos: ["REQ-001"] });
    for (const r of [1, 2, 3]) await mk(`n1-reparo${r}`, { reqsCobertos: ["REQ-001"], reparoEntrega: { rodada: r, origemId: `${session.id}-n1`, etapaAnterior: `${session.id}-n1`, defeitos: ["d"], microbriefReparo: {} } });
    await prisma.telemetryLog.create({ data: { sessionId: session.id, action: "REPAIR_ROUND_AUTHORIZED", details: "{}" } });
    const all = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({ processedCount: 0, allCompleted: true, tasks: all, specCompleteness: { complete: false, declaredFiles: ["src/x.ts"], missingFiles: ["src/x.ts"] } } as never);
    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({ passed: false, specFilesComplete: false, allReqsApproved: true, buildVerified: true, missingFiles: ["src/x.ts"], unapprovedReqs: [], gaps: ["Arquivos da Spec ausentes no disco: src/x.ts"] });
    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "w-434");
    await executeClaimedJob(jobId, "w-434");
    expect((await prisma.session.findUnique({ where: { id: session.id } }))?.phase).toBe("EXECUCAO");
    const reparo4 = await prisma.taskNode.findFirst({ where: { sessionId: session.id, id: { endsWith: "-reparo4" } } });
    expect(reparo4?.title).toMatch(/^Reparo 4\/4 — /);
  });
});
