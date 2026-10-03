import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { findFreePort } from "./port-utils";

// "npm run dev" → next dev; "npm start" (--start) → next start sobre o build existente.
// Antes "npm start" apontava para scripts/start-dynamic.js, removido junto com os .js
// compilados (4bc901e) sem uma fonte .ts equivalente — o comando estava quebrado.
const isStart = process.argv.slice(2).includes("--start");

async function startServer() {
  const basePort = parseInt(process.env.PORT || "3001", 10);

  try {
    // 1. Limpa o diretório .next para evitar conflitos entre manifestos de build de produção e ambiente de dev.
    // No modo --start o .next É o build a ser servido, então não pode ser apagado.
    const nextDir = path.join(process.cwd(), ".next");
    if (!isStart && fs.existsSync(nextDir)) {
      try {
        const entries = fs.readdirSync(nextDir);
        for (const entry of entries) {
          fs.rmSync(path.join(nextDir, entry), { recursive: true, force: true });
        }
      } catch (err) {
        console.warn("[NextCode] Aviso ao limpar o cache .next:", err);
      }
    }
    if (isStart && !fs.existsSync(path.join(nextDir, "BUILD_ID"))) {
      console.error('[NextCode] Nenhum build encontrado em .next — rode "npm run build" antes de "npm start".');
      process.exit(1);
    }

    // 2. Aloca porta disponível
    const freePort = await findFreePort(basePort);

    console.log(`\x1b[32m\x1b[1m[NextCode] Porta ${freePort} alocada com sucesso. Acesse: http://localhost:${freePort}\x1b[0m\n`);

    // Vincula a loopback por padrão: local-auth.ts trata "localhost" como fronteira
    // de confiança, então expor em 0.0.0.0 (padrão do Next) publicaria o bootstrap
    // de auth na rede local. Defina NEXTCODE_DEV_HOST para ouvir em outra interface.
    const devHost = process.env.NEXTCODE_DEV_HOST || "127.0.0.1";
    const nextCommand = isStart ? "start" : "dev";
    const isWin = process.platform === "win32";
    const command = isWin ? "cmd.exe" : "npx";
    const args = isWin
      ? ["/c", "npx", "next", nextCommand, "-p", String(freePort), "-H", devHost]
      : ["next", nextCommand, "-p", String(freePort), "-H", devHost];

    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, PORT: String(freePort) },
    });

    child.on("error", (err) => {
      console.error(`[NextCode] Erro ao iniciar servidor (next ${nextCommand}):`, err);
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code || 0);
    });
  } catch (err) {
    console.error("[NextCode] Erro de alocação de rede:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

startServer();
