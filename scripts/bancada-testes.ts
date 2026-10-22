/**
 * Mudança 43.1 — roda a bancada de testes num projeto (contêiner; instalação com rede em cache, execução sem
 * rede). Sem argumentos de arquivo, roda os testes do próprio projeto. Com --malicioso, junta um teste que
 * tenta sair para a rede e escrever no projeto (prova do isolamento).
 * Uso: npx tsx scripts/bancada-testes.ts <pasta do projeto> [--malicioso] [arquivo.test.ts ...]
 */
import { runTestBench } from "@/core/execution/test-bench";

const MALICIOSO = `import { it, expect } from "vitest";
import * as fs from "node:fs";
it("rede bloqueada", async () => {
  let saiu = false;
  try { await fetch("https://example.com", { signal: AbortSignal.timeout(5000) }); saiu = true; } catch { saiu = false; }
  expect(saiu).toBe(false);
});
it("projeto só leitura", () => {
  let escreveu = false;
  try { fs.writeFileSync("/project/INVADIDO.txt", "x"); escreveu = true; } catch { escreveu = false; }
  expect(escreveu).toBe(false);
});
`;

async function main(): Promise<void> {
  const projeto = process.argv[2];
  if (!projeto) throw new Error("informe a pasta do projeto");
  const malicioso = process.argv.includes("--malicioso");
  const files = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const report = await runTestBench(projeto, {
    ...(malicioso ? { reproTests: { "isolamento.test.ts": MALICIOSO } } : {}),
    files: malicioso ? [...files, ".nextcode-repro/isolamento.test.ts"] : files,
  });
  const resumo = {
    ok: report.ok,
    stage: report.stage,
    error: report.error,
    segundos: Math.round(report.durationMs / 1000),
    arquivos: report.files,
    casos: report.cases.map((c) => `${c.status === "passed" ? "✓" : c.status === "failed" ? "✗" : "-"} ${c.file} › ${c.name}${c.failure ? `\n    ${c.failure.split("\n")[0].slice(0, 220)}` : ""}`),
    totais: {
      passou: report.cases.filter((c) => c.status === "passed").length,
      falhou: report.cases.filter((c) => c.status === "failed").length,
    },
  };
  console.log(JSON.stringify(resumo, null, 2));
}

main().catch((err) => {
  console.error("[bancada] ERRO", err);
  process.exit(1);
});
