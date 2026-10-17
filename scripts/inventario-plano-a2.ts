/**
 * A2.0 — Inventário do planejamento (somente leitura; cópia do banco em %TEMP%).
 */
import fs from "fs";
import path from "path";
import os from "os";

const repoRoot = path.resolve(process.cwd());
const srcDb = path.join(repoRoot, "prisma", "dev.db");
const srcWal = path.join(repoRoot, "prisma", "dev.db-wal");

const tmpDir = path.join(os.tmpdir(), "nc-a2-inventario-plano");
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

process.env.DATABASE_URL = `file:${copyDb.replace(/\\/g, "/")}`;

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

const SESSION_SUFFIX = "934939fc";

async function main() {
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  TelemetryLogger.log = () => {};

  const prisma = (await import("@/lib/prisma")).default;
  const { SpecDecomposerSkill } = await import("@/core/skills/spec-decomposer");
  const { parseSpecDocument } = await import("@/core/intake/spec-format");
  const {
    extractFilePathsFromCriteriaText,
    pathInStageScope,
  } = await import("@/core/decision/jev-execution-checks");

  type StageRow = {
    stageIndex: number;
    nodeId: string;
    title: string;
    filesScope: string[];
    reqsCobertos: string[];
    criteriosPorReq: Record<string, string>;
  };

  function criteriosFromPayload(payloadRaw: string | null, specText: string): Record<string, string> {
    const out: Record<string, string> = {};
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = payloadRaw ? JSON.parse(payloadRaw) : null;
    } catch {
      parsed = null;
    }
    const mb = parsed?.microbrief as
      | { criteriosAceitePorReq?: Record<string, string[]>; reqsCobertos?: string[] }
      | undefined;
    const spec = parseSpecDocument(specText);
    const reqIds = mb?.reqsCobertos ?? (Array.isArray(parsed?.reqsCobertos) ? (parsed!.reqsCobertos as string[]) : []);
    for (const reqId of reqIds) {
      const fromMb = mb?.criteriosAceitePorReq?.[reqId];
      if (Array.isArray(fromMb) && fromMb.length > 0) {
        out[reqId] = fromMb.join("; ");
      } else {
        const reqSpec = spec?.requisitos?.find((r) => r.id === reqId);
        out[reqId] = reqSpec?.criterio || reqSpec?.titulo || reqId;
      }
    }
    return out;
  }

  function buildStagesFromDb(
    tasks: { id: string; title: string; role: string; filesScope: string; payload: string | null }[],
    specText: string
  ): StageRow[] {
    const impl = tasks
      .filter((t) => t.role !== "scaffold")
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    return impl.map((t, idx) => {
      let filesScope: string[] = [];
      try {
        filesScope = JSON.parse(t.filesScope || "[]");
      } catch {
        filesScope = [];
      }
      let reqsCobertos: string[] = [];
      try {
        const p = t.payload ? JSON.parse(t.payload) : null;
        reqsCobertos = Array.isArray(p?.reqsCobertos)
          ? p.reqsCobertos.filter((x: unknown) => typeof x === "string")
          : Array.isArray(p?.reqs)
            ? p.reqs.filter((x: unknown) => typeof x === "string")
            : [];
        const mb = p?.microbrief;
        if (mb && Array.isArray(mb.reqsCobertos)) {
          reqsCobertos = mb.reqsCobertos;
        }
      } catch {
        reqsCobertos = [];
      }
      const m = t.title.match(/Etapa\s+(\d+)\//i);
      const stageIndex = m ? Number(m[1]) : idx + 1;
      return {
        stageIndex,
        nodeId: t.id,
        title: t.title,
        filesScope,
        reqsCobertos,
        criteriosPorReq: criteriosFromPayload(t.payload, specText),
      };
    });
  }

  function buildStagesFromDecomp(
    nodes: { id: string; title: string; role?: string; filesScope?: string[]; payload?: unknown }[],
    specText: string
  ): StageRow[] {
    const impl = nodes.filter((n) => n.role !== "scaffold");
    return impl.map((n, idx) => {
      const p = (n.payload ?? {}) as Record<string, unknown>;
      const mb = p.microbrief as { reqsCobertos?: string[]; criteriosAceitePorReq?: Record<string, string[]> } | undefined;
      const reqsCobertos = Array.isArray(p.reqsCobertos)
        ? (p.reqsCobertos as string[])
        : mb?.reqsCobertos ?? [];
      const criteriosPorReq: Record<string, string> = {};
      if (mb?.criteriosAceitePorReq) {
        for (const [reqId, lines] of Object.entries(mb.criteriosAceitePorReq)) {
          criteriosPorReq[reqId] = Array.isArray(lines) ? lines.join("; ") : String(lines);
        }
      } else {
        Object.assign(criteriosPorReq, criteriosFromPayload(JSON.stringify(p), specText));
      }
      const m = n.title.match(/Etapa\s+(\d+)\//i);
      return {
        stageIndex: m ? Number(m[1]) : idx + 1,
        nodeId: n.id,
        title: n.title,
        filesScope: n.filesScope ?? [],
        reqsCobertos,
        criteriosPorReq,
      };
    });
  }

  function metrics(stages: StageRow[]) {
    const reqToStages = new Map<string, number[]>();
    for (const s of stages) {
      for (const reqId of s.reqsCobertos) {
        const list = reqToStages.get(reqId) ?? [];
        list.push(s.stageIndex);
        reqToStages.set(reqId, list);
      }
    }
    let reqsInMultipleStages = 0;
    for (const stagesOfReq of reqToStages.values()) {
      if (new Set(stagesOfReq).size > 1) reqsInMultipleStages++;
    }

    const outOfScopePairs: { stageIndex: number; req: string; arquivo: string }[] = [];
    for (const s of stages) {
      for (const reqId of s.reqsCobertos) {
        const criterio = s.criteriosPorReq[reqId] ?? "";
        for (const arquivo of extractFilePathsFromCriteriaText(criterio)) {
          if (!pathInStageScope(s.filesScope, arquivo)) {
            outOfScopePairs.push({ stageIndex: s.stageIndex, req: reqId, arquivo });
          }
        }
      }
    }

    return {
      etapas: stages.length,
      reqsEmMaisDeUmaEtapa: reqsInMultipleStages,
      paresReqArquivoForaDoEscopo: outOfScopePairs.length,
      paresDetalhe: outOfScopePairs,
    };
  }

  function pairsForStages(stages: StageRow[], stageNums: number[]) {
    const set = new Set(stageNums);
    return stages
      .filter((s) => set.has(s.stageIndex))
      .flatMap((s) => {
        const rows: { stageIndex: number; req: string; arquivo: string }[] = [];
        for (const reqId of s.reqsCobertos) {
          const criterio = s.criteriosPorReq[reqId] ?? "";
          for (const arquivo of extractFilePathsFromCriteriaText(criterio)) {
            if (!pathInStageScope(s.filesScope, arquivo)) {
              rows.push({ stageIndex: s.stageIndex, req: reqId, arquivo });
            }
          }
        }
        return rows;
      });
  }

  const session =
    (await prisma.session.findFirst({ where: { id: { contains: SESSION_SUFFIX } } })) ??
    (await prisma.session.findFirst({ where: { id: { endsWith: SESSION_SUFFIX } } }));

  if (!session?.canonicalSpec) {
    console.log(JSON.stringify({ error: "session_or_spec_not_found", suffix: SESSION_SUFFIX }, null, 2));
    process.exit(1);
  }

  const specText = session.canonicalSpec;
  const parsed = parseSpecDocument(specText);
  const specVersion = session.specVersion;

  const tasks = await prisma.taskNode.findMany({
    where: { sessionId: session.id, specVersion },
    orderBy: { createdAt: "asc" },
  });

  const storedStages = buildStagesFromDb(tasks, specText);
  const storedMetrics = metrics(storedStages);

  const files = parsed?.arquivosAfetados ?? [];
  const decomp = SpecDecomposerSkill.decomposeSpec(
    specText,
    parsed?.titulo ?? null,
    files,
    parsed?.stack ?? [],
    session.id
  );
  const decompStages = buildStagesFromDecomp(decomp.nodes, specText);
  const decompMetrics = metrics(decompStages);

  const out = {
    sessionId: session.id,
    specVersion,
    specApproved: session.specApproved,
    specCharLength: specText.length,
    specReqCount: parsed?.requisitos?.length ?? parsed?.requisitosIds?.length ?? 0,
    specFileCount: files.length,
    taskNodeCount: tasks.length,
    stored: {
      ...storedMetrics,
      etapas1e3: {
        etapa1: pairsForStages(storedStages, [1]),
        etapa3: pairsForStages(storedStages, [3]),
      },
    },
    heuristicDecomposeSpec: {
      ...decompMetrics,
      t8bValid: decomp.t8bCheck?.valid ?? null,
      t8bErrorCount: decomp.t8bCheck?.errors?.length ?? 0,
      decompNodeCount: decomp.nodes.length,
      etapas1e3: {
        etapa1: pairsForStages(decompStages, [1]),
        etapa3: pairsForStages(decompStages, [3]),
      },
    },
    numbersMatch:
      storedMetrics.etapas === decompMetrics.etapas &&
      storedMetrics.reqsEmMaisDeUmaEtapa === decompMetrics.reqsEmMaisDeUmaEtapa &&
      storedMetrics.paresReqArquivoForaDoEscopo === decompMetrics.paresReqArquivoForaDoEscopo,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
