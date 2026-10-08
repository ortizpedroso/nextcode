> ⛔ **SUBSTITUÍDO** por `docs/prompts/R1-continuacao-v3.md` (DeepSeek direto fora; 08/10). Não enviar.

# Prompt R1 (continuação v2) — interruptor de teste + rota paga pelo FreeLLMAPI

> **Substitui** `docs/prompts/R1-continuacao-testes.md` (não enviar aquele).
> Motivo: auditoria de 08/10 (`docs/NEXTCODE-REFERENCIA.md` §5.2 "Auditoria de gateways"): OmniRoute está pausado e o FreeLLMAPI é
> o gateway do projeto (D3: FreeLLMAPI primeiro, DeepSeek direto só como último recurso). O R1.2 deixou o FreeLLMAPI de fora.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Continuação do R1 (v2) — concluir R1.3 com interruptor de teste, corrigir a rota paga para passar pelo FreeLLMAPI, depois R1.4–R1.6

Contexto verificado pelo auditor (não reabra):
- Sua parada no R1.3 estava correta.
- O OmniRoute está **pausado** (`LlmGateway.omniroute.enabled = false`). O FreeLLMAPI é o gateway do projeto; pela decisão D3, o DeepSeek direto (BYOK) é **último recurso**.
- O FreeLLMAPI roteia `auto:<perfil>` só pela cadeia do perfil; perfil inexistente devolve **HTTP 400 "Profile not found"**, que o `SmartRouter` trata como falha e passa ao próximo gateway da lista. Fixar o nome do modelo **não** garante provedor pago (`deepseek-v4-flash` respondeu via `electronhub`, gratuito).

## TRAVAS
Valem todas as travas T-A…T-K de `docs/prompts/R1-roteamento-pago-primeiro.md`, com esta T-A:
- **T-A (continuação v2).** `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/R1-continuacao-freellmapi.md`. `git status --short` mostra **somente** `M src/core/orchestrator/node-executor.ts`, `M src/core/skills/executor-tool-loop.ts`, `?? tests/orchestrator/executor-somente-pago.test.ts` e arquivos em `.claude/`. Diferente → PARE.

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
3. `characterization.test.ts`, `execution-trigger-routes.test.ts`, `job-worker.test.ts` — **somente**: importar `setPaidOnlyRoutingForTests`; `setPaidOnlyRoutingForTests(false)` na **primeira linha** do `beforeEach` de nível superior existente; `setPaidOnlyRoutingForTests(null)` na **primeira linha** do `afterAll` de nível superior existente.
   Em `job-worker.test.ts`, teste "8. critério de aceite 2 (queda real)": o script do processo filho passa a importar `setPaidOnlyRoutingForTests` do caminho absoluto de `src/core/orchestrator/node-executor.ts` (construído como `jobWorkerModulePath`) e chamar `setPaidOnlyRoutingForTests(false);` antes de `startJobWorker();`. Nada mais.
4. `executor-somente-pago.test.ts`: `setPaidOnlyRoutingForTests(null)` no `beforeEach` e no `afterEach`; acrescentar `setPaidOnlyRoutingForTests(false) faz o executor voltar à rota antiga`.
5. `tsc` 0 e suíte completa verde. Teste antigo quebrando fora desses arquivos → PARE com a lista.

Commit: `feat(executor): R1.3 - executor somente em provedor pago (Flash/Pro)`.

---

## PASSO R1.3b — rota paga: FreeLLMAPI (perfis pagos) primeiro, DeepSeek direto por último

**PODE ALTERAR:** `config/politicas-orquestracao.yaml`, `src/core/config/orchestration-policy.ts`, `tests/harness/orchestration-policy-and-skills.test.ts`, `src/core/llm/paid-routing.ts`, `tests/llm/paid-routing.test.ts`, `src/core/orchestrator/node-executor.ts` (somente a chamada de `loadPaidGatewaysForTier`), `tests/orchestrator/executor-somente-pago.test.ts`.

1. YAML, bloco `roteamento_papeis_criticos`: acrescentar (sem remover as chaves existentes):
   ```yaml
     perfil_freellmapi_forte: "nextcode-pago-forte"    # perfil do FreeLLMAPI só com modelos pagos fortes
     perfil_freellmapi_barato: "nextcode-pago-barato"  # perfil do FreeLLMAPI só com modelos pagos baratos
     modelo_direto_forte: "deepseek-v4-pro"           # último recurso (BYOK DeepSeek direto)
   ```
   `modelo_pago_barato` (já existe, `"deepseek-flash"`) passa a ser o modelo **direto** barato. Atualize o comentário dessa linha para `# último recurso (BYOK DeepSeek direto) no nível 'rapido'`.
2. `orchestration-policy.ts`: em `roteamentoPapeisCriticos` acrescentar `perfilFreellmapiForte: string; perfilFreellmapiBarato: string; modeloDiretoForte: string;` com padrões `"nextcode-pago-forte"`, `"nextcode-pago-barato"`, `"deepseek-v4-pro"`; ler com `extractScalarString`. Teste: `R1.3b: lê perfis do FreeLLMAPI e modelo direto forte, com padrões`.
3. Reescrever `src/core/llm/paid-routing.ts` com exatamente esta assinatura e regra:
   ```ts
   export interface PaidRoutingConfig {
     perfilFreellmapiForte: string;
     perfilFreellmapiBarato: string;
     modeloDiretoForte: string;
     modeloPagoBarato: string;
   }

   /**
    * Rota paga dos papéis críticos (decisão D3 + pausa do OmniRoute): 1º FreeLLMAPI por perfil só de modelos pagos
    * (auto:<perfil>); depois os gateways pagos diretos (BYOK, último recurso). Nunca OmniRoute; nunca auto/auto:smart/auto:fast.
    */
   export async function loadPaidGatewaysForTier(
     nivel: "rapido" | "medio" | "pesado",
     cfg: PaidRoutingConfig,
     loader: () => Promise<GatewayConfig[]> = loadGatewayConfigs
   ): Promise<GatewayConfig[]>
   ```
   Regra (`barato = nivel === "rapido"`):
   - `free = configs.find((g) => g.id === "freellmapi")` → se existir, **primeiro item**: `{ ...free, heavyFirst: true, modelFast: null, modelHeavy: \`auto:${barato ? cfg.perfilFreellmapiBarato : cfg.perfilFreellmapiForte}\` }`.
   - depois, cada `g` com `g.heavyFirst === true` e `g.id !== "freellmapi"`: `{ ...g, modelHeavy: barato ? cfg.modeloPagoBarato : cfg.modeloDiretoForte }`.
   - `omniroute` nunca entra. Erro do `loader` → `[]`.
4. `node-executor.ts`: a chamada passa a ser `loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos)`. Nada mais muda.
5. `tests/llm/paid-routing.test.ts`: **substituir** os 4 testes do R1.2 por:
   - `freellmapi vem primeiro com auto:nextcode-pago-forte (medio/pesado)`
   - `rapido usa auto:nextcode-pago-barato no freellmapi e deepseek-flash no direto`
   - `pesado usa deepseek-v4-pro no deepseek direto`
   - `omniroute nunca entra, mesmo habilitado`
   - `sem freellmapi configurado → só o deepseek direto`
   - `nenhum item usa auto, auto:smart ou auto:fast`
   - `loader com erro → lista vazia`
6. `executor-somente-pago.test.ts`: ajustar as expectativas de modelo/gateway à nova lista (freellmapi `auto:nextcode-pago-*` primeiro, deepseek direto depois) e acrescentar `perfil inexistente no FreeLLMAPI (400) → roteador segue para o deepseek direto` (simular o gateway respondendo 400 com `{"error":{"message":"Profile 'nextcode-pago-forte' not found."}}`).

Commit: `feat(llm): R1.3b - rota paga pelo FreeLLMAPI (perfis pagos) com DeepSeek direto como ultimo recurso`.

---

## PASSO R1.4 — avaliador sem queda para o gratuito
Como no prompt original, com:
- condição `isPaidOnlyRouting(loadOrchestrationPolicy())`;
- **PODE ALTERAR** também `tests/harness/end-to-end-harness-plan.test.ts` e `tests/skills/executor-tool-loop.test.ts`, **somente** para: importar `setPaidOnlyRoutingForTests` no mesmo `import` que já traz `setExecutorModeForTests`; `setPaidOnlyRoutingForTests(false)` logo após `setExecutorModeForTests(...)` do `beforeEach` existente; `setPaidOnlyRoutingForTests(null)` logo após `setExecutorModeForTests(null)` do `afterEach` existente;
- `avaliador-somente-pago.test.ts` com `setPaidOnlyRoutingForTests(null)` em `beforeEach`/`afterEach`; o caso antigo usa `false`.
- Não mude `evaluator-models.ts` (a passagem do avaliador para o FreeLLMAPI é outro pacote).

## PASSO R1.5 — como no prompt original.

## PASSO R1.6 — prova real
Como no prompt original (sem interruptor). **Hoje os perfis `nextcode-pago-*` ainda não existem no FreeLLMAPI**: o esperado é 400 no FreeLLMAPI e resposta pelo DeepSeek direto. Mostre isso nos eventos `llm.gateway_call` / `llm.gateway_failure` (campo do motivo e `X-Routed-Via`). Se alguma chamada de executor ou avaliador for atendida por modelo gratuito → PARE.

## RELATÓRIO
Formato do prompt original, acrescentando: (a) tabela `arquivo de teste antigo › linhas alteradas (git diff -U0)`; (b) por chamada de executor/avaliador na prova real: `gateway tentado › modelo pedido › status › X-Routed-Via`.

===== FIM DO PROMPT =====
