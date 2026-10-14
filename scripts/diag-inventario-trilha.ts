import fs from "fs";
import path from "path";
import os from "os";

// 1. Cópia do banco antes de importar qualquer módulo do Prisma (Trava T-F)
const repoRoot = path.resolve(process.cwd());
const srcDb = path.join(repoRoot, "prisma", "dev.db");
const tmpDir = path.join(os.tmpdir(), "nc-diag-i1");

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
  const { default: prisma } = await import("@/lib/prisma");

  try {
    // 1. Contagem por action de TelemetryLog
    const allLogs = await prisma.telemetryLog.findMany({
      select: {
        action: true,
        details: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const actionMap = new Map<
      string,
      { total: number; primeira: Date; ultima: Date }
    >();

    const jevMap = new Map<
      string,
      { action: string; purpose: string; total: number; primeira: Date; ultima: Date }
    >();

    for (const log of allLogs) {
      // Agrupamento por action
      const act = actionMap.get(log.action);
      if (!act) {
        actionMap.set(log.action, {
          total: 1,
          primeira: log.createdAt,
          ultima: log.createdAt,
        });
      } else {
        act.total++;
        act.ultima = log.createdAt;
      }

      // Agrupamento para JEV_DECISION e JEV_FAILURE por purpose
      if (log.action === "JEV_DECISION" || log.action === "JEV_FAILURE") {
        let purpose = "desconhecido";
        try {
          if (log.details) {
            const parsed = JSON.parse(log.details);
            if (parsed && typeof parsed === "object" && typeof parsed.purpose === "string") {
              purpose = parsed.purpose;
            }
          }
        } catch {
          purpose = "erro_parse";
        }

        const jevKey = `${log.action}::${purpose}`;
        const jEntry = jevMap.get(jevKey);
        if (!jEntry) {
          jevMap.set(jevKey, {
            action: log.action,
            purpose,
            total: 1,
            primeira: log.createdAt,
            ultima: log.createdAt,
          });
        } else {
          jEntry.total++;
          jEntry.ultima = log.createdAt;
        }
      }
    }

    // Ordenar e imprimir ações
    const sortedActions = Array.from(actionMap.entries()).sort((a, b) => b[1].total - a[1].total);
    for (const [action, data] of sortedActions) {
      console.log(
        JSON.stringify({
          tipo: "acao",
          action,
          total: data.total,
          primeira: data.primeira.toISOString(),
          ultima: data.ultima.toISOString(),
        })
      );
    }

    // Ordenar e imprimir decisões/falhas JEV
    const sortedJev = Array.from(jevMap.values()).sort((a, b) => b.total - a.total);
    for (const entry of sortedJev) {
      console.log(
        JSON.stringify({
          tipo: "jev",
          action: entry.action,
          purpose: entry.purpose,
          total: entry.total,
          primeira: entry.primeira.toISOString(),
          ultima: entry.ultima.toISOString(),
        })
      );
    }

    // 2. Contagem por phase de Session
    const sessions = await prisma.session.findMany({
      select: {
        phase: true,
      },
    });

    const phaseMap = new Map<string, number>();
    for (const sess of sessions) {
      const p = sess.phase ?? "NULO";
      phaseMap.set(p, (phaseMap.get(p) ?? 0) + 1);
    }

    const sortedPhases = Array.from(phaseMap.entries()).sort((a, b) => b[1] - a[1]);
    for (const [phase, total] of sortedPhases) {
      console.log(
        JSON.stringify({
          tipo: "fase",
          phase,
          total,
        })
      );
    }
  } finally {
    await prisma.$disconnect();
    // Limpeza da pasta temporária
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

main().catch((err) => {
  console.error("Erro ao executar diagnóstico:", err);
  process.exit(1);
});
