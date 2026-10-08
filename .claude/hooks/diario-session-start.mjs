// SessionStart: injeta no contexto a entrada mais recente de memory/diario.md (onde paramos).
import fs from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.join(root, "memory", "diario.md");
let entry = "memory/diario.md não encontrado — crie a primeira entrada antes de trabalhar.";
try {
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("\n## ");
  if (start >= 0) {
    const next = text.indexOf("\n## ", start + 4);
    entry = text.slice(start + 1, next >= 0 ? next : undefined).trim();
  }
} catch {}
const ctx =
  "NextCode — ÚLTIMA ENTRADA DO DIÁRIO (memory/diario.md). Fonte única: docs/NEXTCODE-REFERENCIA.md. " +
  "Ao terminar cada passo, acrescente uma entrada nova no topo do diário.\n\n" + entry;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx } }));
