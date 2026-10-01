import { execSync } from "child_process";

/**
 * Script de Segurança Anti-Vazamento (NextCode v5 - Item S4)
 * Verifica se arquivos .db, .env ou chaves/tokens sensíveis estão sendo rastreados no Git.
 */
function checkSecrets() {
  console.log("🔒 Running anti-leak secret check...");

  try {
    const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    const forbiddenFiles = trackedFiles.filter(
      (f) => f.endsWith(".db") || f.endsWith(".sqlite") || (f.startsWith(".env") && !f.endsWith(".example"))
    );

    if (forbiddenFiles.length > 0) {
      console.error("❌ SECURITY FAILURE: The following database or env files are tracked in Git:");
      forbiddenFiles.forEach((f) => console.error(`   - ${f}`));
      console.error("Run 'git rm --cached <file>' to un-track them.");
      process.exit(1);
    }

    console.log("✅ Check Secrets Passed: No database or env files tracked in Git.");
  } catch (err) {
    console.error("❌ Error running check-secrets:", err.message);
    process.exit(1);
  }
}

checkSecrets();
