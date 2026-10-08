# Prompt R1 — Papéis críticos só no pago; Jev escolhe Flash ou Pro (para o Antigravity)

> Regra e análise em `docs/NEXTCODE-REFERENCIA.md` §5.2 ("Análise de 08/10"). Decisão em `memory/decisoes.md`.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa R1 — Executor e avaliador nunca caem no modelo gratuito; o Jev escolhe entre DeepSeek Flash (barato) e Pro

## OBJETIVO
Hoje: (a) o executor de nível `rapido` vai para o FreeLLMAPI gratuito; (b) nos níveis `medio`/`pesado`, se o DeepSeek falhar, o roteador **cai sozinho** para os gateways gratuitos; (c) o avaliador, se Gemini/Claude/DeepSeek falharem, cai para o gratuito. Passa a valer: **executor e avaliador só usam provedor pago**; sem pago disponível a sessão **pausa** (mecanismo `SEM_LLM` que já existe); e o nível `rapido` passa a significar **DeepSeek Flash (pago barato)**, escolhido pelo Jev só com confiança alta.

## TRAVAS (obrigatórias; violar qualquer uma = PARAR e relatar)
- **T-A Pré-condição.** `git status --short` só pode mostrar arquivos dentro de `.claude/`. `git rev-parse HEAD` deve ser igual a `git log -1 --format=%H -- docs/prompts/R1-roteamento-pago-primeiro.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só altere os arquivos de PODE ALTERAR do passo em curso. Precisou de outro → PARE e relate. Nunca aumente timeout, nunca use `try {} catch {}` vazio, `.skip` ou `.only`, e nunca altere teste existente além do que está escrito aqui.
- **T-C Literalidade.** Faça exatamente o que está escrito (nomes, chaves, limiares, ordem). Nada de refatoração ou melhoria extra. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais.** Todo nome citado deve existir (`git grep -n`). Nomes novos: só os escritos aqui.
- **T-E Um passo = um commit.** Antes de CADA commit: `npx tsc --noEmit` (0 erros) e `npx vitest run` completo (tudo verde) **nesse estado**. Cole as saídas. **Proibido**: `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`. Use cópia em pasta temporária (`DATABASE_URL`).
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório ou saída colada.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Os arquivos deste prompt são LF; mantenha LF (`git ls-files --eol`).
- **T-J Paradas obrigatórias.** Teste antigo quebrando por motivo não previsto aqui (cole a lista e PARE — não edite o teste); arquivo fora do escopo; contradição prompt × código; modelo Flash inexistente na API (passo R1.0); custo real de um projeto > US$ 0,50.
- **T-K Commits** terminam com: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## LEITURA OBRIGATÓRIA
- `src/core/router/smart-router.ts`: opção `gateways?: GatewayConfig[]` de `dispatchWithFallback`; bloco "TENTATIVA 1" (ordem `heavyFirst`, `modelForTier`, `omniDisabled`, `aggregatorAlreadyTried`) e as rotas diretas depois dele (Groq, NVIDIA, Gemini, DeepSeek).
- `src/core/llm/gateways.ts`: `GatewayConfig`, `GATEWAY_DEFAULTS` (deepseek: `modelHeavy: "deepseek-v4-pro"`, `heavyFirst: true`), `loadGatewayConfigs`, `modelForTier`.
- `src/core/llm/cost.ts`: tabela `PRICES` (já tem `deepseek-(v4-)?flash`).
- `src/core/orchestrator/node-executor.ts`: as três chamadas `smartRouter.dispatchWithFallback` do executor (chamada única, reenvio do relatório) e `runExecutorToolLoop(...)` com `routerKeys`; `makeBlindAuditDispatchFn` (avaliador: `dispatchStrongEvaluator` e, se falhar, rota `tier: "fast"`); `noLlmAvailable` e o bloco `SEM_LLM`.
- `src/core/skills/executor-tool-loop.ts`: `ExecutorToolLoopParams` (`routerKeys`, `executorTier`) e a chamada `dispatchWithFallback` com `tier: executorTier === "rapido" ? "fast" : "heavy"`; o teste de `providerUsed === "none"`.
- `src/core/decision/jev-decisions.ts`: `decideMicrobriefsPlanningBatch` (cálculo do `tier`, `stepUpTier`, reserva `fileCount <= 1 ? "rapido" : ...`).
- `src/core/config/orchestration-policy.ts`: `extractScalarNumber`, `extractScalarString`, leitura de `jevExecucao` em `loadOrchestrationPolicy` (modelo a seguir).
- `config/politicas-orquestracao.yaml`.

---

## PASSO R1.0 — Conferir que o modelo Flash existe (sem commit)
Com uma **cópia** de `prisma/dev.db`, ler a chave DeepSeek (`readSecret(setting.deepseekKey)`) num script temporário fora do repositório e fazer `GET https://api.deepseek.com/v1/models`. Colar no relatório **só a lista de `id`** (nunca a chave).
- Se `deepseek-v4-flash` estiver na lista → seguir.
- Se não estiver → **PARE** e relate a lista (o fundador escolhe o modelo barato).

---

## PASSO R1.1 — Política

**PODE ALTERAR:** `config/politicas-orquestracao.yaml`, `src/core/config/orchestration-policy.ts`, `tests/harness/orchestration-policy-and-skills.test.ts`.

1. YAML, no fim do arquivo, bloco novo:
   ```yaml
   roteamento_papeis_criticos:
     somente_pago: true                       # executor e avaliador nunca caem no gratuito; sem pago → PAUSADA
     modelo_pago_barato: "deepseek-v4-flash"  # nível 'rapido' do executor
     confianca_minima_modelo_barato: 0.85     # Jev precisa disso em 'rapido' para usar o modelo barato
   ```
2. `orchestration-policy.ts`: campo `roteamentoPapeisCriticos: { somentePago: boolean; modeloPagoBarato: string; confiancaMinimaModeloBarato: number }` na política; padrões `true`, `"deepseek-v4-flash"`, `0.85`; leitura em `loadOrchestrationPolicy` com `extractScalarBoolean`, `extractScalarString`, `extractScalarNumber`.
3. Teste: `R1.1: lê roteamento_papeis_criticos do YAML e usa os padrões quando as chaves faltam`.

Commit: `feat(policy): R1.1 - roteamento dos papeis criticos (somente pago, modelo barato)`.

---

## PASSO R1.2 — Gateways só pagos para os papéis críticos

**PODE ALTERAR:** `src/core/llm/paid-routing.ts` (NOVO), `tests/llm/paid-routing.test.ts` (NOVO).

Criar `src/core/llm/paid-routing.ts` com exatamente:
```ts
import { loadGatewayConfigs, type GatewayConfig } from "@/core/llm/gateways";

/**
 * Gateways pagos (heavyFirst) para executor/avaliador. Nunca inclui FreeLLMAPI nem OmniRoute.
 * nivel 'rapido' troca o modelo pesado pelo modelo pago barato; os demais mantêm o modelo pesado.
 */
export async function loadPaidGatewaysForTier(
  nivel: "rapido" | "medio" | "pesado",
  modeloPagoBarato: string,
  loader: () => Promise<GatewayConfig[]> = loadGatewayConfigs
): Promise<GatewayConfig[]>
```
Regra: `(await loader()).filter((g) => g.heavyFirst === true)`; se `nivel === "rapido"`, cada item vira `{ ...g, modelHeavy: modeloPagoBarato }`. Erro do `loader` → `[]`.

Testes (`tests/llm/paid-routing.test.ts`, com `loader` falso):
- `devolve só gateways heavyFirst (exclui freellmapi e omniroute)`
- `rapido troca o modelo para o pago barato`
- `medio e pesado mantêm deepseek-v4-pro`
- `loader com erro → lista vazia`

Commit: `feat(llm): R1.2 - gateways somente pagos para papeis criticos`.

---

## PASSO R1.3 — Executor só no pago

**PODE ALTERAR:** `src/core/orchestrator/node-executor.ts`, `src/core/skills/executor-tool-loop.ts`, `tests/orchestrator/executor-somente-pago.test.ts` (NOVO).

1. `executor-tool-loop.ts`: em `ExecutorToolLoopParams` acrescentar `paidGateways?: GatewayConfig[]`. Na chamada `dispatchWithFallback` do laço: **se `params.paidGateways` existir** → `tier: "heavy"`, `gateways: params.paidGateways`, e **não** passar `geminiKey`, `groqKey`, `nvidiaKey`, `omniRouteUrl`, `omniRouteKey` (só `deepseekKey`); senão, comportamento atual inalterado.
2. `node-executor.ts`, em `executeTaskNode`, depois de calcular `executorTier`: se `policy.roteamentoPapeisCriticos.somentePago` → `const paidGateways = await loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos.modeloPagoBarato)`. Usar `paidGateways` nas **três** rotas do executor:
   - laço: passar `paidGateways` para `runExecutorToolLoop`;
   - chamada única e reenvio do relatório: `tier: "heavy"`, `gateways: paidGateways`, sem `geminiKey`/`groqKey`/`nvidiaKey`/`omniRouteUrl`/`omniRouteKey`.
   Com `somentePago: false` → tudo exatamente como hoje.
3. Registrar `TelemetryLogger.log({ sessionId, action: "EXECUTOR_ROTA_PAGA", details: { nodeId, executorTier, modelos: paidGateways.map((g) => g.modelHeavy), gateways: paidGateways.map((g) => g.id) } })` uma vez por execução de etapa.
4. Sem gateway pago (lista vazia ou todos falham) o roteador devolve `providerUsed: "none"` → o caminho `noLlmAvailable` / `SEM_LLM` existente pausa a sessão sem gastar tentativa. **Não** criar outro caminho de pausa.
5. Testes (`tests/orchestrator/executor-somente-pago.test.ts`, `smartRouter.dispatchWithFallback` simulado por `vi.spyOn`, mesmo estilo de `tests/governance/secret-guard.test.ts`):
   - `rapido chama o roteador com tier heavy e só o gateway pago com deepseek-v4-flash`
   - `pesado chama com deepseek-v4-pro`
   - `nenhuma chamada do executor recebe groqKey, nvidiaKey, geminiKey ou omniRouteKey`
   - `sem gateway pago → providerUsed none → etapa volta a pending sem gastar tentativa e sessão PAUSADA`
   - `somentePago false → chamada idêntica à de hoje (tier fast no rapido)`

Commit: `feat(executor): R1.3 - executor somente em provedor pago (Flash/Pro)`.

---

## PASSO R1.4 — Avaliador sem queda para o gratuito

**PODE ALTERAR:** `src/core/orchestrator/node-executor.ts` (somente `makeBlindAuditDispatchFn`), `tests/orchestrator/avaliador-somente-pago.test.ts` (NOVO).

1. Em `makeBlindAuditDispatchFn`: quando `dispatchStrongEvaluator` não devolver conteúdo **e** `loadOrchestrationPolicy().roteamentoPapeisCriticos.somentePago === true` → devolver `null` (sem chamar a rota `tier: "fast"`). O evento `EVALUATOR_MODEL` continua sendo registrado, com `provider: "nenhum-pago"` nesse caso (no lugar de `"freellmapi-fallback"`). Com `somentePago: false` → igual a hoje.
2. `null` já leva ao caminho existente de "falha do avaliador" (`heuristic_fallback` → `evaluatorOutageFreeRetry`, que não gasta tentativa até `MAX_FREE_EVALUATOR_RETRIES`). **Não** alterar esse caminho.
3. **Se testes existentes quebrarem** porque dependiam da queda para o gratuito: **PARE**, cole a lista de testes e mensagens, e não edite.
4. Testes novos:
   - `avaliador pago falha → não chama a rota gratuita e devolve null`
   - `EVALUATOR_MODEL registra provider nenhum-pago`
   - `somentePago false → mantém a rota gratuita (comportamento antigo)`

Commit: `feat(avaliador): R1.4 - avaliador sem queda para o gratuito`.

---

## PASSO R1.5 — Jev: modelo barato só com confiança alta; sem Jev, Pro

**PODE ALTERAR:** `src/core/decision/jev-decisions.ts` (somente `decideMicrobriefsPlanningBatch`), `tests/decision/jev-modelo-barato.test.ts` (NOVO).

1. No ramo do Jev, **depois** do `stepUpTier` existente: `if (tier === "rapido" && compAns.confidence < policy.roteamentoPapeisCriticos.confiancaMinimaModeloBarato) tier = "medio";`
2. Na reserva (sem Jev): trocar `fileCount <= 1 ? "rapido" : fileCount <= 3 ? "medio" : "pesado"` por `fileCount <= 3 ? "medio" : "pesado"`. Nada mais muda.
3. Nenhuma pergunta nova ao Jev; divisão (`precisaDividir`, `divisaoPorJev`) **inalterada**.
4. Testes:
   - `rapido com confiança 0.90 → rapido`
   - `rapido com confiança 0.80 → medio`
   - `sem Jev, 1 arquivo → medio`
   - `limiar vem da política (0.95 → confiança 0.90 vira medio)`

Commit: `feat(jev): R1.5 - modelo barato so com confianca alta; reserva no Pro`.

---

## PASSO R1.6 — Prova real e relatório
1. P1 e P2 reais com `C:\Users\ortiz\.gemini\antigravity\brain\dfb3a9c9-3acb-4a2d-bfa4-9c9e9e1a29a6\scratch\smoke-p1-p2-10-7-2.ts` (`p1`, `p2`), **cada um com cópia nova** de `prisma/dev.db`. Teto US$ 0,50 por projeto.
2. Só acrescentar ao script a listagem de `EXECUTOR_ROTA_PAGA`, `EVALUATOR_MODEL`, `EXECUTOR_TIER`, `JEV_DECISION` e `llm.gateway_call` (modelo que respondeu).
3. Apagar as pastas temporárias. Gravar `docs/relatorios/R1-roteamento-pago-primeiro.md` e commitar `docs(relatorio): R1`.

## RELATÓRIO (formato obrigatório)
1. **Identificação:** hash de partida; `git log --oneline <partida>..HEAD`.
2. **Por commit:** `git show --stat`; saída do `npx tsc --noEmit`; linha final do `npx vitest run` **daquele commit**.
3. **R1.0:** lista de `id` de `/v1/models` (sem chave).
4. **Testes novos:** tabela `arquivo › nome › o que prova`.
5. **Evidência de nomes:** tabela `nome › git grep -n`.
6. **Execução real (P1, P2):** fase final; `tsc` do projeto gerado; tabela **por etapa** `nodeId › nível planejado (Jev) › confiança › modelo que respondeu › tentativas › aprovada na 1ª?`; prova de que **nenhuma** chamada de executor ou avaliador foi para FreeLLMAPI/OmniRoute; custo total (`LLM_COST`) e do Jev; comparação com `memory/medicoes.md` (P1 US$ 0,0394; P2 US$ 0,1398).
7. **Desvios do prompt:** obrigatório ("nenhum" se nenhum).
8. **Checklist T-A…T-K:** sim/não com evidência.
9. **Dúvidas abertas** para o fundador.

===== FIM DO PROMPT =====
