import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

function testListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    try {
      server.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  const ipv4Ok = await testListen(port, "0.0.0.0");
  if (!ipv4Ok) return false;

  const ipv6Ok = await testListen(port, "::");
  if (!ipv6Ok) return false;

  const localhostOk = await testListen(port, "127.0.0.1");
  if (!localhostOk) return false;

  return true;
}

async function findFreePort(startPort: number = 3001, maxPort: number = 3099): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`Nenhuma porta livre encontrada na faixa ${startPort}-${maxPort}`);
}

async function startDevServer() {
  const basePort = parseInt(process.env.PORT || "3001", 10);

  try {
    // 1. Limpa o diretório .next para evitar conflitos entre manifestos de build de produção e ambiente de dev
    const nextDir = path.join(process.cwd(), ".next");
    if (fs.existsSync(nextDir)) {
      try {
        const entries = fs.readdirSync(nextDir);
        for (const entry of entries) {
          fs.rmSync(path.join(nextDir, entry), { recursive: true, force: true });
        }
      } catch (err) {
        console.warn("[NextCode] Aviso ao limpar o cache .next:", err);
      }
    }

    // 2. Aloca porta disponível
    const freePort = await findFreePort(basePort);

    console.log(`\x1b[32m\x1b[1m[NextCode] Porta ${freePort} alocada com sucesso. Acesse: http://localhost:${freePort}\x1b[0m\n`);

    const isWin = process.platform === "win32";
    const command = isWin ? "cmd.exe" : "npx";
    const args = isWin
      ? ["/c", "npx", "next", "dev", "-p", String(freePort)]
      : ["next", "dev", "-p", String(freePort)];

    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, PORT: String(freePort) },
    });

    child.on("error", (err) => {
      console.error("[NextCode] Erro ao iniciar servidor de desenvolvimento:", err);
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

startDevServer();
