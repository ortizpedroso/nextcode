import fs from "fs";
import path from "path";
import os from "os";

// 1. Cópia do banco antes de importar qualquer módulo do Prisma
const repoRoot = path.resolve(process.cwd());
const srcDb = path.join(repoRoot, "prisma", "dev.db");
const tmpDir = path.join(os.tmpdir(), "nc-diag-j1");

if (fs.existsSync(tmpDir)) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
fs.mkdirSync(tmpDir, { recursive: true });

const copyDb = path.join(tmpDir, "dev-copy.db");
fs.copyFileSync(srcDb, copyDb);

process.env.DATABASE_URL = `file:${copyDb.replace(/\\/g, "/")}`;

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

async function main() {
  // Importação dinâmica após configuração de DATABASE_URL e .env
  const { renderCanonicalSpecDocument, parseSpecDocument } = await import(
    "@/core/intake/spec-format"
  );
  const { readProjectFilesContent } = await import(
    "@/core/orchestrator/node-executor"
  );
  const { verifyProjectDeliveryWithJev } = await import(
    "@/core/decision/jev-execution-checks"
  );
  const { estimateJevCostUsd } = await import("@/core/decision/jev");
  const { P1_SPEC } = await import("../bench/specs/p1");
  const { P4_SPEC } = await import("../bench/specs/p3-p4");
  const prismaMod = await import("@/lib/prisma");
  const prisma = prismaMod.default;

  const cases = [
    {
      nome: "p1-referencia",
      spec: P1_SPEC,
      pasta: path.join(repoRoot, "bench", "projetos", "p1-referencia"),
    },
    {
      nome: "p4-base",
      spec: P4_SPEC,
      pasta: path.join(repoRoot, "bench", "projetos", "p4-base"),
    },
  ];

  const sessionIdsUsed: string[] = [];

  for (const c of cases) {
    const canonicalText = renderCanonicalSpecDocument(c.spec);
    const parsedSpec = parseSpecDocument(canonicalText);
    if (!parsedSpec) {
      throw new Error(`Falha no parseSpecDocument para caso: ${c.nome}`);
    }

    const requisitos = (parsedSpec.requisitos ?? []).map((r) => ({
      id: r.id,
      titulo: r.titulo,
      criterio: r.criterio,
    }));
    const stack = parsedSpec.stack;
    const regras = parsedSpec.notasImplementacao;
    const arquivosAfetados = parsedSpec.arquivosAfetados ?? [];

    const codeContentMap = readProjectFilesContent(arquivosAfetados, c.pasta);

    // Conferência de leitura completa de todos os arquivos afetados
    for (const f of arquivosAfetados) {
      if (!(f in codeContentMap) || typeof codeContentMap[f] !== "string") {
        throw new Error(
          `Arquivo obrigatório não lido no codeContentMap: ${f} (${c.nome})`
        );
      }
    }

    // Cálculo de tamanhoEstado exatamente com a regra de verifyProjectDeliveryWithJev
    const compactCodeFiles: Record<string, string> = {};
    for (const [file, content] of Object.entries(codeContentMap)) {
      const lines = content.split(/\r?\n/).slice(0, 200).join("\n");
      compactCodeFiles[file] = lines.slice(0, 6000);
    }

    const stateObj = {
      projetoId: parsedSpec.titulo || c.nome,
      spec: {
        titulo: parsedSpec.titulo || null,
        versao: 1,
        requisitos,
        stack: stack || [],
        regras: regras || [],
        arquivosAfetados,
      },
      codeFiles: compactCodeFiles,
    };
    const tamanhoEstado = JSON.stringify(stateObj).length;

    // 5 repetições por caso
    for (let rep = 1; rep <= 5; rep++) {
      const sessionId = `diag-j1-${c.nome}-${rep}-${Date.now()}`;
      sessionIdsUsed.push(sessionId);

      const auditResult = await verifyProjectDeliveryWithJev({
        sessionId,
        projetoId: parsedSpec.titulo || c.nome,
        spec: {
          titulo: parsedSpec.titulo,
          requisitos,
          stack,
          regras,
          arquivosAfetados,
        },
        codeContentMap,
      });

      const lineOutput = {
        caso: c.nome,
        rep,
        jevDisponivel: auditResult.jevDisponivel,
        aprovado: auditResult.aprovado,
        scores: auditResult.scores,
        lacunas: auditResult.lacunas.map((l) => l.categoria),
        tamanhoEstado,
      };

      console.log(JSON.stringify(lineOutput));

      // Pequena pausa para garantir flush assíncrono de telemetria
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Consulta à trilha de telemetria para calcular tokens e custo total estimado do JEV
  const telemetryLogs = await prisma.telemetryLog.findMany({
    where: {
      action: "JEV_DECISION",
      sessionId: { in: sessionIdsUsed },
    },
  });

  let totalInputTokens = 0;
  for (const log of telemetryLogs) {
    if (log.details) {
      try {
        const details = JSON.parse(log.details);
        const usage = details.usage;
        if (usage) {
          const input =
            usage.prompt_tokens ??
            usage.input_tokens ??
            usage.total_tokens ??
            0;
          totalInputTokens += input;
        }
      } catch {}
    }
  }

  const custoTotalUsd = estimateJevCostUsd(totalInputTokens);
  console.log(
    JSON.stringify({
      resumo: "custo_total_jev",
      totalChamadas: sessionIdsUsed.length,
      totalLogsEncontrados: telemetryLogs.length,
      totalInputTokens,
      custoTotalUsd,
    })
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Erro fatal no script de diagnóstico J1:", err);
  process.exit(1);
});
