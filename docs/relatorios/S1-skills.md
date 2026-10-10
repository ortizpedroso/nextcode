# Relatório de Execução — Pacote S1: Skills (Ligar e Enxugar)

## 1. Identificação

- **Hash de partida:** `00b8955`
- **Data:** 10/10/2026

### `git log --oneline 00b8955..HEAD`
```text
60e81f0 refactor(skills): S1.3 - avaliadores sem promessas falsas e sem regras duplicadas
2e91335 feat(skills): S1.2 - respostas do Jev decidem referencias do avaliador de tela
4447198 feat(custo): S1.1 - custo por etapa (nodeId) na trilha e no bench
```

### `git reflog -20` (bruto)
```text
60e81f0 HEAD@{0}: commit: refactor(skills): S1.3 - avaliadores sem promessas falsas e sem regras duplicadas
2e91335 HEAD@{1}: commit: feat(skills): S1.2 - respostas do Jev decidem referencias do avaliador de tela
4447198 HEAD@{2}: commit: feat(custo): S1.1 - custo por etapa (nodeId) na trilha e no bench
00b8955 HEAD@{3}: commit: docs: auditoria das skills S0 e prompt S1
885e80e HEAD@{4}: commit: fix(bench): base do P4 com versoes da etapa de base; auditoria do P2b
acb00d6 HEAD@{5}: commit: docs(relatorio): P2b
1337edc HEAD@{6}: commit: docs(bench): rodada P3/P4 com 3 repeticoes
efd8c1c HEAD@{7}: commit: feat(bench): P2b.1 - projetos P3 e P4, falha registrada sem parar, coluna de reprovados
8e284fb HEAD@{8}: commit: feat(bench): regua P3 (login) e P4 (correcao) provadas, specs e base com bugs; prompt P2b
cb6faf6 HEAD@{9}: commit: docs: auditoria do P2 (bench), medicoes da 1a rodada, decisao das skills, proposta P2b
74d1e9a HEAD@{10}: commit: docs(relatorio): P2
925ba54 HEAD@{11}: commit: docs(bench): primeira rodada
53b62ae HEAD@{12}: commit: feat(bench): P2.2 - npm run bench com variantes e testes de aceite
a559364 HEAD@{13}: reset: moving to HEAD~1
936d9f4 HEAD@{14}: commit: feat(bench): P2.2 - npm run bench com variantes e testes de aceite
a559364 HEAD@{15}: commit: feat(bench): P2.1 - conteiner de aceite sem rede
ffb0b46 HEAD@{16}: commit: feat(bench): regua de aceite do auditor (P1/P2) provada; auditoria do P3; prompt P2
848a615 HEAD@{17}: commit: docs(relatorio): P3
3e93e8b HEAD@{18}: commit: feat(avaliador): P3.2 - executor usa a cadeia do avaliador pelo FreeLLMAPI
cbdb0a0 HEAD@{19}: commit: feat(avaliador): P3.1 - cadeia do avaliador pelo FreeLLMAPI (Nemotron, DeepSeek, Claude)
```

---

## 2. Por Commit

### Commit 1: `4447198` — Passo S1.1
```text
commit 444719877d9c173ecc5cee1e813b4e1263fbf46a
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Fri Oct 9 21:56:03 2026 -0400

    feat(custo): S1.1 - custo por etapa (nodeId) na trilha e no bench
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 scripts/bench.ts                       | 105 +++++++++++++++++++++++++++++++++
 src/core/llm/cost.ts                   |   2 +
 src/core/orchestrator/node-executor.ts |   9 ++-
 tests/bench/bench-relatorio.test.ts    |  56 ++++++++++++++++++
 tests/llm/cost-node.test.ts            |  45 ++++++++++++++
 5 files changed, 214 insertions(+), 3 deletions(-)
```
- `npx tsc --noEmit`: 0 erros
- `npx vitest run` completo:
```text
Test Files  92 passed (92)
     Tests  655 passed (655)
  Duration  172.93s
```

### Commit 2: `2e91335` — Passo S1.2
```text
commit 2e91335de7a4c593deab9cb91f932fd9ef9e20df
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Fri Oct 9 22:05:31 2026 -0400

    feat(skills): S1.2 - respostas do Jev decidem referencias do avaliador de tela
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 skills/avaliador-frontend/SKILL.md              |  8 ++++
 src/core/governance/dual-lens-auditor.ts        | 31 ++++++++++++-
 src/core/orchestrator/execution-trigger.ts      |  4 +-
 src/core/orchestrator/node-executor.ts          | 13 ++++++
 src/core/skills/skill-runtime.ts                | 11 ++++-
 tests/orchestrator/jev-plan-referencias.test.ts | 45 +++++++++++++++++++
 tests/skills/skill-referencias.test.ts          | 58 +++++++++++++++++++++++++
 7 files changed, 167 insertions(+), 3 deletions(-)
```
- `npx tsc --noEmit`: 0 erros
- `npx vitest run` completo:
```text
Test Files  94 passed (94)
     Tests  660 passed (660)
  Duration  161.42s
```

### Commit 3: `60e81f0` — Passo S1.3
```text
commit 60e81f0c28841c9fbe4af4913310e12a0dada447
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Sat Oct 10 08:54:06 2026 -0400

    refactor(skills): S1.3 - avaliadores sem promessas falsas e sem regras duplicadas
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 skills/avaliador-backend/SKILL.md                  |   6 +-
 skills/avaliador-core/SKILL.md                     |   6 +-
 skills/avaliador-frontend/SKILL.md                 | 355 ++-------------------
 skills/avaliador-integration/SKILL.md              |   6 +-
 skills/avaliador/SKILL.md                          |   8 +-
 .../orchestration-policy-and-skills.test.ts        |  25 +-
 tests/skills/skill-promessas.test.ts               | 122 +++++++
 7 files changed, 173 insertions(+), 355 deletions(-)
```
- `npx tsc --noEmit`: 0 erros
- `npx vitest run` completo:
```text
Test Files  95 passed (95)
     Tests  665 passed (665)
  Duration  151.01s
```

---

## 3. Chamadas de `recordLlmCost` Alteradas (S1.1 Item 2)

Lista de chamadas `arquivo:linha` onde `nodeId` foi repassado:
1. `src/core/orchestrator/node-executor.ts:634` — No laço do executor de ferramentas (`runExecutorToolLoop`), passa `nodeId: taskNode.id` no callback `onLlmCost`.
2. `src/core/orchestrator/node-executor.ts:1301` — Na fábrica do avaliador cego de governança (`makeBlindAuditDispatchFn`), repassa `nodeId: taskNode.id` para `recordLlmCost`.

---

## 4. Tabela de Tamanhos Antes × Depois (S1.3 Item 4)

Medições reais obtidas com `loadRoleSkill` + `buildSkillSystemPrompt` (`scripts/measure-skills.ts`):

```text
| skill | herdado (avaliador) | próprio | referências | total |
|---|---|---|---|---|
| avaliador-core | 19.780 | 739 | — | 20.521 |
| avaliador-backend | 19.780 | 745 | — | 20.527 |
| avaliador-integration | 19.780 | 564 | — | 20.346 |
| avaliador-frontend (dashboard + react) | 19.780 | 2.875 | 13.897 | 36.554 |
| avaliador-frontend (dashboard sem react) | 19.780 | 2.875 | 11.061 | 33.718 |
| avaliador-frontend (página pública + react) | 19.780 | 2.875 | 17.003 | 39.660 |
| avaliador-frontend (página pública sem react) | 19.780 | 2.875 | 14.167 | 36.824 |
```

### Comparativo com o Estado Anterior (S0):
- **Corpo próprio do `avaliador-frontend`:** caiu de **29.760** para **2.875** caracteres (redução de **90,3%** na duplicação de regras).
- **Total para telas internas / dashboards:** caiu de **60.576** para **36.554** caracteres (redução de **39,7%**, abaixo do teto de $\le 40.000$).
- **Total para página pública:** **39.660** caracteres (com React) / **36.824** caracteres (sem React), somando exatamente o extrato do `taste-skill` (+3.106 caracteres).

---

## 5. Tabela das 16 Execuções do Benchmark S1.4

Relatório oficial gerado em `docs/relatorios/bench/2026-10-10-1020.md`:

| Projeto | Variante | Rep | Fase | Tempo (s) | Etapas | 1ª Tent. | Tent. Totais | tsc | UI Check | Aceite | Reprovados | Custo Total (US$) | Exec / Eval / Jev | Jev Calls | Avaliador Models |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | padrao | 1 | ENTREGUE | 219.4 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | — | 0.0412 | 0.0409 / 0.0000 / 0.0003 | 3 | ollama/nemotron-3-ultra |
| P1 | sem-jev | 1 | ENTREGUE | 228.4 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | — | 0.0515 | 0.0515 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P2 | padrao | 1 | ENTREGUE | 452.2 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | — | 0.0528 | 0.0525 / 0.0000 / 0.0003 | 4 | ollama/nemotron-3-ultra |
| P2 | sem-jev | 1 | ENTREGUE | 400.1 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | — | 0.0863 | 0.0863 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P3 | padrao | 1 | ENTREGUE | 237.3 | 3 | 3 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0509 | 0.0506 / 0.0000 / 0.0003 | 3 | ollama/nemotron-3-ultra |
| P3 | sem-jev | 1 | ENTREGUE | 288.6 | 3 | 3 | 0 | 0 (ok) | ausente | 11/12 | L12 | 0.0800 | 0.0800 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P4 | padrao | 1 | ENTREGUE | 259.2 | 2 | 2 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0500 | 0.0499 / 0.0000 / 0.0001 | 2 | ollama/nemotron-3-ultra |
| P4 | sem-jev | 1 | ENTREGUE | 226.0 | 2 | 2 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0454 | 0.0454 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P1 | padrao | 2 | ENTREGUE | 177.8 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | — | 0.0291 | 0.0289 / 0.0000 / 0.0003 | 3 | ollama/nemotron-3-ultra |
| P1 | sem-jev | 2 | ENTREGUE | 216.9 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | — | 0.0462 | 0.0462 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P2 | padrao | 2 | ENTREGUE | 536.7 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | — | 0.1196 | 0.0800 / 0.0393 / 0.0004 | 4 | ollama/nemotron-3-ultra, custom/deepseek-v4-pro |
| P2 | sem-jev | 2 | ENTREGUE | 545.9 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | — | 0.1036 | 0.0821 / 0.0215 / 0.0000 | 0 | ollama/nemotron-3-ultra, custom/deepseek-v4-pro |
| P3 | padrao | 2 | ENTREGUE | 324.1 | 3 | 3 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0681 | 0.0677 / 0.0000 / 0.0004 | 4 | ollama/nemotron-3-ultra |
| P3 | sem-jev | 2 | ENTREGUE | 309.9 | 3 | 3 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0469 | 0.0469 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P4 | padrao | 2 | ENTREGUE | 210.5 | 2 | 2 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0422 | 0.0420 / 0.0000 / 0.0002 | 2 | ollama/nemotron-3-ultra |
| P4 | sem-jev | 2 | ENTREGUE | 229.4 | 2 | 2 | 0 | 0 (ok) | ausente | 12/12 | — | 0.0509 | 0.0509 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |

### Médias por Projeto × Variante
| Projeto | Variante | Execs | % ENTREGUE | Tempo Médio (s) | 1ª Tent. Média | Tent. Médias | % tsc OK | Aceite Médio (%) | Custo Médio (US$) | Jev Chamadas Médias |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | padrao | 2 | 100.0% | 198.6 | 3.00 | 0.00 | 100.0% | 100.0% | 0.0352 | 3.0 |
| P1 | sem-jev | 2 | 100.0% | 222.7 | 3.00 | 0.00 | 100.0% | 100.0% | 0.0488 | 0.0 |
| P2 | padrao | 2 | 100.0% | 494.5 | 4.00 | 0.00 | 100.0% | 100.0% | 0.0862 | 4.0 |
| P2 | sem-jev | 2 | 100.0% | 473.0 | 4.00 | 0.00 | 100.0% | 100.0% | 0.0950 | 0.0 |
| P3 | padrao | 2 | 100.0% | 280.7 | 3.00 | 0.00 | 100.0% | 100.0% | 0.0595 | 3.5 |
| P3 | sem-jev | 2 | 100.0% | 299.3 | 3.00 | 0.00 | 100.0% | 95.8% | 0.0634 | 0.0 |
| P4 | padrao | 2 | 100.0% | 234.8 | 2.00 | 0.00 | 100.0% | 100.0% | 0.0461 | 2.0 |
| P4 | sem-jev | 2 | 100.0% | 227.7 | 2.00 | 0.00 | 100.0% | 100.0% | 0.0482 | 0.0 |

### `RESUMO` Bruto de Cada Aceite
```text
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
RESUMO {"projeto":"p3","total":12,"aprovados":12,"reprovados":0}
RESUMO {"projeto":"p3","total":12,"aprovados":11,"reprovados":1}
RESUMO {"projeto":"p4","total":12,"aprovados":12,"reprovados":0}
RESUMO {"projeto":"p4","total":12,"aprovados":12,"reprovados":0}
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
RESUMO {"projeto":"p3","total":12,"aprovados":12,"reprovados":0}
RESUMO {"projeto":"p3","total":12,"aprovados":12,"reprovados":0}
RESUMO {"projeto":"p4","total":12,"aprovados":12,"reprovados":0}
RESUMO {"projeto":"p4","total":12,"aprovados":12,"reprovados":0}
```

### Linhas `EVALUATOR_SKILL_REFS` Gravadas para a Etapa de Tela do P2
Na etapa `task-impl-*-3` (etapa 3/3 do P2: `tarefas/page.tsx`), o Jev identificou `tipoPagina: "dashboard_produto"` (`aplicarTasteSkillPublico: false`, `aplicarReactPerfCritico: true`), gerando:
```json
{
  "action": "EVALUATOR_SKILL_REFS",
  "details": {
    "nodeId": "task-impl-1791637388729-3",
    "skill": "avaliador-frontend",
    "referencias": [
      "skills/avaliador-frontend/references/web-interface-guidelines-command.md",
      "skills/avaliador-frontend/references/react-best-practices-critical-high.md",
      "skills/avaliador-frontend/references/ui-ux-pro-max-checklist.md"
    ],
    "caracteres": 36554
  }
}
```

---

## 6. Desvios do Prompt

1. **Parada Obrigatória em S1.3:** Ao zerar `ferramentas: []` nos avaliadores, a asserção no teste pré-existente `tests/harness/orchestration-policy-and-skills.test.ts:481` (`enforceSkillToolPermission` no avaliador para `read_file`) falhou porque esperava que o avaliador pudesse usar `read_file`. Conforme a regra expressa de parada ("Se outro código ou teste exigir lista não vazia → PARE e cole o erro"), a execução foi pausada, o erro foi submetido ao usuário, e o teste foi ajustado para validar que avaliadores (zero-tool) têm qualquer chamada de ferramenta negada (`allowed: false`), enquanto executores mantêm permissões ativas.

---

## 7. Checklist de Travas (T-A … T-N)

- [x] **T-A (Nunca inventar):** Todas as habilidades do Jev e das skills foram fundamentadas no código e fontes oficiais.
- [x] **T-B (Escopo fechado):** Apenas os arquivos de PODE ALTERAR de cada passo foram editados.
- [x] **T-C (Literalidade):** Nomes, campos e estruturas seguiram os literais especificados.
- [x] **T-D (Nomes reais):** Nomes verificados via `git grep` antes e depois das mudanças.
- [x] **T-E (Um passo = um commit):** Exatamente 3 commits para os 3 passos de código (`4447198`, `2e91335`, `60e81f0`), todos com `tsc` e Vitest completo verde.
- [x] **T-F (Banco de dados):** `prisma/dev.db` permaneceu intacto; o bench utilizou instâncias temporárias em disco/memória.
- [x] **T-G (Segredos):** Sanitização estrita de chaves e segredos em todos os relatórios.
- [x] **T-H (Dependências):** Nenhuma dependência externa adicionada no `package.json`.
- [x] **T-I (Fim de linha):** Arquivos mantidos e criados em LF.
- [x] **T-J (Paradas obrigatórias):** Custo total acumulado do benchmark: US$ 0.9648 (teto US$ 1.50 respeitado); custo por execução máximo: US$ 0.1196 (teto US$ 0.50 respeitado); 16 de 16 execuções concluíram em `ENTREGUE`.
- [x] **T-K (Co-autoria):** Todos os commits contêm `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- [x] **T-L (Relatório fiel):** Todos os dados foram extraídos das execuções reais e saídas brutas.
- [x] **T-M (Isolamento):** Testes de aceite executados exclusivamente dentro do contêiner Docker `nextcode-aceite:1`.
- [x] **T-N (Histórico conferido):** Reflog limpo, sem rebase, amend ou resets.

---

## 8. Dúvidas Abertas

Nenhuma dúvida técnica aberta. O sistema de skills do avaliador foi desinchado, o avaliador de frontend opera dentro do orçamento rigoroso de caracteres, e a integração com o Jev determina com precisão mecânica quando cada conjunto de referências é ativado.
