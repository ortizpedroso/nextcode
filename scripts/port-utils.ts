import * as net from "net";

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

/** Porta livre de verdade: testa IPv4, IPv6 e loopback. */
export async function isPortAvailable(port: number): Promise<boolean> {
  const ipv4Ok = await testListen(port, "0.0.0.0");
  if (!ipv4Ok) return false;

  const ipv6Ok = await testListen(port, "::");
  if (!ipv6Ok) return false;

  const localhostOk = await testListen(port, "127.0.0.1");
  if (!localhostOk) return false;

  return true;
}

// Faixa relativa à porta base (antes fixa em 3001-3099: PORT acima de 3099 nunca achava porta).
export async function findFreePort(startPort: number = 3001, maxPort: number = startPort + 98): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`Nenhuma porta livre encontrada na faixa ${startPort}-${maxPort}`);
}
