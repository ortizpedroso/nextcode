/**
 * E5 — controles do autoteste (porta da §5.0: "P1 ref passa, P4 pega os bugs").
 * 1. P1: o testador escreve os testes pela Spec do P1, contra uma cópia SEM os arquivos (teste do teste);
 *    depois os testes rodam contra bench/projetos/p1-referencia — todos têm de passar.
 * 2. P4: os testes da Spec do P4 rodam contra bench/projetos/p4-base (com os bugs) — os REQ com bug têm de
 *    falhar — e contra p1-referencia (mesma API, correta) — têm de passar.
 * Lê a chave da Anthropic de uma CÓPIA do banco; telemetria desligada; nada é escrito em prisma/dev.db.
 * Uso: npx tsx scripts/controles-autoteste-e5.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = path.join(os.tmpdir(), "nc-e5-controles");
fs.mkdirSync(tmpDir, { recursive: true });
fs.copyFileSync(path.join("prisma", "dev.db"), path.join(tmpDir, "dev.db"));
if (fs.existsSync(path.join("prisma", "dev.db-wal"))) fs.copyFileSync(path.join("prisma", "dev.db-wal"), path.join(tmpDir, "dev.db-wal"));
process.env.DATABASE_URL = `file:${path.join(tmpDir, "dev.db").split(path.sep).join("/")}`;

function copyWithout(src: string, dest: string, without: string[]) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  for (const f of without) fs.rmSync(path.join(dest, f), { force: true });
}

async function main() {
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  TelemetryLogger.log = () => {};
  const { generateAcceptanceTests } = await import("@/core/governance/acceptance-tests");
  const { runTestBench } = await import("@/core/execution/test-bench");
  const { P1_SPEC } = await import("../bench/specs/p1");
  const { P4_SPEC } = await import("../bench/specs/p3-p4");

  const inputOf = (spec: typeof P1_SPEC, id: string) => ({
    microbriefId: id,
    arquivos: spec.arquivosAfetados,
    criteriosPorReq: Object.fromEntries((spec.requisitos ?? []).map((r) => [r.id, [r.criterio]])),
    contrato: [...spec.modulos.map((m) => `${m.nome}: ${m.resumo} (${(m.arquivos ?? []).join(", ")})`), ...(spec.rotas ?? []).map((r) => `rota ${r.caminho}: ${r.descricao}`)].join("\n"),
  });
  const run = async (projeto: string, testes: { caminho: string; conteudo: string }[]) => {
    const r = await runTestBench(projeto, {
      reproTests: Object.fromEntries(testes.map((t) => [t.caminho, t.conteudo])),
      files: testes.map((t) => `.nextcode-repro/${t.caminho}`),
    });
    return r.cases.map((c) => ({ caso: c.name.slice(0, 110), status: c.status, falha: (c.failure ?? "").split("\n")[0].slice(0, 140) }));
  };

  const ref = path.resolve("bench/projetos/p1-referencia");
  const vazio = path.join(tmpDir, "p1-vazio");
  copyWithout(ref, vazio, P1_SPEC.arquivosAfetados);
  const p1 = await generateAcceptanceTests({ projectPath: vazio, input: inputOf(P1_SPEC, "P1") });
  const p1Ref = await run(ref, p1.testes);

  const base = path.resolve("bench/projetos/p4-base");
  // P4 modifica arquivos que já existem: teste que passa antes vira regressão.
  const p4 = await generateAcceptanceTests({ projectPath: base, input: { ...inputOf(P4_SPEC, "P4"), arquivosExistentes: P4_SPEC.arquivosAfetados } });
  const p4Base = await run(base, p4.testes);
  const p4Ref = await run(ref, p4.testes);

  const out = {
    p1: { testes: p1.testes.map((t) => ({ req: t.req, visivel: t.visivel })), descartados: p1.descartados, julgamento: p1.julgamento, contraReferencia: p1Ref },
    p4: { testes: p4.testes.map((t) => ({ req: t.req, visivel: t.visivel, regressao: Boolean(t.regressao), ...(process.env.E5_DUMP ? { conteudo: t.conteudo } : {}) })), descartados: p4.descartados, contraBase: p4Base, contraReferencia: p4Ref },
  };
  console.log(JSON.stringify(out, null, 1));
  const p1ok = p1Ref.length > 0 && p1Ref.every((c) => c.status === "passed");
  const p4reqsFalham = new Set(p4Base.filter((c) => c.status === "failed").map((c) => /REQ-\d+/.exec(c.caso)?.[0]).filter(Boolean));
  console.error(`P1 ref passa: ${p1ok} (${p1Ref.filter((c) => c.status === "passed").length}/${p1Ref.length}) · P4 base: REQ com teste falhando = ${[...p4reqsFalham].join(", ")} · P4 contra a referência: ${p4Ref.filter((c) => c.status === "passed").length}/${p4Ref.length} passam`);
}
main();
