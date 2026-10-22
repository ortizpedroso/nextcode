/**
 * J3 — roda a revisão final cega (avaliador-final) numa sessão já existente, sem mudar fase nem arquivos.
 * Serve para medir no projeto real. O custo vai para a trilha da sessão (LLM_COST) e o resultado para
 * FINAL_REVIEW_MANUAL. Uso: npx tsx scripts/revisao-final-sessao.ts <idDaSessao|prefixo>
 */
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

async function main(): Promise<void> {
  const prefixo = process.argv[2];
  if (!prefixo) throw new Error("informe o id (ou prefixo) da sessão");
  const prisma = (await import("@/lib/prisma")).default;
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  const { reviewFinalDelivery } = await import("@/core/governance/final-reviewer");
  const { readProjectFilesContent } = await import("@/core/orchestrator/node-executor");
  const { parseSpecDocument } = await import("@/core/intake/spec-format");

  const session = await prisma.session.findFirstOrThrow({ where: { id: { startsWith: prefixo } }, include: { project: true } });
  const spec = session.canonicalSpec || "";
  const files = readProjectFilesContent(parseSpecDocument(spec)?.arquivosAfetados ?? [], session.project?.path);
  const t0 = Date.now();
  const r = await reviewFinalDelivery({ sessionId: session.id, spec, files });
  const resumo = {
    executado: r.executado,
    motivoNaoExecutado: r.motivoNaoExecutado,
    aprovado: r.aprovado,
    modelo: r.modelo,
    segundos: Math.round((Date.now() - t0) / 1000),
    reqs: r.reqVerdicts.map((v) => `${v.id}=${v.status}`),
    defeitos: r.defeitos,
    ressalvas: r.ressalvas,
    naoVerificados: r.naoVerificados,
    citacoesInvalidas: r.citacoesInvalidas,
    descartes: r.descartes,
    justificativa: r.justificativa,
  };
  TelemetryLogger.log({ sessionId: session.id, action: "FINAL_REVIEW_MANUAL", details: resumo });
  console.log(JSON.stringify(resumo, null, 2));
  await new Promise((res) => setTimeout(res, 500));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[revisao-final] ERRO", err);
  process.exit(1);
});
