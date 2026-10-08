# Relatório P1 — Núcleo do Jev: custo no teto, retry em 429/529, alerta em 422, estado íntegro, score com probabilidades em objeto e limiares do YAML lidos

## 1. Identificação
- **Hash de partida:** `d42877980c588f2f1cc549f316bda7dd01a9cf58`
- **Log dos commits:**
  ```text
  c8b63a6 fix(policy): P1.4 - limiares do Jev lidos do YAML
  6639232 fix(jev): P1.3 - estado nunca cortado no meio e score com probabilidades em objeto
  e1acc35 feat(jev): P1.2 - nova tentativa em 429/529 e alerta em 422
  4dd6733 feat(jev): P1.1 - custo do Jev no LLM_COST e usage na trilha
  ```

---

## 2. Detalhamento por Commit

### Commit 1: `4dd6733` — `feat(jev): P1.1 - custo do Jev no LLM_COST e usage na trilha`
- **Diffstat:**
  ```text
  src/core/decision/jev.ts         |  26 ++++++
  src/core/llm/cost.ts             |   3 +-
  tests/decision/jev-custo.test.ts | 170 +++++++++++++++++++++++++++++++++++++++
  3 files changed, 198 insertions(+), 1 deletion(-)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  87 passed (87)
       Tests  626 passed (626)
    Duration  151.59s
  ```

### Commit 2: `e1acc35` — `feat(jev): P1.2 - nova tentativa em 429/529 e alerta em 422`
- **Diffstat:**
  ```text
  src/core/decision/jev.ts         | 110 +++++++++++++++++----
  tests/decision/jev-retry.test.ts | 200 +++++++++++++++++++++++++++++++++++++++
  2 files changed, 294 insertions(+), 16 deletions(-)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  88 passed (88)
       Tests  632 passed (632)
    Duration  129.85s
  ```

### Commit 3: `6639232` — `fix(jev): P1.3 - estado nunca cortado no meio e score com probabilidades em objeto`
- **Diffstat:**
  ```text
  src/core/decision/jev-execution-checks.ts |   6 +-
  src/core/decision/jev.ts                  |  20 +++-
  src/core/governance/secret-guard.ts       |   2 +-
  tests/decision/jev-estado.test.ts         | 185 ++++++++++++++++++++++++++++++
  4 files changed, 207 insertions(+), 6 deletions(-)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  89 passed (89)
       Tests  637 passed (637)
    Duration  156.46s
  ```

### Commit 4: `c8b63a6` — `fix(policy): P1.4 - limiares do Jev lidos do YAML`
- **Diffstat:**
  ```text
  src/core/config/orchestration-policy.ts            |  49 +++++++++
  tests/harness/orchestration-policy-and-skills.test.ts | 117 +++++++++++++++++++++
  2 files changed, 166 insertions(+)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  89 passed (89)
       Tests  638 passed (638)
    Duration  128.89s
  ```

---

## 3. Testes Novos

| Arquivo | Nome do Teste | O que prova |
|---|---|---|
| `tests/decision/jev-custo.test.ts` | `askJevBatch com sessionId grava LLM_COST papel jev com o custo de input_tokens` | Prova que `askJevBatch` registra `LLM_COST` com `papel: "jev"`, modelo e precificação exata (US$ 0.042/1M tokens) |
| `tests/decision/jev-custo.test.ts` | `askJevChoice idem` | Prova que `askJevChoice` registra `LLM_COST` idêntico para a decisão unitária |
| `tests/decision/jev-custo.test.ts` | `JEV_DECISION traz usage` | Prova que o payload de telemetria `JEV_DECISION` inclui `usage` (`input_tokens`, `output_tokens`) |
| `tests/decision/jev-custo.test.ts` | `sem sessionId não grava LLM_COST` | Prova que chamadas fora de sessão não inserem custo na tabela |
| `tests/decision/jev-custo.test.ts` | `costFromUsage("jev-1.13.0", { input_tokens: 1000, output_tokens: 500 }) = 0.000042` | Prova cálculo numérico determinístico da tabela de preços |
| `tests/decision/jev-retry.test.ts` | `429 depois 200 → resposta válida e 1 JEV_RETRY` | Prova retry em HTTP 429 com log `JEV_RETRY` e sucesso posterior |
| `tests/decision/jev-retry.test.ts` | `529, 529, 529 → null após 3 tentativas` | Prova exaustão de retries em status 529 limitando a 3 chamadas |
| `tests/decision/jev-retry.test.ts` | `retry-after 1 → espera ~1000 ms` | Prova respeito ao header `retry-after` em segundos convertido para milissegundos |
| `tests/decision/jev-retry.test.ts` | `422 → null, JEV_REQUEST_INVALID com o detalhe, sem nova tentativa` | Prova que HTTP 422 emite `JEV_REQUEST_INVALID` com texto truncado e não faz retry |
| `tests/decision/jev-retry.test.ts` | `401 → null sem nova tentativa` | Prova que erros não transientes não efetuam retry |
| `tests/decision/jev-retry.test.ts` | `signal do chamador abortado durante a espera → não faz nova chamada` | Prova cancelamento imediato sem retry caso o sinal do chamador seja abortado |
| `tests/decision/jev-estado.test.ts` | `estado acima do limite → null, JEV_STATE_TOO_LARGE e nenhuma chamada HTTP` | Prova recusa antecipada se `state.length > maxChars` com evento `JEV_STATE_TOO_LARGE` sem disparar HTTP |
| `tests/decision/jev-estado.test.ts` | `estado no limite → enviado inteiro (JSON.parse do state enviado funciona)` | Prova que estado com tamanho exato (24.000 chars) é transmitido integralmente sem ser cortado |
| `tests/decision/jev-estado.test.ts` | `score com probabilities objeto {"0":0.1,"1":0.9} → [0.1, 0.9]` | Prova ordenação e conversão de probabilidades enviadas em dicionário indexado numericamente |
| `tests/decision/jev-estado.test.ts` | `score com probabilities array continua funcionando` | Prova compatibilidade retroativa quando probabilities já é array |
| `tests/decision/jev-estado.test.ts` | `guarda de segredos com Jev indisponível por estado grande continua fail-closed (bloqueia)` | Prova mecanismo de segurança fail-closed da guarda de segredos quando o payload excede o limite |
| `tests/harness/orchestration-policy-and-skills.test.ts` | `P1.4: lê os 14 limiares de jev_limiares do YAML e usa os padrões quando faltam` | Prova carregamento dos 14 campos escalares de `jev_limiares` do YAML e recuo para valores padrão quando ausentes |

---

## 4. Evidência de Nomes (`git grep -n`)
- `JEV_RETRY`:
  - `src/core/decision/jev.ts:128`
  - `tests/decision/jev-retry.test.ts:31, 56, 82, 150, 170, 197`
- `JEV_REQUEST_INVALID`:
  - `src/core/decision/jev.ts:171, 272`
  - `tests/decision/jev-retry.test.ts:125, 142`
- `JEV_STATE_TOO_LARGE`:
  - `src/core/decision/jev.ts:249`
  - `tests/decision/jev-estado.test.ts:31, 46, 179`
- `postJev`:
  - `src/core/decision/jev.ts:80, 156, 256`

---

## 5. Tabela P1.4: Limiares do Jev (`chave › valor no YAML › padrão do código`)

| Chave YAML | Valor no YAML (`config/politicas-orquestracao.yaml`) | Padrão do Código (`DEFAULT_ORCHESTRATION_POLICY`) |
|---|---|---|
| `confianca_minima_choice` | 0.75 | 0.75 |
| `probabilidade_minima_aprovacao_incondicional_noul` | 0.80 | 0.80 |
| `score_minimo_clareza` | 2.0 | 2.0 |
| `confianca_minima_score` | 0.65 | 0.65 |
| `probabilidade_minima_escopo_fechado_noul` | 0.75 | 0.75 |
| `probabilidade_minima_sem_contradicoes_noul` | 0.80 | 0.80 |
| `confianca_minima_complexidade` | 0.65 | 0.65 |
| `probabilidade_dividir_microbrief_noul` | 0.70 | 0.70 |
| `confianca_minima_cluster` | 0.70 | 0.70 |
| `probabilidade_minima_taste_skill_publico_noul` | 0.75 | 0.75 |
| `probabilidade_minima_react_perf_noul` | 0.30 | 0.30 |
| `limiar_disparo_fire_t` | 0.70 | 0.70 |
| `probabilidade_minima_fonte_oficial_noul` | 0.80 | 0.80 |
| `probabilidade_maxima_prompt_injection_noul` | 0.15 | 0.15 |

*Constatação:* Todos os 14 valores presentes no YAML coincidem com os padrões do código. O comportamento atual do sistema permaneceu estritamente preservado.

---

## 6. Execução Real (P1 com cópia isolada do banco)
- **Comando executado:** `npx tsx <scratch>/smoke-p1-p2-10-7-2.ts p1`
- **Fase final da sessão:** `CONCLUIDO`
- **Compilação do projeto gerado (`tsc --noEmit`):** `exitCode=0` (0 erros)
- **Custo por papel:**
  - `executor`: US$ 0.033723
  - `avaliador`: US$ 0.013022
  - `jev`: US$ 0.000289
  - **Custo total da sessão (`LLM_COST`):** US$ 0.047034
- **Eventos Jev na trilha:**
  - `JEV_DECISION`: 3 eventos
  - `JEV_RETRY`: 0
  - `JEV_REQUEST_INVALID`: 0
  - `JEV_STATE_TOO_LARGE`: 0
- **Tokens e chamadas Jev:** 3 chamadas HTTP (2.471 + 1.303 + 3.107 = 6.881 input tokens, 976 output tokens), registradas com sucesso e precificadas via `LLM_COST`.

---

## 7. Desvios do Prompt
Nenhum.

---

## 8. Checklist das Travas (T-A … T-K)
- **T-A Pré-condição:** Cumprida. O `git status` inicial continha apenas `.claude/` e o commit `HEAD` correspondia àquele especificado no prompt.
- **T-B Escopo fechado:** Cumprida. Apenas os arquivos explicitamente listados nos passos P1.1, P1.2, P1.3, P1.4 foram alterados. Nenhum timeout aumentado, nenhum `.skip`/`.only` inserido, nenhum catch vazio.
- **T-C Literalidade:** Cumprida. Nomes de eventos (`JEV_RETRY`, `JEV_REQUEST_INVALID`, `JEV_STATE_TOO_LARGE`), ações e valores foram seguidos à risca.
- **T-D Nomes reais:** Cumprida. Todos os nomes foram validados via `git grep -n`.
- **T-E Um passo = um commit:** Cumprida. Cada passo gerou um commit individual acompanhado da validação integral por `npx tsc --noEmit` e `npx vitest run`.
- **T-F Banco:** Cumprida. Nenhuma escrita em `prisma/dev.db`; o smoke P1 utilizou cópia temporária via `DATABASE_URL`.
- **T-G Segredos:** Cumprida. Chaves e tokens não foram expostos nem commitados.
- **T-H Dependências:** Cumprida. Nenhum pacote novo foi instalado.
- **T-I Fim de linha:** Cumprida. As terminações de linha de cada arquivo modificado foram inspecionadas e preservadas via `git ls-files --eol`.
- **T-J Paradas obrigatórias:** Cumprida. Não houve quebras de testes legados e o custo real da sessão foi inferior ao limite de US$ 0,50.
- **T-K Commits:** Cumprida. Todos os commits encerram com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## 9. Dúvidas Abertas para o Fundador
Nenhuma dúvida impeditiva no escopo do P1. O núcleo do Jev está integrado ao teto de custos, com tolerância a falhas transitórias e leitura fiel de limiares.
