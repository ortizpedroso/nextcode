/**
 * A2.3 — Replay do planejamento da Spec real `934939fc` com o analista (LLM real), em cópia do banco.
 * Não escreve em prisma/dev.db; telemetria só em memória. Gasto: só o analista (DeepSeek).
 * Uso: npx tsx scripts/replay-analista-a23.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const repoRoot = process.cwd();
const tmpDir = path.join(os.tmpdir(), "nc-a23-replay-analista");
fs.mkdirSync(tmpDir, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "prisma", "dev.db"), path.join(tmpDir, "dev.db"));
const wal = path.join(repoRoot, "prisma", "dev.db-wal");
if (fs.existsSync(wal)) fs.copyFileSync(wal, path.join(tmpDir, "dev.db-wal"));
process.env.DATABASE_URL = `file:${path.join(tmpDir, "dev.db").split(path.sep).join("/")}`;

const envPath = path.join(repoRoot, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const trail: { action: string; details: any }[] = [];
  const { TelemetryLogger } = await import("@/core/telemetry/telemetry-logger");
  TelemetryLogger.log = (e: any) => {
    trail.push({ action: e.action, details: e.details });
  };
  const prisma = (await import("@/lib/prisma")).default;
  const { SmartRouter } = await import("@/core/router/smart-router");
  const { readSecret } = await import("@/core/security/crypto");
  const { parseSpecDocument } = await import("@/core/intake/spec-format");
  const { SpecDecomposerSkill } = await import("@/core/skills/spec-decomposer");
  const { validateFinalPlan } = await import("@/core/orchestrator/plan-scope-check");
  const { costFromUsage } = await import("@/core/llm/cost");

  const session = await prisma.session.findFirst({
    where: { id: { startsWith: "934939fc" } },
    select: { id: true, canonicalSpec: true },
  });
  const spec = session?.canonicalSpec;
  if (!spec) throw new Error("Spec da sessão 934939fc não encontrada na cópia do banco");
  const parsed = parseSpecDocument(spec)!;
  const reqs = parsed.requisitos ?? [];
  const textoPorReq = Object.fromEntries(reqs.map((r) => [r.id, `${r.titulo} ${r.criterio}`]));
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });

  const router = new SmartRouter();
  const usageLog: { model: string; usd: number; input: number; output: number; ms: number }[] = [];
  const original = router.dispatchWithFallback.bind(router);
  (router as any).dispatchWithFallback = async (args: any) => {
    const t0 = Date.now();
    const res = await original(args);
    const json = await res.response.json().catch(() => ({}));
    const model = String(res.modelUsed || "");
    usageLog.push({
      model,
      usd: costFromUsage(model, json.usage),
      input: Number(json.usage?.prompt_tokens ?? 0),
      output: Number(json.usage?.completion_tokens ?? 0),
      ms: Date.now() - t0,
    });
    return { ...res, response: { json: async () => json } };
  };

  const decomp = await SpecDecomposerSkill.decomposeWithAnalistaSkill({
    specText: spec,
    titulo: parsed.titulo ?? null,
    files: parsed.arquivosAfetados ?? [],
    stack: parsed.stack ?? [],
    smartRouter: router,
    geminiKey: readSecret(setting?.geminiKey),
    omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
    omniRouteKey: readSecret(setting?.omniRouteKey),
  });

  const implNodes = decomp.nodes.filter((n: any) => n.payload?.microbrief);
  const reqCount = new Map<string, number>();
  for (const n of implNodes) for (const r of (n.payload as any).microbrief.reqsCobertos) reqCount.set(r, (reqCount.get(r) ?? 0) + 1);
  const check = validateFinalPlan(decomp.nodes as any, reqs.map((r) => r.id), textoPorReq, 4);
  const analistaTrail = trail.filter((t) => t.action.startsWith("ANALISTA_PLAN"));

  console.log(
    JSON.stringify(
      {
        sessao: session!.id,
        specChars: spec.length,
        reqs: reqs.length,
        arquivos: (parsed.arquivosAfetados ?? []).length,
        quemPlanejou: analistaTrail.some((t) => t.action === "ANALISTA_PLAN_APPROVED") ? "analista" : "heuristica (reserva)",
        trilha: analistaTrail.map((t) => ({ action: t.action, rodada: t.details?.rodada, erros: t.details?.erros, reason: t.details?.reason, amostra: (t.details?.amostra ?? []).slice(0, 5) })),
        etapas: implNodes.length,
        reqEmMaisDeUmaEtapa: [...reqCount.values()].filter((c) => c > 1).length,
        reqSemEtapa: reqs.filter((r) => !reqCount.has(r.id)).map((r) => r.id),
        t8bFinal: { valid: check.valid, erros: check.errors.length, amostra: check.errors.slice(0, 10) },
        chamadas: usageLog,
        custoUsd: usageLog.reduce((a, u) => a + u.usd, 0),
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
