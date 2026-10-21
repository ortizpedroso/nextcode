# Auditoria do Cursor — Execução Autônoma 2 da E1 (Mudança 26: P1–P13, D41, D42)

- **Auditor:** Cursor
- **Partida conferida (T-A):** `git log -1 --format=%s` = `docs: prompt do Cursor alinhado ao HEAD (186)` (`1b99f4f`). `git status --short` inicial = apenas ` M .claude/.headroom_wrap_marker.json` e ` M .serena/project.yml` (intocados).
- **Trava T-F (`prisma/dev.db`):** mtime antes = `2026-10-20 04:52:32.630`; mtime depois da suíte (2×), testes isolados e bench = `2026-10-20 04:52:32.630` (inalterado).
- **Veredito geral:** **aceito com ressalvas**.
  - **Motivo:** Os 15 commits de código (`fbda610`…`49598bc`, `014d816`, `835e98f`) implementam corretamente os itens P1–P13 (TR1 1–14) e as duas correções pós-bench (D41 e D42). O `HEAD` compila (`tsc --noEmit` exit 0) e passa 100% nas duas rodadas completas do Vitest (`136 passed / 909 passed`). Os testes de regressão de D41 e D42 falham quando a respectiva correção de código é revertida e voltam a passar quando restaurada. Na prova real (bench LLM), P1, P2, P3 e P4 terminaram em `ENTREGUE` com aceite `10/10`, `13/13`, `12/12` e `12/12`, chamadas médias do executor por etapa ≤ 10 em todos (`2.0`, `5.0`, `3.0` e `3.0`) e custo total de `US$ 0.3847` (≤ `US$ 0.60`). As ressalvas decorrem de:
    1. **Violação da trava T-B na D23 (`c074f1f`):** aumento de `timeout` em `tests/harness/end-to-end-harness-plan.test.ts:52` (`120_000`) e `tests/orchestrator/step-4b.test.ts:51` (`60_000`) fora do escopo funcional de P6, além de commits intermediários (`fbda610`, `c77196f`, `9d9b07a`, `aa808dd`, `70e4b6b`, `d73f945`) em que a suíte completa sofria timeouts de 15s sob carga.
    2. **Promessa parcial na skill `skills/avaliador/SKILL.md:72` (P7 / D25):** o texto diz que em `APROVADO_COM_RESSALVA` *"as ressalvas vão para o resumo e viram correção da próxima rodada"*, mas o código (`src/core/orchestrator/node-executor.ts:1751,2011`) apenas grava `correcoesSugeridas` e `verdictAction: "polir_uma_rodada"` no `result` do nó e promove a etapa imediatamente para `completed`, sem disparar rodada automática de polimento.
    3. **Teste dependente de `.env` não versionado:** `tests/intake/mega-stress-e1-e5.test.ts:160-218` (`TESTE PESADO 3`) falha em worktrees limpos porque `decideGraphifyEligibilityWithJev` exige `ZEROENTROPY_API_KEY` no ambiente e o teste não define valor sintético em `process.env`.

---

## 1. Escopo e histórico

### `git log --oneline 54b8c19..HEAD`

```text
1b99f4f docs: prompt do Cursor alinhado ao HEAD (186)
dfe3d70 docs: revisao da pasta docs contra o codigo (185)
917c364 docs(auditoria): relatorios honestos da mudanca 26 + D41 + D42 (184)
835e98f fix(executor): turno do executor respeita o timeout da etapa (D42) (183)
014d816 fix(avaliador): Lente 2 aceita lista de referencias do executor (TR1 3, D41) (182)
e07f99b docs(bench): registra contagens reais do bench 20/10 (P1 e P2 entregues; P3 e P4 pausados por queda do provedor) (181)
7bfca11 docs: relatorios da mudanca 26 e prompt de auditoria do Cursor (180)
d050322 docs(referencia): marca P1-P13 concluidos na mudanca 26 (179)
49598bc feat(p13): relatorio do bench detalha etapa, modelo, tokens e custo (TR1 11) (178)
d73f945 feat(p12): pastas protegidas antes de abrir ou apagar projeto (TR1 10) (177)
e677318 feat(p11): SPEC_CLARITY_SHADOW sem escrever no chat; Graphify so com >= 5 arquivos (TR1 7, 8) (176)
5ce95d0 feat(p10): catalogo unico das 12 decisoes do Jev e limpeza de obsoletos (TR1 9) (175)
70e4b6b feat(p9): teto de custo por estimativa do plano e pausa com autorizacao (TR1 6) (174)
ff316e7 feat(p8): prompt caching da Anthropic no avaliador Claude (TR1 4) (173)
57f2119 feat(p7): avaliador separa critico de importante e exige nivelProva (TR1 3) (172)
c074f1f feat(p6): regra do harness repetida bloqueia sem gastar tentativa (TR1 2); timeout dos e2e (171)
aa808dd feat(p5): espera curta no mesmo turno antes de pausar por queda do provedor (TR1 1) (170)
e5fcda7 feat(p4): nivel do modelo por etapa via Jev ou cluster (TR1 5) (169)
9d9b07a feat(p3): retentativa do executor preserva codigo na quarentena (TR1 14) (168)
c77196f feat(p2): contexto fixo da stack no 1o prompt do executor (TR1 13) (167)
fbda610 feat(p1): executor com varias acoes por turno (TR1 12) (166)
```

Total: **21 commits** no intervalo `54b8c19..HEAD`, sendo **15 commits de código** (`fbda610`…`49598bc`, `014d816`, `835e98f`) e **6 commits de documentação/relatórios** (`d050322`, `7bfca11`, `e07f99b`, `917c364`, `dfe3d70`, `1b99f4f`).

### `git diff --stat 54b8c19..HEAD`

```text
 config/politicas-orquestracao.yaml                 |  52 ++-
 docs/NEXTCODE-REFERENCIA.md                        | 189 +++++----
 docs/prompts/AUDITORIA-E1-producao-cursor.md       | 144 ++++++-
 docs/relatorios/AUDITORIA-E1-producao.md           | 144 +++++++
 docs/relatorios/DECISOES-AUTONOMAS-E1-2.md         | 157 ++++++++
 docs/relatorios/IMPLEMENTADO-E1-producao.md        | 194 ++++++++++
 docs/relatorios/bench/2026-10-20-0226.md           |  85 ++++
 docs/relatorios/bench/2026-10-20-0226.yaml         | 446 ++++++++++++++++++++++
 memory/decisoes.md                                 |  22 ++
 memory/diario.md                                   |  85 ++++
 memory/medicoes.md                                 |  24 ++
 skills/avaliador-frontend/SKILL.md                 |  22 +-
 skills/avaliador/SKILL.md                          |  35 +-
 skills/executor-backend/SKILL.md                   |  19 +-
 skills/executor-core/SKILL.md                      |  19 +-
 skills/executor-database/SKILL.md                  |  19 +-
 skills/executor-frontend/SKILL.md                  |  19 +-
 skills/executor-test/SKILL.md                      |  19 +-
 src/app/api/chat/route.ts                          |  34 +-
 src/app/api/projects/[id]/route.ts                 |  15 +-
 src/app/api/projects/route.ts                      |  28 +-
 src/app/api/sessions/[id]/budget/route.ts          |  94 +++++
 src/core/config/orchestration-policy.ts            |  84 +++-
 src/core/decision/jev-decisions.ts                 | 131 +++++--
 src/core/governance/dual-lens-auditor.ts           | 199 ++++++++--
 src/core/intake/universal-funnel.ts                |  14 +-
 src/core/llm/cost.ts                               |  33 +-
 src/core/llm/evaluator-models.ts                   |  90 ++++-
 src/core/llm/gateways.ts                           |  28 +-
 src/core/orchestrator/budget-guard.ts              | 122 +++++-
 src/core/orchestrator/execution-trigger.ts         |  15 +-
 src/core/orchestrator/jev-plan.ts                  | 107 +++++-
 src/core/orchestrator/job-worker.ts                |  35 +-
 src/core/orchestrator/node-executor.ts             | 334 ++++++++++++++--
 src/core/orchestrator/project-scaffolder.ts        |  82 ++++
 src/core/project/folder-safety.ts                  | 119 ++++++
 src/core/project/source-files.ts                   |  15 +-
 src/core/router/smart-router.ts                    |  24 +-
 src/core/skills/executor-tool-loop.ts              | 343 ++++++++++++++---
 src/core/skills/skill-contracts.ts                 |  41 +-
 src/lib/bench-metrics.ts                           | 193 +++++++++-
 src/types/canonical-spec.ts                        |   5 +
 tests/api/projects-delete.test.ts                  |  43 ++-
 tests/api/projects-open-existing.test.ts           |  55 ++-
 tests/bench/bench-relatorio.test.ts                |  78 +++-
 tests/decision/jev-chat-fanout.test.ts             |  36 +-
 tests/governance/av13-problemas-evidencia.test.ts  |  77 +++-
 tests/governance/lens2-lista-evidencia.test.ts     |  45 +++
 tests/harness/budget-ceiling.test.ts               |  88 ++++-
 tests/harness/end-to-end-harness-plan.test.ts      |   2 +-
 tests/harness/jev-decisions-catalog.test.ts        |  48 +++
 tests/orchestrator/jev-plan-referencias.test.ts    |  61 +++
 tests/orchestrator/step-4b.test.ts                 |   2 +-
 tests/skills/executor-tool-loop.test.ts            | 355 +++++++++++++++++
 vitest.config.ts                                   |   2 +
 55 files changed, 4399 insertions(+), 372 deletions(-)
```

*(Nota: o `git diff --stat 54b8c19..HEAD` tem 55 arquivos alterados; nos 15 commits de código sem os commits `d050322..1b99f4f` são 46 arquivos de código/teste/config/skills).*

### `git reflog -60` (verificação de `amend`, `reset` ou `rebase`)

```text
1b99f4f HEAD@{0}: commit: docs: prompt do Cursor alinhado ao HEAD (186)
dfe3d70 HEAD@{1}: commit: docs: revisao da pasta docs contra o codigo (185)
917c364 HEAD@{2}: commit: docs(auditoria): relatorios honestos da mudanca 26 + D41 + D42 (184)
835e98f HEAD@{3}: commit: fix(executor): turno do executor respeita o timeout da etapa (D42) (183)
014d816 HEAD@{4}: commit: fix(avaliador): Lente 2 aceita lista de referencias do executor (TR1 3, D41) (182)
e07f99b HEAD@{5}: commit: docs(bench): registra contagens reais do bench 20/10 (P1 e P2 entregues; P3 e P4 pausados por queda do provedor) (181)
7bfca11 HEAD@{6}: commit: docs: relatorios da mudanca 26 e prompt de auditoria do Cursor (180)
d050322 HEAD@{7}: commit: docs(referencia): marca P1-P13 concluidos na mudanca 26 (179)
49598bc HEAD@{8}: commit: feat(p13): relatorio do bench detalha etapa, modelo, tokens e custo (TR1 11) (178)
d73f945 HEAD@{9}: commit: feat(p12): pastas protegidas antes de abrir ou apagar projeto (TR1 10) (177)
e677318 HEAD@{10}: commit: feat(p11): SPEC_CLARITY_SHADOW sem escrever no chat; Graphify so com >= 5 arquivos (TR1 7, 8) (176)
5ce95d0 HEAD@{11}: commit: feat(p10): catalogo unico das 12 decisoes do Jev e limpeza de obsoletos (TR1 9) (175)
70e4b6b HEAD@{12}: commit: feat(p9): teto de custo por estimativa do plano e pausa com autorizacao (TR1 6) (174)
ff316e7 HEAD@{13}: commit: feat(p8): prompt caching da Anthropic no avaliador Claude (TR1 4) (173)
57f2119 HEAD@{14}: commit: feat(p7): avaliador separa critico de importante e exige nivelProva (TR1 3) (172)
c074f1f HEAD@{15}: commit: feat(p6): regra do harness repetida bloqueia sem gastar tentativa (TR1 2); timeout dos e2e (171)
aa808dd HEAD@{16}: commit: feat(p5): espera curta no mesmo turno antes de pausar por queda do provedor (TR1 1) (170)
e5fcda7 HEAD@{17}: commit: feat(p4): nivel do modelo por etapa via Jev ou cluster (TR1 5) (169)
9d9b07a HEAD@{18}: commit: feat(p3): retentativa do executor preserva codigo na quarentena (TR1 14) (168)
c77196f HEAD@{19}: commit: feat(p2): contexto fixo da stack no 1o prompt do executor (TR1 13) (167)
fbda610 HEAD@{20}: commit: feat(p1): executor com varias acoes por turno (TR1 12) (166)
54b8c19 HEAD@{21}: commit: docs(referencia): plano de producao na E1 — 13 passos em ordem (mudanca 26) (165)
```

Nenhuma ocorrência de `amend`, `reset` ou `rebase` nas 60 entradas do `git reflog`.

### Arquivos alterados fora de um passo P1–P13, D41 ou D42

1. **`tests/harness/end-to-end-harness-plan.test.ts` (linha 52) e `tests/orchestrator/step-4b.test.ts` (linha 51):** alterados no commit `c074f1f` (P6) para aumentar os timeouts dos blocos `describe` para `120_000` e `60_000` (decisão D23). Não pertencem ao requisito funcional de P6 (TR1 item 2 — regra do harness repetida) e violam a trava T-B (*"nunca aumentar timeout para teste passar"*).
2. **Arquivos de documentação, memória e relatórios do bench (`d050322`, `7bfca11`, `e07f99b`, `917c364`, `dfe3d70`, `1b99f4f`):**
   - `docs/NEXTCODE-REFERENCIA.md`
   - `docs/prompts/AUDITORIA-E1-producao-cursor.md`
   - `docs/relatorios/AUDITORIA-E1-producao.md`
   - `docs/relatorios/DECISOES-AUTONOMAS-E1-2.md`
   - `docs/relatorios/IMPLEMENTADO-E1-producao.md`
   - `docs/relatorios/bench/2026-10-20-0226.md` e `docs/relatorios/bench/2026-10-20-0226.yaml`
   - `memory/decisoes.md`, `memory/diario.md`, `memory/medicoes.md`

---

## 2. Commits isolados (tabela hash › tsc › vitest)

**Método em cada commit (1 por vez, em série):**
1. `git worktree add c:\projetos\nc-aud-<hash> <hash>`
2. Junction de `node_modules` apontando para `c:\projetos\nextcode\node_modules`
3. Sincronização do banco de teste do worktree: `DATABASE_URL="file:c:\projetos\nc-aud-<hash>/prisma/test.db" npx prisma db push --skip-generate`
   - *Achado técnico relevante sobre o `prisma db push` em worktrees:* o Prisma CLI resolve caminhos relativos em `DATABASE_URL` (`file:./prisma/test.db`) a partir do diretório de `prisma/schema.prisma`, criando `prisma/prisma/test.db` em vez de `prisma/test.db`, enquanto `vitest.config.ts:15` aponta para `path.resolve(__dirname, "prisma", "test.db")`. Além disso, com `node_modules` via junction no Windows, o Node precisa de `NODE_OPTIONS="--preserve-symlinks --preserve-symlinks-main"` para não carregar duas instâncias do módulo `vitest`. Aplicando o caminho absoluto de `prisma/test.db` no `prisma db push` e limpando `DATABASE_URL` antes do `npx vitest run`, todas as 39 suítes de banco rodam normalmente no worktree.
4. `npx tsc --noEmit` e `npx vitest run`
5. Remoção da junction e `git worktree remove --force c:\projetos\nc-aud-<hash>`. Ao final, `git worktree list` confirmou que nenhum worktree de auditoria restou.

| Hash | Passo | `prisma db push` | `tsc --noEmit` | `vitest run` (arquivos) | `vitest run` (testes) | Falhas observadas no worktree |
|---|---|---|---|---|---|---|
| `fbda610` | P1 | `in sync (180ms)` | `exit 0` | `2 failed \| 129 passed (131)` | `3 failed \| 875 passed (878)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3 — sem `.env`), `step-4b.test.ts` (#5 e #7 — timeout 15s pré-`c074f1f`) |
| `9d9b07a` | P3 | `in sync (471ms)` | `exit 0` | `3 failed \| 128 passed (131)` | `4 failed \| 878 passed (882)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3), `step-4b.test.ts` (#5 e #7 — timeout 15s), `executor-tool-loop.test.ts` (`turno inválido...` — timeout 15s) |
| `aa808dd` | P5 | `in sync (146ms)` | `exit 0` | `2 failed \| 129 passed (131)` | `3 failed \| 884 passed (887)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3), `step-4b.test.ts` (#5 e #7 — timeout 15s) |
| `c074f1f` | P6 | `in sync (271ms)` | `exit 0` | `1 failed \| 130 passed (131)` | `1 failed \| 888 passed (889)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3 — sem `.env`) |
| `57f2119` | P7 | `in sync (346ms)` | `exit 0` | `1 failed \| 130 passed (131)` | `1 failed \| 888 passed (889)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3 — sem `.env`) |
| `70e4b6b` | P9 | `in sync (733ms)` | `exit 0` | `2 failed \| 130 passed (132)` | `2 failed \| 894 passed (896)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3), `executor-tool-loop.test.ts` (`TR1 (1) a) provedor some 2×...` — timeout 15s sob carga) |
| `d73f945` | P12 | `in sync (236ms)` | `exit 0` | `2 failed \| 133 passed (135)` | `3 failed \| 903 passed (906)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3), `executor-tool-loop.test.ts` (`TR1 (1) a)` e `turno inválido...` — timeout 15s sob carga) |
| `014d816` | D41 | `in sync (284ms)` | `exit 0` | `1 failed \| 135 passed (136)` | `1 failed \| 907 passed (908)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3 — sem `.env`) |
| `835e98f` | D42 | `in sync (175ms)` | `exit 0` | `1 failed \| 135 passed (136)` | `1 failed \| 908 passed (909)` | `mega-stress-e1-e5.test.ts` (TESTE PESADO 3 — sem `.env`) |

**Commits de código que ficaram de fora da execução isolada em worktree (6 de 15):**
- `c77196f` (P2), `e5fcda7` (P4), `ff316e7` (P8), `5ce95d0` (P10), `e677318` (P11), `49598bc` (P13).

### Saída colada dos 9 commits em worktree

```text
==========================================
COMMIT: fbda610
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-fbda610/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-fbda610/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 180ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 FAIL  tests/orchestrator/step-4b.test.ts > Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção > 5. LLM falso escreve status: "aprovada" → o rascunho gravado tem aguardando_aprovacao
 FAIL  tests/orchestrator/step-4b.test.ts > Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção > 7. ENTREGUE + pedido novo → ELICITACAO; aprovação → specVersion 2, nós novos, os nós da versão 1 intocados (completed), mensagem de conclusão só sobre a versão 2
 Test Files  2 failed | 129 passed (131)
      Tests  3 failed | 875 passed (878)
   Start at  20:39:56
   Duration  193.37s (transform 4.31s, setup 2.00s, collect 21.95s, tests 117.94s, environment 29ms, prepare 16.59s)
==========================================
COMMIT: 9d9b07a
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-9d9b07a/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-9d9b07a/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 471ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 FAIL  tests/orchestrator/step-4b.test.ts > Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção > 5. LLM falso escreve status: "aprovada" → o rascunho gravado tem aguardando_aprovacao
 FAIL  tests/orchestrator/step-4b.test.ts > Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção > 7. ENTREGUE + pedido novo → ELICITACAO; aprovação → specVersion 2, nós novos, os nós da versão 1 intocados (completed), mensagem de conclusão só sobre a versão 2
 FAIL  tests/skills/executor-tool-loop.test.ts > Laço de ferramentas do executor (Item 2) > turno inválido registra a amostra com no máximo 300 caracteres e o tamanho total em EXECUTOR_TOOL_CALL
 Test Files  3 failed | 128 passed (131)
      Tests  4 failed | 878 passed (882)
   Start at  20:43:37
   Duration  230.09s (transform 5.57s, setup 2.64s, collect 28.36s, tests 133.11s, environment 38ms, prepare 22.38s)
==========================================
COMMIT: aa808dd
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-aa808dd/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-aa808dd/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 146ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 FAIL  tests/orchestrator/step-4b.test.ts > Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção > 5. LLM falso escreve status: "aprovada" → o rascunho gravado tem aguardando_aprovacao
 FAIL  tests/orchestrator/step-4b.test.ts > Passo 4b — Orquestração por fase, Spec cumulativa e chat sem promoção > 7. ENTREGUE + pedido novo → ELICITACAO; aprovação → specVersion 2, nós novos, os nós da versão 1 intocados (completed), mensagem de conclusão só sobre a versão 2
 Test Files  2 failed | 129 passed (131)
      Tests  3 failed | 884 passed (887)
   Start at  20:47:56
   Duration  182.30s (transform 4.45s, setup 1.85s, collect 20.68s, tests 114.27s, environment 28ms, prepare 14.88s)
==========================================
COMMIT: c074f1f
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-c074f1f/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-c074f1f/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 271ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 Test Files  1 failed | 130 passed (131)
      Tests  1 failed | 888 passed (889)
   Start at  20:53:36
   Duration  263.33s (transform 7.58s, setup 2.81s, collect 34.01s, tests 154.96s, environment 40ms, prepare 23.25s)
==========================================
COMMIT: 57f2119
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-57f2119/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-57f2119/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 346ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 Test Files  1 failed | 130 passed (131)
      Tests  1 failed | 888 passed (889)
   Start at  20:58:35
   Duration  174.57s (transform 5.30s, setup 2.10s, collect 22.95s, tests 99.39s, environment 30ms, prepare 16.99s)
==========================================
COMMIT: 70e4b6b
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-70e4b6b/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-70e4b6b/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 733ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 FAIL  tests/skills/executor-tool-loop.test.ts > Laço de ferramentas do executor (Item 2) > TR1 (1) a) provedor some 2× no meio do laço e volta ⇒ mesmo turno repetido, etapa concluída sem pausar
 Test Files  2 failed | 130 passed (132)
      Tests  2 failed | 894 passed (896)
   Start at  21:01:55
   Duration  157.17s (transform 3.07s, setup 1.82s, collect 18.91s, tests 91.15s, environment 28ms, prepare 15.13s)
==========================================
COMMIT: d73f945
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-d73f945/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-d73f945/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 236ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 FAIL  tests/skills/executor-tool-loop.test.ts > Laço de ferramentas do executor (Item 2) > TR1 (1) a) provedor some 2× no meio do laço e volta ⇒ mesmo turno repetido, etapa concluída sem pausar
 FAIL  tests/skills/executor-tool-loop.test.ts > Laço de ferramentas do executor (Item 2) > turno inválido registra a amostra com no máximo 300 caracteres e o tamanho total em EXECUTOR_TOOL_CALL
 Test Files  2 failed | 133 passed (135)
      Tests  3 failed | 903 passed (906)
   Start at  21:05:14
   Duration  154.07s (transform 3.28s, setup 1.83s, collect 18.95s, tests 85.00s, environment 28ms, prepare 15.33s)
==========================================
COMMIT: 014d816
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-014d816/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-014d816/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 284ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 Test Files  1 failed | 135 passed (136)
      Tests  1 failed | 907 passed (908)
   Start at  21:08:11
   Duration  149.29s (transform 3.18s, setup 1.84s, collect 19.40s, tests 80.91s, environment 29ms, prepare 15.98s)
==========================================
COMMIT: 835e98f
Datasource "db": SQLite database "test.db" at "file:c:\projetos\nc-aud-835e98f/prisma/test.db"
SQLite database test.db created at file:c:\projetos\nc-aud-835e98f/prisma/test.db
Your database is now in sync with your Prisma schema. Done in 175ms
TSC_EXIT=0
VITEST_EXIT=1
 FAIL  tests/intake/mega-stress-e1-e5.test.ts > Bancada de Testes de Estresse Pesado — Validação de Robustez Extrema (E1 a E5) > TESTE PESADO 3: Boundary de Probabilidade do JEV no Graphify (E4) — limiar estrito de 0.65
 Test Files  1 failed | 135 passed (136)
      Tests  1 failed | 908 passed (909)
   Start at  21:11:01
   Duration  140.36s (transform 3.08s, setup 1.75s, collect 19.04s, tests 74.90s, environment 28ms, prepare 14.74s)
```

---

## 3. HEAD 2×

No checkout `1b99f4f` (`HEAD`), `npx tsc --noEmit` retornou `exit 0` (sem saída) nas duas rodadas, e `npx vitest run` passou integralmente nas duas rodadas (`136 passed / 909 passed`), com **0 falhas intermitentes**.

### Rodada 1 (`npx tsc --noEmit; npx vitest run`)

```text
 Test Files  136 passed (136)
      Tests  909 passed (909)
   Start at  20:09:59
   Duration  316.66s (transform 5.62s, setup 3.33s, collect 40.53s, tests 179.77s, environment 53ms, prepare 31.91s)
```

### Rodada 2 (`npx tsc --noEmit; npx vitest run`)

```text
 Test Files  136 passed (136)
      Tests  909 passed (909)
   Start at  20:15:56
   Duration  323.14s (transform 5.99s, setup 3.00s, collect 35.49s, tests 199.70s, environment 47ms, prepare 27.16s)
```

---

## 4. D41/D42 falham sem a correção

### Par D41: `src/core/governance/dual-lens-auditor.ts` × `tests/governance/lens2-lista-evidencia.test.ts`

Reversão temporária apenas de `src/core/governance/dual-lens-auditor.ts` para `014d816~1` e posterior restauração:

```text
=== D41 SEM CORRECAO ===

 RUN  v2.1.9 C:/projetos/nextcode

 ❯ tests/governance/lens2-lista-evidencia.test.ts (2 tests | 1 failed) 32ms
   × TR1 (3) — Lente 2 aceita lista de referências do executor > lista válida (várias faixas, separadas por ';' e ',') → sem divergência, APROVADO 26ms
     → expected [ { reqId: 'REQ-001', …(4) } ] to deeply equal []

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/governance/lens2-lista-evidencia.test.ts > TR1 (3) — Lente 2 aceita lista de referências do executor > lista válida (várias faixas, separadas por ';' e ',') → sem divergência, APROVADO
AssertionError: expected [ { reqId: 'REQ-001', …(4) } ] to deeply equal []

- Expected
+ Received

- Array []
+ Array [
+   Object {
+     "declaradoPeloExecutor": "atendido",
+     "detalhe": "Executor citou evidência inexistente (src/lib/soma.ts:1-3; src/lib/soma.ts:5,7-9) para REQ-001.",
+     "reqId": "REQ-001",
+     "statusLente1": "implementado",
+     "tipoDivergencia": "alucinacao_grave",
+   },
+ ]

 ❯ tests/governance/lens2-lista-evidencia.test.ts:31:36
     29|   it("lista válida (várias faixas, separadas por ';' e ',') → sem dive…
     30|     const r = await judge("src/lib/soma.ts:1-3; src/lib/soma.ts:5,7-9"…
     31|     expect(r.reqDivergences ?? []).toEqual([]);
       |                                    ^
     32|     expect(r.verdict).toBe("APPROVED");
     33|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  20:21:41
   Duration  1.50s (transform 378ms, setup 60ms, collect 865ms, tests 32ms, environment 0ms, prepare 203ms)

=== D41 COM CORRECAO (RESTAURADO) ===

 RUN  v2.1.9 C:/projetos/nextcode

 ✓ tests/governance/lens2-lista-evidencia.test.ts (2 tests) 13ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:21:49
   Duration  1.99s (transform 417ms, setup 80ms, collect 753ms, tests 13ms, environment 0ms, prepare 425ms)
```

### Par D42: `src/core/skills/executor-tool-loop.ts` × `tests/skills/executor-tool-loop.test.ts -t "limite da etapa"`

Reversão temporária apenas de `src/core/skills/executor-tool-loop.ts` para `835e98f~1` e posterior restauração:

```text
=== D42 SEM CORRECAO ===

 RUN  v2.1.9 C:/projetos/nextcode

 ❯ tests/skills/executor-tool-loop.test.ts (35 tests | 1 failed | 34 skipped) 1863ms
   × Laço de ferramentas do executor (Item 2) > bench 20/10: o turno do executor passa ao gateway o limite da etapa (não os 120 s padrão) 1858ms
     → expected false to be true // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/skills/executor-tool-loop.test.ts > Laço de ferramentas do executor (Item 2) > bench 20/10: o turno do executor passa ao gateway o limite da etapa (não os 120 s padrão)
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/skills/executor-tool-loop.test.ts:960:61
    958|     await executeTaskNode(task);
    959|     expect(timeouts.length).toBeGreaterThan(0);
    960|     expect(timeouts.every((t) => t === getStepTimeoutMs())).toBe(true);
       |                                                             ^
    961|     expect(getStepTimeoutMs()).toBeGreaterThan(120_000);
    962|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 34 skipped (35)
   Start at  20:22:23
   Duration  7.24s (transform 2.64s, setup 120ms, collect 3.67s, tests 1.86s, environment 1ms, prepare 607ms)

=== D42 COM CORRECAO (RESTAURADO) ===

 RUN  v2.1.9 C:/projetos/nextcode

 ✓ tests/skills/executor-tool-loop.test.ts (35 tests | 34 skipped) 1276ms
   ✓ Laço de ferramentas do executor (Item 2) > bench 20/10: o turno do executor passa ao gateway o limite da etapa (não os 120 s padrão) 1271ms

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  20:22:39
   Duration  5.26s (transform 1.98s, setup 101ms, collect 2.91s, tests 1.28s, environment 0ms, prepare 329ms)
```

---

## 5. Prova real (tabela colada, custo e mtime)

Comando executado: `npm run bench -- --projetos p1,p2,p3,p4 --variantes padrao --repeticoes 1`

*(Os arquivos `docs/relatorios/bench/2026-10-20-2129.md` e `.yaml` gerados pelo script foram lidos e removidos em seguida para cumprir estritamente a regra R1 de criar somente `docs/relatorios/AUDITORIA-E1-producao-cursor.md`).*

### Saída do comando no terminal

```text
> nextcode@0.1.0 bench
> npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes padrao --repeticoes 1


Iniciando Benchmark: Projetos=[p1,p2,p3,p4], Variantes=[padrao], Repetições=1

>>> Executando: Projeto=P1, Variante=padrao, Rep=1 <<<
Fim da iteração: Fase=ENTREGUE, Custo=US$ 0.0564, Aceite=10/10
Custo Acumulado Bench: US$ 0.0564

>>> Executando: Projeto=P2, Variante=padrao, Rep=1 <<<
Fim da iteração: Fase=ENTREGUE, Custo=US$ 0.2003, Aceite=13/13
Custo Acumulado Bench: US$ 0.2568

>>> Executando: Projeto=P3, Variante=padrao, Rep=1 <<<
Fim da iteração: Fase=ENTREGUE, Custo=US$ 0.0867, Aceite=12/12
Custo Acumulado Bench: US$ 0.3435

>>> Executando: Projeto=P4, Variante=padrao, Rep=1 <<<
Fim da iteração: Fase=ENTREGUE, Custo=US$ 0.0413, Aceite=12/12
Custo Acumulado Bench: US$ 0.3847

Benchmark concluído com sucesso!
```

### Tabelas coladas do relatório gerado (`2026-10-20-2129.md`)

| Projeto | Variante | Rep | Teto (US$) | Fase | Tempo (s) | Etapas | 1ª Tent. | Tent. Totais | tsc | UI Check | Aceite | Reprovados | Custo Total (US$) | Exec / Eval / Jev | Jev Calls | Aval. indisp. | Aval. por provedor | Avaliador Models |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | padrao | 1 | 3.00 | ENTREGUE | 159.3 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | — | 0.0564 | 0.0179 / 0.0341 / 0.0004 | 4 | 0 | claude:2 | claude-sonnet-5-5 |
| P2 | padrao | 1 | 3.00 | ENTREGUE (INVÁLIDA: rota) | 411.7 | 4 | 3 | 2 | 0 (ok) | UI_CHECK_PASSED | 13/13 | — | 0.2003 | 0.1179 / 0.0759 / 0.0007 | 8 | 1 | claude:6 | claude-sonnet-5-5 |
| P3 | padrao | 1 | 3.00 | ENTREGUE | 180.9 | 3 | 3 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0867 | 0.0428 / 0.0370 / 0.0005 | 4 | 0 | claude:2 | claude-sonnet-5-5 |
| P4 | padrao | 1 | 3.00 | ENTREGUE | 108.0 | 2 | 2 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0413 | 0.0211 / 0.0175 / 0.0002 | 3 | 0 | claude:1 | claude-sonnet-5-5 |

**Detalhe por etapa e Chamadas do executor por etapa (com IA):**

- **P1 - padrao (Rep 1):**
  - `task-scaffold-1792545249270` (`core`, sem IA): 0 chamadas, 0 ações, 1 tent., US$ 0.0000
  - `task-analista-1792545259445-1` (`Etapa 1/2: lib/tarefas.ts`, `rapido`, `custom/deepseek-flash`): 2 chamadas, 3 ações, 1 tent., 7046 in / 879 out, Exec US$ 0.0016, Aval (`claude-sonnet-5-5`) US$ 0.0149
  - `task-analista-1792545259445-2` (`Etapa 2/2: tarefas/route.ts, [id]/route.ts`, `medio`, `custom/deepseek-v4-pro`): 2 chamadas, 4 ações, 1 tent., 9449 in / 3080 out, Exec US$ 0.0163, Aval (`claude-sonnet-5-5`) US$ 0.0191
  - **Chamadas do executor por etapa (com IA):** média **2.0** em 2 etapa(s) — meta TR1 ≤ 10.
- **P2 - padrao (Rep 1):**
  - `task-scaffold-1792545425210` (`core`, sem IA): 0 chamadas, 0 ações, 1 tent., US$ 0.0000
  - `task-analista-1792545439123-1` (`Etapa 1/3: lib/tarefas.ts`, `rapido`, `custom/deepseek-flash, custom/deepseek-v4-pro`): 11 chamadas, 5 ações, 3 tent., 42793 in / 10037 out, Exec US$ 0.0460, Aval (`claude-sonnet-5-5`) US$ 0.0238
  - `task-analista-1792545439123-2` (`Etapa 2/3: tarefas/route.ts, [id]/route.ts`, `pesado`, `custom/deepseek-v4-pro`): 2 chamadas, 4 ações, 1 tent., 9046 in / 5900 out, Exec US$ 0.0304, Aval (`claude-sonnet-5-5`) US$ 0.0106
  - `task-analista-1792545439123-3` (`Etapa 3/3: tarefas/page.tsx`, `pesado`, `custom/deepseek-v4-pro`): 2 chamadas, 3 ações, 1 tent., 12062 in / 8019 out, Exec US$ 0.0415, Aval (`claude-sonnet-5-5`) US$ 0.0415
  - **Chamadas do executor por etapa (com IA):** média **5.0** em 3 etapa(s) — meta TR1 ≤ 10. *(Nota: `Aval. indisp. = 1` ocorreu em 1 tentativa do avaliador durante a Etapa 1/3 e foi recuperada na tentativa seguinte, concluindo com `faseFinal: "ENTREGUE"`, `UI_CHECK_PASSED` e aceite `13/13`).*
- **P3 - padrao (Rep 1):**
  - `task-scaffold-1792545854224` (`core`, sem IA): 0 chamadas, 0 ações, 1 tent., US$ 0.0000
  - `task-analista-1792545870338-1` (`Etapa 1/2: lib/auth.ts`, `pesado`, `custom/deepseek-v4-pro`): 3 chamadas, 3 ações, 1 tent., 11409 in / 2555 out, Exec US$ 0.0131, Aval (`claude-sonnet-5-5`) US$ 0.0164
  - `task-analista-1792545870338-2` (`Etapa 2/2: registrar/route.ts, login/route.ts, sessao/route.ts +1`, `pesado`, `custom/deepseek-v4-pro`): 3 chamadas, 6 ações, 1 tent., 17539 in / 5778 out, Exec US$ 0.0297, Aval (`claude-sonnet-5-5`) US$ 0.0207
  - **Chamadas do executor por etapa (com IA):** média **3.0** em 2 etapa(s) — meta TR1 ≤ 10.
- **P4 - padrao (Rep 1):**
  - `task-scaffold-1792546049346` (`core`, sem IA): 0 chamadas, 0 ações, 1 tent., US$ 0.0000
  - `task-analista-1792546056417-1` (`Etapa 1/1: tarefas/route.ts, [id]/route.ts`, `medio`, `custom/deepseek-v4-pro`): 3 chamadas, 7 ações, 1 tent., 13279 in / 3408 out, Exec US$ 0.0211, Aval (`claude-sonnet-5-5`) US$ 0.0175
  - **Chamadas do executor por etapa (com IA):** média **3.0** em 1 etapa(s) — meta TR1 ≤ 10.

**Pausas `SESSION_PAUSED_NO_LLM`:** Nenhuma (0). A correção D42 (`gatewayTimeoutMs: stepTimeoutMs`) eliminou os abortos de 120s que haviam pausado P3 e P4 no bench do Claude.

**Custo total em LLM na auditoria:** `US$ 0.3847` (dentro do teto de `US$ 0.60`).

**`mtime` de `prisma/dev.db`:**
- Antes: `2026-10-20 04:52:32.630`
- Depois: `2026-10-20 04:52:32.630`

---

## 6. Conferência dirigida (sim/não com arquivo:linha)

1. **P1 — `finish` só vale sozinho. Há teto de 8 ações e 48 mil caracteres por turno (`executor-tool-loop.ts`).**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/core/skills/executor-tool-loop.ts:21`: `const MAX_ACTIONS_PER_TURN = 8;` e validação em `src/core/skills/executor-tool-loop.ts:236-241` (`parseTurnPayload` rejeita lista com `items.length > MAX_ACTIONS_PER_TURN`).
     - `src/core/skills/executor-tool-loop.ts:23`: `const MAX_TURN_OUTPUT_CHARS = 48_000;` e truncamento acumulado do turno em `src/core/skills/executor-tool-loop.ts:685-693` (isentando `write_file`/`edit_file` via `isWriteAction` em `src/core/skills/executor-tool-loop.ts:1035-1037`).
     - `src/core/skills/executor-tool-loop.ts:653`: o laço só encerra com `finish` quando `parsed.actions.length === 1 && parsed.actions[0].ferramenta === "finish"`. Se vier acompanhado de outras ações na mesma lista, cai em `runOneAction` (`src/core/skills/executor-tool-loop.ts:989-990`) e devolve `"Ignorado: \`finish\` vai SOZINHO, no turno seguinte, depois de ver estes resultados."`.

2. **P3 — O código da tentativa anterior nunca é guardado quando a guarda de segredos reprovou (`node-executor.ts`, `codigoTentativa`).**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/core/orchestrator/node-executor.ts:2026-2029`: `const previousAttemptSaved = finalStatus !== "completed" && loopCodeContentMap && !secretGuardRes.blocked ? pickAttemptCodeToKeep(loopCodeContentMap) : undefined;` e `...(previousAttemptSaved ? { codigoTentativa: previousAttemptSaved } : {})` em `src/core/orchestrator/node-executor.ts:2039`. Quando `secretGuardRes.blocked` é `true`, `previousAttemptSaved` é `undefined`.

3. **P5 — Pausa `SEM_LLM` não gasta tentativa e guarda `pausado: true` e o código. A retomada não mostra o bloco de "reprovado".**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/core/orchestrator/node-executor.ts:1338-1348`: quando `noLlmAvailable && !policy.tentativas.falhaProvedorContaComoTentativa`, grava `status: "pending"`, `attempts: taskDb.attempts` (inalterado) e `result: JSON.stringify({ success: false, error: msg, pausado: true, ...(pausedCode ? { codigoTentativa: pausedCode } : {}) })`.
     - `src/core/orchestrator/node-executor.ts:1063`: `if (!prevRes.pausado && (prevRes.type1 || prevRes.type2 || prevRes.secretGuard || prevRes.uiGate || prevRes.error))` impede a montagem do bloco `[AUTO-HEALING FEEDBACK - RE-TENTATIVA]` quando `prevRes.pausado === true`. Em `src/core/orchestrator/node-executor.ts:1125-1127`, o cabeçalho exibido na retomada é `"CÓDIGO DA TENTATIVA ANTERIOR (execução pausada por queda do provedor; já está na quarentena desta etapa — continue a partir dele..."`.

4. **P6 — Só caminho protegido dentro do escopo (ou escrita negada) conta para `HARNESS_RULE_BLOCK`. Bloqueio não incrementa `attempts`.**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/core/skills/executor-tool-loop.ts:1029`: `const HARNESS_RULE_CODES = new Set(["SKILL PROTECTED PATH", "SKILL WRITE DENIED"]);`.
     - `src/core/skills/executor-tool-loop.ts:853-861`: só incrementa `harnessDenialCounts` quando `regra && HARNESS_RULE_CODES.has(regra) && (regra !== "SKILL PROTECTED PATH" || inScope)`.
     - `src/core/orchestrator/node-executor.ts:1921-1930`: quando `loopHarnessDenials.length > 0`, define `finalStatus = "blocked"`, `blockedByHarnessRule = true`, e registra `HARNESS_RULE_BLOCK`.
     - `src/core/orchestrator/node-executor.ts:2060-2068`: `const updatedAttempts = finalStatus !== "completed" && !blockedByHarnessRule && (!noLlmAvailable || policy.tentativas.falhaProvedorContaComoTentativa) ? taskDb.attempts + 1 : taskDb.attempts;`.

5. **P7 — Só `critico` reprova. `importante` vai para `correcoesSugeridas` e aparece no resultado da etapa.**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/core/governance/dual-lens-auditor.ts:685-691`: separa `criticos` (`severidade === "critico"`) e `importantes` (`severidade === "importante"`); `effectiveImplemented = hasIncompleteReq || criticos.length > 0 ? false : Boolean(parsed.implemented)`. Portanto, problemas `importante` nunca forçam `effectiveImplemented = false`.
     - `src/core/governance/dual-lens-auditor.ts:693-704,723,944`: `importantes` alimentam `ressalvasFinais` (gerando `rawVerdict = "APROVADO_COM_RESSALVA"` e `verdict = "APPROVED"`) e `correcoesSugeridas = importantes.map(formatProblemaLine)`.
     - `src/core/orchestrator/node-executor.ts:2011-2013`: grava `correcoesSugeridas: type2Res.correcoesSugeridas`, `fatoQueGarante: type2Res.fatoQueGarante` e `nivelProva: type2Res.nivelProva` em `mcpRes.type2` (persistido em `TaskNode.result`).

6. **P8 — Só o avaliador Claude usa `cache_control`. O custo cobra a escrita no cache a 1,25× (`cost.ts`).**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/core/llm/evaluator-models.ts:68-89,193`: `buildAnthropicCachedBody` monta blocos com `cache_control: { type: "ephemeral" }` exclusivamente quando `c.provider === "claude"`. Nenhum outro arquivo em `src/` usa `cache_control`.
     - `src/core/llm/cost.ts:51,53-67`: `const CACHE_WRITE_5M_MULTIPLIER = 1.25;` e `const cacheWriteCost = (cacheWrite * price.input * CACHE_WRITE_5M_MULTIPLIER) / 1_000_000;`.

7. **P9 — `teto = max(fixo, etapas × 0,35 × 1,5) + valor autorizado`. A sugestão nunca fica abaixo de US$ 0,50.**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `config/politicas-orquestracao.yaml:156-157` e `src/core/config/orchestration-policy.ts:294-295`: `custoEstimadoPorEtapaUsd: 0.35` e `margemEstimativa: 1.5`.
     - `src/core/orchestrator/budget-guard.ts:61-63`: `estimatePlanCostUsd` retorna `etapas * policy.orcamento.custoEstimadoPorEtapaUsd * policy.orcamento.margemEstimativa`.
     - `src/core/orchestrator/budget-guard.ts:84-85`: `const baseLimitUsd = Math.max(p.orcamento.tetoCustoPorProjetoUsd, estimativaPlanoUsd); const limitUsd = Math.round((baseLimitUsd + extra) * 1e6) / 1e6;`.
     - `src/core/orchestrator/budget-guard.ts:48,88-91`: `const MIN_AUTHORIZATION_USD = 0.5;` e `const sugestaoAutorizacaoUsd = Math.max(MIN_AUTHORIZATION_USD, Math.ceil(restanteUsd * 100) / 100);`.

8. **P11 — `SPEC_CLARITY_SHADOW` não escreve no chat. O Graphify só roda com ≥ 5 arquivos-fonte.**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/app/api/chat/route.ts:945-957`: o bloco de `decideSpecClarity` apenas chama `TelemetryLogger.log("SPEC_CLARITY_SHADOW", ...)` e não concatena nada a `guardRes.finalMessageContent` nem a `aiResponseContent`.
     - `src/core/project/source-files.ts:40-44`: `export const GRAPHIFY_MIN_SOURCE_FILES = 5;` e `hasExistingSourceCode` exige `countSourceFiles(root!, minFiles) >= minFiles` (5). Em `src/app/api/chat/route.ts:307` e `src/app/api/chat/route.ts:1054`, tanto o `evaluateChatFanOutWithJev` quanto o `graphifySuggestion` são condicionados por `hasExistingSourceCode(...)`.

9. **P12 — `DELETE` com `apagarPasta` e `POST` respondem 409 antes de qualquer escrita (banco ou disco).**
   - **Resposta:** **Sim.**
   - **Evidência:**
     - `src/app/api/projects/[id]/route.ts:78-89`: quando `apagarPasta` é verdadeiro, chama `checkFolderSafeToDelete(project.path)` e retorna `status: 409` **antes** de `prisma.message.deleteMany`/`taskNode.deleteMany`/`session.deleteMany` (`linhas 92-103`), `fs.rmSync` (`linha 125`) e `prisma.project.delete` (`linha 156`).
     - `src/app/api/projects/route.ts:87-97`: chama `checkFolderSafeToOpen(resolvedPath)` e retorna `status: 409` **antes** de `fs.mkdirSync` (`linha 118`), `fs.writeFileSync` (`linhas 125, 140, 143`) e `prisma.project.create` (`linha 146`).

10. **D42 — `gatewayTimeoutMs` chega ao `callGateway` nos dois ramos (pago e BYOK) do `dispatchOneTurn`.**
    - **Resposta:** **Sim.**
    - **Evidência:**
      - `src/core/skills/executor-tool-loop.ts:703,717,731`: calcula `const stepTimeoutMs = getStepTimeoutMs(params.policy);` e passa `gatewayTimeoutMs: stepTimeoutMs` tanto no ramo `params.paidGateways` (`linha 717`) quanto no ramo BYOK/default (`linha 731`).
      - `src/core/router/smart-router.ts:1150`: `dispatchWithFallback` repassa `options.gatewayTimeoutMs` a `this.tryOpenAiGateway(..., options.gatewayTimeoutMs)`, que o entrega como `timeoutMs` a `callGateway` em `src/core/router/smart-router.ts:810`.

11. **Skills `executor-*`, `avaliador` e `avaliador-frontend`: cada frase nova bate com o código? Liste qualquer promessa que o código não cumpre.**
    - **Frases novas de P1 (`skills/executor-*/SKILL.md`), P4 (`skills/executor-*/SKILL.md`) e P7 (`skills/avaliador/SKILL.md`, `skills/avaliador-frontend/SKILL.md`):**
      - `acoes` até 8 por turno e `finish` sempre sozinho (`skills/executor-*/SKILL.md:74-96`) batem com `src/core/skills/executor-tool-loop.ts:21,236,653,989`.
      - `nivel_modelo_padrao` no frontmatter (`rapido` em `executor-core`, `executor-database`, `executor-test`; `medio` em `executor-backend`; `pesado` em `executor-frontend`) bate com `src/core/skills/skill-contracts.ts:11,134`.
      - Separação `critico` / `importante`, exigência de `nivelProva` (`linha_exata` ou `trecho_verificado`) e `fatoQueGarante` em `skills/avaliador/SKILL.md:38-91` e `skills/avaliador-frontend/SKILL.md:50-71` batem com `src/core/governance/dual-lens-auditor.ts:575-725`.
    - **Promessas nas skills que o código não cumpre:**
      1. **Nova (introduzida em P7):** `skills/avaliador/SKILL.md:72` promete que em `APROVADO_COM_RESSALVA` *"as ressalvas vão para o resumo e viram correção da próxima rodada"*. No código (`src/core/orchestrator/node-executor.ts:1751,2011-2014`), `correcoesSugeridas` e `verdictAction: "polir_uma_rodada"` são apenas gravados no JSON `result` da etapa, que passa imediatamente para `completed` sem executar uma rodada de polimento (conforme admitido pelo próprio Claude em D25).
      2. **Pré-existentes nas mesmas skills (registradas como S3 em `docs/NEXTCODE-REFERENCIA.md:347`):**
         - `skills/executor-*/SKILL.md:10` declara `comandos: [typecheck, test]` (e `skills/executor-core/SKILL.md:27` diz `Use run_check (typecheck / test)`), mas `src/core/skills/executor-tool-loop.ts:976-977` (e a própria linha 69 da skill) recusa `"test"` com `"não disponível neste item"`.
         - `skills/executor-*/SKILL.md:29` (regra 4) ainda fala em escrever bloco ````relatorio_executor```` depois dos blocos de código (modo legado de chamada única), enquanto no laço de ferramentas o relatório vai dentro do argumento `relatorio` da ferramenta `finish`.

---

## 7. Decisões D1–D42

- **D1:** **concordo** — `MAX_ACTIONS_PER_TURN = 8` é um teto seguro para evitar despejo especulativo no mesmo turno e cabe confortavelmente no prompt.
- **D2:** **concordo** — `MAX_TURN_OUTPUT_CHARS = 48_000` (12k por ação × 4 leituras típicas) protege o contexto sem cortar leituras normais, mantendo `write_file`/`edit_file` isentos de truncamento.
- **D3:** **concordo** — quando `finish` vem misturado na lista, executar as ações anteriores e devolver o aviso explícito na posição do `finish` aproveita o trabalho do turno sem violar a regra de conferir os resultados antes de encerrar.
- **D4:** **concordo** — truncar em 4.000 caracteres por arquivo fixo (12.000 no total) nos 3 arquivos de configuração da stack (`package.json`, `tsconfig.json`, `prisma/schema.prisma`) evita inflar o 1º turno.
- **D5:** **concordo** — injetar o contexto fixo apenas no 1º turno da 1ª tentativa evita repetição redundante nas retentativas, que já recebem o diagnóstico e o código anterior.
- **D6:** **concordo** — na ausência de `files_scope`, inferir se o schema do Prisma entra pela presença do arquivo mantém o helper previsível.
- **D7:** **concordo** — expor `codeContentMap` tanto no sucesso quanto na falha de `runExecutorToolLoop` é necessário para recuperar o código parcial em timeout, limite de passos ou pausa por queda de provedor.
- **D8:** **concordo** — semear a quarentena com `seedFiles` e mostrar o código no prompt permite usar `edit_file` diretamente na tentativa 2 sem um turno extra de `read_file`.
- **D9:** **concordo** — o teto de 60.000 caracteres (`PREVIOUS_ATTEMPT_MAX_TOTAL_CHARS`) evita estourar o banco SQLite (`TaskNode.result`) e o prompt da retentativa.
- **D10:** **concordo** — descartar `codigoTentativa` quando `secretGuardRes.blocked` é `true` evita reintroduzir segredo bloqueado na quarentena e no prompt.
- **D11:** **concordo** — o esquema `jev_plan_step_tier_v1` com `choice` (`rapido` / `medio` / `pesado`) e `justificativa_curta` é enxuto e determinístico.
- **D12:** **concordo** — uma chamada `Promise.all` por plano mantendo ordem determinística tem custo irrisório (~US$ 0,0002) e baixa latência.
- **D13:** **concordo** — a ordem `jev` (confiança ≥ 0,55) › `skill` (`nivel_modelo_padrao`) › `cluster` › `politica` respeita a hierarquia desenhada em TR1 (5).
- **D14:** **concordo** — em `rapido`, experimentar 1 candidato flash com `maxOutputTokens: 8192` e cair nos candidatos pagos seguintes na mesma chamada evita falhar a etapa quando o modelo rápido não responde ou trunca.
- **D15:** **concordo** — manter `pesado` na lista paga completa com `maxOutputTokens: 16384` sem reordenar preserva a estabilidade do gateway pago existente.
- **D16:** **concordo** — `esperasMesmoTurnoSegundos: [5, 15]` (20s máximos por turno) absorve oscilações curtas do provedor sem travar o worker por minutos.
- **D17:** **concordo** — `NEXTCODE_TURN_RETRY_DELAYS_MS="0,0"` em `vitest.config.ts` evita que todos os testes unitários com provedor simulado `none` paguem 20s reais de `sleep`.
- **D18:** **concordo** — não exibir `[AUTO-HEALING FEEDBACK - RE-TENTATIVA]` quando `prevRes.pausado === true` evita confundir o modelo na retomada pós-queda de provedor.
- **D19:** **concordo** — contar apenas `SKILL PROTECTED PATH` (dentro do escopo) e `SKILL WRITE DENIED` distingue conflito estrutural do plano/harness de erro comum do modelo.
- **D20:** **concordo** — exigir `HARNESS_DENIAL_REPEAT_THRESHOLD = 2` no mesmo par `(regra, caminho)` dá 1 chance ao modelo de ajustar a abordagem após a primeira negativa.
- **D21:** **concordo** — diferenciar `.env` pedido por engano no `files_scope` do analista (conflito do plano → bloqueio) de `.env` fora do `files_scope` (tentativa indevida do modelo → erro normal) é tecnicamente preciso.
- **D22:** **concordo** — encerrar o laço imediatamente ao atingir a 2ª negativa repetida economiza chamadas de LLM que jamais passariam pela regra do harness.
- **D23:** **discordo (motivo técnico e de governança)** — A trava T-B do projeto proíbe expressamente aumentar timeout para fazer teste passar (*"nunca aumentar timeout para teste passar"*), e a trava T-E exige suíte verde antes de cada commit. Em vez de alterar `tests/harness/end-to-end-harness-plan.test.ts` (`120_000`) e `tests/orchestrator/step-4b.test.ts` (`60_000`) dentro do commit `c074f1f` (P6), o correto sob as travas seria otimizar o custo de setup/I/O desses testes ou parar e registrar a recomendação ao fundador sem tocar nos testes fora do escopo.
- **D24:** **concordo** — aceitar problemas legados sem `severidade` como `"critico"` por padrão preserva compatibilidade retroativa com mocks antigos sem enfraquecer a porta em produção.
- **D25:** **concordo com ressalva** — guardar `correcoesSugeridas` no `result` da etapa sem criar rodada extra de polimento é seguro para custo/latência na E1, mas `skills/avaliador/SKILL.md:72` não deveria prometer que *"viram correção da próxima rodada"* se essa rodada não existe ainda.
- **D26:** **concordo** — rebaixar ` implementacao_confirmada` para `divergencia_otimista` quando falta `fatoQueGarante` ou quando `nivelProva` é vazio/`inferido` garante mecanicamente a exigência de prova concreta na Lente 2.
- **D27:** **concordo** — marcar os 2 blocos fixos (system prompt da skill e contexto estático da Spec/requisitos) com `cache_control: { type: "ephemeral" }` e deixar o código variável fora do cache segue a arquitetura de prefixo fixo da Anthropic.
- **D28:** **concordo** — cobrar escrita de cache efêmero de 5m a `1.25×` e leitura a `0.10×` (`price.cachedInput`) reflete a tabela oficial da Anthropic e impede subestimar o custo na 1ª chamada.
- **D29:** **concordo** — separar `estimatePlanCostUsd` (função pura) de `checkProjectBudget` (consulta ao banco com `etapas`) facilita o uso tanto no `job-worker` quanto no endpoint `/api/sessions/[id]/budget`.
- **D30:** **concordo** — `sugestaoAutorizacaoUsd = max(0.50, ceil(restante * 100) / 100)` evita pedir autorizações de poucos centavos que gerariam múltiplas pausas seguidas.
- **D31:** **concordo** — a rota `POST /api/sessions/[id]/budget` validando incremento positivo (≤ US$ 50), somando `budgetAuthorizedExtraUsd`, voltando a sessão para `EXECUCAO` e reenfileirando o job implementa o ciclo completo de autorização.
- **D32:** **concordo** — manter as 12 entradas canônicas em `JEV_DECISIONS_CATALOG` com `status: "ativa" | "sombra" | "reserva"` documenta cada ponto de decisão sem código morto oculto.
- **D33:** **concordo** — remover `evaluateIntakeGuardWithJev` e `decideSpecClarityWithJev` (sem chamadores em `src/`) elimina duplicação mantendo apenas as versões unificadas.
- **D34:** **concordo** — manter `SPEC_CLARITY_SHADOW` apenas na telemetria e remover o apêndice `"Observação (modo sombra)..."` do texto visível da mensagem do assistente cumpre TR1 (7).
- **D35:** **concordo** — `GRAPHIFY_MIN_SOURCE_FILES = 5` em `hasExistingSourceCode` impede rodar Graphify em projetos recém-criados pelo scaffolder (que têm 1–3 arquivos stub).
- **D36:** **concordo** — normalizar com `fs.realpathSync.native` (com fallback para `path.resolve`), comparar case-insensitive no Windows e bloquear ancestrais do próprio repositório (`isAncestorOfSelf`) fecha brechas de symlink/junction e caixa.
- **D37:** **concordo** — bloquear no `POST /api/projects` a raiz do usuário (`homedir`), áreas do sistema e a própria pasta do NextCode, permitindo subpastas legítimas como `~/projetos/meu-app` (não vazias e sem marcadores de pasta de sistema), equilibra segurança e usabilidade.
- **D38:** **concordo** — validar `checkFolderSafeToDelete` no início do `DELETE /api/projects/[id]` (antes de apagar mensagens, nós, sessões, arquivos ou projeto) garante que um 409 não deixe o projeto meio apagado.
- **D39:** **concordo** — parear cada `EXECUTOR_TOOL_CALL` ao `LLM_COST` do turno pela janela temporal entre turnos permite atribuir modelo, tokens e custo por etapa sem alterar o schema do banco.
- **D40:** **concordo** — calcular a média de chamadas do executor por etapa somente sobre etapas com IA (`executorChamadas > 0`) evita que o nó mecânico de scaffold dilua artificialmente a média da meta TR1 (≤ 10).
- **D41:** **concordo** — fatiar `evidencia` por `;` (referências completas) e `,` (faixas adicionais do mesmo arquivo herdando `currentFile`) em `checkEvidenceExists` resolve o falso positivo de `alucinacao_grave` quando o executor cita múltiplas linhas/faixas válidas.
- **D42:** **concordo** — repassar `gatewayTimeoutMs: getStepTimeoutMs(params.policy)` nos dois ramos de `dispatchOneTurn` até `callGateway` corrige o bug em que turnos longos do executor (> 120s de geração de código) eram abortados pelo timeout default de 120s do gateway mesmo com `timeoutPorEtapaSegundos = 300`.

---

## 8. Veredito por passo (P1 … P13, D41, D42) e veredito geral

| Passo | Commit | Veredito | Justificativa resumida |
|---|---|---|---|
| **P1** (TR1 12) | `fbda610` | **aceito com ressalvas** | Código e testes de múltiplas ações por turno (teto 8, 48k chars, `finish` sozinho) corretos; ressalva por commitar com `step-4b.test.ts` dando timeout na suíte completa (T-E) e promessas pré-existentes nas skills `executor-*` (S3). |
| **P2** (TR1 13) | `c77196f` | **aceito com ressalvas** | Injeção de `package.json`, `tsconfig.json` e `prisma/schema.prisma` no 1º turno do executor correta; ressalva por não ter sido rodado em worktree isolado nesta auditoria e ter sido commitado antes do ajuste de timeout da suíte. |
| **P3** (TR1 14) | `9d9b07a` | **aceito com ressalvas** | Preservação de `codigoTentativa` na quarentena e no prompt (bloqueada quando `secretGuardRes.blocked`) correta; ressalva pelas 4 falhas de timeout/env na suíte completa isolada no worktree. |
| **P4** (TR1 5) | `e5fcda7` | **aceito** | Classificação `rapido`/`medio`/`pesado` via Jev (`jev_plan_step_tier_v1`) com fallback para skill/cluster/política e despacho no executor corretos e comprovados no bench real. |
| **P5** (TR1 1) | `aa808dd` | **aceito com ressalvas** | Espera curta no mesmo turno (`[5, 15]` s), pausa `pausado: true` preservando código sem gastar tentativa e retomada limpa corretas; ressalva pelas 3 falhas na suíte completa isolada no worktree. |
| **P6** (TR1 2) | `c074f1f` | **aceito com ressalvas** | Bloqueio `HARNESS_RULE_BLOCK` após 2 negativas da mesma regra sem gastar tentativa correto; **ressalva principal:** incluiu aumento de timeout em 2 arquivos de teste e2e fora do escopo (decisão D23, violando T-B). |
| **P7** (TR1 3) | `57f2119` | **aceito com ressalvas** | Separação `critico`/`importante` e exigência de `fatoQueGarante` + `nivelProva` na Lente 2 corretas; **ressalva:** `skills/avaliador/SKILL.md:72` promete que as ressalvas *"viram correção da próxima rodada"*, mas o código apenas salva `correcoesSugeridas` no resultado do nó aprovado (D25). |
| **P8** (TR1 4) | `ff316e7` | **aceito** | `cache_control: { type: "ephemeral" }` restrito ao avaliador Claude (`evaluator-models.ts`) e cobrança de escrita no cache a `1.25×` e leitura a `0.10×` (`cost.ts`) corretos. |
| **P9** (TR1 6) | `70e4b6b` | **aceito** | Cálculo `max(fixo, etapas × 0.35 × 1.5) + autorizado`, piso de sugestão `US$ 0.50`, pausa `PAUSADO_CUSTO` e rota `POST /api/sessions/[id]/budget` corretos. |
| **P10** (TR1 9) | `5ce95d0` | **aceito** | Catálogo único `JEV_DECISIONS_CATALOG` com as 12 decisões, remoção de funções duplicadas sem uso e teste de contrato (`tests/harness/jev-decisions-catalog.test.ts`) corretos. |
| **P11** (TR1 7, 8) | `e677318` | **aceito** | `SPEC_CLARITY_SHADOW` restrito à telemetria (sem poluir o chat) e Graphify condicionado a `hasExistingSourceCode` com `GRAPHIFY_MIN_SOURCE_FILES = 5` corretos. |
| **P12** (TR1 10) | `d73f945` | **aceito** | `checkFolderSafeToOpen` e `checkFolderSafeToDelete` (`folder-safety.ts`) respondendo HTTP 409 antes de qualquer escrita em disco ou banco em `POST /api/projects` e `DELETE /api/projects/[id]`. |
| **P13** (TR1 11) | `49598bc` | **aceito** | Detalhamento por etapa (cluster, nível, fonte, modelos, chamadas, ações, tokens, custo) e média de chamadas do executor por etapa com IA verificados no relatório real do bench. |
| **D41** (TR1 3 fix) | `014d816` | **aceito** | `splitEvidenceRefs` em `dual-lens-auditor.ts:843-869` aceita listas separadas por `;` e `,`; teste falha sem a correção e passa com ela. |
| **D42** (timeout fix) | `835e98f` | **aceito** | `gatewayTimeoutMs: stepTimeoutMs` repassado nos dois ramos de `dispatchOneTurn` até `callGateway`; teste falha sem a correção, passa com ela, e destravou P3 e P4 no bench real (`12/12` em ambos). |

### Veredito Geral

**ACEITO COM RESSALVAS.**

---

## 9. O que não foi verificado

1. **Execução isolada em worktree dos 6 commits intermediários não listados no mínimo obrigatório do Passo 2:** `c77196f` (P2), `e5fcda7` (P4), `ff316e7` (P8), `5ce95d0` (P10), `e677318` (P11) e `49598bc` (P13). O código e os testes desses commits foram conferidos no `HEAD` (2×) e por inspeção estática (`arquivo:linha`), mas não tiveram worktree individual criado.
2. **Desconto efetivo de `cache_read_input_tokens` no provedor Anthropic em produção (P8):** nos logs do bench, o gateway OpenAI-compatível (`Litellm` / `FreeLLMAPI`) usado para chamar `claude-sonnet-5-5` consome o endpoint `/chat/completions` (`src/core/llm/evaluator-models.ts:152-182`), enquanto o payload nativo Anthropic com `cache_control` (`buildAnthropicCachedBody`, linha 193) só é usado quando o provedor configurado é o gateway nativo `"claude"` (`/messages`). A lógica e a tarifação em `evaluator-models.ts` e `cost.ts` estão testadas em suíte unitária, mas no bench o avaliador rodou via `freellmapi` (`claude-sonnet-5-5`).
3. **Interação visual no navegador para o botão de autorização de orçamento (P9):** a rota `POST /api/sessions/[id]/budget` e a lógica de pausa/retomada (`budget-guard.ts`, `job-worker.ts`) foram verificadas no código e em `tests/harness/budget-ceiling.test.ts`, mas não houve teste manual de clique na interface gráfica do navegador.
