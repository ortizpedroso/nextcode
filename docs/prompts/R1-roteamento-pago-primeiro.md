# Prompt R1 — Roteamento "pago primeiro" com divisão para o gratuito (para o Antigravity)

> Decisão do fundador (08/10 tarde, `memory/decisoes.md`) e regra em `docs/NEXTCODE-REFERENCIA.md` §5.2.
> Copie TUDO abaixo da linha e cole no Antigravity.

---

# Tarefa R1 — Jev decide "pago primeiro" e divide a etapa para caber no modelo gratuito

## OBJETIVO
Hoje o Jev escolhe o nível do executor só pela complexidade (`rapido` → gratuito FreeLLMAPI; `medio`/`pesado` → DeepSeek pago) e, sem resposta do Jev, uma etapa de 1 arquivo vai para o **gratuito**. Passa a valer: **o Jev primeiro decide se a etapa precisa de modelo pago**; se não precisar, decide se ela cabe inteira no gratuito ou se deve ser **dividida (uma parte por arquivo)** para caber no gratuito; na dúvida, **pago**.

## TRAVAS (obrigatórias; violar qualquer uma = PARAR e relatar)
- **T-A Pré-condição.** `git status --short` só pode mostrar arquivos dentro de `.claude/`. `git rev-parse HEAD` deve ser igual a `git log -1 --format=%H -- docs/prompts/R1-roteamento-pago-primeiro.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só altere os arquivos de PODE ALTERAR. Precisou de outro → PARE e relate. Nunca aumente timeout, nunca use `try {} catch {}` vazio, `.skip` ou `.only`, e nunca altere teste existente além do que está escrito aqui.
- **T-C Literalidade.** Faça exatamente o que está escrito: nomes, textos das perguntas, limiares e ordem das regras. Nada de refatoração ou "melhoria" extra. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais.** Todo nome citado deve existir (`git grep -n`). Nomes novos: só os escritos neste prompt.
- **T-E Um passo = um commit.** Antes de CADA commit: `npx tsc --noEmit` (0 erros) e `npx vitest run` completo (tudo verde) **nesse estado**. Cole as saídas. **Proibido**: `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`. Testes e execução real em cópia temporária (`DATABASE_URL`).
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório ou saída colada.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Todos os arquivos deste prompt são LF; mantenha LF (`git ls-files --eol`).
- **T-J Paradas obrigatórias.** Teste antigo quebrando por motivo não previsto aqui; arquivo fora do escopo; contradição prompt × código; resposta 422 do Jev; custo real de um projeto > US$ 0,50.
- **T-K Commits** terminam com: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## LEITURA OBRIGATÓRIA
- `src/core/decision/jev-decisions.ts`: `MicrobriefPlanningDecision`, `decideMicrobriefsPlanningBatch` (perguntas `::complexidade_microbrief`, `::precisa_dividir_microbrief`, cálculo do `tier`, `stepUpTier`, bloco "Reserva determinística em código").
- `src/core/orchestrator/execution-trigger.ts`: `planNodeTiers`, `withJevPlan`, a chamada `splitNodesByJev(rawNodes, (id) => jevPlan.get(id)?.divisaoPorJev === true)`, `planFor`.
- `src/core/orchestrator/node-split.ts`: `splitNodesByJev` (divide uma parte por arquivo; `skipped` quando um REQ cita dois arquivos).
- `src/core/orchestrator/node-executor.ts`: `readPlannedTier`, uso de `resolveExecutorTierForAttempt` e `executorTier === "rapido" ? "fast" : "heavy"` (só leitura; NÃO alterar).
- `src/core/config/orchestration-policy.ts`: `jevLimiares.planejamentoMicrobrief`, `DEFAULT_ORCHESTRATION_POLICY`, `extractScalarNumber`, e como o bloco `jevExecucao` é lido em `loadOrchestrationPolicy` (modelo a seguir).
- `config/politicas-orquestracao.yaml`: blocos `jev_limiares` e `jev_execucao`.
- `tests/harness/jev-decisions-catalog.test.ts` (teste "M3") e `tests/orchestrator/node-split.test.ts`.

---

## PASSO R1.1 — Política: limiares do "pago primeiro"

**PODE ALTERAR:** `config/politicas-orquestracao.yaml`, `src/core/config/orchestration-policy.ts`, `tests/harness/orchestration-policy-and-skills.test.ts`.

**O que fazer:**
1. No YAML, dentro de `jev_limiares:`, logo após o bloco `planejamento_microbrief:`, acrescentar:
   ```yaml
     roteamento_pago_primeiro:
       probabilidade_minima_pago_noul: 0.35            # >= isso → modelo pago
       confianca_minima_gratuito_inteiro: 0.85         # complexidade 'rapido' com essa confiança → gratuito
       probabilidade_minima_partes_gratuito_noul: 0.80 # >= isso (e 2+ arquivos) → divide para o gratuito
   ```
2. Em `orchestration-policy.ts`: no tipo de `jevLimiares` acrescentar `roteamentoPagoPrimeiro: { probabilidadeMinimaPagoNoul: number; confiancaMinimaGratuitoInteiro: number; probabilidadeMinimaPartesGratuitoNoul: number; }`; no `DEFAULT_ORCHESTRATION_POLICY` os valores 0.35, 0.85, 0.8; em `loadOrchestrationPolicy` ler as três chaves com `extractScalarNumber` (mesmo padrão usado para `jevExecucao`).
3. Teste novo em `tests/harness/orchestration-policy-and-skills.test.ts`: `R1.1: lê roteamento_pago_primeiro do YAML e usa os padrões quando as chaves faltam`.

**Pronto quando:** teste verde, `tsc` 0, suíte verde; commit `feat(policy): R1.1 - limiares do roteamento pago primeiro`.

---

## PASSO R1.2 — Decisão do Jev "pago primeiro"

**PODE ALTERAR:** `src/core/decision/jev-decisions.ts` (somente `MicrobriefPlanningDecision` e `decideMicrobriefsPlanningBatch`), `tests/harness/jev-decisions-catalog.test.ts` (somente o que está no item 5), `tests/decision/jev-rota-pago-primeiro.test.ts` (NOVO).

**O que fazer:**
1. Em `MicrobriefPlanningDecision` acrescentar:
   ```ts
   /** Jev decidiu dividir a etapa (uma parte por arquivo) para que cada parte rode no modelo gratuito. */
   divisaoParaGratuito: boolean;
   rotaModelo: "pago_necessario" | "gratuito_inteiro" | "gratuito_dividido" | "pago_por_seguranca" | "reserva";
   /** noul de `precisa_modelo_pago`; null sem Jev. */
   probabilidadePago: number | null;
   ```
2. Em `decideMicrobriefsPlanningBatch`, para cada Microbrief, acrescentar ao mesmo lote (mesma chamada `askJevBatch`) **exatamente** estas duas perguntas:
   ```ts
   questions[`${mb.id}::precisa_modelo_pago`] = {
     type: "noul",
     instructions: `Would a free, lower-capability model likely produce incomplete or wrong code for microbrief \`${mb.id}\`, so that a strong paid model is required to implement it correctly on the first attempt?`,
     criteria: {
       true: "A strong paid model is required: business rules spread across several requirements, security or authentication, data consistency, contracts between files, or acceptance criteria that need interpretation.",
       false: "Every function, type, rule and response format is explicitly written in the microbrief; a model only needs to transcribe it into code.",
     },
   };
   questions[`${mb.id}::partes_cabem_no_gratuito`] = {
     type: "noul",
     instructions: `If microbrief \`${mb.id}\` were split into one part per target file in \`arquivos\`, would each part be a small, mechanical task whose acceptance criteria name only that file and fully specify it?`,
     criteria: {
       true: "Each file has its own explicit criteria and can be written on its own from the microbrief.",
       false: "Parts depend on shared logic or decisions that are not written in the microbrief, or one requirement spans several files.",
     },
   };
   ```
3. No ramo em que o Jev respondeu (o `if (batch)` existente), **depois** de calcular `tier` (com o `stepUpTier` existente) e **sem mudar** cluster, skills e `divisaoPorJev`, decidir o nível nesta ordem (lim = `policy.jevLimiares.roteamentoPagoPrimeiro`):
   ```text
   pPago   = resposta noul de ::precisa_modelo_pago            (ausente/inválida → 1)
   pPartes = resposta noul de ::partes_cabem_no_gratuito       (ausente/inválida → 0)
   pago(t) = t === "rapido" ? "medio" : t

   se pPago >= lim.probabilidadeMinimaPagoNoul            → nivel = pago(tier),  rota = "pago_necessario"
   senão se tier === "rapido" e compAns.confidence >= lim.confiancaMinimaGratuitoInteiro
                                                          → nivel = "rapido",    rota = "gratuito_inteiro"
   senão se mb.arquivos.length >= 2 e pPartes >= lim.probabilidadeMinimaPartesGratuitoNoul
                                                          → nivel = "rapido",    rota = "gratuito_dividido", divisaoParaGratuito = true
   senão                                                  → nivel = pago(tier),  rota = "pago_por_seguranca"
   ```
   `nivelModelo` passa a ser `nivel`; `probabilidadePago` = `pPago` quando a resposta existe, senão `null`; `divisaoParaGratuito` = false fora do 3º caso.
   **Importante:** se as duas perguntas novas vierem ausentes mas as 6 antigas vierem válidas, o ramo do Jev continua valendo (com pPago = 1 → pago). Não exija as perguntas novas na condição `if (compAns?.type === "choice" && ...)` existente.
4. Na reserva (sem Jev): trocar `fileCount <= 1 ? "rapido" : fileCount <= 3 ? "medio" : "pesado"` por `fileCount <= 3 ? "medio" : "pesado"`; `divisaoParaGratuito: false`, `rotaModelo: "reserva"`, `probabilidadePago: null`. Nada mais muda na reserva.
5. Em `tests/harness/jev-decisions-catalog.test.ts`, no teste "M3": trocar **apenas** `toHaveLength(18)` por `toHaveLength(24)` e `18 perguntas` por `24 perguntas` no título. Nenhuma outra alteração nesse arquivo.
6. Testes novos em `tests/decision/jev-rota-pago-primeiro.test.ts` (Jev simulado por `vi.spyOn(globalThis, "fetch")`, chave como em `tests/governance/secret-guard.test.ts`), um Microbrief de 2 arquivos por caso:
   - `pago_necessario: precisa_modelo_pago 0.60 → nunca rapido, rota pago_necessario`
   - `gratuito_inteiro: pago 0.10 + complexidade rapido confiança 0.90 → rapido`
   - `gratuito_dividido: pago 0.10 + complexidade medio + partes 0.90 → rapido e divisaoParaGratuito`
   - `pago_por_seguranca: pago 0.10 + complexidade medio + partes 0.40 → medio`
   - `1 arquivo não divide: pago 0.10 + complexidade medio + partes 0.95 → pago_por_seguranca`
   - `perguntas novas ausentes → pago (pPago = 1)`
   - `sem Jev (fetch rejeita) → reserva paga: 1 arquivo = medio, rotaModelo reserva`
   - `limiares vêm da política` (passar `policy` com `probabilidadeMinimaPagoNoul: 0.70` e pago 0.60 → não é pago_necessario)
   - `uma única chamada HTTP com 8 perguntas por Microbrief`

**Pronto quando:** testes verdes, `tsc` 0, suíte verde; commit `feat(jev): R1.2 - decisao pago primeiro e divisao para o gratuito`.

---

## PASSO R1.3 — Ligar no planejamento: dividir para o gratuito e registrar a rota

**PODE ALTERAR:** `src/core/orchestrator/execution-trigger.ts`, `tests/orchestrator/rota-modelo-plano.test.ts` (NOVO).

**O que fazer:**
1. Trocar o critério de `splitNodesByJev` para: `(id) => jevPlan.get(id)?.divisaoPorJev === true || jevPlan.get(id)?.divisaoParaGratuito === true`.
2. Criar e exportar em `execution-trigger.ts` a função pura:
   ```ts
   export function resolvePlanForNode(
     nodeId: string,
     jevPlan: Map<string, MicrobriefPlanningDecision>,
     skippedIds: Set<string>
   ): MicrobriefPlanningDecision | undefined
   ```
   - `plan = jevPlan.get(nodeId) ?? jevPlan.get(nodeId.replace(/-p\d+$/, ""))` (mesma regra do `planFor` atual);
   - se `plan?.divisaoParaGratuito === true` **e** `skippedIds.has(nodeId)` (a divisão não foi possível) → devolver `{ ...plan, nivelModelo: "medio", divisaoParaGratuito: false, rotaModelo: "pago_por_seguranca" }`;
   - senão devolver `plan`.
   Substituir o uso de `planFor(node.id)` por `resolvePlanForNode(node.id, jevPlan, new Set(splitRes.skipped.map((s) => s.nodeId)))` (crie o `Set` uma vez, antes do laço). Remover `planFor` se ficar sem uso.
3. Em `withJevPlan`, acrescentar ao objeto `jevPlan` gravado: `rotaModelo: decision.rotaModelo` e `probabilidadePago: decision.probabilidadePago`.
4. Logo após criar as tarefas (depois do laço `for (const node of decomposedNodes)`), registrar **um** evento por tarefa:
   `TelemetryLogger.log({ sessionId, action: "JEV_ROTA_MODELO", details: { nodeId, rotaModelo, nivelModelo, probabilidadePago, source } })` — usando o plano resolvido do passo 2; tarefa sem plano (base sem IA) não registra.
5. Testes novos em `tests/orchestrator/rota-modelo-plano.test.ts` (só `resolvePlanForNode` e `splitNodesByJev`, sem banco):
   - `parte de etapa dividida herda rapido do plano pai (id -p1, -p2)`
   - `divisão para o gratuito impossível (REQ cita dois arquivos) → etapa inteira volta para medio e pago_por_seguranca` (use o mesmo caso de `tests/orchestrator/node-split.test.ts` "REQ que cita dois arquivos")
   - `plano sem divisão para o gratuito é devolvido igual`

**Pronto quando:** testes verdes, `tsc` 0, suíte verde; commit `feat(orchestrator): R1.3 - divisao para o gratuito no planejamento e trilha JEV_ROTA_MODELO`.

---

## PASSO R1.4 — Prova real (P1 e P2) e relatório

1. Rodar o P1 e o P2 reais com o script já usado no Item 10 (`C:\Users\ortiz\.gemini\antigravity\brain\dfb3a9c9-3acb-4a2d-bfa4-9c9e9e1a29a6\scratch\smoke-p1-p2-10-7-2.ts`, argumentos `p1` e `p2`), **cada um com cópia nova** de `prisma/dev.db` em pasta temporária. Teto: US$ 0,50 por projeto (passou → PARE).
2. Não alterar o script além de acrescentar a contagem/listagem de `JEV_ROTA_MODELO` e `JEV_NODE_SPLIT`.
3. Apagar as pastas temporárias ao final.
4. Gravar o relatório em `docs/relatorios/R1-roteamento-pago-primeiro.md` e commitar: `docs(relatorio): R1`.

## RELATÓRIO (formato obrigatório, `docs/relatorios/R1-roteamento-pago-primeiro.md`)
1. **Identificação:** hash de partida; `git log --oneline <partida>..HEAD`.
2. **Por commit:** `git show --stat <hash>`; saída do `npx tsc --noEmit`; linha final do `npx vitest run` **daquele commit**.
3. **Testes novos:** tabela `arquivo › nome › o que prova`.
4. **Evidência de nomes:** tabela `nome › saída de git grep -n` para todo nome citado.
5. **Execução real (P1 e P2):** fase final; `tsc` do projeto gerado; tabela **por etapa**: `nodeId › rotaModelo › nivelModelo › probabilidadePago › tentativas › modelo que respondeu (llm.gateway_call / EXECUTOR_TIER) › aprovada na 1ª?`; eventos `JEV_ROTA_MODELO` e `JEV_NODE_SPLIT` crus; custo total (`LLM_COST`) e custo do Jev; comparação com a última medição (`memory/medicoes.md`: P1 US$ 0,0394, P2 US$ 0,1398).
6. **Decisões do Jev observadas:** para `precisa_modelo_pago` e `partes_cabem_no_gratuito`: valor de cada Microbrief.
7. **Desvios do prompt:** obrigatório ("nenhum" se nenhum).
8. **Checklist T-A…T-K:** sim/não com evidência.
9. **Dúvidas abertas** para o fundador.
