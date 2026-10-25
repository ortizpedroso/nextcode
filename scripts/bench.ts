import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

import { P3_SPEC, P4_SPEC } from "../bench/specs/p3-p4";

export type ProjetoBench = "p1" | "p2" | "p3" | "p4";
export type VarianteBench = "padrao" | "sem-jev" | "avaliador-deepseek" | "avaliador-claude";

/** Teto efetivo por sessão no bench B1: 0,50 (YAML) + 2,50 autorizado na trilha. */
export const BENCH_TETO_PROJETO_USD = 3.0;

export const BENCH_VARIANTES_PADRAO: VarianteBench[] = ["padrao", "sem-jev", "avaliador-deepseek"];

export const PROJETOS_VALIDOS: ProjetoBench[] = ["p1", "p2", "p3", "p4"];
export const TOTAL_TESTES_POR_PROJETO: Record<ProjetoBench, number> = {
  p1: 10,
  p2: 13,
  p3: 12,
  p4: 12,
};

export function sanitizarSegredos(texto: string): string {
  return texto
    .replace(/typesafe-[a-zA-Z0-9_-]+/g, "typesafe-***")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "sk-***")
    .replace(/AIza[a-zA-Z0-9_-]+/g, "AIza***")
    .replace(/(?:key|token|secret|password|authorization)=([^\s&]+)/gi, "$1=***");
}

export interface EtapaDetalheBench {
  nodeId: string;
  titulo: string;
  cluster: string;
  nivelPlanejado: string;
  fontePlano: "jev" | "fallback" | "ausente";
  executorModelos: string[];
  executorTokensEntrada: number;
  executorTokensSaida: number;
  executorUsd: number;
  avaliadorModelos: string[];
  avaliadorUsd: number;
  /** P13 (TR1): chamadas ao modelo do executor (turnos do laço) na etapa, somando as tentativas. */
  executorChamadas: number;
  /** Ações de ferramenta executadas na etapa (várias por turno desde o P1). */
  acoesFerramenta: number;
  tentativas: number;
}

export interface MetricasExecucao {
  projeto: ProjetoBench;
  variante: VarianteBench;
  repeticao: number;
  faseFinal: string;
  tempoSeg: number;
  etapas: number;
  aprovadasNa1a: number;
  tentativasTotais: number;
  tscProjeto: number;
  uiCheck: "UI_CHECK_PASSED" | "UI_CHECK_FAILED" | "ausente";
  aceite: {
    aprovados: number;
    total: number;
    reprovadosIds: string[];
    resumoRaw?: string;
  };
  custo: {
    executor: number;
    avaliador: number;
    jev: number;
    total: number;
  };
  /** Teto de custo da sessão (bench B1). */
  tetoEfetivoUsd: number;
  avaliadorServedBy: string[];
  avaliadorIndisponivel: number;
  avaliacoesPorProvedor: Record<string, number>;
  timeoutsAvaliador: number;
  divergenciasEvidencia: number;
  jevChamadas: number;
  erroBench?: string;
  etapasDetalhe?: EtapaDetalheBench[];
}

export interface MediasVariante {
  projeto: ProjetoBench;
  variante: VarianteBench;
  execucoes: number;
  faseFinalEntreguePct: number;
  tempoMedioSeg: number;
  aprovadasNa1aMedia: number;
  tentativasTotaisMedia: number;
  tscZeroErrosPct: number;
  aceiteMediaPct: number;
  custoTotalMedio: number;
  custoExecutorMedio: number;
  custoAvaliadorMedio: number;
  custoJevMedio: number;
  jevChamadasMedia: number;
}

export function calcularMedias(metricas: MetricasExecucao[]): MediasVariante[] {
  const metricasValidas = metricas.filter((m) => (m.avaliadorIndisponivel ?? 0) === 0);
  const grupos = new Map<string, MetricasExecucao[]>();
  for (const m of metricasValidas) {
    const key = `${m.projeto}::${m.variante}`;
    const list = grupos.get(key) || [];
    list.push(m);
    grupos.set(key, list);
  }

  const res: MediasVariante[] = [];
  for (const [key, lista] of grupos.entries()) {
    const [projeto, variante] = key.split("::") as [ProjetoBench, VarianteBench];
    const n = lista.length;
    if (n === 0) continue;

    const entregues = lista.filter((x) => x.faseFinal === "ENTREGUE").length;
    const tscOk = lista.filter((x) => x.tscProjeto === 0).length;
    const tempoTotal = lista.reduce((acc, x) => acc + x.tempoSeg, 0);
    const aprov1aTotal = lista.reduce((acc, x) => acc + x.aprovadasNa1a, 0);
    const tentTotal = lista.reduce((acc, x) => acc + x.tentativasTotais, 0);
    const custoTot = lista.reduce((acc, x) => acc + x.custo.total, 0);
    const custoExec = lista.reduce((acc, x) => acc + x.custo.executor, 0);
    const custoEval = lista.reduce((acc, x) => acc + x.custo.avaliador, 0);
    const custoJev = lista.reduce((acc, x) => acc + x.custo.jev, 0);
    const jevChamadas = lista.reduce((acc, x) => acc + x.jevChamadas, 0);

    const aceitePctSoma = lista.reduce((acc, x) => {
      const p = x.aceite.total > 0 ? (x.aceite.aprovados / x.aceite.total) * 100 : 0;
      return acc + p;
    }, 0);

    res.push({
      projeto,
      variante,
      execucoes: n,
      faseFinalEntreguePct: (entregues / n) * 100,
      tempoMedioSeg: tempoTotal / n,
      aprovadasNa1aMedia: aprov1aTotal / n,
      tentativasTotaisMedia: tentTotal / n,
      tscZeroErrosPct: (tscOk / n) * 100,
      aceiteMediaPct: aceitePctSoma / n,
      custoTotalMedio: custoTot / n,
      custoExecutorMedio: custoExec / n,
      custoAvaliadorMedio: custoEval / n,
      custoJevMedio: custoJev / n,
      jevChamadasMedia: jevChamadas / n,
    });
  }

  return res;
}

export function formatarRelatorioMarkdown(
  metricas: MetricasExecucao[],
  medias: MediasVariante[],
  timestampStr: string
): string {
  const linhas: string[] = [];

  linhas.push(`# Relatório de Benchmark NextCode — ${timestampStr}`);
  linhas.push("");
  linhas.push("Medições da orquestração real executada contra testes de aceite herméticos em contêiner Docker sem rede.");
  linhas.push("");

  linhas.push("## Tabela de Execuções");
  linhas.push("");
  linhas.push(
    "| Projeto | Variante | Rep | Teto (US$) | Fase | Tempo (s) | Etapas | 1ª Tent. | Tent. Totais | tsc | UI Check | Aceite | Reprovados | Custo Total (US$) | Exec / Eval / Jev | Jev Calls | Aval. indisp. | Aval. por provedor | Avaliador Models |"
  );
  linhas.push(
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"
  );

  for (const m of metricas) {
    let faseDisplay = m.faseFinal === "ENTREGUE" ? "ENTREGUE" : `⚠️ ${m.faseFinal}`;
    if ((m.avaliadorIndisponivel ?? 0) > 0) {
      faseDisplay = `${faseDisplay} (INVÁLIDA: rota)`;
    }
    const tscDisplay = m.tscProjeto === 0 ? "0 (ok)" : `erro (${m.tscProjeto})`;
    const aceiteDisplay = `${m.aceite.aprovados}/${m.aceite.total}`;
    const reprovadosDisplay = m.aceite.reprovadosIds.length > 0 ? m.aceite.reprovadosIds.join(", ") : "—";
    const custosDet = `${m.custo.executor.toFixed(4)} / ${m.custo.avaliador.toFixed(4)} / ${m.custo.jev.toFixed(4)}`;
    const modelsStr = Array.from(new Set(m.avaliadorServedBy)).join(", ") || "-";
    const indispDisplay = m.avaliadorIndisponivel ?? 0;
    const porProvDisplay =
      Object.entries(m.avaliacoesPorProvedor ?? {})
        .map(([k, v]) => `${k}:${v}`)
        .join(", ") || "—";

    const tetoDisplay = (m.tetoEfetivoUsd ?? BENCH_TETO_PROJETO_USD).toFixed(2);
    linhas.push(
      `| ${m.projeto.toUpperCase()} | ${m.variante} | ${m.repeticao} | ${tetoDisplay} | ${faseDisplay} | ${m.tempoSeg.toFixed(
        1
      )} | ${m.etapas} | ${m.aprovadasNa1a} | ${m.tentativasTotais} | ${tscDisplay} | ${m.uiCheck} | ${aceiteDisplay} | ${reprovadosDisplay} | ${m.custo.total.toFixed(
        4
      )} | ${custosDet} | ${m.jevChamadas} | ${indispDisplay} | ${porProvDisplay} | ${modelsStr} |`
    );
  }

  const execucoesExcluidasMedias = metricas.filter((m) => (m.avaliadorIndisponivel ?? 0) > 0).length;
  if (execucoesExcluidasMedias > 0) {
    linhas.push("");
    linhas.push(
      `*${execucoesExcluidasMedias} execução(ões) excluída(s) das médias por Projeto × Variante por falha de rota do avaliador (Aval. indisp. > 0).*`
    );
  }

  linhas.push("");
  linhas.push("## Médias por Projeto × Variante");
  linhas.push("");
  linhas.push(
    "| Projeto | Variante | Execs | % ENTREGUE | Tempo Médio (s) | 1ª Tent. Média | Tent. Médias | % tsc OK | Aceite Médio (%) | Custo Médio (US$) | Jev Chamadas Médias |"
  );
  linhas.push(
    "|---|---|---|---|---|---|---|---|---|---|---|"
  );

  for (const med of medias) {
    linhas.push(
      `| ${med.projeto.toUpperCase()} | ${med.variante} | ${med.execucoes} | ${med.faseFinalEntreguePct.toFixed(
        1
      )}% | ${med.tempoMedioSeg.toFixed(1)} | ${med.aprovadasNa1aMedia.toFixed(
        2
      )} | ${med.tentativasTotaisMedia.toFixed(2)} | ${med.tscZeroErrosPct.toFixed(
        1
      )}% | ${med.aceiteMediaPct.toFixed(1)}% | ${med.custoTotalMedio.toFixed(
        4
      )} | ${med.jevChamadasMedia.toFixed(1)} |`
    );
  }

  linhas.push("");
  linhas.push("");
  linhas.push("## Detalhe por etapa");
  linhas.push("");
  for (const m of metricas) {
    linhas.push(`### ${m.projeto.toUpperCase()} - ${m.variante} (Rep ${m.repeticao})`);
    if (m.etapasDetalhe && m.etapasDetalhe.length > 0) {
      linhas.push("| Node ID | Título | Cluster | Nível Plan. | Fonte | Exec. Modelos | Chamadas exec. | Ações | Tentativas | Tokens In | Tokens Out | Exec. USD | Aval. Modelos | Aval. USD |");
      linhas.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
      for (const ed of m.etapasDetalhe) {
        linhas.push(
          `| ${ed.nodeId} | ${ed.titulo} | ${ed.cluster} | ${ed.nivelPlanejado} | ${ed.fontePlano} | ${ed.executorModelos.join(", ") || "-"} | ${ed.executorChamadas} | ${ed.acoesFerramenta} | ${ed.tentativas} | ${ed.executorTokensEntrada} | ${ed.executorTokensSaida} | ${ed.executorUsd.toFixed(4)} | ${ed.avaliadorModelos.join(", ") || "-"} | ${ed.avaliadorUsd.toFixed(4)} |`
        );
      }
      const comIa = m.etapasDetalhe.filter((e) => e.executorChamadas > 0);
      if (comIa.length > 0) {
        const media = comIa.reduce((s, e) => s + e.executorChamadas, 0) / comIa.length;
        linhas.push("");
        linhas.push(`**Chamadas do executor por etapa (com IA):** média ${media.toFixed(1)} em ${comIa.length} etapa(s) — meta TR1 ≤ 10.`);
      }
    } else {
      linhas.push("*(Sem detalhes de etapa disponíveis)*");
    }
    linhas.push("");
  }

  linhas.push("## Detalhe Bruto dos Aceites");
  linhas.push("");
  for (const m of metricas) {
    linhas.push(`### ${m.projeto.toUpperCase()} - ${m.variante} (Rep ${m.repeticao})${m.erroBench ? " [ERRO_BENCH]" : ""}`);
    linhas.push("```text");
    if (m.erroBench) {
      linhas.push(`ERRO_BENCH:\n${m.erroBench}`);
    } else {
      linhas.push(m.aceite.resumoRaw || `RESUMO {"projeto":"${m.projeto}","aprovados":${m.aceite.aprovados},"total":${m.aceite.total}}`);
    }
    linhas.push("```");
    linhas.push("");
  }

  return linhas.join("\n");
}

export function formatarRelatorioYaml(
  metricas: MetricasExecucao[],
  medias: MediasVariante[],
  timestampStr: string
): string {
  const obj = {
    benchmark_timestamp: timestampStr,
    medias,
    execucoes: metricas,
  };
  return JSON.stringify(obj, null, 2);
}

// ---------------------------------------------------------------------------
// Execução isolada de UMA iteração
// ---------------------------------------------------------------------------
async function rodarUmaExecucao(
  projeto: ProjetoBench,
  variante: VarianteBench,
  repeticao: number
): Promise<MetricasExecucao> {
  const repoRoot = path.resolve(process.cwd());
  const srcDb = path.join(repoRoot, "prisma", "dev.db");
  const runRoot = path.join(os.tmpdir(), `nc-bench-${projeto}-${variante}-${repeticao}`);
  if (fs.existsSync(runRoot)) {
    try {
      fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  fs.mkdirSync(runRoot, { recursive: true });
  const copyDb = path.join(runRoot, "dev-copy.db");
  const projectDir = path.join(runRoot, `project-${projeto}`);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.copyFileSync(srcDb, copyDb);

  process.env.DATABASE_URL = `file:${copyDb.replace(/\\/g, "/")}`;

  if (variante === "avaliador-deepseek") {
    process.env.EVALUATOR_NEMOTRON_MODEL = "bench-desligado";
  }
  if (variante === "avaliador-claude") {
    process.env.EVALUATOR_NEMOTRON_MODEL = "bench-desligado";
    process.env.EVALUATOR_DEEPSEEK_MODEL = "bench-desligado";
    process.env.EVALUATOR_CLAUDE_MODEL = "claude-opus-5-5";
  }

  // Carregar .env do projeto se existir
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

  const prismaMod = await import("@/lib/prisma");
  const prisma = prismaMod.default;

  if (variante === "sem-jev") {
    await prisma.setting.updateMany({
      data: { typesafeKey: null },
    });
  }

  const { renderCanonicalSpecDocument } = await import("@/core/intake/spec-format");
  const { approveSpecAndStart } = await import("@/core/orchestrator/execution-trigger");
  const { claimJob, executeClaimedJob } = await import("@/core/orchestrator/job-queue");
  const { sessionCostUsd } = await import("@/core/llm/cost");

  const p1Spec = renderCanonicalSpecDocument({
    titulo: "API de Tarefas em Memória (P1)",
    status: "aguardando_aprovacao",
    data: "2026-10-08",
    stack: ["Next.js", "TypeScript"],
    modulos: [
      {
        id: "mod-store",
        nome: "Repositório de Tarefas em Memória",
        resumo: "Funções puras e tipadas para listar, criar, atualizar e remover tarefas em memória.",
        arquivos: ["src/lib/tarefas.ts"],
      },
      {
        id: "mod-api",
        nome: "Rotas REST de Tarefas",
        resumo: "Endpoints GET/POST em /api/tarefas e PATCH/DELETE em /api/tarefas/[id].",
        arquivos: ["src/app/api/tarefas/route.ts", "src/app/api/tarefas/[id]/route.ts"],
      },
    ],
    entidades: [
      {
        nome: "Tarefa",
        campos: [
          { nome: "id", tipo: "string" },
          { nome: "titulo", tipo: "string" },
          { nome: "concluida", tipo: "boolean" },
          { nome: "criadaEm", tipo: "string" },
        ],
      },
    ],
    rotas: [
      { caminho: "/api/tarefas", descricao: "GET lista tarefas; POST cria tarefa validando titulo." },
      { caminho: "/api/tarefas/[id]", descricao: "PATCH atualiza titulo/concluida; DELETE remove tarefa por id." },
    ],
    arquivosAfetados: [
      "src/lib/tarefas.ts",
      "src/app/api/tarefas/route.ts",
      "src/app/api/tarefas/[id]/route.ts",
    ],
    objetivo:
      "Implementar API de tarefas em memória em Next.js App Router com store tipado e duas rotas REST.",
    requisitosIds: ["REQ-001", "REQ-002", "REQ-003"],
    requisitos: [
      {
        id: "REQ-001",
        titulo: "Store em memória em src/lib/tarefas.ts",
        criterio:
          "Definir interface Tarefa (id, titulo, concluida, criadaEm) e exportar listarTarefas, criarTarefa, atualizarTarefa e removerTarefa.",
      },
      {
        id: "REQ-002",
        titulo: "Listagem e criação em src/app/api/tarefas/route.ts",
        criterio:
          "Exportar GET retornando 200 com array de tarefas e POST validando titulo não vazio (400 se inválido, 201 com a tarefa criada).",
      },
      {
        id: "REQ-003",
        titulo: "Atualização e remoção em src/app/api/tarefas/[id]/route.ts",
        criterio:
          "Exportar PATCH e DELETE recebendo context com params Promise<{ id: string }>, retornando 404 quando o id não existir.",
      },
    ],
  });

  const p2Spec = renderCanonicalSpecDocument({
    titulo: "CRUD de Tarefas com Tela (P2)",
    status: "aguardando_aprovacao",
    data: "2026-10-08",
    stack: ["Next.js", "TypeScript", "Tailwind CSS"],
    modulos: [
      {
        id: "mod-store",
        nome: "Repositório de Tarefas em Memória",
        resumo: "Store em memória tipado para operações CRUD de tarefas.",
        arquivos: ["src/lib/tarefas.ts"],
      },
      {
        id: "mod-api",
        nome: "Rotas REST de Tarefas",
        resumo: "Endpoints GET/POST em /api/tarefas e PATCH/DELETE em /api/tarefas/[id].",
        arquivos: ["src/app/api/tarefas/route.ts", "src/app/api/tarefas/[id]/route.ts"],
      },
      {
        id: "mod-ui",
        nome: "Tela de Gestão de Tarefas",
        resumo: "Página cliente em /tarefas para listar, adicionar, alternar concluída e excluir tarefas.",
        arquivos: ["src/app/tarefas/page.tsx"],
      },
    ],
    entidades: [
      {
        nome: "Tarefa",
        campos: [
          { nome: "id", tipo: "string" },
          { nome: "titulo", tipo: "string" },
          { nome: "concluida", tipo: "boolean" },
          { nome: "criadaEm", tipo: "string" },
        ],
      },
    ],
    rotas: [
      { caminho: "/api/tarefas", descricao: "GET lista tarefas; POST cria nova tarefa." },
      { caminho: "/api/tarefas/[id]", descricao: "PATCH atualiza tarefa; DELETE remove tarefa." },
      { caminho: "/tarefas", descricao: "Interface web CRUD consumindo /api/tarefas." },
    ],
    arquivosAfetados: [
      "src/lib/tarefas.ts",
      "src/app/api/tarefas/route.ts",
      "src/app/api/tarefas/[id]/route.ts",
      "src/app/tarefas/page.tsx",
    ],
    objetivo:
      "Implementar CRUD completo de tarefas em memória com backend REST e tela interativa em /tarefas.",
    requisitosIds: ["REQ-001", "REQ-002", "REQ-003", "REQ-004"],
    requisitos: [
      {
        id: "REQ-001",
        titulo: "Store em memória em src/lib/tarefas.ts",
        criterio:
          "Definir interface Tarefa (id, titulo, concluida, criadaEm) e exportar listarTarefas, criarTarefa, atualizarTarefa e removerTarefa.",
      },
      {
        id: "REQ-002",
        titulo: "Listagem e criação em src/app/api/tarefas/route.ts",
        criterio:
          "Exportar GET retornando 200 com a lista de tarefas e POST validando titulo não vazio (400 se inválido, 201 com a tarefa criada).",
      },
      {
        id: "REQ-003",
        titulo: "Atualização e remoção em src/app/api/tarefas/[id]/route.ts",
        criterio:
          "Exportar PATCH e DELETE recebendo context com params Promise<{ id: string }>, retornando 404 quando o id não existir.",
      },
      {
        id: "REQ-004",
        titulo: "Tela CRUD em src/app/tarefas/page.tsx",
        criterio:
          "Componente Client ('use client') com export default que consome /api/tarefas para listar, criar nova tarefa via formulário, marcar como concluída e remover.",
      },
    ],
  });

  let targetSpec = "";
  if (projeto === "p1") {
    targetSpec = p1Spec;
  } else if (projeto === "p2") {
    targetSpec = p2Spec;
  } else if (projeto === "p3") {
    targetSpec = renderCanonicalSpecDocument(P3_SPEC);
  } else if (projeto === "p4") {
    targetSpec = renderCanonicalSpecDocument(P4_SPEC);
  }

  if (projeto === "p4") {
    const p4Base = path.join(repoRoot, "bench", "projetos", "p4-base");
    fs.cpSync(p4Base, projectDir, { recursive: true });
  }

  const project = await prisma.project.create({
    data: {
      name: `Bench ${projeto.toUpperCase()} ${variante} ${repeticao}`,
      path: projectDir,
    },
  });

  const session = await prisma.session.create({
    data: {
      title: `Bench ${projeto.toUpperCase()} ${variante} ${repeticao}`,
      projectId: project.id,
      canonicalSpec: targetSpec,
    },
  });

  const { BUDGET_AUTHORIZED_ACTION } = await import("@/core/orchestrator/budget-guard");
  await prisma.telemetryLog.create({
    data: {
      sessionId: session.id,
      action: BUDGET_AUTHORIZED_ACTION,
      details: JSON.stringify({ acrescimoUsd: 2.5, motivo: "bench B1 (fundador 16/10)" }),
    },
  });

  const startedAt = Date.now();
  const startRes = await approveSpecAndStart(session.id, targetSpec);
  if (!startRes.ok || !startRes.jobId) {
    throw new Error(`approveSpecAndStart falhou: ${JSON.stringify(startRes)}`);
  }

  const workerId = `worker-bench-${projeto}-${variante}-${repeticao}`;
  const claimed = await claimJob(startRes.jobId, workerId);
  if (!claimed) {
    throw new Error(`claimJob falhou para ${startRes.jobId}`);
  }

  await executeClaimedJob(startRes.jobId, workerId);
  // Mudança 44: a entrega reprovada abre reparo (J2b) num job novo — o bench executava um job só e parava em
  // EXECUCAO com as etapas de reparo na fila (22/10: P2 sem-jev, P3). Segue a fila até uma fase final.
  for (let n = 0; n < 12; n++) {
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id }, select: { phase: true } });
    if (["ENTREGUE", "BLOQUEADA", "PAUSADA"].includes(s.phase)) break;
    const next = await prisma.job.findFirst({ where: { sessionId: session.id, status: "queued" }, orderBy: { createdAt: "asc" } });
    if (!next) break;
    if (!(await claimJob(next.id, workerId))) break;
    await executeClaimedJob(next.id, workerId);
  }
  // Esperar TelemetryLogger assíncrono
  await new Promise((r) => setTimeout(r, 1500));

  const tempoSeg = Number(((Date.now() - startedAt) / 1000).toFixed(1));

  const finalSession = await prisma.session.findUniqueOrThrow({
    where: { id: session.id },
    include: { tasks: { orderBy: { createdAt: "asc" } } },
  });

  let tscProjeto = 0;
  try {
    execSync("npx tsc --noEmit", {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: any) {
    tscProjeto = err.status ?? 1;
  }

  const logs = await prisma.telemetryLog.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  const totalCustoUsd = await sessionCostUsd(session.id);
  const costRows = logs.filter((l) => l.action === "LLM_COST");
  const toolCallRows = logs.filter((l) => l.action === "EXECUTOR_TOOL_CALL");
  const costByPapel: Record<string, number> = { executor: 0, avaliador: 0, jev: 0, outro: 0 };
  for (const row of costRows) {
    try {
      const parsed = JSON.parse(row.details || "{}");
      const papel = parsed.papel || "outro";
      const usd = Number(parsed.usd) || 0;
      costByPapel[papel] = (costByPapel[papel] ?? 0) + usd;
    } catch {}
  }

  // Avaliador models e timeouts
  const evalLogs = logs.filter((l) => l.action === "EVALUATOR_MODEL");
  const avaliadorIndisponivel = logs.filter((l) => l.action === "EVALUATOR_UNAVAILABLE").length;
  const avaliadorServedBy: string[] = [];
  const avaliacoesPorProvedor: Record<string, number> = {};
  let timeoutsAvaliador = 0;
  for (const el of evalLogs) {
    try {
      const parsed = JSON.parse(el.details || "{}");
      const prov = String(parsed.provider ?? "desconhecido");
      avaliacoesPorProvedor[prov] = (avaliacoesPorProvedor[prov] ?? 0) + 1;
      if (parsed.model) avaliadorServedBy.push(parsed.model);
      const fails: string[] = parsed.failures || [];
      for (const f of fails) {
        if (/timeout/i.test(f)) timeoutsAvaliador++;
      }
    } catch {}
  }

  // Jev Evidence e Decision
  let divergenciasEvidencia = 0;
  for (const el of logs.filter((l) => l.action === "JEV_EVIDENCE_CHECK")) {
    try {
      const parsed = JSON.parse(el.details || "{}");
      const divs = parsed.divergencias || [];
      divergenciasEvidencia += divs.length;
    } catch {}
  }
  const jevChamadas = logs.filter((l) => l.action === "JEV_DECISION").length;

  // UI Check
  let uiCheck: "UI_CHECK_PASSED" | "UI_CHECK_FAILED" | "ausente" = "ausente";
  if (logs.some((l) => l.action === "UI_CHECK_PASSED")) {
    uiCheck = "UI_CHECK_PASSED";
  } else if (logs.some((l) => l.action === "UI_CHECK_FAILED")) {
    uiCheck = "UI_CHECK_FAILED";
  }

  // Etapas e tentativas
  const tasks = finalSession.tasks;
  const etapas = tasks.length;
  const aprovadasNa1a = tasks.filter((t) => t.status === "completed" && t.attempts === 0).length;
  const tentativasTotais = tasks.reduce((acc, t) => acc + (t.attempts || 0), 0);

  // Rodar contêiner Docker de aceite
  const aceiteDir = path.join(repoRoot, "bench", "aceite");
  const runShPath = path.join(repoRoot, "docker", "aceite", "run.sh");
  const dockerCmd = `docker run --rm --network none --memory=1g --cpus=1 --pids-limit=256 --cap-drop=ALL --security-opt=no-new-privileges -v "${projectDir.replace(/\\/g, "/")}:/project:ro" -v "${aceiteDir.replace(/\\/g, "/")}:/aceite:ro" -v "${runShPath.replace(/\\/g, "/")}:/opt/aceite/run.sh:ro" nextcode-aceite:1 ${projeto}`;

  let dockerOut = "";
  try {
    dockerOut = execSync(dockerCmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: any) {
    dockerOut = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
  }

  let aprovadosAceite = 0;
  let totalAceite = 0;
  const reprovadosIds: string[] = [];
  let resumoRaw = "";

  for (const line of dockerOut.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("RESUMO ")) {
      resumoRaw = trimmed;
      try {
        const json = JSON.parse(trimmed.replace("RESUMO ", ""));
        aprovadosAceite = json.aprovados ?? 0;
        totalAceite = json.total ?? 0;
      } catch {}
    } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const row = JSON.parse(trimmed);
        if (row.id && row.ok === false) {
          reprovadosIds.push(row.id);
        }
      } catch {}
    }
  }

  // Montar etapasDetalhe por tarefa/nó
  const etapasDetalhe: EtapaDetalheBench[] = [];
  for (const t of tasks) {
    let payloadParsed: any = {};
    try {
      payloadParsed = JSON.parse(t.payload || "{}");
    } catch {}

    const jevPlan = payloadParsed.jevPlan;
    const mb = payloadParsed.microbrief;
    const cluster = t.cluster || mb?.cluster || "core";
    const nivelPlanejado = jevPlan?.nivelModelo || mb?.nivelModeloSugerido || "medio";
    const fontePlano: "jev" | "fallback" | "ausente" = jevPlan?.source === "jev" ? "jev" : jevPlan?.source ? "fallback" : "ausente";

    const nodeCostLogs = costRows.filter((l) => {
      try {
        const d = JSON.parse(l.details || "{}");
        return d.nodeId === t.id;
      } catch {
        return false;
      }
    });

    const execLogs = nodeCostLogs.filter((l) => {
      try { return JSON.parse(l.details || "{}").papel === "executor"; } catch { return false; }
    });
    const evalCostLogs = nodeCostLogs.filter((l) => {
      try { return JSON.parse(l.details || "{}").papel === "avaliador"; } catch { return false; }
    });

    const executorModelos: string[] = [];
    let executorTokensEntrada = 0;
    let executorTokensSaida = 0;
    let executorUsd = 0;
    for (const el of execLogs) {
      try {
        const d = JSON.parse(el.details || "{}");
        if (d.model && !executorModelos.includes(d.model)) executorModelos.push(d.model);
        executorUsd += Number(d.usd) || 0;
        const u = d.usage || {};
        executorTokensEntrada += Number(u.prompt_tokens ?? u.input_tokens ?? 0);
        executorTokensSaida += Number(u.completion_tokens ?? u.output_tokens ?? 0);
      } catch {}
    }

    const avaliadorModelos: string[] = [];
    let avaliadorUsd = 0;
    for (const ev of evalCostLogs) {
      try {
        const d = JSON.parse(ev.details || "{}");
        if (d.model && !avaliadorModelos.includes(d.model)) avaliadorModelos.push(d.model);
        avaliadorUsd += Number(d.usd) || 0;
      } catch {}
    }

    const acoesFerramenta = toolCallRows.filter((l) => {
      try {
        const d = JSON.parse(l.details || "{}");
        return d.nodeId === t.id && d.ferramenta !== "invalido";
      } catch {
        return false;
      }
    }).length;

    etapasDetalhe.push({
      nodeId: t.id,
      executorChamadas: execLogs.length,
      acoesFerramenta,
      tentativas: (t.attempts || 0) + (t.status === "completed" ? 1 : 0),
      titulo: t.title,
      cluster,
      nivelPlanejado,
      fontePlano,
      executorModelos,
      executorTokensEntrada,
      executorTokensSaida,
      executorUsd,
      avaliadorModelos,
      avaliadorUsd,
    });
  }

  await prisma.$disconnect().catch(() => {});
  // Mudança 44: preserva a pasta de qualquer iteração não entregue (EXECUCAO incluída) — a evidência sumia.
  if (finalSession.phase === "ENTREGUE") {
    try {
      fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  } else {
    console.warn(`[BENCH] Pasta de diagnóstico preservada em: ${runRoot}`);
  }

  return {
    projeto,
    variante,
    repeticao,
    faseFinal: finalSession.phase,
    tempoSeg,
    etapas,
    aprovadasNa1a,
    tentativasTotais,
    tscProjeto,
    uiCheck,
    aceite: {
      aprovados: aprovadosAceite,
      total: totalAceite,
      reprovadosIds,
      resumoRaw,
    },
    custo: {
      executor: costByPapel.executor || 0,
      avaliador: costByPapel.avaliador || 0,
      jev: costByPapel.jev || 0,
      total: totalCustoUsd,
    },
    avaliadorServedBy,
    avaliadorIndisponivel,
    avaliacoesPorProvedor,
    timeoutsAvaliador,
    divergenciasEvidencia,
    jevChamadas,
    etapasDetalhe,
    tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
  };
}

// ---------------------------------------------------------------------------
async function lerCustoDbTemporario(dbPath: string): Promise<number> {
  let custo = 0;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const tempPrisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath.replace(/\\/g, "/")}` } },
    });
    const logs = await tempPrisma.telemetryLog.findMany({
      where: { action: "LLM_COST" },
    });
    for (const row of logs) {
      try {
        const parsed = JSON.parse(row.details || "{}");
        custo += Number(parsed.usd) || 0;
      } catch {}
    }
    await tempPrisma.$disconnect().catch(() => {});
  } catch {}
  return custo;
}

// ---------------------------------------------------------------------------
// Main CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);

  // Subprocesso isolado para uma única iteração
  const umaIdx = args.indexOf("--uma");
  if (umaIdx !== -1) {
    const proj = args[umaIdx + 1] as ProjetoBench;
    if (!PROJETOS_VALIDOS.includes(proj)) {
      console.error(`Projeto inválido: "${proj}". Valores permitidos: ${PROJETOS_VALIDOS.join(", ")}`);
      process.exit(2);
    }
    const vari = args[umaIdx + 2] as VarianteBench;
    const rep = Number(args[umaIdx + 3] || 1);
    const metrica = await rodarUmaExecucao(proj, vari, rep);
    console.log("===RESULTADO_JSON_START===");
    console.log(JSON.stringify(metrica));
    console.log("===RESULTADO_JSON_END===");
    return;
  }

  // Leitura de parâmetros gerais
  let projetos: ProjetoBench[] = ["p1", "p2"];
  let variantes: VarianteBench[] = [...BENCH_VARIANTES_PADRAO];
  let repeticoes = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--projetos" && args[i + 1]) {
      const rawProjetos = args[i + 1].split(",").map((s) => s.trim().toLowerCase());
      for (const p of rawProjetos) {
        if (!PROJETOS_VALIDOS.includes(p as ProjetoBench)) {
          console.error(`Projeto inválido: "${p}". Valores permitidos: ${PROJETOS_VALIDOS.join(", ")}`);
          process.exit(2);
        }
      }
      projetos = rawProjetos as ProjetoBench[];
      i++;
    } else if (args[i] === "--variantes" && args[i + 1]) {
      variantes = args[i + 1].split(",").map((s) => s.trim().toLowerCase()) as VarianteBench[];
      i++;
    } else if (args[i] === "--repeticoes" && args[i + 1]) {
      repeticoes = Number(args[i + 1]) || 1;
      i++;
    }
  }

  console.log(`\nIniciando Benchmark: Projetos=[${projetos.join(",")}], Variantes=[${variantes.join(",")}], Repetições=${repeticoes}`);
  // Mudança 44: sem a imagem da régua do auditor o aceite saía "0/0" calado (bench 22/10) — constrói ou para.
  const aceiteImg = spawnSync("docker", ["image", "inspect", "nextcode-aceite:1"], { encoding: "utf8" });
  if (aceiteImg.status !== 0) {
    console.log("Imagem nextcode-aceite:1 ausente — construindo (docker/aceite)…");
    const build = spawnSync("docker", ["build", "-t", "nextcode-aceite:1", path.join(process.cwd(), "docker", "aceite")], { encoding: "utf8", stdio: "inherit" });
    if (build.status !== 0) {
      console.error("Falha ao construir nextcode-aceite:1: sem a régua o aceite não é medido. Benchmark interrompido.");
      process.exit(3);
    }
  }

  let custoAcumulado = 0;
  const metricas: MetricasExecucao[] = [];

  for (let rep = 1; rep <= repeticoes; rep++) {
    for (const proj of projetos) {
      for (const vari of variantes) {
        console.log(`\n>>> Executando: Projeto=${proj.toUpperCase()}, Variante=${vari}, Rep=${rep} <<<`);

        const spawnRes = spawnSync(
          process.execPath,
          [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/bench.ts", "--uma", proj, vari, String(rep)],
          {
            cwd: process.cwd(),
            encoding: "utf8",
            env: { ...process.env },
            maxBuffer: 50 * 1024 * 1024,
          }
        );

        const out = spawnRes.stdout || "";
        const m = out.match(/===RESULTADO_JSON_START===([\s\S]*?)===RESULTADO_JSON_END===/);

        if (spawnRes.status !== 0 || !m) {
          console.error(`Falha no subprocesso para ${proj} ${vari} ${rep} (status=${spawnRes.status})`);
          const stderrCombined = `${spawnRes.stderr || ""}\n${spawnRes.stdout || ""}`.trim();
          const ultimas20Stderr = sanitizarSegredos(
            stderrCombined.split(/\r?\n/).filter(Boolean).slice(-20).join("\n")
          );

          const runRoot = path.join(os.tmpdir(), `nc-bench-${proj}-${vari}-${rep}`);
          const copyDb = path.join(runRoot, "dev-copy.db");
          let custoDb = 0;
          if (fs.existsSync(copyDb)) {
            custoDb = await lerCustoDbTemporario(copyDb);
            try {
              fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            } catch {}
          }

          const totalEsperado = TOTAL_TESTES_POR_PROJETO[proj];
          const metricaErro: MetricasExecucao = {
            projeto: proj,
            variante: vari,
            repeticao: rep,
            faseFinal: "ERRO_BENCH",
            tempoSeg: 0,
            etapas: 0,
            aprovadasNa1a: 0,
            tentativasTotais: 0,
            tscProjeto: 1,
            uiCheck: "ausente",
            aceite: {
              aprovados: 0,
              total: totalEsperado,
              reprovadosIds: [],
              resumoRaw: ultimas20Stderr ? `ERRO_BENCH:\n${ultimas20Stderr}` : "ERRO_BENCH",
            },
            custo: {
              executor: 0,
              avaliador: 0,
              jev: 0,
              total: custoDb,
            },
            avaliadorServedBy: [],
            avaliadorIndisponivel: 0,
            avaliacoesPorProvedor: {},
            timeoutsAvaliador: 0,
            divergenciasEvidencia: 0,
            jevChamadas: 0,
            erroBench: ultimas20Stderr,
            tetoEfetivoUsd: BENCH_TETO_PROJETO_USD,
          };

          metricas.push(metricaErro);
          custoAcumulado += custoDb;

          console.log(`Fim da iteração (ERRO_BENCH): Fase=ERRO_BENCH, Custo=US$ ${custoDb.toFixed(4)}, Aceite=0/${totalEsperado}`);
          console.log(`Custo Acumulado Bench: US$ ${custoAcumulado.toFixed(4)}`);
          continue;
        }

        const metrica: MetricasExecucao = JSON.parse(m[1].trim());
        metricas.push(metrica);
        custoAcumulado += metrica.custo.total;

        console.log(`Fim da iteração: Fase=${metrica.faseFinal}, Custo=US$ ${metrica.custo.total.toFixed(4)}, Aceite=${metrica.aceite.aprovados}/${metrica.aceite.total}`);
        console.log(`Custo Acumulado Bench: US$ ${custoAcumulado.toFixed(4)}`);

        // Travas T-J (B1: teto US$ 3,00/execução; US$ 10,00 rodada)
        if (metrica.custo.total > BENCH_TETO_PROJETO_USD) {
          console.error(
            `[TRAVA T-J] Custo de uma execução excedeu US$ ${BENCH_TETO_PROJETO_USD.toFixed(2)}: US$ ${metrica.custo.total.toFixed(4)}`
          );
          break;
        }
        if (custoAcumulado > 10.0) {
          console.error(`[TRAVA T-J] Custo acumulado do benchmark excedeu US$ 10,00: US$ ${custoAcumulado.toFixed(4)}`);
          break;
        }
      }
      if (custoAcumulado > 10.0) break;
    }
    if (custoAcumulado > 10.0) break;
  }

  const medias = calcularMedias(metricas);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

  const relatoriosDir = path.join(process.cwd(), "bench", "resultados");
  fs.mkdirSync(relatoriosDir, { recursive: true });

  const mdPath = path.join(relatoriosDir, `${timestampStr}.md`);
  const yamlPath = path.join(relatoriosDir, `${timestampStr}.yaml`);

  const mdContent = formatarRelatorioMarkdown(metricas, medias, timestampStr);
  const yamlContent = formatarRelatorioYaml(metricas, medias, timestampStr);

  fs.writeFileSync(mdPath, mdContent, "utf8");
  fs.writeFileSync(yamlPath, yamlContent, "utf8");

  console.log(`\nBenchmark concluído com sucesso!`);
  console.log(`Relatório Markdown: ${mdPath}`);
  console.log(`Relatório YAML: ${yamlPath}`);
}

import { fileURLToPath } from "url";
const __curFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__curFile)) {
  main().catch((err) => {
    console.error("Erro fatal no benchmark:", err);
    process.exit(1);
  });
}
