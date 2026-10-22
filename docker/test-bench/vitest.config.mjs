// Configuração da bancada (mudança 43): igual para todo projeto; o alias "@/" segue o padrão do Next.
// Ambiente node (sem navegador): a bancada testa regras e rotas; tela fica com a verificação de tela.
import path from "node:path";

export default {
  cacheDir: "/tmp/vite-cache",
  resolve: { alias: { "@": path.resolve("/tmp/app/src") } },
  test: {
    root: "/tmp/app",
    environment: "node",
    include: [".nextcode-repro/**/*.test.{ts,tsx,js,mjs}", "tests/**/*.test.{ts,tsx,js,mjs}", "src/**/*.test.{ts,tsx,js,mjs}"],
    exclude: ["**/node_modules/**"],
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    watch: false,
  },
};
