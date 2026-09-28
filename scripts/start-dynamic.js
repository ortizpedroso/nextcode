const net = require("net");
const { spawn } = require("child_process");

/**
 * Testa se uma porta está verdadeiramente disponível em IPv4, IPv6 e localhost
 */
function testListen(port, host) {
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

async function isPortAvailable(port) {
  const ipv4Ok = await testListen(port, "0.0.0.0");
  if (!ipv4Ok) return false;

  const ipv6Ok = await testListen(port, "::");
  if (!ipv6Ok) return false;

  const localhostOk = await testListen(port, "127.0.0.1");
  if (!localhostOk) return false;

  return true;
}

/**
 * Encontra a primeira porta totalmente livre a partir da porta inicial especificada
 */
async function findFreePort(startPort = 3001, maxPort = 3099) {
  for (let port = startPort; port <= maxPort; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`Nenhuma porta livre encontrada na faixa ${startPort}-${maxPort}`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDev = args.includes("--dev") || !args.includes("--start");
  const defaultPort = parseInt(process.env.PORT || "3001", 10);

  try {
    const freePort = await findFreePort(defaultPort);

    if (freePort !== defaultPort) {
      console.log(
        `\x1b[33m[NEXTCODE PORT ROUTINE]\x1b[0m Porta \x1b[1m${defaultPort}\x1b[0m está ocupada! Porta livre alocada dinamicamente: \x1b[32m\x1b[1m${freePort}\x1b[0m`
      );
    } else {
      console.log(
        `\x1b[32m[NEXTCODE PORT ROUTINE]\x1b[0m Porta \x1b[1m${freePort}\x1b[0m está livre e foi alocada.`
      );
    }

    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const nextArgs = ["next", isDev ? "dev" : "start", "-p", String(freePort)];

    console.log(`\x1b[36m[NEXTCODE SERVING]\x1b[0m Servidor iniciando em: \x1b[4mhttp://localhost:${freePort}\x1b[0m\n`);

    const child = spawn(command, nextArgs, {
      stdio: "inherit",
      env: { ...process.env, PORT: String(freePort) },
      shell: false,
    });

    child.on("error", (err) => {
      console.error("[NEXTCODE PORT ROUTINE] Erro ao iniciar processo:", err);
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code || 0);
    });
  } catch (err) {
    console.error("[NEXTCODE PORT ROUTINE] Falha na busca por porta livre:", err.message);
    process.exit(1);
  }
}

main();
