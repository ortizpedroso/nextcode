// Stop: impede encerrar se houve commit depois da última atualização do diário e o commit não o inclui.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
if (input.stop_hook_active) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
try {
  const commitTs = Number(git("log", "-1", "--format=%ct")) * 1000;
  const touched = git("show", "--name-only", "--format=", "HEAD").split(/\r?\n/);
  if (touched.includes("memory/diario.md")) process.exit(0);
  const diaryMs = fs.statSync(path.join(root, "memory", "diario.md")).mtimeMs;
  if (commitTs > diaryMs) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: "Houve commit depois da última atualização de memory/diario.md. Antes de encerrar, acrescente no topo do diário: o que foi feito (com o commit), onde parou, o próximo passo e as pendências do fundador.",
    }));
  }
} catch {}
process.exit(0);
