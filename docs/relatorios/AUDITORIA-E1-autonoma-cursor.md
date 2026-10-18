# Auditoria do Cursor — execução autônoma da E1 (mudança 23)

Auditor: Cursor. Partida conferida: `git log -1` = `docs: relatorios da execucao autonoma e prompt de auditoria do Cursor (149)`. `git status --short` só ` M .claude/.headroom_wrap_marker.json` e ` M .serena/project.yml`. Fonte do que o Claude afirma: `docs/relatorios/AUDITORIA-E1-autonoma.md` e `docs/relatorios/DECISOES-AUTONOMAS-E1.md`. Cronograma: `docs/NEXTCODE-REFERENCIA.md` §5.0 (AGORA, checklist da mudança 23, linhas A2 e AV1, mudanças 21–23).

Veredito geral: **aceito com ressalvas**. Portas de LLM (A2.3 e AV1.5) cumpridas nesta auditoria. HEAD compilou e a suíte passou duas vezes. A suíte isolada em worktree não ficou verde (banco sem tabelas). Um caminho do analista (`skipModel`) não grava trilha.

---

## 1. Escopo e histórico

`git log --oneline 7067106..HEAD`:

```
9a4440f docs: relatorios da execucao autonoma e prompt de auditoria do Cursor (149)
c10d3b7 feat(sm1): conferencia mecanica da Spec (...)
3ad117b fix(av1): porteiro so com pasta de projeto vinculada (AV1.4b)
324a586 feat(m20): desliga gravacao e injecao da memoria do projeto (mudanca 20)
5005022 fix(projetos): reabrir so desarquiva e acha a pasta escolhida (PJ1.6b)
42b878e test(av1): controles com defeito plantado no avaliador real, 7/7 (AV1.5)
522f7f8 feat(av1): porteiro tsc+ESLint antes do avaliador (AV1.4)
d3b9f86 feat(av1): avaliador com problemas por severidade e evidencia conferida; skills alinhadas (AV1.3)
37108c9 feat(av1): avaliador nao aprova arquivo que nao leu inteiro (AV1.2)
a06fa8d feat(av1): avaliador Claude Sonnet->Opus, nunca a familia do executor (AV1.1)
f404648 feat(a2): replay real aprovado; prazo do analista e dependencia entre etapas irmas (A2.3)
801864b feat(a2): analista planeja de verdade, codigo confere e monta o Microbrief (A2.2)
3ea5ef9 feat(a2): T8b confere escopo do plano e bloqueia plano impossivel (A2.1)
```

12 commits de código (`3ea5ef9`…`c10d3b7`) mais o commit de relatórios `9a4440f`. Bate com a tabela da seção 1 do relatório do Claude.

`git diff --stat 7067106..c10d3b7` (última linha):

```
46 files changed, 2409 insertions(+), 1056 deletions(-)
```

Igual ao número que o Claude registrou. `git diff --name-only 7067106..c10d3b7`: os 46 caminhos estão nos arquivos citados nas seções do relatório do Claude (src, tests, skills, scripts, docs, memory). Nenhum caminho fora dessa lista nesse intervalo.

`git diff --stat 7067106..HEAD` inclui ainda `docs/prompts/AUDITORIA-E1-autonoma-cursor.md` (commit `9a4440f`): 47 arquivos, +2524 / −1059.

`git reflog -30`: nenhuma linha `amend`, `reset` ou `rebase` (busca vazia). Os 13 commits do intervalo aparecem como `commit:` simples (`HEAD@{0}` = `9a4440f` … `HEAD@{12}` = `3ea5ef9`, `HEAD@{13}` = `7067106`).

---

## 2. Commits isolados

Método: `git worktree add --detach C:\projetos\nc-aud-<hash> <hash>`, junção de `node_modules`, cópia de `prisma/dev.db` (+ `-wal`/`-shm` na 2ª rodada), `DATABASE_URL=file:<cópia>`, `npx tsc --noEmit`, `npx vitest run`. Worktrees removidos no fim (`git worktree list` voltou a só `C:/projetos/nextcode`).

| hash | passo | tsc | vitest (esta auditoria) |
|---|---|---|---|
| `3ea5ef9` | A2.1 | exit 0 | exit 1 — 38 failed / 88 passed (126); 108 failed / 672 passed / 60 skipped (840) |
| `a06fa8d` | AV1.1 | exit 0 | exit 1 — 38 failed / 89 passed (127); 108 failed / 678 passed / 60 skipped (846) |
| `522f7f8` | AV1.4 | exit 0 | exit 1 — 38 failed / 91 passed (129); 108 failed / 688 passed / 60 skipped (856) |
| `3ad117b` | AV1.4b | exit 0 | exit 1 — 38 failed / 91 passed (129); 110 failed / 688 passed / 60 skipped (858) |
| `c10d3b7` | SM1 | exit 0 | exit 1 — 38 failed / 92 passed (130); 110 failed / 693 passed / 60 skipped (863) |

O total de arquivos e de testes de cada commit bate com a tabela do Claude (126/840, 127/846, 129/856, 129/858, 130/863). A falha é a mesma nos cinco: `PrismaClientKnownRequestError` `The table main.Project does not exist` e `no such table: main.TelemetryLog` (`tests/core/session-attach.test.ts` e outros). Duas tentativas (cópia só do `dev.db`; depois `dev.db`+WAL+SHM e `DATABASE_URL` da cópia) deram os mesmos totais. Não é uma regressão que apareça num commit e suma no seguinte.

Fora desta tabela (não rodados isolados): `801864b`, `f404648`, `37108c9`, `d3b9f86`, `42b878e` (o Claude marca este como só script/docs), `5005022`, `324a586`.

---

## 3. HEAD duas vezes

Checkout `9a4440f`. As duas rodadas: `npx tsc --noEmit` exit 0 (saída vazia).

Rodada 1 (`npx vitest run`, exit 0):

```
 Test Files  130 passed (130)
      Tests  863 passed (863)
   Start at  20:41:48
   Duration  229.37s
```

Rodada 2 (exit 0):

```
 Test Files  130 passed (130)
      Tests  863 passed (863)
   Start at  20:45:48
   Duration  225.00s
```

Nenhum teste falhou numa rodada e passou na outra. O caso citado pelo Claude (`end-to-end-harness-plan.test.ts` › "Item 1 (Fila nunca para)") não falhou nestas duas rodadas.

---

## 4. Prova real (LLM)

`prisma/dev.db` mtime antes, depois do replay e depois dos controles: `2026-10-16T21:22:35.4626750-04:00` (igual nas três leituras).

### Replay `npx tsx scripts/replay-analista-a23.ts` (exit 0)

```
quemPlanejou: analista
trilha: ANALISTA_PLAN_APPROVED rodada 1
etapas: 35
reqEmMaisDeUmaEtapa: 0
reqSemEtapa: []
t8bFinal.valid: true
t8bFinal.erros: 0
model: deepseek-v4-pro
usd: 0.116116704
input: 15063
output: 29127
ms: 184776
```

Porta do prompt (t8b válida, 0 REQ em mais de uma etapa, `reqSemEtapa` vazio): cumprida. Nº de etapas 35 (o prompt permite variar).

### Controles `npx tsx scripts/controles-avaliador-av15.ts 1` (exit 0)

`acertos: 7` / `total: 7`. `custoUsd: 0.1075`.

| caso | esperado | obtido | método | reqs / divergência | modelo | usd |
|---|---|---|---|---|---|---|
| 1 correto | APPROVED | APPROVED | llm_blind | 001 implementado, 002 implementado | claude-sonnet-5-5 | 0.00925 |
| 2 POST devolve 200 | REJECTED | REJECTED | llm_blind | 001 parcial · divergencia_otimista | claude-sonnet-5-5 | 0.01018 |
| 3 POST é stub | REJECTED | REJECTED | llm_blind | 001 ausente · alucinacao_grave | claude-sonnet-5-5 | 0.01072 |
| 4 arquivo grande com bug no fim | REJECTED | REJECTED | llm_blind | 001 parcial · divergencia_otimista | claude-sonnet-5-5 | 0.05685 |
| 5 acima do limite | REJECTED | REJECTED | limite_tamanho | — | — | 0 |
| 6 sem validar título + relatório mente | REJECTED | REJECTED | llm_blind | 001 parcial · divergencia_otimista | claude-sonnet-5-5 | 0.01122 |
| 7 citação :999 | REJECTED | REJECTED | llm_blind | 001 implementado · alucinacao_grave | claude-sonnet-5-5 | 0.00925 |

Bate com a tabela AV1.5 do relatório do Claude (caso 1 aprovado; 2–7 reprovados pelo motivo daquela tabela).

Custo desta auditoria: 0,1161 + 0,1075 = **US$ 0,2236** (teto US$ 0,50).

---

## 5. Conferência dirigida

| Pergunta | Sim/não | Evidência |
|---|---|---|
| A2.1 `PLANO_REPROVADO` não cria `TaskNode` | sim | `execution-trigger.ts:417-429` retorna `tasks: []` antes de `taskNode.create` (`:446`) |
| A2.1 aviso ao humano 1 vez | sim no código | um `applyPhaseEvent` (`execution-trigger.ts:423`); `session-phase.ts:178-181` chama `postHumanNotice` uma vez por efeito `AVISAR_HUMANO`; `phase-machine.ts:412-416` emite um efeito. Não há segundo emissor de `PLANO_REPROVADO` em `src/`. A tela não foi aberta |
| A2.2 todo caminho de `decomposeWithAnalistaSkill` grava `ANALISTA_PLAN_*` | não | `skipModel \|\| !smartRouter` retorna `baseDecomp` sem log (`spec-decomposer.ts:395-396`). Os outros caminhos logam: `APPROVED` `:490-494`, `RETRY` `:498-510`, `FALLBACK` `:399-401` (`spec_sem_requisitos` `:407`, skill `:417`, exceção `:469`, rodadas `:522`) |
| AV1.1 produção do avaliador não chama `dispatchWithFallback` | sim | `makeBlindAuditDispatchFn` chama `dispatchStrongEvaluator` (`node-executor.ts:499-501`). `dispatchWithFallback` no avaliador só se `NODE_ENV===test` e `EVALUATOR_STRICT_IN_TESTS!==true` (`:519-521`) |
| AV1.1 família do executor recusada | sim | `evaluator-models.ts:123-125` (`mesma família do executor — recusado`). Retorno Claude: `independent: executorFamily !== "claude"` (`:84`) |
| AV1.2 nenhum trecho de arquivo cortado antes do avaliador | sim para arquivo | `dual-lens-auditor.ts:551-552` cola `content` inteiro. Acima do limite: `validateType2` reprova com `method: "limite_tamanho"` (`:753-765`) sem chamar o LLM. O Brief ainda é cortado em 30_000 caracteres (`:621`) — não é arquivo |
| AV1.3 citação inventada descarta a resposta | sim | `implementado` sem `fileLineRefExists` → `return null` (`:669-670`); problema não-`menor` sem citação válida → `return null` (`:672-673`). `menor` sem linha não descarta |
| AV1.3 problemas decidem como D24 | sim | crítico ou ≥3 importantes → `effectiveImplemented` false → `REPROVADO` (`:681-690`); 1–2 importantes entram em `ressalvasFinais` e o veredito vira `APROVADO_COM_RESSALVA` se o resto passou (`:684-695`) |
| AV1.4/4b porteiro só com pasta de projeto | sim | `node-executor.ts:1297` exige `taskDb.session.project?.path` |
| AV1.4 checkOnly desfaz a promoção | sim | `empirical-gate.ts:107` `if (opts.checkOnly && !result.rolledBack) qm.rollbackPromotion(taskId)` |
| AV1.4 promoção real reaplica e confere de novo | sim | `empirical-gate.ts:122-124` `reapplyPromotion` se a quarentena já foi limpa e há retrato; em seguida `verifyProjectBuild` (`:130`). A 2ª chamada no executor é `promoteWithEmpiricalGate` sem `checkOnly` (`node-executor.ts:1541`) |
| M20 aprovação não grava `.nextcode/MEMORY.md` | sim | `execution-trigger.ts:329-330` não chama `consolidateMemoryFromSpec` (o símbolo não aparece no arquivo). `project-context.ts:172` `memoryContent` fixo `undefined`; `formatProjectContext` (`:196-220`) não imprime memória |
| SM1 (a) ponto no nome com extensão | sim, com teste | `tests/intake/sm1-conferencia-spec.test.ts:27-38` |
| SM1 (b) REQ cita arquivo fora da lista | sim, com teste | mesmo arquivo `:41-53` |
| SM1 (c) data carimbada | sim, com teste | `:56-60` |
| SM1 (d) troca/remoção | sim, com teste | `:63-75` (`REMOVAL_INTENT_REGEX`) |
| SM1 (e) 2ª chamada visível | código sim, teste de rota não | `chat/route.ts:885-889` `SPEC_FIX_CALL`. O arquivo de teste do SM1 não cobre a rota |

### Skills × código

`skills/analista/SKILL.md`: sem ferramentas (`ferramentas: []`, `:11`), 1 passo (`:15`), saída JSON (`:53-60`), regras de arquivo/REQ/dependência alinhadas a `validatePlanStages` / `checkPlanScope`. Frase que o código não cumpre ao pé da letra: frontmatter `nivel_modelo: forte` (`:10`). O dispatch usa `tier: "heavy"` (`spec-decomposer.ts:447`), que resolve `deepseek-v4-pro` (`gateways.ts:59`, `politicas-orquestracao.yaml:87-90`). O corpo da skill não nomeia o modelo.

`skills/avaliador/SKILL.md`: sem ferramentas, arquivo inteiro, Lente 2 no harness, tabela crítico / ≥3 importantes / 1–2 ressalva / menor não conta (`:69-73`) — igual a `dual-lens-auditor.ts:676-695`. Item 4 do porteiro (`:41`) existe no código (`node-executor.ts:1297-1301`).

`skills/avaliador-core/SKILL.md`: o corpo diz que a Lente 2 é do harness (`:41`). O frontmatter ainda descreve "protocolo de duas lentes" (`:5-6`), `passos_max: 25` (`:16`) e `entrada.lente_2_cruzada` (`:22-24`). O caminho do avaliador é uma chamada; `passos_max` não é lido ali.

`skills/avaliador-frontend/SKILL.md`: linha `:58` diz que não faz a Lente 2. A description (`:5-8`) ainda fala em "protocolo de duas lentes" e "auditoria estática das 104 regras"; `passos_max: 35` (`:19`). Referências locais entram no prompt quando `cluster === "frontend"` (`dual-lens-auditor.ts:567-569`). Não verificado se as 104 regras rodam como checagem ou só como texto no prompt.

---

## 6. Decisões D1–D39

Concordo com o motivo técnico registrado, no estado do código em HEAD, salvo o apontamento em D10 (número antigo).

| # | Veredito |
|---|---|
| D1 | concordo — arquivo citado vale na etapa ou num ancestral; é o que `checkPlanScope` aplica (relatório A2.1 + `plan-scope-check.ts`) |
| D2 | concordo — REQ repetido é erro |
| D3 | concordo — arquivo que ninguém produz fica para a Spec (SM1 b), não para o plano |
| D4 | concordo — `PLANO_REPROVADO` → `BLOQUEADA` com `faseAntesDoBloqueio: SPEC_REVISAO` (`phase-machine.ts:412-416`) e sem `TaskNode` |
| D5 | concordo como heurística de reserva (última etapa com arquivo citado; nome genérico não conta). Não prova que o "dono" semântico do REQ esteja certo |
| D6 | concordo — a conferência fica depois de `splitNodesByJev` (`execution-trigger.ts:391-406`) |
| D7 | concordo — replay desta auditoria usou `deepseek-v4-pro` e a T8b aceitou |
| D8 | concordo — o modelo devolve JSON de etapas; o Microbrief é montado no código (`buildDecompositionFromAnalystPlan`, `spec-decomposer.ts:482-489`) |
| D9 | concordo — `ANALISTA_MAX_RODADAS = 3` (`spec-decomposer.ts:638`) |
| D10 | concordo com a decisão da época (sair de 4096/5 s). O número vigente no código é o da D14, não 16_000/240 s |
| D11 | concordo — skill sem ferramentas; o teste de estrutura tirou o analista da lista com ferramentas (relatório A2.2) |
| D12 | concordo — plano tem de cobrir os arquivos da Spec e não inventar |
| D13 | concordo — `recordLlmCost` com `papel: "analista"` (`spec-decomposer.ts:461-466`) |
| D14 | concordo — `ANALISTA_MAX_TOKENS = 32000`, `ANALISTA_TIMEOUT_MS = 300_000` (`:644-649`); `gatewayTimeoutMs` repassado. Replay desta auditoria: aprovado na rodada 1 em 185 s |
| D15 | concordo — `finish_reason === "length"` vira texto `[CORTADA]` (`:476-477`) |
| D16 | concordo como reserva para a T8b ficar válida em etapas irmãs. É heurística, não prova de agrupamento |
| D17 | concordo — controles desta auditoria responderam `claude-sonnet-5-5`; cadeia padrão em `defaultEvaluatorChain` |
| D18 | concordo — recusa por família em `evaluator-models.ts:123-125` |
| D19 | concordo — 404 segue na cadeia; a auto-cura por catálogo não está neste arquivo |
| D20 | concordo em produção — sem `strong.content` o retorno é null, salvo o ramo de teste |
| D21 | concordo — o ramo de teste está fechado por `NODE_ENV` (`node-executor.ts:519`). É código de teste dentro do caminho de produção, como o próprio registro diz |
| D22 | concordo — os testes da cadeia antiga foram reescritos; não reabri o diff teste a teste de cada assert antigo |
| D23 | concordo — inteiro ou `limite_tamanho`; caso 5 dos controles reprovou sem LLM (`usd: 0`) |
| D24 | concordo — ver seção 5 |
| D25 | concordo — citação inválida devolve null; `menor` é exceção |
| D26 | concordo no `skills/avaliador/SKILL.md`. Ressalva: frontmatter de `avaliador-core` e a description de `avaliador-frontend` ainda falam em duas lentes / `passos_max` alto (seção 5) |
| D27 | concordo — Lente 2 continua mecânica; não há 2º LLM por etapa neste caminho |
| D28 | concordo — porteiro reusa `promoteWithEmpiricalGate` com `checkOnly: true` |
| D29 | concordo — reapply + `verifyProjectBuild` de novo (`empirical-gate.ts:122-130`) |
| D30 | concordo com a correção do AV1.4b — sem `project.path` o porteiro não roda (`node-executor.ts:1297`) |
| D31 | concordo — 7 controles, 7/7 nesta auditoria; bench P1–P4 não rodado |
| D32 | concordo no código lido — reabrir faz `update` só de `{ isArchived: false }` (`projects/route.ts:85-89`) e compara pasta pedida e caminho final (`:80-83`) |
| D33 | concordo em não ter feito o smoke de tela nesta execução. Esta auditoria também não abriu a tela |
| D34 | concordo — gravação e injeção desligadas; `project-memory.ts` permanece |
| D35 | concordo — teste (a): `.env.example` aceito, `.env` sozinho não |
| D36 | concordo — teste (b) reprova `vitest.config.ts` fora de `arquivos_afetados` |
| D37 | concordo — teste (c) troca `2025-10-16` por `specDateToday()` |
| D38 | concordo — teste (d) cobre "troque", "substitua", "em vez de", "no lugar" |
| D39 | concordo no código (`SPEC_FIX_CALL` em `chat/route.ts:889`). A rota com Spec real não foi chamada nesta auditoria |

---

## 7. Veredito por passo

| Passo | Veredito | Por quê |
|---|---|---|
| A2.1 | aceito com ressalvas | Código do bloqueio confere. `tsc` isolado 0. Vitest isolado não verde pelo banco do worktree (mesma falha nos 5 commits) |
| A2.2 | aceito com ressalvas | Trilha nos caminhos de LLM e de fallback. `skipModel` / sem router volta à heurística sem `ANALISTA_PLAN_*` |
| A2.3 | aceito | Replay desta auditoria: T8b válida, 0 REQ repetido, `reqSemEtapa` vazio, `ANALISTA_PLAN_APPROVED` na rodada 1, US$ 0,116. Commit `f404648` não rodado isolado |
| AV1.1 | aceito com ressalvas | Produção não cai no roteador; família recusada. Vitest isolado com a falha de banco acima |
| AV1.2 | aceito | Arquivo inteiro ou `limite_tamanho`. Caso 5 dos controles: REJECTED, `usd` 0. Commit `37108c9` não isolado. Brief ainda cortado a 30 mil caracteres |
| AV1.3 | aceito | Citação inventada descarta; D24 no código. Casos 2, 3, 6 e 7 dos controles bateram com a tabela. Commit `d3b9f86` não isolado |
| AV1.4 | aceito com ressalvas | `checkOnly` desfaz; promoção real reaplica e roda o tsc de novo. Vitest isolado com a falha de banco |
| AV1.5 | aceito | 7/7, US$ 0,1075, motivos da tabela |
| PJ1.6b | aceito com ressalvas | Código do POST confere (`projects/route.ts:52-99`). Smoke de tela não feito (D33). Commit `5005022` não isolado |
| M20 | aceito | Sem gravação na aprovação e sem injeção no prompt. Commit `324a586` não isolado |
| AV1.4b | aceito com ressalvas | Porteiro exige pasta do projeto. Vitest isolado com a falha de banco |
| SM1 | aceito com ressalvas | (a)–(d) com teste. (e) só no código da rota; rota com Spec real não chamada |
| Geral | aceito com ressalvas | Portas de LLM cumpridas; HEAD 130/863 nas duas rodadas; ressalvas acima. Não rejeita nenhum passo |

---

## 8. O que não foi verificado

- Vitest verde em cada um dos 12 commits, no próprio commit. Os 5 obrigatórios compilaram; a suíte falhou pelo sqlite do worktree. Sete commits não foram isolados (`801864b`, `f404648`, `37108c9`, `d3b9f86`, `42b878e`, `5005022`, `324a586`).
- O flake "Item 1 (Fila nunca para)" — não apareceu nas duas rodadas do HEAD.
- Bench P1–P4 e teste pesado.
- Smoke da tela (PJ1.5 / D33).
- Rota do chat com Spec real (SM1 e).
- Se as 104 regras do avaliador-frontend são checagem ou só texto no prompt.
- Cada assert reescrito na D22, um a um.
- `passos_max` das skills filhas (não há laço que o leia no avaliador).
