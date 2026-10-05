import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    testTimeout: 15000,
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
