import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import * as crypto from "crypto";
import { isPortAvailable } from "./port-utils";

// "npm run dev" → next dev; "npm start" (--start) → next start sobre o build existente.
// Antes "npm start" apontava para scripts/start-dynamic.js, removido junto com os .js
// compilados (4bc901e) sem uma fonte .ts equivalente — o comando estava quebrado.
const isStart = process.argv.slice(2).includes("--start");

/**
 * Garante a chave mestra que cifra as API keys no SQLite (NEXTCODE_MASTER_KEY no .env).
 * Sem ela o app recusa gravar qualquer segredo (ver encryptSecret). Gerada uma única vez;
 * perder o .env = recadastrar as chaves.
 */
function ensureMasterKey(): void {
  if ((process.env.NEXTCODE_MASTER_KEY || process.env.NEXTCODE_MASTER_KEYS || "").trim()) return;
  const envPath = path.join(process.cwd(), ".env");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (/^NEXTCODE_MASTER_KEYS?=\S+/m.test(current)) return;
  const key = crypto.randomBytes(32).toString("base64");
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(
    envPath,
    `${prefix}\n# Chave mestra AES-256-GCM das API keys no SQLite (gerada automaticamente). PERDER = recadastrar as chaves.\nNEXTCODE_MASTER_KEY=${key}\n`
  );
  // Vale já para este processo e o next dev filho (herda process.env).
  process.env.NEXTCODE_MASTER_KEY = key;
  console.log("[NextCode] NEXTCODE_MASTER_KEY gerada e gravada no .env (guarde uma cópia em local seguro).");
}

function shouldWipeNextCache(nextDir: string, isStartMode: boolean): { wipe: boolean; reason: string } {
  if (isStartMode) return { wipe: false, reason: "" };
  if (process.env.NEXTCODE_DEV_FORCE_CLEAN === "1") {
    return { wipe: true, reason: "NEXTCODE_DEV_FORCE_CLEAN=1" };
  }
  const buildIdPath = path.join(nextDir, "BUILD_ID");
  if (fs.existsSync(buildIdPath)) {
    return { wipe: true, reason: "artefato de next build em .next (incompatível com next dev)" };
  }
  return { wipe: false, reason: "" };
}

function wipeNextDir(nextDir: string): void {
  const entries = fs.readdirSync(nextDir);
  for (const entry of entries) {
    fs.rmSync(path.join(nextDir, entry), { recursive: true, force: true });
  }
}

async function startServer() {
  ensureMasterKey();
  const basePort = parseInt(process.env.PORT || "3001", 10);

  try {
    const nextDir = path.join(process.cwd(), ".next");
    const { wipe, reason } = shouldWipeNextCache(nextDir, isStart);
    if (wipe && fs.existsSync(nextDir)) {
      try {
        wipeNextDir(nextDir);
        console.log(`[NextCode] Cache .next apagado (${reason}).`);
      } catch (err) {
        console.warn("[NextCode] Aviso ao limpar o cache .next:", err);
      }
    } else if (!isStart && fs.existsSync(nextDir)) {
      console.log("[NextCode] Cache .next preservado — reinício de dev mais rápido. Limpeza forçada: NEXTCODE_DEV_FORCE_CLEAN=1 npm run dev");
    }
    if (isStart && !fs.existsSync(path.join(nextDir, "BUILD_ID"))) {
      console.error('[NextCode] Nenhum build encontrado em .next — rode "npm run build" antes de "npm start".');
      process.exit(1);
    }

    // Um único dev. Pular para 3002/3003 deixava três processos no mesmo SQLite e no mesmo .next.
    const portFree = await isPortAvailable(basePort);
    if (!portFree) {
      console.error(
        `[NextCode] Porta ${basePort} já está em uso. Outro npm run dev está no ar. Abra http://127.0.0.1:${basePort} ou encerre esse processo. Não vou subir outra cópia.`
      );
      process.exit(1);
    }

    console.log(`\x1b[32m\x1b[1m[NextCode] Porta ${basePort} alocada. URL: http://${process.env.NEXTCODE_DEV_HOST || "127.0.0.1"}:${basePort}\x1b[0m`);
    if (!isStart) {
      console.log(
        "[NextCode] Aguarde 'Ready' no log do Next. A 1ª abertura no browser compila a home (minutos após limpar .next; bem mais rápida com cache preservado)."
      );
    }
    console.log("");

    // Vincula a loopback por padrão: local-auth.ts trata "localhost" como fronteira
    // de confiança, então expor em 0.0.0.0 (padrão do Next) publicaria o bootstrap
    // de auth na rede local. Defina NEXTCODE_DEV_HOST para ouvir em outra interface.
    const devHost = process.env.NEXTCODE_DEV_HOST || "127.0.0.1";
    const nextCommand = isStart ? "start" : "dev";
    const useTurbo = !isStart && process.env.NEXTCODE_DEV_NO_TURBO !== "1";
    const isWin = process.platform === "win32";
    const command = isWin ? "cmd.exe" : "npx";
    const nextArgs = [
      "next",
      nextCommand,
      ...(useTurbo ? ["--turbo"] : []),
      "-p",
      String(basePort),
      "-H",
      devHost,
    ];
    const args = isWin ? ["/c", "npx", ...nextArgs] : nextArgs;
    if (useTurbo) {
      console.log("[NextCode] next dev com Turbopack (desligar: NEXTCODE_DEV_NO_TURBO=1).");
    }

    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, PORT: String(basePort) },
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
