import fs from "fs";
import path from "path";
import os from "os";

// Trava T-F: cópia do banco para %TEMP%\nc-dg1\ antes de importar Prisma
const repoRoot = path.resolve(process.cwd());
const tmpDir = path.join(os.tmpdir(), "nc-dg1");

if (fs.existsSync(tmpDir)) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
fs.mkdirSync(tmpDir, { recursive: true });

for (const ext of ["", "-wal", "-shm"]) {
  const src = path.join(repoRoot, "prisma", `dev.db${ext}`);
  const dst = path.join(tmpDir, `dev.db${ext}`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

process.env.DATABASE_URL = `file:${path.join(tmpDir, "dev.db").replace(/\\/g, "/")}`;

async function main() {
  const { default: prisma } = await import("@/lib/prisma");

  const session = await prisma.session.findFirst({
    where: { id: { startsWith: "4d019f00" } },
    select: { id: true, title: true, phase: true, specVersion: true, createdAt: true, updatedAt: true },
  });

  if (!session) {
    console.log(JSON.stringify({ error: "Sessão 4d019f00 não encontrada" }));
    return;
  }

  console.log(JSON.stringify({ tipo: "SESSAO", id: session.id, title: session.title, phase: session.phase }));

  // 1. Revisões finais: FINAL_REVIEW e FINAL_REVIEW_PROOFS
  const reviewLogs = await prisma.telemetryLog.findMany({
    where: {
      sessionId: session.id,
      action: { in: ["FINAL_REVIEW", "FINAL_REVIEW_PROOFS"] },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const log of reviewLogs) {
    let details: any = {};
    try {
      details = JSON.parse(log.details || "{}");
    } catch {}

    if (log.action === "FINAL_REVIEW") {
      const defeitos = (details.defeitos ?? []).map((d: any) => {
        if (typeof d === "string") {
          return { texto: d };
        }
        return {
          req: d.req ?? null,
          arquivo: d.arquivo ?? null,
          prova: d.prova ?? null,
          bloqueia: d.prova === "reproduzido" || d.prova === undefined || (typeof d.defeito === "string" && d.defeito.startsWith("revisão final [critico]")),
          defeito: d.defeito ?? null,
        };
      });
      console.log(
        JSON.stringify({
          tipo: "FINAL_REVIEW",
          createdAt: log.createdAt,
          aprovado: details.aprovado,
          executado: details.executado,
          modelo: details.modelo,
          totalDefeitos: defeitos.length,
          defeitos,
          perguntasSpec: details.perguntasSpec ?? [],
          ressalvas: details.ressalvas ?? [],
        })
      );
    } else if (log.action === "FINAL_REVIEW_PROOFS") {
      const provas = (details.provas ?? []).map((p: any) => ({
        caminho: p.caminho,
        req: p.req ?? null,
        arquivo: p.arquivo ?? null,
        defeito: p.defeito ?? null,
      }));
      console.log(
        JSON.stringify({
          tipo: "FINAL_REVIEW_PROOFS",
          createdAt: log.createdAt,
          totalProvas: provas.length,
          provas,
        })
      );
    }
  }

  // 2. Rodadas de reparo: DELIVERY_REPAIR_PLANNED
  const repairLogs = await prisma.telemetryLog.findMany({
    where: {
      sessionId: session.id,
      action: "DELIVERY_REPAIR_PLANNED",
    },
    orderBy: { createdAt: "asc" },
  });

  for (const log of repairLogs) {
    let details: any = {};
    try {
      details = JSON.parse(log.details || "{}");
    } catch {}
    const itens = (details.itens ?? []).map((it: any) => ({
      donaId: it.donaId ?? it.dona?.id ?? null,
      donaTitulo: it.donaTitulo ?? it.dona?.title ?? null,
      reqs: it.reqs ?? [],
      defeitos: it.defeitos ?? [],
      escopoExtra: it.escopoExtra ?? [],
      arquivos: it.arquivos ?? [],
    }));
    console.log(
      JSON.stringify({
        tipo: "DELIVERY_REPAIR_PLANNED",
        createdAt: log.createdAt,
        rodada: details.rodada,
        totalItens: itens.length,
        itens,
      })
    );
  }

  // 3. Plano original: TaskNodes da sessão + ANALISTA_PLAN_APPROVED e PLANO_T8B_OK
  const planLogs = await prisma.telemetryLog.findMany({
    where: {
      sessionId: session.id,
      action: { in: ["ANALISTA_PLAN_APPROVED", "PLANO_T8B_OK"] },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const log of planLogs) {
    let details: any = {};
    try {
      details = JSON.parse(log.details || "{}");
    } catch {}
    console.log(
      JSON.stringify({
        tipo: "PLANO_LOG",
        action: log.action,
        createdAt: log.createdAt,
        totalNodes: details.totalNodes ?? details.nodes?.length ?? null,
        details,
      })
    );
  }

  const nodes = await prisma.taskNode.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      role: true,
      status: true,
      attempts: true,
      filesScope: true,
      payload: true,
      result: true,
      createdAt: true,
    },
  });

  console.log(JSON.stringify({ tipo: "TOTAL_NODES", total: nodes.length }));

  for (const node of nodes) {
    let payloadObj: any = {};
    try {
      payloadObj = JSON.parse(node.payload || "{}");
    } catch {}

    let resultObj: any = {};
    try {
      resultObj = JSON.parse(node.result || "{}");
    } catch {}

    let filesScopeArr: string[] = [];
    try {
      filesScopeArr = JSON.parse(node.filesScope || "[]");
    } catch {}

    const microbrief = payloadObj.microbrief ?? payloadObj.microbriefReparo ?? {};
    const reqsCobertos = payloadObj.reqsCobertos ?? microbrief.requisitosCobrir ?? [];

    console.log(
      JSON.stringify({
        tipo: "TASK_NODE",
        id: node.id,
        title: node.title,
        role: node.role,
        status: node.status,
        attempts: node.attempts,
        filesScope: filesScopeArr,
        reqsCobertos,
        createdAt: node.createdAt,
        reparoEntrega: payloadObj.reparoEntrega ? { rodada: payloadObj.reparoEntrega.rodada, origemId: payloadObj.reparoEntrega.origemId } : null,
      })
    );
  }

  // 4. Por etapa: autoteste, avaliador e contratos de reparo
  const nodeIds = nodes.map((n) => n.id);
  const stepLogs = await prisma.telemetryLog.findMany({
    where: {
      sessionId: session.id,
      action: {
        in: [
          "ACCEPTANCE_TESTS_PASSED",
          "ACCEPTANCE_TESTS_FAILED",
          "ACCEPTANCE_DISAGREEMENT",
          "EVALUATOR_MODEL",
          "REPAIR_CONTRACT_PASSED",
          "REPAIR_CONTRACT_FAILED",
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const log of stepLogs) {
    let details: any = {};
    try {
      details = JSON.parse(log.details || "{}");
    } catch {}
    console.log(
      JSON.stringify({
        tipo: "STEP_EVENT",
        action: log.action,
        nodeId: details.nodeId ?? details.node_id ?? null,
        createdAt: log.createdAt,
        details,
      })
    );
  }

  // 5. Avaliador result por nó
  for (const node of nodes) {
    let resultObj: any = {};
    try {
      resultObj = JSON.parse(node.result || "{}");
    } catch {}

    if (resultObj.reqVerdicts || resultObj.correcoesSugeridas || resultObj.ressalvas) {
      console.log(
        JSON.stringify({
          tipo: "EVALUATOR_RESULT",
          nodeId: node.id,
          title: node.title,
          verdict: resultObj.verdict,
          reqVerdicts: resultObj.reqVerdicts ?? [],
          ressalvas: resultObj.ressalvas ?? [],
          correcoesSugeridas: resultObj.correcoesSugeridas ?? [],
        })
      );
    }
  }
}

main().catch((err) => {
  console.error("Erro no diagnóstico:", err);
  process.exit(1);
});
