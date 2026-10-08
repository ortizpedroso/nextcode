# Relatório — Tarefa R1: Roteamento Pago Primeiro (Executor e Avaliador Somente no Pago + Trava `X-Routed-Via` no FreeLLMAPI)

## 1. Identificação

- **Hash de partida (R1 v1):** `bccf119380df64405d2e220a18b6c7703db8ae28`
- **Hash de partida (R1 v2 — ID `deepseek-flash`):** `aacd5bfce9843b24ad62cc0aea93eec2c20fe148`
- **Hash de partida (R1 v3 — continuação FreeLLMAPI + `X-Routed-Via`):** `b74edda329f531ece81beb8338ad4507a62a918d`
- **`git log --oneline aacd5bf..HEAD`:**
  ```text
  88ab558 feat(jev): R1.5 - modelo barato so com confianca alta; reserva no Pro
  6ab284e feat(avaliador): R1.4 - avaliador sem queda para o gratuito
  9a9d539 feat(llm): R1.3b - papeis criticos so pelo FreeLLMAPI e trava de rota paga (X-Routed-Via)
  a2c9b2c feat(executor): R1.3 - executor somente em provedor pago
  b74edda docs(R1 v3): ponto de partida alinhado ao HEAD; diario
  c1dc964 docs(diario): R1 v3 entregue, proximo passo e pendencias
  5e3cbaa docs(R1 v3): esclarece leitura do perfil vazio
  016101d docs(R1 v3): DeepSeek pago confirmado no FreeLLMAPI; perfis opcionais com padrao vazio
  bf66ea2 docs: auditoria 2 (DeepSeek pelo FreeLLMAPI, divisao por tamanho) e prompt R1 v3
  825ad65 docs: auditoria de gateways (OmniRoute pausado, FreeLLMAPI primeiro), prompt R1 continuacao v2
  1b018f1 docs(R1): decisao sobre testes antigos e prompt de continuacao
  51e141e feat(llm): R1.2 - gateways somente pagos para papeis criticos
  69d8a94 feat(policy): R1.1 - roteamento dos papeis criticos (somente pago, modelo barato)
  ```

---

## 2. Por commit (`git show --stat`, `npx tsc --noEmit` e `npx vitest run`)

### 2.1 Commit R1.1 — `69d8a94`
```text
69d8a94 feat(policy): R1.1 - roteamento dos papeis criticos (somente pago, modelo barato)
 config/politicas-orquestracao.yaml                 |  5 +++
 src/core/config/orchestration-policy.ts            | 26 +++++++++++
 .../orchestration-policy-and-skills.test.ts        | 50 ++++++++++++++++++++++
 3 files changed, 81 insertions(+)
```
- `npx tsc --noEmit`: `0 erros` (saída vazia, exit code 0)
- `npx vitest run`:
  ```text
  Test Files  80 passed (80)
       Tests  587 passed (587)
  ```

### 2.2 Commit R1.2 — `51e141e`
```text
51e141e feat(llm): R1.2 - gateways somente pagos para papeis criticos
 src/core/llm/paid-routing.ts   | 21 ++++++++++++++
 tests/llm/paid-routing.test.ts | 65 ++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 86 insertions(+)
```
- `npx tsc --noEmit`: `0 erros` (saída vazia, exit code 0)
- `npx vitest run`:
  ```text
  Test Files  81 passed (81)
       Tests  591 passed (591)
  ```

### 2.3 Commit R1.3 — `a2c9b2c`
```text
a2c9b2c feat(executor): R1.3 - executor somente em provedor pago
 src/core/orchestrator/node-executor.ts             | 108 ++++++---
 src/core/skills/executor-tool-loop.ts              |  38 +--
 tests/orchestrator/characterization.test.ts        |   4 +-
 .../orchestrator/execution-trigger-routes.test.ts  |   3 +
 tests/orchestrator/executor-somente-pago.test.ts   | 255 +++++++++++++++++++++
 tests/orchestrator/job-worker.test.ts              |   8 +-
 6 files changed, 371 insertions(+), 45 deletions(-)
```
- `npx tsc --noEmit`: `0 erros` (saída vazia, exit code 0)
- `npx vitest run`:
  ```text
  Test Files  82 passed (82)
       Tests  597 passed (597)
  ```

### 2.4 Commit R1.3b — `9a9d539`
```text
9a9d539 feat(llm): R1.3b - papeis criticos so pelo FreeLLMAPI e trava de rota paga (X-Routed-Via)
 config/politicas-orquestracao.yaml                 |   6 +-
 src/core/config/orchestration-policy.ts            |  31 +++
 src/core/llm/paid-routing.ts                       |  37 +++-
 src/core/orchestrator/node-executor.ts             |   7 +-
 src/core/router/smart-router.ts                    |  25 ++-
 src/core/skills/executor-tool-loop.ts              |   3 +-
 .../orchestration-policy-and-skills.test.ts        |  64 ++++++-
 tests/llm/paid-routing.test.ts                     |  93 +++++++--
 tests/orchestrator/executor-somente-pago.test.ts   |  42 +++-
 tests/router/rota-paga-routed-via.test.ts          | 213 +++++++++++++++++++++
 10 files changed, 474 insertions(+), 47 deletions(-)
```
- `npx tsc --noEmit`: `0 erros` (saída vazia, exit code 0)
- `npx vitest run`:
  ```text
  Test Files  83 passed (83)
       Tests  606 passed (606)
  ```

### 2.5 Commit R1.4 — `6ab284e`
```text
6ab284e feat(avaliador): R1.4 - avaliador sem queda para o gratuito
 src/core/orchestrator/node-executor.ts            |   6 +-
 tests/harness/end-to-end-harness-plan.test.ts     |   4 +-
 tests/orchestrator/avaliador-somente-pago.test.ts | 119 ++++++++++++++++++++++
 tests/skills/executor-tool-loop.test.ts           |   3 +
 4 files changed, 130 insertions(+), 2 deletions(-)
```
- `npx tsc --noEmit`: `0 erros` (saída vazia, exit code 0)
- `npx vitest run`:
  ```text
  Test Files  84 passed (84)
       Tests  609 passed (609)
  ```

### 2.6 Commit R1.5 — `88ab558`
```text
88ab558 feat(jev): R1.5 - modelo barato so com confianca alta; reserva no Pro
 src/core/decision/jev-decisions.ts       |   3 +-
 tests/decision/jev-modelo-barato.test.ts | 115 +++++++++++++++++++++++++++++++
 2 files changed, 117 insertions(+), 1 deletion(-)
```
- `npx tsc --noEmit`: `0 erros` (saída vazia, exit code 0)
- `npx vitest run`:
  ```text
  Test Files  85 passed (85)
       Tests  613 passed (613)
  ```

---

## 3. Passo R1.0 — Lista de `id` de `/v1/models` e Pré-condição FreeLLMAPI

- `GET https://api.deepseek.com/v1/models` (HTTP 200):
  ```json
  ["deepseek-flash", "deepseek-v4-pro"]
  ```
- Pré-condição R1.6 (`POST /v1/chat/completions` no FreeLLMAPI com `model: "deepseek-v4-pro"`, `max_tokens: 512`):
  ```json
  {"status":200,"xRoutedVia":"custom/deepseek-v4-pro"}
  ```

---

## 4. Testes novos e (a) Testes antigos alterados (`git diff -U0`)

### 4.1 Tabela de testes novos

| Arquivo | Nome do teste | O que prova |
| --- | --- | --- |
| `tests/harness/orchestration-policy-and-skills.test.ts` | `R1.1: lê roteamento_papeis_criticos do YAML e usa os padrões quando as chaves faltam` | Leitura de `somente_pago`, `modelo_pago_barato` e `confianca_minima_modelo_barato` com valores padrão quando ausentes |
| `tests/harness/orchestration-policy-and-skills.test.ts` | `R1.3b: lê modelo forte, perfis e prefixos_rota_paga, com padrões` | Leitura de `modelo_pago_forte`, `perfil_freellmapi_forte`, `perfil_freellmapi_barato` e `prefixos_rota_paga` separados por vírgula |
| `tests/llm/paid-routing.test.ts` | `perfis vazios (padrão): só deepseek-v4-pro no freellmapi (medio/pesado)` | Com perfis vazios, `medio` e `pesado` devolvem somente `freellmapi` com `modelHeavy: "deepseek-v4-pro"` e `heavyFirst: true` |
| `tests/llm/paid-routing.test.ts` | `perfis vazios: rapido usa deepseek-flash` | No nível `rapido`, devolve somente `freellmapi` com `modelHeavy: "deepseek-flash"` |
| `tests/llm/paid-routing.test.ts` | `com perfil configurado: auto:<perfil> primeiro e depois o modelo fixo` | Quando há perfil configurado, monta `[auto:<perfil>, <modelo fixo>]` na ordem exata |
| `tests/llm/paid-routing.test.ts` | `deepseek direto e omniroute nunca entram` | Exclui `deepseek` direto e `omniroute` da rota paga |
| `tests/llm/paid-routing.test.ts` | `sem freellmapi → lista vazia` | Sem `freellmapi` habilitado/com chave, devolve `[]` |
| `tests/llm/paid-routing.test.ts` | `nenhum item usa auto, auto:smart ou auto:fast` | Garante `modelFast: null` e que `modelHeavy` nunca é `auto`, `auto:smart` ou `auto:fast` |
| `tests/llm/paid-routing.test.ts` | `loader com erro → lista vazia` | Em caso de exceção no `loader`, devolve `[]` |
| `tests/router/rota-paga-routed-via.test.ts` | `X-Routed-Via custom/deepseek-v4-pro é aceito` | Aceita resposta do FreeLLMAPI quando `X-Routed-Via` começa com `custom/` |
| `tests/router/rota-paga-routed-via.test.ts` | `X-Routed-Via electronhub/... é recusado e o próximo item da lista é tentado` | Recusa `electronhub/...` com `llm.gateway_failure` (`rota não paga recusada`) e avança para o próximo item |
| `tests/router/rota-paga-routed-via.test.ts` | `sem allowedRoutedViaPrefixes nada muda` | Mantém o comportamento normal para chamadas sem `allowedRoutedViaPrefixes` |
| `tests/router/rota-paga-routed-via.test.ts` | `todos recusados → providerUsed none` | Quando todos os itens têm `X-Routed-Via` fora de `allowedRoutedViaPrefixes`, devolve `providerUsed: "none"` |
| `tests/orchestrator/executor-somente-pago.test.ts` | `rapido chama o roteador com tier heavy e só o gateway pago com deepseek-flash` | Executor `rapido` usa `tier: "heavy"`, `freellmapi` com `deepseek-flash` e registra `EXECUTOR_ROTA_PAGA` |
| `tests/orchestrator/executor-somente-pago.test.ts` | `pesado chama com deepseek-v4-pro` | Executor `pesado` usa `tier: "heavy"` e `freellmapi` com `deepseek-v4-pro` |
| `tests/orchestrator/executor-somente-pago.test.ts` | `nenhuma chamada do executor recebe groqKey, nvidiaKey, geminiKey ou omniRouteKey` | Nenhuma chave de fallback gratuito é repassada ao roteador |
| `tests/orchestrator/executor-somente-pago.test.ts` | `chamadas pagas levam allowedRoutedViaPrefixes ["custom/"] e não levam deepseekKey` | Chamadas pagas levam `allowedRoutedViaPrefixes: ["custom/"]` e `deepseekKey: undefined` |
| `tests/orchestrator/executor-somente-pago.test.ts` | `sem gateway pago → providerUsed none → etapa volta a pending sem gastar tentativa e sessão PAUSADA` | Sem rota paga disponível, a etapa volta para `pending` (`attempts: 0`) e a sessão vai para `PAUSADA` |
| `tests/orchestrator/executor-somente-pago.test.ts` | `somentePago false → chamada idêntica à de hoje (tier fast no rapido)` | Com `somentePago: false`, preserva o comportamento legado |
| `tests/orchestrator/executor-somente-pago.test.ts` | `setPaidOnlyRoutingForTests(false) faz o executor voltar à rota antiga` | O interruptor de teste desliga o modo somente pago |
| `tests/orchestrator/avaliador-somente-pago.test.ts` | `avaliador pago falha → não chama a rota gratuita e devolve null` | Quando `dispatchStrongEvaluator` falha e `somentePago` está ativo, não chama `smartRouter.dispatchWithFallback` e devolve `null` |
| `tests/orchestrator/avaliador-somente-pago.test.ts` | `EVALUATOR_MODEL registra provider nenhum-pago` | Registra `EVALUATOR_MODEL` com `provider: "nenhum-pago"` |
| `tests/orchestrator/avaliador-somente-pago.test.ts` | `somentePago false → mantém a rota gratuita (comportamento antigo)` | Com `somentePago: false`, faz fallback para a rota `tier: "fast"` |
| `tests/decision/jev-modelo-barato.test.ts` | `rapido com confiança 0.90 → rapido` | Jev com `choice: "rapido"` e `confidence: 0.90` (>= 0.85) mantém `rapido` |
| `tests/decision/jev-modelo-barato.test.ts` | `rapido com confiança 0.80 → medio` | Jev com `choice: "rapido"` e `confidence: 0.80` (< 0.85) sobe para `medio` |
| `tests/decision/jev-modelo-barato.test.ts` | `sem Jev, 1 arquivo → medio` | Reserva determinística sem Jev usa `medio` (Pro) mesmo para 1 arquivo |
| `tests/decision/jev-modelo-barato.test.ts` | `limiar vem da política (0.95 → confiança 0.90 vira medio)` | Respeita `confiancaMinimaModeloBarato` configurado na política |

### 4.2 (a) Tabela `arquivo de teste antigo › linhas alteradas (git diff -U0)`

| Arquivo de teste antigo | Linhas alteradas (`git diff -U0 51e141e..HEAD`) |
| --- | --- |
| `tests/orchestrator/characterization.test.ts` | `@@ -19 +19 @@` (`import { executeTaskNode, setPaidOnlyRoutingForTests } ...`)<br>`@@ -218,0 +219 @@` (`setPaidOnlyRoutingForTests(null);` em `afterAll`)<br>`@@ -239,0 +241 @@` (`setPaidOnlyRoutingForTests(false);` em `beforeEach`) |
| `tests/orchestrator/execution-trigger-routes.test.ts` | `@@ -15,0 +16 @@` (`import { setPaidOnlyRoutingForTests } ...`)<br>`@@ -234,0 +236 @@` (`setPaidOnlyRoutingForTests(false);` em `beforeEach`)<br>`@@ -244,0 +247 @@` (`setPaidOnlyRoutingForTests(null);` em `afterAll`) |
| `tests/orchestrator/job-worker.test.ts` | `@@ -16,0 +17 @@` (`import { setPaidOnlyRoutingForTests } ...`)<br>`@@ -194,0 +196 @@` (`setPaidOnlyRoutingForTests(false);` em `beforeEach`)<br>`@@ -225,0 +228 @@` (`setPaidOnlyRoutingForTests(null);` em `afterAll`)<br>`@@ -491,0 +495,3 @@` e `@@ -495 +501 @@` (`nodeExecutorModulePath` e `setPaidOnlyRoutingForTests(false);` no processo filho do teste 8) |
| `tests/harness/end-to-end-harness-plan.test.ts` | `@@ -12 +12 @@` (`import { ..., setPaidOnlyRoutingForTests, ... }`)<br>`@@ -71,0 +72 @@` (`setPaidOnlyRoutingForTests(false);` em `beforeEach`)<br>`@@ -79,0 +81 @@` (`setPaidOnlyRoutingForTests(null);` em `afterEach`) |
| `tests/skills/executor-tool-loop.test.ts` | `@@ -12,0 +13 @@` (`setPaidOnlyRoutingForTests,` no `import`)<br>`@@ -182,0 +184 @@` (`setPaidOnlyRoutingForTests(false);` em `beforeEach`)<br>`@@ -197,0 +200 @@` (`setPaidOnlyRoutingForTests(null);` em `afterEach`) |

---

## 5. Evidência de nomes (`nome › git grep -n`)

| Nome | `git grep -n` |
| --- | --- |
| `roteamento_papeis_criticos` | `config/politicas-orquestracao.yaml:172:roteamento_papeis_criticos:` |
| `roteamentoPapeisCriticos` | `src/core/config/orchestration-policy.ts:120:  roteamentoPapeisCriticos: {`<br>`src/core/config/orchestration-policy.ts:304:  roteamentoPapeisCriticos: {`<br>`src/core/config/orchestration-policy.ts:529:  policy.roteamentoPapeisCriticos.somentePago = extractScalarBoolean(` |
| `PaidRoutingConfig` | `src/core/llm/paid-routing.ts:3:export interface PaidRoutingConfig {` |
| `loadPaidGatewaysForTier` | `src/core/llm/paid-routing.ts:15:export async function loadPaidGatewaysForTier(`<br>`src/core/orchestrator/node-executor.ts:945:    ? await loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos)` |
| `setPaidOnlyRoutingForTests` | `src/core/orchestrator/node-executor.ts:671:export function setPaidOnlyRoutingForTests(value: boolean | null): void {` |
| `isPaidOnlyRouting` | `src/core/orchestrator/node-executor.ts:467:    const paidOnly = isPaidOnlyRouting(loadOrchestrationPolicy());`<br>`src/core/orchestrator/node-executor.ts:674:export function isPaidOnlyRouting(policy: OrchestrationPolicy): boolean {`<br>`src/core/orchestrator/node-executor.ts:944:  const paidGateways = isPaidOnlyRouting(policy)` |
| `allowedRoutedViaPrefixes` | `src/core/router/smart-router.ts:244:  allowedRoutedViaPrefixes?: string[];`<br>`src/core/router/smart-router.ts:797:    allowedRoutedViaPrefixes?: string[]`<br>`src/core/router/smart-router.ts:1146:      const gatewayResult = await this.tryOpenAiGateway(gw, messages, tier, stream, signal, options.maxTokens, options.allowedRoutedViaPrefixes);`<br>`src/core/skills/executor-tool-loop.ts:388:  allowedRoutedViaPrefixes?: string[];` |
| `EXECUTOR_ROTA_PAGA` | `src/core/orchestrator/node-executor.ts:950:      action: "EXECUTOR_ROTA_PAGA",` |
| `nenhum-pago` | `src/core/orchestrator/node-executor.ts:472:        provider: strong?.provider ?? (paidOnly ? "nenhum-pago" : "freellmapi-fallback"),` |
| `confiancaMinimaModeloBarato` | `src/core/config/orchestration-policy.ts:123:    confiancaMinimaModeloBarato: number;`<br>`src/core/decision/jev-decisions.ts:356:        if (tier === "rapido" && compAns.confidence < policy.roteamentoPapeisCriticos.confiancaMinimaModeloBarato) tier = "medio";` |
| `decideMicrobriefsPlanningBatch` | `src/core/decision/jev-decisions.ts:246:export async function decideMicrobriefsPlanningBatch(params: {` |
| `makeBlindAuditDispatchFn` | `src/core/orchestrator/node-executor.ts:455:export function makeBlindAuditDispatchFn(` |
| `tryOpenAiGateway` | `src/core/router/smart-router.ts:790:  private async tryOpenAiGateway(` |

---

## 6. Execução real (P1 e P2)

### 6.1 Resumo geral P1 e P2
- **P1 (`API de Tarefas em Memória`):**
  - Fase final: `ENTREGUE` (tempo total `208.7s`)
  - `npx tsc --noEmit` no projeto gerado: `exitCode=0 (0 erros)`
  - Custo total LLM (`LLM_COST`): **US$ 0.047818** | Custo Jev (3 chamadas, 7.219 input tokens): **US$ 0.000303**
- **P2 (`CRUD de Tarefas com Tela`):**
  - Fase final: `ENTREGUE` (tempo total `392.9s`)
  - `npx tsc --noEmit` no projeto gerado: `exitCode=0 (0 erros)`
  - `UI_CHECK_PASSED`: `{"pages":["/tarefas"],"stage":"browser","problems":[],"skipped":false}`
  - Custo total LLM (`LLM_COST`): **US$ 0.110148** | Custo Jev (4 chamadas, 9.432 input tokens): **US$ 0.000396**

### 6.2 Tabela por etapa (P1 e P2)

| Projeto | `nodeId` | Nível planejado (Jev) | Confiança (Jev) | Modelo que respondeu (Executor) | Tentativas | Aprovada na 1ª? |
| --- | --- | --- | --- | --- | --- | --- |
| **P1** | `task-base-1791469882332-1` (`lib/tarefas.ts`) | `rapido` | `0.98` | `custom/deepseek-flash` (via FreeLLMAPI) | 1 (`attempts=0`) | Sim |
| **P1** | `task-impl-1791469882332-2` (`[id]/route.ts, tarefas/route.ts`) | `medio` | `0.69` | `custom/deepseek-v4-pro` (via FreeLLMAPI) | 1 (`attempts=0`) | Sim |
| **P2** | `task-base-1791470135488-1` (`lib/tarefas.ts`) | `rapido` | `0.98` | `custom/deepseek-flash` (via FreeLLMAPI) | 1 (`attempts=0`) | Sim |
| **P2** | `task-impl-1791470135488-2` (`[id]/route.ts, tarefas/route.ts`) | `pesado` (`choice: "medio"`, `conf: 0.46 < 0.65` → `stepUpTier`) | `0.46` | `custom/deepseek-v4-pro` (via FreeLLMAPI) | 1 (`attempts=0`) | Sim |
| **P2** | `task-impl-1791470135488-3` (`tarefas/page.tsx`) | `medio` | `0.67` | `custom/deepseek-v4-pro` (via FreeLLMAPI) | 1 (`attempts=0`) | Sim |

### 6.3 (b) Tabela por chamada de executor na prova real (`modelo pedido › status › X-Routed-Via › aceito/recusado`)

#### P1 (10 chamadas HTTP ao FreeLLMAPI `/v1/chat/completions`, `llm.gateway_failure = 0`)

| # | Etapa | Modelo pedido | Status HTTP | `X-Routed-Via` | Aceito/Recusado |
| --- | --- | --- | --- | --- | --- |
| 1 | `task-base-1791469882332-1` (turno 1) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 2 | `task-base-1791469882332-1` (turno 2) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 3 | `task-base-1791469882332-1` (turno 3) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 4 | `task-base-1791469882332-1` (reenvio relatório) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 5 | `task-impl-1791469882332-2` (turno 1) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 6 | `task-impl-1791469882332-2` (turno 2) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 7 | `task-impl-1791469882332-2` (turno 3) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 8 | `task-impl-1791469882332-2` (turno 4) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 9 | `task-impl-1791469882332-2` (turno 5) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 10 | `task-impl-1791469882332-2` (turno 6) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |

#### P2 (13 chamadas HTTP ao FreeLLMAPI `/v1/chat/completions`, `llm.gateway_failure = 0`)

| # | Etapa | Modelo pedido | Status HTTP | `X-Routed-Via` | Aceito/Recusado |
| --- | --- | --- | --- | --- | --- |
| 1 | `task-base-1791470135488-1` (turno 1) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 2 | `task-base-1791470135488-1` (turno 2) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 3 | `task-base-1791470135488-1` (turno 3) | `deepseek-flash` | `200` | `custom/deepseek-flash` | Aceito |
| 4 | `task-impl-1791470135488-2` (turno 1) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 5 | `task-impl-1791470135488-2` (turno 2) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 6 | `task-impl-1791470135488-2` (turno 3) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 7 | `task-impl-1791470135488-2` (turno 4) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 8 | `task-impl-1791470135488-2` (turno 5) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 9 | `task-impl-1791470135488-2` (turno 6) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 10 | `task-impl-1791470135488-3` (turno 1) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 11 | `task-impl-1791470135488-3` (turno 2) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 12 | `task-impl-1791470135488-3` (turno 3) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |
| 13 | `task-impl-1791470135488-3` (turno 4) | `deepseek-v4-pro` | `200` | `custom/deepseek-v4-pro` | Aceito |

### 6.4 Prova de que nenhuma chamada de executor ou avaliador caiu em rota gratuita ou OmniRoute
- Todas as 23 chamadas de executor (10 em P1 + 13 em P2) foram servidas com `X-Routed-Via` iniciando em `custom/` (`custom/deepseek-flash` nas etapas de nível `rapido` e `custom/deepseek-v4-pro` nas etapas `medio`/`pesado`), com `llm.gateway_failure = 0` e zero chamadas a `omniroute`, `electronhub`, `groq` ou `nvidia`.
- Todas as 5 chamadas de avaliador (2 em P1 + 3 em P2) registraram `EVALUATOR_MODEL` com `provider: "deepseek"`, `model: "deepseek-v4-pro"`, zero quedas para `freellmapi-fallback`.

### 6.5 Comparação de custo com `memory/medicoes.md`

| Projeto | Antes (`memory/medicoes.md`, 10.7) | Agora (R1.6 com `custom/deepseek-flash` no `rapido` + `custom/deepseek-v4-pro` no `medio`/`pesado`) | Diferença |
| --- | --- | --- | --- |
| **P1** | US$ 0.0394 (Etapa 1 saía US$ 0.0000 no modelo gratuito `groq/qwen3-32b`) | **US$ 0.0478** (Etapa 1 toda paga em `custom/deepseek-flash` por US$ 0.0027; Etapa 2 em `custom/deepseek-v4-pro`) | +US$ 0.0084 (100% em modelos pagos, abaixo de US$ 0.50) |
| **P2** | US$ 0.1398 | **US$ 0.1101** (Etapa 1 toda paga em `custom/deepseek-flash` por US$ 0.0030; Etapas 2 e 3 em `custom/deepseek-v4-pro` aprovadas de 1ª) | **-US$ 0.0297 (-21,2%)** |

---

## 7. Desvios do prompt

Nenhum. (No R1.0 e no R1.3 houve paradas obrigatórias previstas pelas travas T-J, seguidas das atualizações oficiais do fundador em `aacd5bf` e `b74edda` / `docs/prompts/R1-continuacao-v3.md`).

---

## 8. Checklist T-A…T-K

- **T-A (Pré-condição):** **Sim** — conferida antes de iniciar (`HEAD` = `aacd5bf` na retomada v2 e `b74edda` na retomada v3; `git status --short` limpo exceto `.claude/`).
- **T-B (Escopo fechado):** **Sim** — cada passo alterou exclusivamente os arquivos listados em `PODE ALTERAR` daquele passo; nenhum timeout aumentado, nenhum `try {} catch {}` vazio novo, nenhum `.skip` ou `.only`.
- **T-C (Literalidade):** **Sim** — assinaturas, chaves YAML, padrões e mensagens de telemetria idênticos à especificação.
- **T-D (Nomes reais):** **Sim** — todos os nomes citados verificados com `git grep -n` na seção 5.
- **T-E (Um passo = um commit):** **Sim** — 6 commits atômicos (`69d8a94`, `51e141e`, `a2c9b2c`, `9a9d539`, `6ab284e`, `88ab558`), cada um precedido por `npx tsc --noEmit` (0 erros) e `npx vitest run` completo (100% verde), sem `--amend`, `rebase`, `reset`, `push --force` ou `--no-verify`.
- **T-F (Banco):** **Sim** — `prisma/dev.db` intocado; todos os testes e provas reais rodaram sobre cópias temporárias via `DATABASE_URL`, removidas ao final.
- **T-G (Segredos):** **Sim** — nenhuma chave exposta em código, logs, telemetria ou relatório.
- **T-H (Dependências):** **Sim** — `package.json` e `package-lock.json` inalterados.
- **T-I (Fim de linha):** **Sim** — todos os arquivos criados/editados mantidos em `i/lf w/lf` (`git ls-files --eol`).
- **T-J (Paradas obrigatórias):** **Sim** — respeitadas no R1.0 e R1.3; custo real de P1 (US$ 0.0478) e P2 (US$ 0.1101) muito abaixo do teto de US$ 0.50.
- **T-K (Co-autoria nos commits):** **Sim** — todos os commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## 9. Dúvidas abertas para o fundador

Nenhuma dúvida bloqueante para o escopo de R1. Como observado em `docs/prompts/R1-continuacao-v3.md` (Passo R1.4), a migração do `dispatchStrongEvaluator` (`evaluator-models.ts`) para também despachar via FreeLLMAPI em vez da chave DeepSeek direta fica para o pacote próprio.
