import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pasta corrompida no NTFS (zombie): evita scandir em tests/orchestrator até chkdsk + git checkout.
    exclude: ["**/node_modules/**", "tests/orchestrator/**", "tests/orchestrator"],
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    testTimeout: 15000,
    // Banco de teste isolado definido ANTES de qualquer import: o Prisma carrega o .env
    // (DATABASE_URL=dev.db) no import do client, então o fallback do vitest.setup.ts nunca
    // valia e a suíte gravava no dev.db real. Os processos filhos herdam este valor.
    env: {
      DATABASE_URL: `file:${path.resolve(__dirname, "prisma", "test.db")}`,
      // TR1 (1): sem espera real entre as repetições de turno na suíte.
      NEXTCODE_TURN_RETRY_DELAYS_MS: "0,0",
    },
    // Os testes de integração compartilham o mesmo arquivo SQLite (prisma/test.db),
    // incluindo Setting(id="default") e a fila global na tabela Job.
    // Desabilitar paralelismo entre arquivos garante isolamento determinístico sem esperas fixas.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
