# Prompt R1 (continuação v3) — só FreeLLMAPI nos papéis críticos + trava de rota paga

> **Substitui** `R1-continuacao-testes.md` e `R1-continuacao-freellmapi.md` (não enviar esses).
> Base: `docs/NEXTCODE-REFERENCIA.md` §5.2 "Auditoria 2 (08/10)". Copie de **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Continuação do R1 (v3) — interruptor de teste; papéis críticos só pelo FreeLLMAPI (perfil pago → modelo pago fixo); trava de rota paga pelo X-Routed-Via; depois R1.4–R1.6

Contexto verificado pelo auditor (não reabra):
- Sua parada no R1.3 estava correta.
- **DeepSeek direto (BYOK) está fora.** O DeepSeek pago agora é servido **pelo FreeLLMAPI** (provedor `custom`). OmniRoute está pausado.
- Pedir só o nome do modelo **não** garante provedor pago: `deepseek-v4-flash` foi servido por `electronhub` (gratuito). O FreeLLMAPI devolve o provedor real no cabeçalho `X-Routed-Via` (o código já guarda isso em `servedBy`, `callGateway` em `src/core/llm/gateways.ts`).
- Perfil `auto:<nome>` inexistente no FreeLLMAPI → HTTP 400 → `SmartRouter` passa ao próximo item da lista.

## TRAVAS
Valem todas as travas T-A…T-K de `docs/prompts/R1-roteamento-pago-primeiro.md`, com esta T-A:
- **T-A (v3).** `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/R1-continuacao-v3.md`. `git status --short` mostra **somente** `M src/core/orchestrator/node-executor.ts`, `M src/core/skills/executor-tool-loop.ts`, `?? tests/orchestrator/executor-somente-pago.test.ts` e arquivos em `.claude/`. Diferente → PARE.

---

## PASSO R1.3 (conclusão) — interruptor de teste

**PODE ALTERAR** (além do que você já alterou no R1.3): `src/core/orchestrator/node-executor.ts`, `tests/orchestrator/characterization.test.ts`, `tests/orchestrator/execution-trigger-routes.test.ts`, `tests/orchestrator/job-worker.test.ts`, `tests/orchestrator/executor-somente-pago.test.ts`.

1. Em `node-executor.ts`, logo abaixo de `setExecutorModeForTests`:
   ```ts
   let paidOnlyOverrideForTests: boolean | null = null;
   /** Testes de fila/worker/rotas usam o LLM falso pela rota antiga; desligam o "somente pago" só para eles. */
   export function setPaidOnlyRoutingForTests(value: boolean | null): void {
     paidOnlyOverrideForTests = value;
   }
   export function isPaidOnlyRouting(policy: OrchestrationPolicy): boolean {
     return paidOnlyOverrideForTests ?? policy.roteamentoPapeisCriticos.somentePago;
   }
   ```
   Importe só o tipo `OrchestrationPolicy` de `@/core/config/orchestration-policy` se ainda não estiver importado.
2. Na decisão do R1.3, trocar `policy.roteamentoPapeisCriticos.somentePago ?` por `isPaidOnlyRouting(policy) ?`.
3. `characterization.test.ts`, `execution-trigger-routes.test.ts`, `job-worker.test.ts` — **somente**: importar `setPaidOnlyRoutingForTests`; `setPaidOnlyRoutingForTests(false)` na **primeira linha** do `beforeEach` de nível superior existente; `setPaidOnlyRoutingForTests(null)` na **primeira linha** do `afterAll` de nível superior existente. Em `job-worker.test.ts`, teste "8. critério de aceite 2 (queda real)": o script do processo filho importa `setPaidOnlyRoutingForTests` do caminho absoluto de `src/core/orchestrator/node-executor.ts` (construído como `jobWorkerModulePath`) e chama `setPaidOnlyRoutingForTests(false);` antes de `startJobWorker();`. Nada mais.
4. `executor-somente-pago.test.ts`: `setPaidOnlyRoutingForTests(null)` em `beforeEach` e `afterEach`; acrescentar `setPaidOnlyRoutingForTests(false) faz o executor voltar à rota antiga`.
5. `tsc` 0 e suíte completa verde. Teste antigo quebrando fora desses arquivos → PARE com a lista.

Commit: `feat(executor): R1.3 - executor somente em provedor pago`.

---

## PASSO R1.3b — rota paga só pelo FreeLLMAPI + trava X-Routed-Via

**PODE ALTERAR:** `config/politicas-orquestracao.yaml`, `src/core/config/orchestration-policy.ts`, `tests/harness/orchestration-policy-and-skills.test.ts`, `src/core/llm/paid-routing.ts`, `tests/llm/paid-routing.test.ts`, `src/core/router/smart-router.ts` (somente `DispatchOptions`, `tryOpenAiGateway` e a linha que chama `this.tryOpenAiGateway(`), `tests/router/rota-paga-routed-via.test.ts` (NOVO), `src/core/orchestrator/node-executor.ts` e `src/core/skills/executor-tool-loop.ts` (somente para passar os novos parâmetros), `tests/orchestrator/executor-somente-pago.test.ts`.

1. **YAML**, bloco `roteamento_papeis_criticos` — acrescentar (sem remover as chaves existentes):
   ```yaml
     modelo_pago_forte: "deepseek-v4-pro"                 # modelo pago fixo no FreeLLMAPI (níveis medio/pesado)
     perfil_freellmapi_forte: "nextcode-pago-forte"        # perfil do FreeLLMAPI só com modelos pagos (opcional; 400 se não existir)
     perfil_freellmapi_barato: "nextcode-pago-barato"
     prefixos_rota_paga: "custom/"                         # X-Routed-Via aceito para papéis críticos (lista separada por vírgula)
   ```
   Atualize o comentário de `modelo_pago_barato` para `# modelo pago fixo no FreeLLMAPI (nível 'rapido')`.
2. **orchestration-policy.ts**: em `roteamentoPapeisCriticos` acrescentar `modeloPagoForte: string; perfilFreellmapiForte: string; perfilFreellmapiBarato: string; prefixosRotaPaga: string[];` com padrões `"deepseek-v4-pro"`, `"nextcode-pago-forte"`, `"nextcode-pago-barato"`, `["custom/"]`. `prefixosRotaPaga` = `extractScalarString(...)` dividido por vírgula, sem espaços, sem vazios. Teste: `R1.3b: lê modelo forte, perfis e prefixos_rota_paga, com padrões`.
3. **paid-routing.ts** — reescrever com exatamente:
   ```ts
   export interface PaidRoutingConfig {
     modeloPagoForte: string;
     modeloPagoBarato: string;
     perfilFreellmapiForte: string;
     perfilFreellmapiBarato: string;
   }

   /**
    * Rota dos papéis críticos: SOMENTE FreeLLMAPI (DeepSeek direto fora e OmniRoute pausado — decisões de 08/10).
    * 1º perfil pago (auto:<perfil>); 2º modelo pago fixo. Nunca auto / auto:smart / auto:fast.
    * Quem garante que a resposta veio de provedor pago é a trava X-Routed-Via no SmartRouter.
    */
   export async function loadPaidGatewaysForTier(
     nivel: "rapido" | "medio" | "pesado",
     cfg: PaidRoutingConfig,
     loader: () => Promise<GatewayConfig[]> = loadGatewayConfigs
   ): Promise<GatewayConfig[]>
   ```
   Regra: `free = (await loader()).find((g) => g.id === "freellmapi")`; sem `free` → `[]`. Com `free` (`barato = nivel === "rapido"`):
   `[{ ...free, heavyFirst: true, modelFast: null, modelHeavy: \`auto:${barato ? cfg.perfilFreellmapiBarato : cfg.perfilFreellmapiForte}\` }, { ...free, heavyFirst: true, modelFast: null, modelHeavy: barato ? cfg.modeloPagoBarato : cfg.modeloPagoForte }]`. Erro do `loader` → `[]`. **Nenhum outro gateway entra.**
4. **smart-router.ts — trava de rota paga:**
   - Em `DispatchOptions` acrescentar `/** Papéis críticos: só aceita resposta cujo X-Routed-Via comece com um destes prefixos. */ allowedRoutedViaPrefixes?: string[];`.
   - `tryOpenAiGateway` recebe um 7º parâmetro opcional `allowedRoutedViaPrefixes?: string[]` e a chamada `this.tryOpenAiGateway(gw, messages, tier, stream, signal, options.maxTokens)` passa `options.allowedRoutedViaPrefixes`.
   - Em `tryOpenAiGateway`, quando `attempt.ok` **e** a lista existir e não estiver vazia **e** nenhum prefixo casar com `attempt.servedBy` (comparação sem diferenciar maiúsculas): `await attempt.response.body?.cancel().catch(() => {})`; registrar `TelemetryLogger.log({ action: "llm.gateway_failure", details: { gateway: gw.id, requestedModel: model, kind: "bad_request", status: null, detail: \`rota não paga recusada: ${attempt.servedBy}\` } })`; devolver `{ failedKind: "bad_request" }`. Sem a lista → comportamento atual idêntico.
   - Testes em `tests/router/rota-paga-routed-via.test.ts` (servidor HTTP falso local, como em `tests/llm/gateways.test.ts`): `X-Routed-Via custom/deepseek-v4-pro é aceito`; `X-Routed-Via electronhub/... é recusado e o próximo item da lista é tentado`; `sem allowedRoutedViaPrefixes nada muda`; `todos recusados → providerUsed none`.
5. **node-executor.ts / executor-tool-loop.ts**: a chamada passa a ser `loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos)`; nas três chamadas do executor com `paidGateways` (laço, chamada única, reenvio do relatório) acrescentar `allowedRoutedViaPrefixes: policy.roteamentoPapeisCriticos.prefixosRotaPaga` (no laço, via novo campo `allowedRoutedViaPrefixes?: string[]` em `ExecutorToolLoopParams`). E **retirar** `deepseekKey` dessas três chamadas pagas (DeepSeek direto está fora).
6. **tests/llm/paid-routing.test.ts** — substituir os testes do R1.2 por: `medio/pesado: auto:nextcode-pago-forte e depois deepseek-v4-pro, só freellmapi`; `rapido: auto:nextcode-pago-barato e depois deepseek-flash`; `deepseek direto e omniroute nunca entram`; `sem freellmapi → lista vazia`; `nenhum item usa auto, auto:smart ou auto:fast`; `loader com erro → lista vazia`.
7. **executor-somente-pago.test.ts**: ajustar expectativas à nova lista; acrescentar `chamadas pagas levam allowedRoutedViaPrefixes ["custom/"] e não levam deepseekKey`.

Commit: `feat(llm): R1.3b - papeis criticos so pelo FreeLLMAPI e trava de rota paga (X-Routed-Via)`.

---

## PASSO R1.4 — avaliador sem queda para o gratuito
Como no prompt original, com: condição `isPaidOnlyRouting(loadOrchestrationPolicy())`; **PODE ALTERAR** também `tests/harness/end-to-end-harness-plan.test.ts` e `tests/skills/executor-tool-loop.test.ts`, **somente** para importar `setPaidOnlyRoutingForTests` no `import` que já traz `setExecutorModeForTests`, chamar `setPaidOnlyRoutingForTests(false)` logo após `setExecutorModeForTests(...)` do `beforeEach` existente e `setPaidOnlyRoutingForTests(null)` logo após `setExecutorModeForTests(null)` do `afterEach` existente; `avaliador-somente-pago.test.ts` com `setPaidOnlyRoutingForTests(null)` em `beforeEach`/`afterEach`. **Não** altere `evaluator-models.ts` (avaliador no FreeLLMAPI é outro pacote).

## PASSO R1.5 — como no prompt original.

## PASSO R1.6 — prova real
**Pré-condição do fundador:** no painel do FreeLLMAPI, o ID dos modelos do provedor DeepSeek deve estar **sem** o marcador `• ` (hoje está `• deepseek-v4-pro` e `• deepseek-flash`, e a DeepSeek recusa com 400). Antes de rodar, chame uma vez `POST /v1/chat/completions` no FreeLLMAPI com `model: "deepseek-v4-pro"`, `max_tokens: 512`, e cole status + `X-Routed-Via`. Se não for 200 com `custom/...` → **PARE** e relate (não rode P1/P2).
Depois, P1 e P2 como no prompt original (sem interruptor). Se qualquer chamada de executor ou avaliador for atendida por rota fora de `prefixos_rota_paga` → PARE.

## RELATÓRIO
Formato do prompt original, acrescentando: (a) tabela `arquivo de teste antigo › linhas alteradas (git diff -U0)`; (b) por chamada de executor na prova real: `modelo pedido › status › X-Routed-Via › aceito/recusado`.

===== FIM DO PROMPT =====
