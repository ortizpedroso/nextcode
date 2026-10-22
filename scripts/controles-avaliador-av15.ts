/**
 * AV1.5 — Controles com defeito plantado no avaliador real (cadeia de produção: Claude Sonnet 5.5 → Opus 5.5).
 * Lê a chave da Anthropic de uma CÓPIA do banco; telemetria em memória; nada é escrito em prisma/dev.db.
 * Uso: npx tsx scripts/controles-avaliador-av15.ts [repetições=1]
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = path.join(os.tmpdir(), "nc-av15-controles");
fs.mkdirSync(tmpDir, { recursive: true });
fs.copyFileSync(path.join("prisma", "dev.db"), path.join(tmpDir, "dev.db"));
if (fs.existsSync(path.join("prisma", "dev.db-wal"))) fs.copyFileSync(path.join("prisma", "dev.db-wal"), path.join(tmpDir, "dev.db-wal"));
process.env.DATABASE_URL = `file:${path.join(tmpDir, "dev.db").split(path.sep).join("/")}`;

const FILE = "src/app/api/tarefas/route.ts";
const BRIEF = [
  "# Etapa: API de tarefas",
  "## Arquivos desta etapa",
  `- ${FILE}`,
  "## Critérios de aceite por REQ",
  "- REQ-001: POST /api/tarefas recebe JSON {titulo}; titulo vazio ou ausente → 400 com {erro}; JSON inválido → 400; sucesso → 201 com a tarefa criada {id, titulo, concluida:false}.",
  "- REQ-002: GET /api/tarefas → 200 com a lista de tarefas (array).",
].join("\n");

const CORRETO = `import { NextResponse } from "next/server";

type Tarefa = { id: number; titulo: string; concluida: boolean };
const tarefas: Tarefa[] = [];
let nextId = 1;

export async function GET() {
  return NextResponse.json(tarefas, { status: 200 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ erro: "JSON inválido" }, { status: 400 });
  }
  const raw = (body as { titulo?: unknown } | null)?.titulo;
  const titulo = typeof raw === "string" ? raw.trim() : "";
  if (!titulo) {
    return NextResponse.json({ erro: "titulo obrigatório" }, { status: 400 });
  }
  const tarefa: Tarefa = { id: nextId++, titulo, concluida: false };
  tarefas.push(tarefa);
  return NextResponse.json(tarefa, { status: 201 });
}
`;

const helpers = Array.from(
  { length: 700 },
  (_, i) => `export function formatarRotulo${i}(texto: string): string {\n  return texto.trim().toUpperCase() + " #${i}";\n}\n`
).join("\n");
// Cabe inteiro (limite 60 mil): o avaliador tem de ler até o fim para achar o bug.
const GRANDE_COM_BUG = helpers.split("\n\n").slice(0, 480).join("\n\n") + "\n" + CORRETO.replace("{ status: 201 }", "{ status: 200 }");

const REL_OK = "| REQ-001 | atendido | src/app/api/tarefas/route.ts:11 | POST |\n| REQ-002 | atendido | src/app/api/tarefas/route.ts:7 | GET |";

const CASOS = [
  { caso: "1 correto", code: CORRETO, rel: REL_OK, esperado: "APPROVED", defeito: "—" },
  { caso: "2 POST devolve 200 (não 201)", code: CORRETO.replace("{ status: 201 }", "{ status: 200 }"), rel: REL_OK, esperado: "REJECTED", defeito: "REQ-001 status" },
  {
    caso: "3 POST é stub",
    code: CORRETO.replace(/export async function POST[\s\S]*$/, 'export async function POST(_request: Request) {\n  // TODO: implementar criação\n  return NextResponse.json({ erro: "Not implemented" }, { status: 501 });\n}\n'),
    rel: REL_OK,
    esperado: "REJECTED",
    defeito: "REQ-001 ausente",
  },
  { caso: "4 arquivo grande (abaixo de 60 mil) com bug no fim", code: GRANDE_COM_BUG, rel: REL_OK, esperado: "REJECTED", defeito: "REQ-001 status no fim do arquivo" },
  { caso: "5 arquivo acima do limite (> 60 mil)", code: [helpers, helpers.split("formatarRotulo").join("rotuloExtra"), CORRETO].join("\n"), rel: REL_OK, esperado: "REJECTED", defeito: "limite_tamanho (mecânico)" },
  { caso: "6 sem validação de título + relatório mente", code: CORRETO.replace("  if (!titulo) {\n    return NextResponse.json({ erro: \"titulo obrigatório\" }, { status: 400 });\n  }\n", ""), rel: REL_OK, esperado: "REJECTED", defeito: "REQ-001 parcial; executor declarou atendido" },
  { caso: "7 código correto, executor cita linha 999", code: CORRETO, rel: REL_OK.replace("route.ts:11", "route.ts:999"), esperado: "REJECTED", defeito: "evidência inventada do executor (Lente 2)" },
];

async function main() {
  const reps = Number(process.argv[2] || 1);
  // TR1 (10): 3º argumento opcional = modelo@esforço (ex.: claude-sonnet-5-5@medium); omitido = cadeia padrão.
  const candidato = process.argv[3];
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  TelemetryLogger.log = () => {};
  const { DualLensAuditor } = await import("@/core/governance/dual-lens-auditor");
  const { dispatchStrongEvaluator, claudeCandidate } = await import("@/core/llm/evaluator-models");
  const { costFromUsage } = await import("@/core/llm/cost");

  const rows: any[] = [];
  let totalUsd = 0;
  for (let rep = 1; rep <= reps; rep++) {
    for (const c of CASOS) {
      const code = { [FILE]: c.code };
      let modelo = "—";
      let usd = 0;
      const dispatchFn = async (messages: any[]) => {
        const r = await dispatchStrongEvaluator(messages, { executorFamily: "deepseek", ...(candidato ? { chain: [claudeCandidate(candidato)] } : {}) });
        if (r.model) {
          modelo = r.model;
          usd += costFromUsage(r.model, r.usage);
        }
        return r.content;
      };
      const type1 = DualLensAuditor.validateType1(code, [], process.cwd(), [FILE], []);
      const t0 = Date.now();
      const res = await DualLensAuditor.validateType2(type1, BRIEF, c.rel, code, dispatchFn, {
        cluster: "backend",
        expectedReqs: ["REQ-001", "REQ-002"],
      });
      totalUsd += usd;
      rows.push({
        rep,
        caso: c.caso,
        tamanho: c.code.length,
        esperado: c.esperado,
        obtido: res.verdict,
        acertou: res.verdict === c.esperado ? "sim" : "NÃO",
        metodo: res.method,
        reqs: (res.reqVerdicts ?? []).map((r) => `${r.id}=${r.status}`).join(" "),
        divergencias: (res.reqDivergences ?? []).map((d) => `${d.reqId}:${d.tipoDivergencia}`).join(" "),
        motivo: (res.rejectionReason ?? "").slice(0, 160),
        modelo,
        usd: Number(usd.toFixed(5)),
        ms: Date.now() - t0,
        defeitoPlantado: c.defeito,
      });
      console.error(`[${rep}] ${c.caso}: ${res.verdict} (${modelo}, US$ ${usd.toFixed(4)})`);
    }
  }
  console.log(JSON.stringify({ rows, acertos: rows.filter((r) => r.acertou === "sim").length, total: rows.length, custoUsd: Number(totalUsd.toFixed(4)) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
