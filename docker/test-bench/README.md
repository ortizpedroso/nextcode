# Bancada de testes (mudança 43)

Roda testes **vitest** do projeto gerado dentro de um contêiner. O código gerado pela IA nunca roda na máquina.

1. `install.sh` (**com** rede): copia o projeto (sem `node_modules`/`.next`/`.nextcode`), `npm install --ignore-scripts`, instala `vitest@2.1.9` se faltar, `prisma generate`; guarda `node_modules` no volume de cache `/deps` (um por projeto; refeito só quando muda `package.json`, `package-lock.json` ou o schema).
2. `run.sh` (**sem** rede, `--network none`, projeto só leitura): copia o projeto, liga o cache, junta os testes de reprodução (`/repro` → `.nextcode-repro/`) e roda `vitest run --reporter=json`.

Ambiente `node` (sem navegador); alias `@/` = `src/`. Resultado em `<projeto>/.nextcode/test-bench/out/vitest.json`.

```bash
docker build -t nextcode-test-bench:1 docker/test-bench
npx tsx scripts/bancada-testes.ts C:/projetos/gateway --malicioso tests/taxas.test.ts
```

1ª prova real (22/10, Gateway `4d019f00`): os 11 testes que o executor escreveu e nunca rodaram — 9 passam, 2 falham (REQ-026/052 e REQ-055, os mesmos que a revisão final achou lendo); teste malicioso sem rede e sem escrita no projeto; 5 s com o cache.
