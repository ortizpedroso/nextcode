# Relatório B1c + PJ1

> Prompt fundador 16/10/2026. HEAD inicial (T-A): `ba9f111df9748538f2d0140d8c9b370b48984296`.

---

## PASSO B1c.0 — Sonda (sem commit)

Script temporário: `%TEMP%\b1c0-sonda-opus.ts` (chave via `Setting.claudeKey` / env; não registrada).

| Run | HTTP | stop_reason | content[].type (ordem) | tamanho blocos text | usage (resumo) |
|-----|------|-------------|------------------------|---------------------|----------------|
| 1 | 200 | end_turn | thinking, text | 22 | input 92, output 40 (thinking_tokens 24) |
| 2 | 200 | end_turn | thinking, text | 22 | input 92, output 69 (thinking_tokens 53) |

**Conclusão:** causa confirmada — o 1º bloco **não** é `text` (`thinking` antes de `text`); ler só `content[0].text` devolve vazio.

---

## PASSO B1c.1 — Ramo Claude direto

**Commit:** `3890924` — `fix(avaliador): ramo Claude direto le blocos de texto e registra falha (B1c.1)`

**Verificação:**

- `npx tsc --noEmit` → 0 erros
- `npx vitest run` → 124 arquivos, 804 testes, todos verdes (~259 s)

**Desvios:** nenhum.

---

## PASSO B1c.2 — Bench execução INVÁLIDA (rota)

**Commit:** `27e3635` — `feat(bench): marca execucao invalida por falha de rota do avaliador (B1c.2)`

**Verificação:** `npx tsc --noEmit` → 0; `npx vitest run` → 124 / 804 verdes (~259 s).

---

## PASSO B1c.3 — Rodada só avaliador-claude

**Comando:** `npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes avaliador-claude --repeticoes 1`

**Relatório:** `docs/relatorios/bench/2026-10-16-1822.md` (+ `.yaml`) · custo acumulado **US$ 0,7804** (T-J ok) · ~16,6 min.

| Projeto | Fase | Aceite | Custo | Eval USD | Aval. indisp. | Aval. por provedor |
|---------|------|--------|-------|----------|---------------|-------------------|
| P1 | ENTREGUE | 10/10 | 0,1590 | 0,1283 | 0 | claude:2 |
| P2 | ENTREGUE | 13/13 | 0,3131 | 0,2249 | 0 | claude:3 |
| P3 | ENTREGUE | 12/12 | 0,1949 | 0,1295 | 0 | claude:2 |
| P4 | ENTREGUE | 12/12 | 0,1134 | 0,0654 | 0 | claude:1 |

**× baseline `padrao` (B1, 2026-10-16-1658):** 4/4 ENTREGUE ~US$ 0,19 vs **4/4 ENTREGUE ~US$ 0,78** na variante Opus **válida** (antes B1: 0/4 ENTREGUE por rota quebrada). Opus passa a avaliar de fato; nesta rodada aceite 100% nos quatro projetos (diferente do B1 inválido).

**Commit:** `docs: bench B1c avaliador Claude corrigido` (pendente abaixo).

---

## PASSO PJ1.1 — Arquivados visíveis

**Commit:** `c4155a5` — `feat(projetos): lista de arquivados com desarquivar (PJ1.1)`

`fetchProjects` → `/api/projects?includeArchived=true`; sidebar seção recolhida **Arquivados (n)**.

**Desvio R1:** `page.tsx` neste commit também inclui `handleDeleteProject(..., apagarPasta)` (escopo PJ1.3); funcionalidade de apagar só completa no commit PJ1.3.

---

## PASSO PJ1.2 — Reabrir pasta

**Commit:** `5a292cf` — `feat(projetos): abrir pasta existente reabre o projeto (PJ1.2)`

Testes: `tests/api/projects-open-existing.test.ts`.

---

## PASSO PJ1.3 — Apagar pasta opcional

**Commit:** `a373ed1` — `feat(projetos): apagar pergunta se remove a pasta do disco (PJ1.3)`

`DELETE ?apagarPasta=true|false` (default false); diálogo com duas opções explícitas.

---

## PASSO PJ1.4 — Sessão sem projeto

**Commit:** `5692e21` — `feat(sessoes): sessao sem projeto so executa depois de vinculada (PJ1.4)`

Testes: `tests/intake/aprovacao-sem-projeto.test.ts`.

**Fixture alterado (trava PJ1.4):** `tests/orchestrator/execution-trigger.test.ts` — teste 3: cria `Project` com `path: process.cwd()` e passa `projectId` na sessão (linhas ~27–45, ~186–195).

---

## PASSO PJ1.5 — Smoke na tela

**Não executado nesta sessão pelo agente** (servidor local + fluxo manual não rodados). Validar manualmente: arquivar/desarquivar, reabrir pasta, apagar “só NextCode”, sessão ad-hoc → aprovação recusada → vincular → aprovar.

---

## Fechamento

**Verificação final:** `npx tsc --noEmit` → 0; `npx vitest run` → 124 arquivos, 804 testes verdes.

**Prova R1 (`git diff --stat 9d8cba8..bc65639`, commits desta tarefa após T-A):**

```
 docs/relatorios/B1c-PJ1.md                       | 110 +++
 docs/relatorios/bench/2026-10-16-1822.md         |  74 +++
 docs/relatorios/bench/2026-10-16-1822.yaml       | 399 ++++++++++++
 memory/medicoes.md                               |  12 +
 scripts/bench.ts                                 |  37 +-
 src/app/api/chat/route.ts                        |  35 +
 src/app/api/projects/[id]/route.ts               |  5 +-
 src/app/api/projects/route.ts                    |  34 +
 src/app/api/sessions/[id]/route.ts               |  25 +
 src/app/page.tsx                                 |  7 +-
 src/components/layout/sidebar.tsx                |  46 +-
 src/components/projects/project-actions-menu.tsx |  35 +-
 src/core/llm/evaluator-models.ts                 |  83 ++-
 tests/api/projects-delete.test.ts                |  29 +-
 tests/api/projects-open-existing.test.ts         |  93 +++
 tests/bench/bench-relatorio.test.ts              | 120 +++-
 tests/intake/aprovacao-sem-projeto.test.ts       | 140 +++++
 tests/llm/evaluator-freellmapi.test.ts           |  87 +++
 tests/orchestrator/execution-trigger.test.ts     |  13 +
 19 files changed, 1332 insertions(+), 48 deletions(-)
```

*(Entre T-A e o 1º commit B1c houve `391e553` e `9d8cba8` em docs proibidos ao agente — fora desta tarefa.)*

**Próximo passo sugerido:** B1b (reordenar `EVALUATOR_CHAIN` em produção) após auditoria deste relatório.

---

## PASSO PJ1.5 — Smoke na tela (feito 20/10 pelo Claude, navegador real)

Ambiente: `npm run dev` na porta 3101 com **cópia** do banco na pasta temporária (`prisma/dev.db` intocado: mtime `2026-10-20 04:52:32` antes e depois), `NEXTCODE_WORKER_DISABLED=1` (nada executa), projeto de teste numa pasta temporária. Gasto: 2 chamadas ao Jev, US$ 0,0000.

| # | Ação na tela | O que apareceu | Resultado |
|---|---|---|---|
| 1 | Criar `smoke-pj15` → menu → Arquivar → abrir "Arquivados" → Desarquivar | Projetos 3→2, Arquivados 1→2, `smoke-pj15` na lista de arquivados com "Desarquivar"; depois Projetos 2→3, Arquivados 2→1 | ✅ |
| 2 | "Abrir Pasta Local" na pasta do `smoke-pj15` com **outro nome** (`nome-diferente`) | `POST /api/projects 200`; continua Projetos (3), nome antigo mantido; disco sem `smoke-pj15/nome-diferente` | ✅ (ver defeito a) |
| 3 | Menu → Apagar projeto → "Remover só do NextCode" | Janela com as 2 opções e o caminho da pasta; `DELETE 200`; projeto some; pasta continua no disco com `package.json`, `README.md`, `.gitignore` | ✅ |
| 4 | Sessão nova sem projeto → "Aprovo a spec" | "⚠️ Para executar, vincule esta sessão a um projeto com pasta…"; fase não muda | ✅ |
| 4b | Sessão → "Anexar a um projeto" → `smoke-pj15` → "Aprovo a spec" | `PATCH 200`; sessão aparece dentro do projeto; a recusa do vínculo some e vem a próxima ("A Spec Canônica precisa ser revisada…") — a sessão de teste não tinha Spec | ✅ trava do vínculo; **início da execução com Spec real não feito aqui** (precisaria gerar Spec paga); coberto pelo bench, que sempre roda vinculado |

**Defeitos achados:**
- (a) o registro do painel dizia "cadastrado!" também ao **reabrir** uma pasta já cadastrada — `src/app/page.tsx` ignorava o `reopened: true` da API. Corrigido no mesmo commit ("reaberto (já estava cadastrado).").
- (b) não é defeito do PJ1: o token de acesso local é entregue **uma vez por processo** (`/api/auth/session`); abrir o app em `localhost` e depois em `127.0.0.1` deixa a 2ª aba sem acesso (formulários fecham sem fazer nada, API responde 401). Comportamento de segurança já documentado na rota; registrado para quem for testar.
