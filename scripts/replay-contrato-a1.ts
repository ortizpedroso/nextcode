/**
 * A1.6 — Replay do analista com a Spec real do Gateway (sessão 4d019f00)
 *
 * Cópia de dev.db em %TEMP%, só leitura do banco.
 * Roda o analista (decomposeWithAnalistaSkill com modelo real).
 * Confere mecanicamente o contrato gerado e os 5 defeitos de fronteira do DG1.
 * Uso: npx tsx scripts/replay-contrato-a1.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { ContratoProjeto } from "@/core/orchestrator/project-contract";

const repoRoot = process.cwd();
const tmpDir = path.join(os.tmpdir(), "nc-a1-replay");
fs.mkdirSync(tmpDir, { recursive: true });

const srcDb = path.join(repoRoot, "prisma", "dev.db");
const statBefore = fs.statSync(srcDb);
console.log(`[T-F] dev.db LastWriteTime antes: ${statBefore.mtime.toISOString()}`);

fs.copyFileSync(srcDb, path.join(tmpDir, "dev.db"));
const wal = path.join(repoRoot, "prisma", "dev.db-wal");
if (fs.existsSync(wal)) fs.copyFileSync(wal, path.join(tmpDir, "dev.db-wal"));
const shm = path.join(repoRoot, "prisma", "dev.db-shm");
if (fs.existsSync(shm)) fs.copyFileSync(shm, path.join(tmpDir, "dev.db-shm"));

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
  const { SpecDecomposerSkill, parseAnalystPlan } = await import(
    "@/core/skills/spec-decomposer"
  );
  const { validateContract, renderContractTs } = await import(
    "@/core/orchestrator/project-contract"
  );
  const { costFromUsage } = await import("@/core/llm/cost");

  console.log("Buscando sessão 4d019f00...");
  const session = await prisma.session.findFirst({
    where: { id: { startsWith: "4d019f00" } },
    select: { id: true, title: true, canonicalSpec: true },
  });

  if (!session || !session.canonicalSpec) {
    throw new Error("Sessão 4d019f00 ou Spec canônica não encontrada na cópia do banco.");
  }

  console.log(`Sessão encontrada: ${session.id} — "${session.title}"`);
  console.log(`Tamanho da Spec: ${session.canonicalSpec.length} caracteres.`);

  const parsed = parseSpecDocument(session.canonicalSpec);
  if (!parsed) {
    throw new Error("Falha ao analisar SpecDocument da sessão.");
  }

  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const router = new SmartRouter();

  // Intercepta chamadas LLM com response.clone() para capturar contrato e custo sem consumir o stream do analista
  let capturedContrato: ContratoProjeto | undefined;
  let capturedStages: any[] = [];
  let capturedTotalCost = 0;
  const clonePromises: Promise<void>[] = [];

  const origDispatch = router.dispatchWithFallback.bind(router);
  router.dispatchWithFallback = async (opts: any) => {
    const res = await origDispatch(opts);
    if (res && res.response) {
      try {
        const cloned = res.response.clone();
        const p = (async () => {
          try {
            const json = await cloned.json();
            const text = json.choices?.[0]?.message?.content || "";
            const planParse = parseAnalystPlan(text);
            if (planParse.ok && planParse.contrato) {
              capturedContrato = planParse.contrato;
              capturedStages = planParse.stages;
            }
            if (json.usage) {
              const model = String(res.modelUsed || opts.model || "deepseek-v4-pro");
              const cost = costFromUsage(model, json.usage);
              capturedTotalCost += cost;
            }
          } catch (e) {
            console.warn("Aviso ao ler clone da resposta:", e);
          }
        })();
        clonePromises.push(p);
      } catch (e) {
        console.warn("Aviso ao clonar response:", e);
      }
    }
    return res;
  };

  console.log("Disparando decomposeWithAnalistaSkill com modelo real...");
  const tStart = Date.now();
  const decomp = await SpecDecomposerSkill.decomposeWithAnalistaSkill({
    sessionId: session.id,
    specText: session.canonicalSpec,
    titulo: parsed.titulo ?? null,
    files: parsed.arquivosAfetados ?? [],
    stack: parsed.stack ?? [],
    smartRouter: router,
    geminiKey: readSecret(setting?.geminiKey),
    omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
    omniRouteKey: readSecret(setting?.omniRouteKey),
  });
  await Promise.all(clonePromises);
  const durationSec = (Date.now() - tStart) / 1000;
  console.log(`Planejamento do analista concluído em ${durationSec.toFixed(1)}s.`);

  const contrato: ContratoProjeto | undefined = capturedContrato || (decomp as any).contrato;
  const stages = capturedStages.length > 0 ? capturedStages : (decomp as any).planStages || [];
  const contratoTs = contrato ? renderContractTs(contrato) : decomp.macrobrief?.contratosTypescript || null;

  // Conferências Mecânicas
  console.log("\n=======================================================");
  console.log("CONFERÊNCIAS MECÂNICAS DO CONTRATO GERADO");
  console.log("=======================================================");

  // 1. Contrato gerado e validado sem erro?
  const validationErrors = contrato && stages.length > 0 ? validateContract(contrato, stages) : ["Contrato não gerado"];
  const contratoValido = validationErrors.length === 0;
  console.log(`1. Contrato gerado e validado sem erro? ${contratoValido ? "SIM (0 erros)" : "NÃO (" + validationErrors.join("; ") + ")"}`);

  // 2. Entidades
  console.log(`2. Entidades no contrato (${contrato?.entidades?.length ?? 0}):`);
  for (const ent of contrato?.entidades ?? []) {
    console.log(`   - ${ent.nome} (Dono: ${ent.dono}): ${ent.campos.map((c) => `${c.nome}: ${c.tipo}`).join(", ")}`);
  }

  // 3. Enums
  console.log(`3. Enums no contrato (${contrato?.enums?.length ?? 0}):`);
  for (const en of contrato?.enums ?? []) {
    console.log(`   - ${en.nome} (Dono: ${en.dono}): [${en.valores.join(", ")}]`);
  }

  // 4. Funções
  console.log(`4. Funções no contrato (${contrato?.funcoes?.length ?? 0}):`);
  for (const fn of contrato?.funcoes ?? []) {
    console.log(`   - ${fn.nome} em ${fn.arquivo} (Dono: ${fn.dono}, Consome: ${fn.usadoPor?.join(", ") || "nenhum"}): ${fn.assinatura}`);
  }

  // 5. Rotas
  const rotas = contrato?.rotas ?? [];
  console.log(`5. Rotas declaradas no contrato (${rotas.length}):`);
  for (const r of rotas) {
    console.log(`   - [${r.metodo}] ${r.caminho} -> ${r.arquivo} (Dono: ${r.dono}, Consome: ${r.usadoPor?.join(", ") || "nenhum"})`);
  }

  // 6. Brechas mapeadas no DG1
  console.log("\n=======================================================");
  console.log("CONFERÊNCIA DOS 5 DEFEITOS DE FRONTEIRA DO DG1");
  console.log("=======================================================");

  const entSessao = contrato?.entidades?.find((e) => e.nome.toLowerCase() === "sessao");
  const fnCriarSessao = contrato?.funcoes?.find((f) => f.nome.toLowerCase().includes("sessao"));
  const temPapelNaSessao = entSessao?.campos?.some((c) => c.nome.toLowerCase() === "papel" || c.nome.toLowerCase() === "role");
  console.log("DG1.1 (REQ-008/007 - Papel na Sessão / auth vs tenant / checkout):");
  console.log(`   -> Sessao tem campo de papel tipado? ${temPapelNaSessao ? "SIM" : "NÃO"}`);
  console.log(`   -> Função de sessão tipada no contrato? ${fnCriarSessao ? `${fnCriarSessao.nome}: ${fnCriarSessao.assinatura}` : "NÃO"}`);

  const fnObterMarca = contrato?.funcoes?.find((f) => f.nome.toLowerCase().includes("marca") || f.nome.toLowerCase().includes("whitelabel"));
  const entMarca = contrato?.entidades?.find((e) => e.nome.toLowerCase().includes("marca") || e.nome.toLowerCase().includes("whitelabel"));
  console.log("DG1.2 (REQ-035 - Campos de Whitelabel / obterMarca):");
  console.log(`   -> Função obterMarca no contrato? ${fnObterMarca ? `${fnObterMarca.nome}: ${fnObterMarca.assinatura} (Dono: ${fnObterMarca.dono}, UsadoPor: ${fnObterMarca.usadoPor?.join(", ")})` : "NÃO"}`);
  console.log(`   -> Entidade Marca/Whitelabel no contrato? ${entMarca ? `${entMarca.nome} [${entMarca.campos.map((c) => c.nome).join(", ")}]` : "NÃO"}`);

  const rotaWebhook = rotas.find((r) => r.caminho.toLowerCase().includes("webhook") || r.caminho.toLowerCase().includes("asaas"));
  const fnWebhook = contrato?.funcoes?.find((f) => f.nome.toLowerCase().includes("webhook") || f.nome.toLowerCase().includes("asaas"));
  console.log("DG1.3 (REQ-053/018 - Webhook Asaas / idempotência e contratos):");
  console.log(`   -> Rota webhook formalizada? ${rotaWebhook ? `SIM ([${rotaWebhook.metodo}] ${rotaWebhook.caminho} em ${rotaWebhook.arquivo})` : "NÃO"}`);
  console.log(`   -> Função de webhook formalizada? ${fnWebhook ? `SIM (${fnWebhook.nome}: ${fnWebhook.assinatura})` : "NÃO"}`);

  const enumsPapel = contrato?.enums?.find((en) => en.nome.toLowerCase().includes("papel") || en.nome.toLowerCase().includes("role"));
  console.log("DG1.4 (REQ-060 - Enum de Papéis de Usuário / Maiúsculas vs minúsculas):");
  console.log(`   -> Enum de papéis formalizado? ${enumsPapel ? `SIM (${enumsPapel.nome}: [${enumsPapel.valores.join(", ")}])` : "NÃO"}`);

  const rotaAdmin = rotas.find((r) => r.caminho.toLowerCase().includes("admin"));
  const fnAdmin = contrato?.funcoes?.find((f) => f.nome.toLowerCase().includes("admin"));
  console.log("DG1.5 (REQ-063 - Rota/Tela Admin e verificação de privilégios):");
  console.log(`   -> Rotas de Admin formalizadas? ${rotaAdmin ? `SIM (${rotaAdmin.caminho} -> ${rotaAdmin.arquivo})` : "NÃO"}`);
  console.log(`   -> Funções de Admin formalizadas? ${fnAdmin ? `SIM (${fnAdmin.nome}: ${fnAdmin.assinatura})` : "NÃO"}`);

  console.log("\nEventos da trilha:", trail.map((t) => t.action));
  const planApproved = trail.find((t) => t.action === "ANALISTA_PLAN_APPROVED");
  if (planApproved) console.log("ANALISTA_PLAN_APPROVED:", JSON.stringify(planApproved.details));

  // Custo
  const dbCostRows = await prisma.telemetryLog.findMany({
    where: { sessionId: session.id, action: "LLM_COST" },
  });
  let dbTotalCost = 0;
  for (const row of dbCostRows) {
    try {
      const d = JSON.parse(row.details || "{}");
      dbTotalCost += Number(d.usd) || 0;
    } catch {}
  }
  const finalCostUsd = capturedTotalCost > 0 ? capturedTotalCost : dbTotalCost;
  console.log("\n=======================================================");
  console.log(`Gasto total do replay: US$ ${finalCostUsd.toFixed(4)}`);
  console.log("=======================================================");

  const resultadoFinal = {
    sessao: session.id,
    duracaoSeg: durationSec,
    custoTotalUsd: finalCostUsd,
    contratoValido,
    errosValidacao: validationErrors,
    totaisContrato: {
      entidades: contrato?.entidades?.length ?? 0,
      enums: contrato?.enums?.length ?? 0,
      funcoes: contrato?.funcoes?.length ?? 0,
      rotas: contrato?.rotas?.length ?? 0,
    },
    contratoTsCompleto: contratoTs,
    contratoObjeto: contrato,
  };

  const outJsonPath = path.join(repoRoot, "docs", "relatorios", "REPLAY-GATEWAY-A1.json");
  fs.writeFileSync(outJsonPath, JSON.stringify(resultadoFinal, null, 2), "utf8");
  console.log(`Resultado salvo em: ${outJsonPath}`);

  await prisma.$disconnect();

  const statAfter = fs.statSync(srcDb);
  console.log(`[T-F] dev.db LastWriteTime depois: ${statAfter.mtime.toISOString()}`);
}

main().catch((err) => {
  console.error("Erro no replay:", err);
  process.exit(1);
});
