const net = require("net");
const fs = require("fs");
const path = require("path");

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

async function findFreePort(startPort = 3001, maxPort = 3099) {
  for (let port = startPort; port <= maxPort; port++) {
    const available = await isPortAvailable(port);
    if (available) return port;
  }
  throw new Error(`Nenhuma porta livre na faixa ${startPort}-${maxPort}`);
}

async function main() {
  const defaultPort = parseInt(process.env.PORT || "3001", 10);
  const freePort = await findFreePort(defaultPort);

  const envPath = path.resolve(process.cwd(), ".env");
  let envContent = "";
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  }

  if (/^PORT=/m.test(envContent)) {
    envContent = envContent.replace(/^PORT=.*$/m, `PORT=${freePort}`);
  } else {
    envContent = (envContent + `\nPORT=${freePort}\nDATABASE_URL=file:./dev.db\n`).trim();
  }

  fs.writeFileSync(envPath, envContent, "utf-8");

  console.log(`[NEXTCODE PORT DISCOVERY] Porta livre identificada e salva no .env: ${freePort}`);
  console.log(freePort);
}

main();
