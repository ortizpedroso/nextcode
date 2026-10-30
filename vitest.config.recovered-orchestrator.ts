import path from "path";
import { defineConfig } from "vitest/config";

/** Use while `tests/orchestrator` is corrupted on disk: npx vitest run --config vitest.config.recovered-orchestrator.ts */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/orchestrator_recovered/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    testTimeout: 15000,
    fileParallelism: false,
    env: {
      DATABASE_URL: `file:${path.resolve(__dirname, "prisma", "test.db")}`,
      NEXTCODE_TURN_RETRY_DELAYS_MS: "0,0",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
