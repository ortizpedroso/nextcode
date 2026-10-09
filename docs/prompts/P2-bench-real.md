# Prompt P2 — Bench real (testes de aceite em contêiner sem rede; padrão × sem Jev × avaliador DeepSeek)

> Pacote P2 de `docs/NEXTCODE-REFERENCIA.md` §5.3. A régua (`bench/aceite/`) foi escrita e provada pelo auditor — **não alterar**.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa P2 — `npm run bench`: roda P1 e P2 pela orquestração real, mede tudo e passa os testes de aceite num contêiner sem rede

## OBJETIVO
Medir o NextCode com números reais, para decidir com dados. Para cada **projeto** (P1, P2) × **variante** × **repetição**: rodar a orquestração de verdade (como o script de fumaça já usado), depois rodar os **testes de aceite** (`bench/aceite/`, escritos pelo auditor) num contêiner **sem rede**, e gravar um relatório comparativo.

Variantes (sem mudar código de produção):
- `padrao` — como está hoje.
- `sem-jev` — na **cópia** do banco, `setting.typesafeKey = null` (o Jev fica indisponível e o NextCode usa as reservas).
- `avaliador-deepseek` — variável de ambiente `EVALUATOR_NEMOTRON_MODEL=bench-desligado` (o Nemotron responde 404 e a cadeia cai no DeepSeek pago).

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/P2-bench-real.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só os arquivos de PODE ALTERAR. **Proibido alterar qualquer arquivo em `bench/aceite/`** (é a régua). Nada em `src/`.
- **T-C Literalidade.** Nomes, variantes, métricas e formato exatamente como escritos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**, com `npx tsc --noEmit` (0) e `npx vitest run` completo verde **nesse estado**; saídas coladas. Proibido `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; cada execução usa **cópia nova** em pasta temporária.
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório.
- **T-H Dependências.** Nenhum pacote novo no `package.json` (a imagem Docker instala `tsx` dentro dela).
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas obrigatórias.** Custo de uma execução > US$ 0,50 → PARE; custo acumulado do bench > US$ 1,50 → PARE (grave o relatório parcial); Docker indisponível → PARE; contradição prompt × código → PARE.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel.** Todo número vem copiado da saída real, com o trecho bruto logo abaixo.
- **T-M Código gerado nunca roda no host.** Os testes de aceite rodam **só** no contêiner `docker/aceite` com `--network none`.

## LEITURA OBRIGATÓRIA
- `bench/aceite/README.md`, `bench/aceite/rodar.mjs` (saída: linhas JSON + `RESUMO {...}`), `bench/aceite/stub-next/`.
- `docker/ui-check/Dockerfile` e `docker/ui-check/run.sh` (padrão de contêiner a seguir: cópia com `tar` excluindo `node_modules`/`.next`, usuário sem privilégio).
- O script de fumaça já usado: `C:\Users\ortiz\.gemini\antigravity\brain\cfd46d9b-2068-4522-b4ee-6460554ba0ab\scratch\smoke-p1-p2-10-7-2.ts` (fluxo `approveSpecAndStart` → `claimJob` → `executeClaimedJob`, Specs P1/P2, coleta de eventos e custos).
- `src/core/llm/cost.ts` (`sessionCostUsd`), `src/core/llm/evaluator-models.ts` (`EVALUATOR_NEMOTRON_MODEL`).

---

## PASSO P2.1 — Contêiner de aceite sem rede

**PODE ALTERAR:** `docker/aceite/Dockerfile` (NOVO), `docker/aceite/run.sh` (NOVO), `docker/aceite/README.md` (NOVO).

1. `Dockerfile`: `FROM node:22.11.0-bookworm-slim`; `RUN npm install -g tsx@4.19.2`; copiar `run.sh`; `USER node`; `ENTRYPOINT ["/bin/sh", "/opt/aceite/run.sh"]`. Se a tag `node:22.11.0-bookworm-slim` não existir no Docker Hub → PARE e relate.
2. `run.sh <p1|p2>`: `set -eu`; copiar `/project` para `/tmp/w` com `tar` excluindo `./node_modules`, `./.next`, `./.git`; `mkdir -p /tmp/w/node_modules/next`; copiar `/aceite/stub-next/*` para lá; `cd /tmp/w`; `tsx /aceite/rodar.mjs /tmp/w "$1"`.
3. Comando de execução (documentar no README do diretório):
   `docker run --rm --network none --memory=1g --cpus=1 --pids-limit=256 --cap-drop=ALL --security-opt=no-new-privileges -v <projeto>:/project:ro -v <repo>/bench/aceite:/aceite:ro nextcode-aceite:1 p1`
4. Prova (cole a saída): construir a imagem `nextcode-aceite:1` e rodar contra **um projeto gerado por uma execução real do P1** (do passo P2.3 ou de uma fumaça nova). A saída deve ter 10 linhas JSON e 1 `RESUMO`. Confirme `--network none` mostrando `docker inspect` da execução ou rodando `getent hosts registry.npmjs.org` dentro do contêiner (deve falhar).

Commit: `feat(bench): P2.1 - conteiner de aceite sem rede`.

---

## PASSO P2.2 — `scripts/bench.ts` e `npm run bench`

**PODE ALTERAR:** `scripts/bench.ts` (NOVO), `package.json` (somente acrescentar em `scripts`: `"bench": "npx tsx scripts/bench.ts"`), `tests/bench/bench-relatorio.test.ts` (NOVO).

1. `scripts/bench.ts` — argumentos: `--projetos p1,p2` (padrão ambos), `--variantes padrao,sem-jev,avaliador-deepseek` (padrão as três), `--repeticoes N` (padrão 1).
   Para cada execução: cópia nova de `prisma/dev.db` em pasta temporária; aplicar a variante (`sem-jev`: `UPDATE` na cópia; `avaliador-deepseek`: `process.env.EVALUATOR_NEMOTRON_MODEL = "bench-desligado"` só nessa execução); rodar o fluxo **igual ao script de fumaça** (Specs P1/P2 copiadas literalmente de lá); ao final, rodar o contêiner `nextcode-aceite:1` no diretório do projeto gerado; apagar as pastas temporárias.
   Isolar cada execução num **processo filho** (`child_process.spawn` de `npx tsx scripts/bench.ts --uma <projeto> <variante> <rep>`), para que variáveis de ambiente e estado em memória não vazem entre execuções.
2. Métricas por execução (todas vindas da trilha da cópia do banco ou da saída real):
   `projeto`, `variante`, `repeticao`, `faseFinal` (valor de `session.phase`), `tempoSeg`, `etapas`, `aprovadasNa1a` (etapas com `attempts=0` e `completed`), `tentativasTotais`, `tscProjeto` (exit code), `uiCheck` (`UI_CHECK_PASSED`/`UI_CHECK_FAILED`/ausente), `aceite` (`aprovados/total` e ids reprovados, do `RESUMO` e das linhas JSON), `custo` por papel (`executor`, `avaliador`, `jev`) e total (`LLM_COST`), `avaliadorServedBy` (lista de `EVALUATOR_MODEL.model`), `timeoutsAvaliador` (falhas com "timeout" em `EVALUATOR_MODEL.failures`), `divergenciasEvidencia` (soma de `JEV_EVIDENCE_CHECK.divergencias`), `jevChamadas` (`JEV_DECISION`).
3. Relatório: `docs/relatorios/bench/<AAAA-MM-DD-HHmm>.md` (tabela por execução + tabela de médias por projeto × variante) e `.yaml` com os mesmos dados.
4. Teste `tests/bench/bench-relatorio.test.ts`: só a função pura que monta as médias e o Markdown a partir de execuções simuladas (sem banco, sem Docker): `médias por projeto × variante`, `aceite agregado`, `execução com fase diferente de ENTREGUE aparece marcada`.

Commit: `feat(bench): P2.2 - npm run bench com variantes e testes de aceite`.

---

## PASSO P2.3 — Primeira rodada real
1. `npm run bench -- --repeticoes 1` (6 execuções: 2 projetos × 3 variantes). Respeite os tetos da T-J.
2. Commitar o relatório gerado: `docs(bench): primeira rodada`.

## RELATÓRIO (`docs/relatorios/P2-bench-real.md`)
1. Identificação: hash de partida; `git log --oneline <partida>..HEAD`.
2. Por commit: `git show --stat`; `npx tsc --noEmit`; linha final do `npx vitest run` daquele commit.
3. Prova do contêiner (P2.1, item 4) com saída bruta.
4. Tabela das 6 execuções (copiada do relatório do bench) + trecho bruto de cada `RESUMO` do aceite.
5. Desvios do prompt (obrigatório).
6. Checklist T-A…T-M.
7. Dúvidas abertas.

===== FIM DO PROMPT =====
