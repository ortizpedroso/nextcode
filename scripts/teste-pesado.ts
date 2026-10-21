/**
 * Teste pesado (porta da E1, mudança 23) — decisão autônoma de 21/10 (DECISOES-AUTONOMAS-E1-3.md).
 * Reexecuta a Spec real do teste `8e2f2052` (Multi_Gateway) do zero, com o código atual, para comparar
 * com a 1ª execução (US$ 18,78; 1.724 chamadas do executor; 548 pausas SEM_LLM).
 *
 * - Cópia do banco em %TEMP%\nc-teste-pesado (prisma/dev.db nunca é escrito — T-F).
 * - Projeto numa pasta nova (o C:\projetos\multi_gateway original não é tocado).
 * - Worker real (startJobWorker): retomadas de SEM_LLM e do avaliador como no app.
 * - Teto: o do sistema (P9, pelo tamanho do plano). Sem autorização extra: bateu o teto, para.
 * - Para em ENTREGUE, BLOQUEADA, PAUSADA por mais de PAUSA_MAX_MIN, ou depois de TEMPO_MAX_H.
 * - Relatório: docs/relatorios/TESTE-PESADO-E1.md (+ .yaml com as etapas).
 *
 * Uso: npx tsx scripts/teste-pesado.ts            (roda)
 *      npx tsx scripts/teste-pesado.ts --relatorio (só refaz o relatório a partir da cópia do banco)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { sanitizarSegredos } from "./bench";

const SESSAO_ORIGEM = "8e2f2052";
const ORIGINAL = { custoUsd: 18.78, chamadasExecutor: 1724, pausasSemLlm: 548, etapas: 54, concluidas: 49 };
const TEMPO_MAX_H = Number(process.env.TESTE_PESADO_TEMPO_MAX_H) || 10;
const PAUSA_MAX_MIN = Number(process.env.TESTE_PESADO_PAUSA_MAX_MIN) || 45;
const POLL_MS = 30_000;

const repoRoot = process.cwd();
const runRoot = path.join(os.tmpdir(), "nc-teste-pesado");
const copyDb = path.join(runRoot, "dev-copy.db");
const projectDir = path.join(runRoot, "multi_gateway");
const estadoPath = path.join(runRoot, "estado.json");
const soRelatorio = process.argv.includes("--relatorio");

if (!soRelatorio) {
  if (fs.existsSync(runRoot)) fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "prisma", "dev.db"), copyDb);
}
process.env.DATABASE_URL = `file:${copyDb.replace(/\\/g, "/")}`;

const envPath = path.join(repoRoot, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const parse = (s: string | null | undefined): any => {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
};

async function rodar(): Promise<{ sessionId: string; motivoFim: string; inicio: number }> {
  const prisma = (await import("@/lib/prisma")).default;
  const { approveSpecAndStart } = await import("@/core/orchestrator/execution-trigger");
  const { startJobWorker, stopJobWorker } = await import("@/core/orchestrator/job-worker");

  const origem = await prisma.session.findFirst({
    where: { id: { startsWith: SESSAO_ORIGEM } },
    select: { canonicalSpec: true },
  });
  if (!origem?.canonicalSpec) throw new Error(`Spec da sessão ${SESSAO_ORIGEM} não encontrada na cópia do banco`);

  // O executor só sai pelo FreeLLMAPI (paid-routing.ts), que roda no Docker; o analista vai direto
  // ao DeepSeek. Sem os dois de pé o teste só acumula pausas (2ª tentativa, 21/10: Docker fechado).
  const { probeGateway } = await import("@/core/llm/gateways");
  for (const id of ["freellmapi", "deepseek"] as const) {
    const h = await probeGateway(id);
    if (!h.reachable || !h.authOk) throw new Error(`gateway ${id} fora do ar (${h.baseUrl}) — suba antes de rodar o teste`);
  }

  const project = await prisma.project.create({ data: { name: "Teste pesado E1 (Multi_Gateway)", path: projectDir } });
  const session = await prisma.session.create({
    data: { title: "Teste pesado E1 (Multi_Gateway)", projectId: project.id, canonicalSpec: origem.canonicalSpec },
  });
  const inicio = Date.now();
  fs.writeFileSync(estadoPath, JSON.stringify({ sessionId: session.id, inicio }, null, 2));

  const start = await approveSpecAndStart(session.id, origem.canonicalSpec);
  if (!start.ok) {
    return { sessionId: session.id, motivoFim: `aprovação recusada: ${JSON.stringify(start)}`, inicio };
  }

  startJobWorker();
  let pausadaDesde: number | null = null;
  let motivoFim = "";
  while (!motivoFim) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id }, select: { phase: true } });
    const nos = await prisma.taskNode.groupBy({ by: ["status"], where: { sessionId: session.id }, _count: true });
    const resumo = nos.map((n) => `${n.status}=${n._count}`).join(" ");
    console.log(`[teste-pesado] ${new Date().toISOString()} fase=${s.phase} ${resumo}`);

    if (s.phase === "ENTREGUE" || s.phase === "BLOQUEADA") motivoFim = `fase ${s.phase}`;
    if (s.phase === "PAUSADA") {
      pausadaDesde ??= Date.now();
      if (Date.now() - pausadaDesde > PAUSA_MAX_MIN * 60_000) motivoFim = `PAUSADA há mais de ${PAUSA_MAX_MIN} min`;
    } else {
      pausadaDesde = null;
    }
    if (Date.now() - inicio > TEMPO_MAX_H * 3_600_000) motivoFim = `tempo máximo de ${TEMPO_MAX_H} h`;
  }
  await stopJobWorker();
  return { sessionId: session.id, motivoFim, inicio };
}

async function relatorio(sessionId: string, motivoFim: string, inicio: number): Promise<void> {
  const prisma = (await import("@/lib/prisma")).default;
  const { getSessionBudget } = await import("@/core/orchestrator/budget-guard");
  const s = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { tasks: { orderBy: { createdAt: "asc" } } },
  });
  const logs = await prisma.telemetryLog.findMany({
    where: { sessionId },
    select: { action: true, details: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const custo = logs.filter((l) => l.action === "LLM_COST").map((l) => parse(l.details));
  const porPapel: Record<string, { usd: number; chamadas: number }> = {};
  for (const d of custo) {
    const k = d.papel ?? "?";
    porPapel[k] ??= { usd: 0, chamadas: 0 };
    porPapel[k].usd += Number(d.usd) || 0;
    porPapel[k].chamadas += 1;
  }
  const totalUsd = Object.values(porPapel).reduce((a, b) => a + b.usd, 0);
  const conta = (acao: string) => logs.filter((l) => l.action === acao).length;
  const budget = await getSessionBudget(sessionId).catch(() => null);

  const etapas = s.tasks
    .filter((t) => t.status !== "superseded")
    .map((t, i) => {
      const daEtapa = custo.filter((d) => d.nodeId === t.id);
      const exec = daEtapa.filter((d) => d.papel === "executor");
      return {
        n: i + 1,
        titulo: t.title,
        cluster: t.cluster,
        status: t.status,
        tentativas: t.attempts,
        executorChamadas: exec.length,
        executorUsd: exec.reduce((a, d) => a + (Number(d.usd) || 0), 0),
        avaliadorUsd: daEtapa.filter((d) => d.papel === "avaliador").reduce((a, d) => a + (Number(d.usd) || 0), 0),
      };
    });
  const comIa = etapas.filter((e) => e.executorChamadas > 0);
  const acimaDaMeta = comIa.filter((e) => e.executorChamadas > 10);
  const concluidas = etapas.filter((e) => e.status === "completed").length;
  const aprovadas1a = etapas.filter((e) => e.status === "completed" && e.tentativas === 0).length;
  const chamadasExec = porPapel.executor?.chamadas ?? 0;
  const horas = ((Date.now() - inicio) / 3_600_000).toFixed(1);
  const fmt = (v: number) => v.toFixed(4);

  const linhas = [
    `# Teste pesado E1 — Spec real \`${SESSAO_ORIGEM}\` (Multi_Gateway), código de ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Sessão (cópia do banco): \`${sessionId}\` · fim: **${motivoFim}** · fase final: **${s.phase}** · duração: ${horas} h`,
    `Cópia do banco e projeto: \`${runRoot}\` (prisma/dev.db não é escrito).`,
    "",
    "## Comparação com a 1ª execução",
    "",
    "| medida | 1ª execução (18–19/10) | agora |",
    "|---|---|---|",
    `| etapas concluídas | ${ORIGINAL.concluidas}/${ORIGINAL.etapas + 1} | ${concluidas}/${etapas.length} |`,
    `| custo total (US$) | ${ORIGINAL.custoUsd.toFixed(2)} | ${totalUsd.toFixed(2)} |`,
    `| chamadas do executor | ${ORIGINAL.chamadasExecutor} | ${chamadasExec} |`,
    `| pausas SEM_LLM | ${ORIGINAL.pausasSemLlm} | ${conta("SESSION_PAUSED_NO_LLM")} |`,
    "",
    "## Porta (decidida em DECISOES-AUTONOMAS-E1-3.md)",
    "",
    `- ENTREGUE: **${s.phase === "ENTREGUE" ? "sim" : "não"}**`,
    `- ≤ 10 chamadas do executor em **cada** etapa com IA: **${acimaDaMeta.length === 0 ? "sim" : `não (${acimaDaMeta.length} etapas acima)`}** — média ${comIa.length ? (comIa.reduce((a, e) => a + e.executorChamadas, 0) / comIa.length).toFixed(1) : "—"}, máximo ${comIa.length ? Math.max(...comIa.map((e) => e.executorChamadas)) : "—"}`,
    `- custo abaixo de US$ ${ORIGINAL.custoUsd.toFixed(2)}: **${totalUsd < ORIGINAL.custoUsd ? "sim" : "não"}**`,
    `- aprovadas na 1ª tentativa: ${aprovadas1a}/${concluidas}`,
    "",
    "## Custo por papel",
    "",
    "| papel | chamadas | US$ |",
    "|---|---|---|",
    ...Object.entries(porPapel).map(([k, v]) => `| ${k} | ${v.chamadas} | ${fmt(v.usd)} |`),
    `| **total** | ${custo.length} | **${fmt(totalUsd)}** |`,
    "",
    budget ? `Teto do sistema (P9): US$ ${budget.limitUsd.toFixed(2)} · gasto contado no teto: US$ ${budget.spentUsd.toFixed(2)}` : "",
    "",
    "## Eventos da trilha",
    "",
    "| evento | vezes |",
    "|---|---|",
    ...[
      "SESSION_PAUSED_NO_LLM",
      "EXECUTOR_TURN_RETRY",
      "HARNESS_RULE_BLOCK",
      "EXECUTOR_REPORT_INVALID",
      "SKILL_TOOL_DENIED",
      "EVALUATOR_UNAVAILABLE",
      "EVALUATOR_OUTAGE_PAUSED",
      "BUDGET_AUTHORIZED",
      "NODE_EXECUTION_COMPLETED",
    ].map((a) => `| ${a} | ${conta(a)} |`),
    "",
    "## Etapas",
    "",
    "| # | etapa | cluster | status | tentativas gastas | chamadas do executor | executor US$ | avaliador US$ |",
    "|---|---|---|---|---|---|---|---|",
    ...etapas.map(
      (e) =>
        `| ${e.n} | ${e.titulo.replace(/\|/g, "/")} | ${e.cluster} | ${e.status} | ${e.tentativas} | ${e.executorChamadas}${e.executorChamadas > 10 ? " ⚠️" : ""} | ${fmt(e.executorUsd)} | ${fmt(e.avaliadorUsd)} |`
    ),
    "",
  ];
  const destino = path.join(repoRoot, "docs", "relatorios", "TESTE-PESADO-E1.md");
  fs.writeFileSync(destino, sanitizarSegredos(linhas.join("\n")), "utf8");
  console.log(`[teste-pesado] relatório: ${destino}`);
  await prisma.$disconnect().catch(() => {});
}

async function main() {
  if (soRelatorio) {
    const est = JSON.parse(fs.readFileSync(estadoPath, "utf8"));
    await relatorio(est.sessionId, "relatório refeito", est.inicio);
    return;
  }
  const r = await rodar();
  await relatorio(r.sessionId, r.motivoFim, r.inicio);
  process.exit(0);
}

main().catch((err) => {
  console.error("[teste-pesado] erro:", err);
  process.exit(1);
});
