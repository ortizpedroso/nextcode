/**
 * A3.3 — Replay do diagnóstico de falha (trilha real + controles sintéticos).
 * Lê somente cópia do banco fora do repositório; não grava telemetria na cópia.
 */
import fs from "fs";
import path from "path";
import os from "os";

const repoRoot = path.resolve(process.cwd());
const srcDb = path.join(repoRoot, "prisma", "dev.db");
const srcWal = path.join(repoRoot, "prisma", "dev.db-wal");

const tmpDir = path.join(os.tmpdir(), "nc-a3-replay-failure-diagnosis");
if (fs.existsSync(tmpDir)) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* ignore */
  }
}
fs.mkdirSync(tmpDir, { recursive: true });

const copyDb = path.join(tmpDir, "dev.db");
fs.copyFileSync(srcDb, copyDb);
if (fs.existsSync(srcWal)) {
  fs.copyFileSync(srcWal, path.join(tmpDir, "dev.db-wal"));
}

const databaseUrl = `file:${copyDb.replace(/\\/g, "/")}`;
process.env.DATABASE_URL = databaseUrl;

const envPath = path.join(repoRoot, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** Controles sintéticos — textos exatos do prompt A3.3. */
const SYNTHETIC_CONTROLS = [
  {
    id: "ctrl-1",
    rotuloAuditor: "wrong_code",
    arquivosEscopo: ["src/lib/soma.ts"],
    criteriosPorReq: {
      "REQ-001": "src/lib/soma.ts exporta soma(a,b) que retorna a+b",
    },
    reqsCobertos: ["REQ-001"],
    motivoRejeicao: "REQ-001: soma retorna a-b em src/lib/soma.ts:3",
  },
  {
    id: "ctrl-2",
    rotuloAuditor: "evaluator_error",
    arquivosEscopo: ["src/lib/soma.ts"],
    criteriosPorReq: {
      "REQ-001": "src/lib/soma.ts exporta soma(a,b) que retorna a+b",
    },
    reqsCobertos: ["REQ-001"],
    motivoRejeicao: "REQ-001: falta o arquivo src/lib/outro.ts",
  },
  {
    id: "ctrl-3",
    rotuloAuditor: "environment",
    arquivosEscopo: ["src/lib/soma.ts"],
    criteriosPorReq: {
      "REQ-001": "src/lib/soma.ts exporta soma(a,b) que retorna a+b",
    },
    reqsCobertos: ["REQ-001"],
    motivoRejeicao: "Cannot find module 'zod' — dependência não instalada",
  },
  {
    id: "ctrl-4",
    rotuloAuditor: "incomplete_output",
    arquivosEscopo: ["src/lib/soma.ts"],
    criteriosPorReq: {
      "REQ-001": "src/lib/soma.ts exporta soma(a,b) que retorna a+b",
    },
    reqsCobertos: ["REQ-001"],
    motivoRejeicao: "resposta do executor cortada: nenhum arquivo gerado",
  },
  {
    id: "ctrl-5",
    rotuloAuditor: "ambiguous_spec",
    arquivosEscopo: ["src/lib/taxa.ts"],
    criteriosPorReq: {
      "REQ-002": "taxa de 2% e também isenta de taxa",
    },
    reqsCobertos: ["REQ-002"],
    motivoRejeicao: "REQ-002 contraditório: pede taxa de 2% e isenção ao mesmo tempo",
  },
] as const;

interface ReplayRow {
  caso: string;
  motivo200: string;
  causaAntiga: string;
  causaNova: string;
  fonte: string;
  confianca: string;
  rotuloAuditor: string;
  acertou: string;
}

interface JevCaseRef {
  caso: string;
  etapa: { titulo: string; cluster: string; reqs_cobertos: string[] };
  arquivosEscopo: string[];
  criteriosPorReq: Record<string, string>;
  motivoRejeicao: string;
  tentativa: number;
  historicoMotivos: string[];
  causaNormal: string;
}

let jevInputTokens = 0;
let jevOutputTokens = 0;

function truncateMotivo(m: string, max = 200): string {
  if (m.length <= max) return m;
  return m.slice(0, max);
}

function criteriosFromPayload(payload: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const microbrief = payload?.microbrief as
    | { criteriosAceitePorReq?: Record<string, string[]>; reqsCobertos?: string[] }
    | undefined;
  const raw = microbrief?.criteriosAceitePorReq ?? {};
  for (const [reqId, lines] of Object.entries(raw)) {
    out[reqId] = Array.isArray(lines) ? lines.join("; ") : String(lines);
  }
  return out;
}

function reqsFromPayload(payload: Record<string, unknown>, criterios: Record<string, string>): string[] {
  const microbrief = payload?.microbrief as { reqsCobertos?: string[] } | undefined;
  if (microbrief?.reqsCobertos?.length) return microbrief.reqsCobertos;
  if ((payload.reqsCobertos as string[] | undefined)?.length) return payload.reqsCobertos as string[];
  return Object.keys(criterios);
}

async function main() {
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  TelemetryLogger.log = (event) => {
    if (event.action === "JEV_DECISION" && event.details?.usage) {
      const usage = event.details.usage as { input_tokens?: number; output_tokens?: number };
      jevInputTokens += usage.input_tokens ?? 0;
      jevOutputTokens += usage.output_tokens ?? 0;
    }
  };

  const { normalizeScopePath } = await import("@/core/governance/dual-lens-auditor");
  const jevChecks = await import("@/core/decision/jev-execution-checks");
  const {
    detectPlanErrorMechanically,
    diagnoseStageFailureWithJev,
    extractFilePathsFromCriteriaText,
    FAILURE_CAUSE_CRITERIA,
  } = jevChecks;
  const { askJevBatch, estimateJevCostUsd } = await import("@/core/decision/jev");
  const prismaMod = await import("@/lib/prisma");
  const prisma = prismaMod.default;

  function buildFailureDiagnosisStateJson(params: {
    etapa: { titulo: string; cluster: string; reqs_cobertos: string[] };
    arquivosEscopo: string[];
    criteriosPorReq: Record<string, string>;
    motivoRejeicao: string;
    tentativa: number;
    historicoMotivos: string[];
    maxChars: number;
  }): string {
    const arquivos_escopo = params.arquivosEscopo.map(normalizeScopePath);
    const reqs_com_arquivos: Record<string, string[]> = {};
    for (const reqId of params.etapa.reqs_cobertos) {
      reqs_com_arquivos[reqId] = extractFilePathsFromCriteriaText(params.criteriosPorReq[reqId] ?? "");
    }

    let motivo = params.motivoRejeicao || "";
    let historico = params.historicoMotivos.slice(-3).map((m) => m.slice(0, 2000));

    const shrink = (): string => {
      const stateObj = {
        etapa: {
          titulo: params.etapa.titulo,
          cluster: params.etapa.cluster,
          reqs_cobertos: params.etapa.reqs_cobertos,
        },
        arquivos_escopo,
        reqs_com_arquivos,
        motivo_rejeicao: motivo,
        tentativa: params.tentativa,
        historico_motivos: historico,
      };
      return JSON.stringify(stateObj);
    };

    let json = shrink();
    while (json.length > params.maxChars && historico.length > 0) {
      historico = historico.slice(1);
      json = shrink();
    }
    while (json.length > params.maxChars && motivo.length > 0) {
      motivo = motivo.slice(0, Math.max(0, motivo.length - 500));
      json = shrink();
    }
    while (json.length > params.maxChars && motivo.length > 200) {
      motivo = motivo.slice(0, motivo.length - 200);
      json = shrink();
    }
    return json;
  }

  const trailLogs = await prisma.telemetryLog.findMany({
    where: { action: "JEV_FAILURE_DIAGNOSIS" },
    select: { details: true },
  });

  function causaAntigaFromTrail(nodeId: string, tentativa: number): string {
    for (const log of trailLogs) {
      if (!log.details) continue;
      try {
        const d = JSON.parse(log.details) as { nodeId?: string; tentativa?: number; causa?: string };
        if (d.nodeId === nodeId && d.tentativa === tentativa && d.causa) return d.causa;
      } catch {
        /* ignore */
      }
    }
    return "—";
  }

  const rows: ReplayRow[] = [];
  const jevCasesForInvert: JevCaseRef[] = [];

  const nodesRaw = await prisma.taskNode.findMany({
    select: {
      id: true,
      title: true,
      cluster: true,
      filesScope: true,
      payload: true,
      failureHistory: true,
    },
  });
  const nodes = nodesRaw.filter((n) => {
    if (!n.failureHistory?.trim()) return false;
    try {
      const h = JSON.parse(n.failureHistory);
      return Array.isArray(h) && h.length > 0;
    } catch {
      return false;
    }
  });

  for (const node of nodes) {
    let history: {
      attemptNumber: number;
      rejectionReason: string;
      diagnostico?: { causa?: string } | null;
    }[] = [];
    try {
      history = JSON.parse(node.failureHistory || "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(history) || history.length === 0) continue;

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(node.payload || "{}");
    } catch {
      payload = {};
    }

    const criteriosPorReq = criteriosFromPayload(payload);
    const reqsCobertos = reqsFromPayload(payload, criteriosPorReq);
    let arquivosEscopo: string[] = [];
    try {
      arquivosEscopo = JSON.parse(node.filesScope || "[]");
    } catch {
      arquivosEscopo = [];
    }

    const historicoMotivos = history.map((h) => h.rejectionReason);

    for (const att of history) {
      const motivo = att.rejectionReason || "";
      const diag = await diagnoseStageFailureWithJev({
        sessionId: null,
        nodeId: node.id,
        etapa: {
          titulo: node.title,
          cluster: node.cluster,
          reqs_cobertos: reqsCobertos,
        },
        arquivosEscopo,
        criteriosPorReq,
        motivoRejeicao: motivo,
        tentativa: att.attemptNumber,
        historicoMotivos: historicoMotivos.filter((_, i) => history[i].attemptNumber < att.attemptNumber).slice(-3),
        modo: "ativo",
      });

      const causaNova = diag?.causa ?? "—";
      const fonte = diag?.fonte ?? (diag ? "jev" : "—");
      const confianca = diag ? String(diag.confianca) : "—";
      const antiga =
        causaAntigaFromTrail(node.id, att.attemptNumber) !== "—"
          ? causaAntigaFromTrail(node.id, att.attemptNumber)
          : att.diagnostico?.causa ?? "—";
      const rotulo = "plan_error";
      const acertou = causaNova === rotulo ? "sim" : "não";

      rows.push({
        caso: `${node.id} / tentativa ${att.attemptNumber}`,
        motivo200: truncateMotivo(motivo),
        causaAntiga: antiga,
        causaNova,
        fonte,
        confianca,
        rotuloAuditor: rotulo,
        acertou,
      });

      if (fonte === "jev" && diag) {
        jevCasesForInvert.push({
          caso: `${node.id} / tentativa ${att.attemptNumber}`,
          etapa: { titulo: node.title, cluster: node.cluster, reqs_cobertos: reqsCobertos },
          arquivosEscopo,
          criteriosPorReq,
          motivoRejeicao: motivo,
          tentativa: att.attemptNumber,
          historicoMotivos: historicoMotivos.filter((_, i) => history[i].attemptNumber < att.attemptNumber).slice(-3),
          causaNormal: diag.causa,
        });
      }
    }
  }

  for (const ctrl of SYNTHETIC_CONTROLS) {
    const diag = await diagnoseStageFailureWithJev({
      sessionId: null,
      nodeId: ctrl.id,
      etapa: {
        titulo: `Controle ${ctrl.id}`,
        cluster: "core",
        reqs_cobertos: [...ctrl.reqsCobertos],
      },
      arquivosEscopo: [...ctrl.arquivosEscopo],
      criteriosPorReq: { ...ctrl.criteriosPorReq },
      motivoRejeicao: ctrl.motivoRejeicao,
      tentativa: 1,
      historicoMotivos: [],
      modo: "ativo",
    });

    const causaNova = diag?.causa ?? "—";
    const fonte = diag?.fonte ?? (diag ? "jev" : "—");
    const confianca = diag ? String(diag.confianca) : "—";
    const acertou = causaNova === ctrl.rotuloAuditor ? "sim" : "não";

    rows.push({
      caso: ctrl.id,
      motivo200: truncateMotivo(ctrl.motivoRejeicao),
      causaAntiga: "—",
      causaNova,
      fonte,
      confianca,
      rotuloAuditor: ctrl.rotuloAuditor,
      acertou,
    });

    if (fonte === "jev" && diag) {
      jevCasesForInvert.push({
        caso: ctrl.id,
        etapa: {
          titulo: `Controle ${ctrl.id}`,
          cluster: "core",
          reqs_cobertos: [...ctrl.reqsCobertos],
        },
        arquivosEscopo: [...ctrl.arquivosEscopo],
        criteriosPorReq: { ...ctrl.criteriosPorReq },
        motivoRejeicao: ctrl.motivoRejeicao,
        tentativa: 1,
        historicoMotivos: [],
        causaNormal: diag.causa,
      });
    }
  }

  console.log("REPLAY_A3_3_JSON_START");
  console.log(
    JSON.stringify(
      {
        databaseCopyPath: copyDb,
        databaseUrl,
        telemetryStrategy:
          "TelemetryLogger.log substituído por no-op que só acumula usage de JEV_DECISION em memória; nenhum INSERT na cópia do banco.",
        rows,
        jevCost: {
          inputTokens: jevInputTokens,
          outputTokens: jevOutputTokens,
          usd: estimateJevCostUsd(jevInputTokens),
        },
      },
      null,
      2
    )
  );
  console.log("REPLAY_A3_3_JSON_END");

  console.log("\n## Ordem invertida (casos fonte jev)\n");
  for (const ref of jevCasesForInvert) {
    const mecanica = detectPlanErrorMechanically({
      arquivosEscopo: ref.arquivosEscopo,
      criteriosPorReq: ref.criteriosPorReq,
      reqsCobertos: ref.etapa.reqs_cobertos,
      motivoRejeicao: ref.motivoRejeicao,
    });
    if (mecanica) {
      console.log(`- ${ref.caso}: pulado (mecânico no replay invertido)`);
      continue;
    }

    const stateJson = buildFailureDiagnosisStateJson({
      etapa: ref.etapa,
      arquivosEscopo: ref.arquivosEscopo,
      criteriosPorReq: ref.criteriosPorReq,
      motivoRejeicao: ref.motivoRejeicao,
      tentativa: ref.tentativa,
      historicoMotivos: ref.historicoMotivos,
      maxChars: 8000,
    });

    const invertedCriteria = Object.fromEntries(Object.entries(FAILURE_CAUSE_CRITERIA).reverse()) as Record<
      string,
      string
    >;

    const answers = await askJevBatch({
      purpose: "failure_diagnosis_inverted_order",
      state: stateJson,
      questions: {
        failure_cause: {
          type: "choice",
          instructions:
            "Examine `etapa`, `arquivos_escopo`, `reqs_com_arquivos`, `motivo_rejeicao`, `tentativa`, and `historico_motivos`. What is the primary cause of this stage failure?",
          criteria: invertedCriteria,
        },
      },
      sessionId: null,
      maxStateChars: 8000,
      useCache: false,
    });

    const inv = answers?.failure_cause;
    const causaInvertida =
      inv && inv.type === "choice" && inv.choice in FAILURE_CAUSE_CRITERIA ? inv.choice : "—";
    const mudou = causaInvertida !== ref.causaNormal ? "SIM" : "não";
    console.log(
      `- ${ref.caso}: normal=${ref.causaNormal} invertida=${causaInvertida} mudou=${mudou}`
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
