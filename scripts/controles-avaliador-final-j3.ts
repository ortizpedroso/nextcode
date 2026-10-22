/**
 * J3 — controles do avaliador-final no modelo real (Anthropic direto). Porta: P1 correto aprovado 5/5;
 * cada controle reprovado pelo seu defeito. Mede Opus 5.5 (partida) e Sonnet 5.5 nos mesmos casos —
 * fica o mais barato que passar (§5.0, linha J3).
 * Lê a chave da Anthropic de uma CÓPIA do banco; telemetria desligada; nada é escrito em prisma/dev.db.
 * Uso: npx tsx scripts/controles-avaliador-final-j3.ts [repeticoesDoCorreto=5] [modelos=claude-opus-5-5,claude-sonnet-5-5]
 * Esforço por modelo (TR1 10): `claude-sonnet-5-5@medium` (low | medium | high | xhigh | max).
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = path.join(os.tmpdir(), "nc-j3-controles");
fs.mkdirSync(tmpDir, { recursive: true });
fs.copyFileSync(path.join("prisma", "dev.db"), path.join(tmpDir, "dev.db"));
if (fs.existsSync(path.join("prisma", "dev.db-wal"))) fs.copyFileSync(path.join("prisma", "dev.db-wal"), path.join(tmpDir, "dev.db-wal"));
process.env.DATABASE_URL = `file:${path.join(tmpDir, "dev.db").split(path.sep).join("/")}`;

function readProject(dir: string, files: string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join("bench", "projetos", dir, f), "utf8")]));
}

async function main() {
  const reps = Number(process.argv[2] || 5);
  const modelos = (process.argv[3] || "claude-opus-5-5,claude-sonnet-5-5").split(",");
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  TelemetryLogger.log = () => {};
  const { reviewFinalDelivery } = await import("@/core/governance/final-reviewer");
  const { dispatchStrongEvaluator, claudeCandidate } = await import("@/core/llm/evaluator-models");
  const { costFromUsage } = await import("@/core/llm/cost");
  const { renderCanonicalSpecDocument } = await import("@/core/intake/spec-format");
  const { P1_SPEC } = await import("../bench/specs/p1");
  const { P4_SPEC } = await import("../bench/specs/p3-p4");

  const p1Spec = renderCanonicalSpecDocument(P1_SPEC);
  const p4Spec = renderCanonicalSpecDocument(P4_SPEC);
  const P1 = readProject("p1-referencia", P1_SPEC.arquivosAfetados ?? []);
  const P4 = readProject("p4-base", P4_SPEC.arquivosAfetados ?? []);
  const ROUTE = "src/app/api/tarefas/route.ts";
  const STORE = "src/lib/tarefas.ts";
  if (!/criarTarefa\(titulo\)/.test(P1[ROUTE])) throw new Error("a rota do P1 mudou: ajuste o controle de integração");

  const casos = [
    ...Array.from({ length: reps }, (_, i) => ({ caso: `1 P1 correto (${i + 1}/${reps})`, spec: p1Spec, files: P1, esperado: true, defeito: "—" })),
    {
      caso: "2 integração: rota valida `titulo` mas passa `body.title` ao store",
      spec: p1Spec,
      files: { ...P1, [ROUTE]: P1[ROUTE].replace("criarTarefa(titulo)", "criarTarefa((body as any)?.title)") },
      esperado: false,
      defeito: "REQ-002 / integração rota × store",
    },
    {
      caso: "3 stub: removerTarefa com TODO e sempre false",
      spec: p1Spec,
      files: {
        ...P1,
        [STORE]: P1[STORE].replace(/export function removerTarefa[\s\S]*$/, "export function removerTarefa(_id: string): boolean {\n  // TODO: remover\n  return false;\n}\n"),
      },
      esperado: false,
      defeito: "REQ-001/REQ-003 remoção",
    },
    { caso: "4 P4 base (3 bugs da régua do auditor)", spec: p4Spec, files: P4, esperado: false, defeito: "REQ-001..003 do P4" },
  ];

  const rows: any[] = [];
  const porModelo: Record<string, { acertos: number; total: number; usd: number }> = {};
  for (const modelo of modelos) {
    porModelo[modelo] = { acertos: 0, total: 0, usd: 0 };
    for (const c of casos) {
      let usd = 0;
      let servido = "—";
      const t0 = Date.now();
      const r = await reviewFinalDelivery({
        spec: c.spec,
        files: c.files,
        dispatch: async (messages) => {
          const res = await dispatchStrongEvaluator(messages, {
            chain: [claudeCandidate(modelo)],
            timeoutMs: 300_000,
            executorFamily: "deepseek",
          });
          if (res.model) {
            servido = res.model;
            usd += costFromUsage(res.model, res.usage);
          }
          return res;
        },
      });
      const obtido = r.executado ? r.aprovado : null;
      const acertou = obtido === c.esperado;
      porModelo[modelo].total++;
      if (acertou) porModelo[modelo].acertos++;
      porModelo[modelo].usd += usd;
      rows.push({
        modelo,
        caso: c.caso,
        esperado: c.esperado ? "aprovado" : "reprovado",
        obtido: obtido === null ? `não executado (${r.motivoNaoExecutado})` : obtido ? "aprovado" : "reprovado",
        acertou: acertou ? "sim" : "NÃO",
        reqs: r.reqVerdicts.map((v) => `${v.id}=${v.status}`).join(" "),
        defeitos: r.defeitos.map((d) => d.defeito.slice(0, 200)),
        descartes: r.descartes,
        servido,
        usd: Number(usd.toFixed(4)),
        s: Math.round((Date.now() - t0) / 1000),
        defeitoPlantado: c.defeito,
      });
      console.error(`[${modelo}] ${c.caso}: ${rows[rows.length - 1].obtido} (US$ ${usd.toFixed(4)})`);
    }
  }
  console.log(JSON.stringify({ porModelo, rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
