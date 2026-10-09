# Relatório P3 — Avaliador pelo FreeLLMAPI: Nemotron → DeepSeek pago → Claude

## 1. Identificação
- **Hash de partida:** `7ac378665e28cf5cc4dcf9c1b9b61421f82db4c2`
- **Log dos commits:**
  ```text
  3e93e8b feat(avaliador): P3.2 - executor usa a cadeia do avaliador pelo FreeLLMAPI
  cbdb0a0 feat(avaliador): P3.1 - cadeia do avaliador pelo FreeLLMAPI (Nemotron, DeepSeek, Claude)
  ```

---

## 2. Detalhamento por Commit

### Commit 1: `cbdb0a0` — `feat(avaliador): P3.1 - cadeia do avaliador pelo FreeLLMAPI (Nemotron, DeepSeek, Claude)`
- **Diffstat:**
  ```text
  src/core/config/orchestration-policy.ts            |   1 +
  src/core/llm/evaluator-models.ts                   | 147 ++++++++-----------
  tests/harness/evaluator-and-tier.test.ts           |  60 +++++---
  tests/harness/orchestration-policy-and-skills.test.ts |   6 +
  tests/llm/evaluator-freellmapi.test.ts             | 163 +++++++++++++++++++++
  5 files changed, 276 insertions(+), 101 deletions(-)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  90 passed (90)
       Tests  646 passed (646)
    Duration  132.32s
  ```

### Commit 2: `3e93e8b` — `feat(avaliador): P3.2 - executor usa a cadeia do avaliador pelo FreeLLMAPI`
- **Diffstat:**
  ```text
  src/core/llm/evaluator-models.ts                  | 8 +-------
  src/core/orchestrator/node-executor.ts            | 8 ++------
  tests/orchestrator/avaliador-somente-pago.test.ts | 2 +-
  3 files changed, 4 insertions(+), 14 deletions(-)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  90 passed (90)
       Tests  646 passed (646)
    Duration  204.85s
  ```

---

## 3. Testes Novos

| Arquivo | Nome do Teste | O que prova |
|---|---|---|
| `tests/llm/evaluator-freellmapi.test.ts` | `nemotron responde via ollama/nemotron → usado, independent true, model = servedBy` | Prova que Nemotron atendido via rota `ollama/nemotron-3-ultra` é aceito, considerado independente do executor (`deepseek`) e preenche `model` com `servedBy`. |
| `tests/llm/evaluator-freellmapi.test.ts` | `nemotron via nvidia/ também é aceito` | Prova que o prefixo `nvidia/` em `servedBy` é aceito para o Nemotron. |
| `tests/llm/evaluator-freellmapi.test.ts` | `nemotron servido por rota fora dos prefixos → recusado, segue para deepseek (custom/deepseek-v4-pro), independent false` | Prova que rota inesperada em `X-Routed-Via` é recusada e a cadeia avança para o próximo candidato (`deepseek`), marcando `independent: false`. |
| `tests/llm/evaluator-freellmapi.test.ts` | `nemotron 429 → pausa 10 min; 2ª chamada nem tenta nemotron` | Prova que erro 429 (rate limit) aciona a pausa de 10 minutos para o provedor, evitando chamadas subsequentes dentro da janela. |
| `tests/llm/evaluator-freellmapi.test.ts` | `nemotron e deepseek falham, claude 404 → content null com 3 falhas` | Prova que falha sucessiva nos candidatos devolve `content: null` e acumula o histórico de falhas de cada um. |
| `tests/llm/evaluator-freellmapi.test.ts` | `sem freellmapi configurado → content null` | Prova retorno limpo quando o gateway FreeLLMAPI não está disponível. |
| `tests/llm/evaluator-freellmapi.test.ts` | `nenhuma chamada vai a api.deepseek.com, api.anthropic.com ou googleapis` | Prova isolamento estrito: todas as requisições passam exclusivamente pelo endpoint do FreeLLMAPI. |
| `tests/harness/orchestration-policy-and-skills.test.ts` | `P3: ollama/nemotron e nvidia/nemotron são família nvidia, independente de deepseek` | Prova que a função `isEvaluatorModelIndependent` classifica modelos com `nemotron` ou `nvidia` na família `nvidia`. |

---

## 4. Evidência de Nomes (`git grep -n`)
- `EVALUATOR_CHAIN`:
  - `src/core/llm/evaluator-models.ts:19:export const EVALUATOR_CHAIN: EvaluatorCandidate[] = [`
  - `src/core/llm/evaluator-models.ts:58:  for (const c of EVALUATOR_CHAIN) {`
- `dispatchStrongEvaluator`:
  - `src/core/llm/evaluator-models.ts:45:export async function dispatchStrongEvaluator(`
  - `src/core/orchestrator/node-executor.ts:11:import { dispatchStrongEvaluator } from "@/core/llm/evaluator-models";`
  - `src/core/orchestrator/node-executor.ts:462:    const strong = await dispatchStrongEvaluator(messages).catch(() => null);`
  - `tests/harness/evaluator-and-tier.test.ts:5, 74, 83, 96`
  - `tests/llm/evaluator-freellmapi.test.ts:2, 40, 62, 83, 103, 108, 127, 139, 154`
  - `tests/orchestrator/avaliador-somente-pago.test.ts:23, 45, 85`

---

## 5. Divergência Plantada

Execução em 3 rodadas usando o FreeLLMAPI real contra um código defeituoso (endpoint `POST /api/tarefas` retornando status HTTP 200 em vez do 201 exigido pelo `REQ-001`):

| Rodada | `servedBy` | REQ marcado como não implementado? | Trecho bruto do veredito |
|---|---|---|---|
| 1 | `ollama/nemotron-3-ultra` | Sim (`status: parcial`) | `verdict: REJECTED`<br>`reqVerdicts: [{"id":"REQ-001","status":"parcial","evidencia":"src/app/api/tarefas/route.ts:5-6"},{"id":"REQ-002","status":"ausente","evidencia":"src/app/api/tarefas/route.ts:1-7"}]` |
| 2 | `ollama/nemotron-3-ultra` | Sim (`status: ausente`) | `verdict: REJECTED`<br>`reqVerdicts: [{"id":"REQ-001","status":"ausente","evidencia":"src/app/api/tarefas/route.ts:6"},{"id":"REQ-002","status":"ausente","evidencia":"src/app/api/tarefas/route.ts:1-7"}]` |
| 3 | `ollama/nemotron-3-ultra` | Sim (`status: parcial`) | `verdict: REJECTED`<br>`reqVerdicts: [{"id":"REQ-001","status":"parcial","evidencia":"src/app/api/tarefas/route.ts:6"},{"id":"REQ-002","status":"ausente","evidencia":"src/app/api/tarefas/route.ts:1-7"}]` |

---

## 6. Provas Reais: P1 e P2

### P1 Real (`smoke-p1-p2-10-7-2.ts p1`)
- **Fase final (linha bruta):**
  ```text
  Fase final: ENTREGUE
  ```
- **Compilação do projeto gerado (`tsc --noEmit`):**
  ```text
  tsc --noEmit no projeto gerado: exitCode=0 (0 erros)
  ```
- **Por etapa:**
  - `task-base-1791515042687-1` › avaliador `ollama/nemotron-3-ultra` › `independent: true` › aprovada na 1ª tentativa (`attempts=0`)
  - `task-impl-1791515042687-2` › avaliador `ollama/nemotron-3-ultra` › `independent: true` › aprovada na 1ª tentativa (`attempts=0`)
- **Custo por papel:**
  ```json
  {
    "executor": 0.034716948,
    "avaliador": 0,
    "jev": 0.000228144,
    "outro": 0
  }
  ```
  - **Custo total LLM (`LLM_COST`):** US$ 0.034945 (abaixo do teto de US$ 0.50)
- **Eventos `EVALUATOR_MODEL` brutos:**
  ```text
  {"provider":"nvidia","model":"ollama/nemotron-3-ultra","independentFromExecutor":true,"failures":[]}
  {"provider":"nvidia","model":"ollama/nemotron-3-ultra","independentFromExecutor":true,"failures":[]}
  ```

---

### P2 Real (`smoke-p1-p2-10-7-2.ts p2`)
- **Fase final (linha bruta):**
  ```text
  Fase final: ENTREGUE
  ```
- **Compilação do projeto gerado (`tsc --noEmit`):**
  ```text
  tsc --noEmit no projeto gerado: exitCode=0 (0 erros)
  ```
- **Por etapa:**
  - `task-base-1791515343547-1` › avaliador `ollama/nemotron-3-ultra` › `independent: true` › aprovada na 1ª tentativa (`attempts=0`)
  - `task-impl-1791515343547-2` › avaliador `ollama/nemotron-3-ultra` › `independent: true` › aprovada na 1ª tentativa (`attempts=0`)
  - `task-impl-1791515343547-3` › avaliador `custom/deepseek-v4-pro` › `independent: false` (fallback automático após timeout do Nemotron na rota complexa) › aprovada na 1ª tentativa (`attempts=0`)
- **Custo por papel:**
  ```json
  {
    "executor": 0.049885320000000004,
    "avaliador": 0.012110296,
    "jev": 0.000395808,
    "outro": 0
  }
  ```
  - **Custo total LLM (`LLM_COST`):** US$ 0.062391 (abaixo do teto de US$ 0.50)
- **Eventos `EVALUATOR_MODEL` brutos:**
  ```text
  {"provider":"nvidia","model":"ollama/nemotron-3-ultra","independentFromExecutor":true,"failures":[]}
  {"provider":"nvidia","model":"ollama/nemotron-3-ultra","independentFromExecutor":true,"failures":[]}
  {"provider":"deepseek","model":"custom/deepseek-v4-pro","independentFromExecutor":false,"failures":["nvidia/nemotron-3-ultra: timeout  requisição abortada pelo chamador"]}
  ```

---

## 7. Desvios do Prompt
Nenhum.

---

## 8. Checklist das Travas (T-A … T-L)
- **T-A Pré-condição:** Cumprida. O `git status` inicial continha apenas `.claude/` e o commit `HEAD` correspondia àquele especificado no prompt (`7ac378665e28cf5cc4dcf9c1b9b61421f82db4c2`).
- **T-B Escopo fechado:** Cumprida. Apenas os arquivos permitidos em P3.1 e P3.2 foram alterados. Nenhum timeout aumentado, nenhum `.skip`/`.only`, nenhum catch vazio.
- **T-C Literalidade:** Cumprida. Cadeia exata (`nemotron-3-ultra` → `deepseek-v4-pro` → `claude-sonnet-4-5`), prefixos de rota e ordem rigorosamente implementados.
- **T-D Nomes reais:** Cumprida. Todos os nomes validados via `git grep -n`.
- **T-E Um passo = um commit:** Cumprida. Dois commits incrementais (`cbdb0a0` e `3e93e8b`), ambos com `tsc` e `vitest` 100% verdes.
- **T-F Banco:** Cumprida. Cópias isoladas em diretórios temporários (`dev-copy.db`) para P1 e P2.
- **T-G Segredos:** Cumprida. Nenhuma chave secreta exposta em código ou relatório.
- **T-H Dependências:** Cumprida. Nenhuma biblioteca externa adicionada.
- **T-I Fim de linha:** Cumprida. EOL verificado com `git ls-files --eol`.
- **T-J Paradas obrigatórias:** Cumprida. Custos dentro do limite de US$ 0,50 (P1 = US$ 0.035, P2 = US$ 0.062) e todas as avaliações foram atendidas estritamente dentro dos prefixos cadastrados (`ollama/nemotron-3-ultra` e `custom/deepseek-v4-pro`).
- **T-K Commits:** Cumprida. Todos os commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel:** Cumprida. Todos os valores de fase final (`Fase final: ENTREGUE`), custos, tarefas e eventos foram extraídos textualmente dos logs brutos de execução.

---

## 9. Dúvidas Abertas
Nenhuma. A cadeia de avaliadores pelo FreeLLMAPI operou de forma robusta e o fallback automático de Nemotron para DeepSeek na etapa de frontend do P2 garantiu a entrega sem intervenção manual.
