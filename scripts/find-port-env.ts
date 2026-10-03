import * as fs from "fs";
import * as path from "path";
import { findFreePort } from "./port-utils";

// Fonte .ts do antigo scripts/find-port-env.js (removido com os .js compilados em 4bc901e,
// o que quebrava "npm run find-port" e "npm run docker:up"): acha uma porta livre e grava
// PORT no .env.
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
  } else if (/^DATABASE_URL=/m.test(envContent)) {
    envContent = `${envContent.trimEnd()}\nPORT=${freePort}\n`;
  } else {
    envContent = `${envContent.trimEnd()}\nPORT=${freePort}\nDATABASE_URL="file:./dev.db"\n`.trimStart();
  }

  fs.writeFileSync(envPath, envContent, "utf-8");

  console.log(`[NEXTCODE PORT DISCOVERY] Porta livre identificada e salva no .env: ${freePort}`);
  console.log(freePort);
}

main();
