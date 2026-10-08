> ⛔ **SUBSTITUÍDO** por `docs/prompts/R1-continuacao-freellmapi.md` (auditoria de gateways, 08/10). Não enviar.

# Prompt R1 (continuação) — testes antigos com o roteamento "somente pago"

> Resposta à parada do Antigravity no R1.3 (08/10). Análise em `docs/NEXTCODE-REFERENCIA.md` §5.2 ("Testes antigos e o somente pago").
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Continuação do R1 — interruptor de teste para o "somente pago" e conclusão do R1.3 a R1.6

Sua parada no R1.3 estava correta. Decisão do auditor: os 18 testes quebrados (e os de R1.4 que você antecipou) testam **fila, worker, rotas e caracterização**, não o roteamento; eles usam um servidor LLM falso pela rota antiga. Eles passam a rodar com o "somente pago" **desligado por um interruptor de teste**, no mesmo padrão de `setExecutorModeForTests`. O roteamento novo continua coberto pelos testes novos (`executor-somente-pago.test.ts`, R1.4). **Nenhuma asserção existente muda.**

## TRAVAS
Todas as travas T-A…T-K do prompt `docs/prompts/R1-roteamento-pago-primeiro.md` continuam valendo, com esta troca na T-A:
- **T-A (continuação).** `git rev-parse HEAD` deve ser igual a `git log -1 --format=%H -- docs/prompts/R1-continuacao-testes.md`. `git status --short` deve mostrar **somente**: `M src/core/orchestrator/node-executor.ts`, `M src/core/skills/executor-tool-loop.ts`, `?? tests/orchestrator/executor-somente-pago.test.ts` e arquivos dentro de `.claude/` (o seu trabalho do R1.3 ainda não commitado). Diferente → PARE.

## PASSO R1.3 (conclusão) — interruptor + testes antigos

**PODE ALTERAR** (além do que você já alterou no R1.3):
- `src/core/orchestrator/node-executor.ts`
- `tests/orchestrator/characterization.test.ts`
- `tests/orchestrator/execution-trigger-routes.test.ts`
- `tests/orchestrator/job-worker.test.ts`
- `tests/orchestrator/executor-somente-pago.test.ts`

**O que fazer:**
1. Em `node-executor.ts`, logo abaixo de `setExecutorModeForTests` (mesmo estilo):
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
   (`OrchestrationPolicy` vem de `@/core/config/orchestration-policy`; se já não estiver importado, importe só o tipo.)
2. Na decisão do R1.3, trocar `policy.roteamentoPapeisCriticos.somentePago ?` por `isPaidOnlyRouting(policy) ?`. Nada mais muda na lógica.
3. Nos três arquivos de teste antigos, **somente** isto (nenhuma outra linha):
   - `characterization.test.ts`, `execution-trigger-routes.test.ts`, `job-worker.test.ts`: importar `setPaidOnlyRoutingForTests` de `@/core/orchestrator/node-executor`; chamar `setPaidOnlyRoutingForTests(false)` na **primeira linha** do `beforeEach` de nível superior já existente; chamar `setPaidOnlyRoutingForTests(null)` na **primeira linha** do `afterAll` de nível superior já existente.
   - `job-worker.test.ts`, teste "8. critério de aceite 2 (queda real)": o script do processo filho escrito com `fs.writeFileSync(workerScriptFile, ...)` passa a importar também `setPaidOnlyRoutingForTests` do caminho absoluto de `src/core/orchestrator/node-executor.ts` (construído como `jobWorkerModulePath`) e chamar `setPaidOnlyRoutingForTests(false);` **antes** de `startJobWorker();`. Nada mais muda nesse teste.
4. Em `executor-somente-pago.test.ts`: chamar `setPaidOnlyRoutingForTests(null)` no `beforeEach` e no `afterEach` (garante que o padrão `true` da política está valendo) e acrescentar o teste `setPaidOnlyRoutingForTests(false) faz o executor voltar à rota antiga`.
5. `npx tsc --noEmit` (0 erros) e `npx vitest run` completo verde. Se ainda houver teste antigo quebrando **fora** destes três arquivos → PARE com a lista.

Commit: `feat(executor): R1.3 - executor somente em provedor pago (Flash/Pro)` (o mesmo título previsto; o interruptor entra neste commit).

## PASSO R1.4 — como no prompt original, com estes acréscimos

**PODE ALTERAR** (além do previsto no R1.4): `tests/harness/end-to-end-harness-plan.test.ts`, `tests/skills/executor-tool-loop.test.ts`.

1. Em `makeBlindAuditDispatchFn`, a condição é `isPaidOnlyRouting(loadOrchestrationPolicy())` (não a leitura direta da política).
2. Em `end-to-end-harness-plan.test.ts` e `executor-tool-loop.test.ts`: importar `setPaidOnlyRoutingForTests` (no mesmo `import` de `@/core/orchestrator/node-executor` que já traz `setExecutorModeForTests`); chamar `setPaidOnlyRoutingForTests(false)` logo após a linha `setExecutorModeForTests(...)` do `beforeEach` existente e `setPaidOnlyRoutingForTests(null)` logo após `setExecutorModeForTests(null)` do `afterEach` existente. Nenhuma outra linha.
3. Nos testes novos do R1.4 (`avaliador-somente-pago.test.ts`): `setPaidOnlyRoutingForTests(null)` no `beforeEach`/`afterEach`; o caso "comportamento antigo" usa `setPaidOnlyRoutingForTests(false)`.
4. Teste antigo quebrando fora destes arquivos → PARE com a lista.

## PASSOS R1.5 e R1.6
Exatamente como no prompt original. Na prova real (R1.6) **não** use o interruptor: o "somente pago" fica ligado.

## RELATÓRIO
Mesmo formato do prompt original, acrescentando na seção 2 a tabela `arquivo de teste antigo › linhas alteradas (git diff -U0)` para provar que só o interruptor foi acrescentado.

===== FIM DO PROMPT =====
