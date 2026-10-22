/**
 * Retoma pela linha de comando uma sessão BLOQUEADA, pelo mesmo caminho do painel (rota /api/dag):
 * `DESBLOQUEIO_HUMANO` + fila da sessão + worker real até ENTREGUE ou BLOQUEADA. Opcionalmente refaz
 * etapas (`--refazer <id,id>`), como o botão "Re-tentar": zera tentativas e registra
 * NODE_UNBLOCKED_BY_HUMAN. Uso: só com o app parado (um worker por banco) e com autorização do fundador.
 *
 * Com `--reabrir`, uma sessão ENTREGUE volta à verificação final (mudança 40), sem mudar a Spec.
 * Com `--rodada-extra`, autoriza mais uma rodada de reparo depois das 3 automáticas (mudança 43.4).
 *
 * Uso: npx tsx scripts/retomar-sessao.ts <idDaSessao|prefixo> [--refazer id1,id2] [--reabrir | --rodada-extra] [--motivo "texto"]
 */
import fs from "fs";
import path from "path";

const POLL_MS = 30_000;
const TEMPO_MAX_H = 4;

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const arg = (nome: string): string | null => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] ?? null : null;
};

async function main(): Promise<void> {
  const prefixo = process.argv[2];
  if (!prefixo || prefixo.startsWith("--")) throw new Error("informe o id (ou prefixo) da sessão");
  const refazer = (arg("--refazer") || "").split(",").filter(Boolean);
  const motivo = arg("--motivo") || "retomada pela linha de comando";

  const prisma = (await import("@/lib/prisma")).default;
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  const { applyPhaseEvent } = await import("@/core/orchestrator/session-phase");
  const { enqueueSessionQueueJob } = await import("@/core/orchestrator/job-queue");
  const { startJobWorker, stopJobWorker } = await import("@/core/orchestrator/job-worker");

  const session = await prisma.session.findFirstOrThrow({ where: { id: { startsWith: prefixo } } });

  // Mesmo caminho do botão "Re-tentar" (mudança 44: etapa de reparo tem o escopo recalculado).
  const { retryNodeAndCascade } = await import("@/core/orchestrator/session-resume");
  for (const nodeId of refazer) {
    const t = await prisma.taskNode.findUniqueOrThrow({ where: { id: nodeId } });
    if (t.sessionId !== session.id) throw new Error(`etapa ${nodeId} não é da sessão ${session.id}`);
    TelemetryLogger.log({ sessionId: t.sessionId, action: "SESSION_RESUME_CLI", details: { nodeId, motivo } });
    const retried = await retryNodeAndCascade(nodeId, "linha_de_comando");
    console.log(`[retomar] ${retried.message}`);
  }

  if (refazer.length > 0) {
    // retryNodeAndCascade já desbloqueou a sessão e pôs na fila.
  } else if (process.argv.includes("--rodada-extra")) {
    // Mudança 43.4: mais uma rodada de reparo, autorizada pelo fundador.
    const { authorizeRepairRound } = await import("@/core/orchestrator/session-resume");
    const authorized = await authorizeRepairRound(session.id, "linha_de_comando");
    console.log(`[retomar] ${authorized.message}`);
    if (!authorized.ok) throw new Error(authorized.message);
  } else if (process.argv.includes("--reabrir")) {
    const { reopenDeliveredSession } = await import("@/core/orchestrator/session-resume");
    const reopened = await reopenDeliveredSession(session.id, "linha_de_comando", motivo);
    console.log(`[retomar] ${reopened.message}`);
    if (!reopened.ok) throw new Error(reopened.message);
  } else {
    if (session.phase === "BLOQUEADA") await applyPhaseEvent(session.id, { type: "DESBLOQUEIO_HUMANO" });
    await enqueueSessionQueueJob(session.id);
  }
  startJobWorker();

  const inicio = Date.now();
  let fim = "";
  while (!fim) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id }, select: { phase: true } });
    console.log(`[retomar] ${new Date().toISOString()} fase=${s.phase}`);
    if (s.phase === "ENTREGUE" || s.phase === "BLOQUEADA") fim = s.phase;
    if (Date.now() - inicio > TEMPO_MAX_H * 3_600_000) fim = `tempo máximo de ${TEMPO_MAX_H} h`;
  }
  await stopJobWorker();
  console.log(`[retomar] FIM ${fim}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[retomar] ERRO", err);
  process.exit(1);
});
