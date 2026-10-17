# Auditoria da execução autônoma da E1 (mudança 23) — para o Cursor auditar

Implementador: Claude. Auditor: Cursor. Hash de partida: `7067106` (`docs: mudanca 23 execucao autonoma da E1; checklist na 5.0 (136)`).
Decisões tomadas em nome do fundador: `docs/relatorios/DECISOES-AUTONOMAS-E1.md`.

Cada seção: o que mudou (`arquivo:linha`), testes novos, saída de `tsc`/`vitest` no estado do commit, prova real e o que o auditor deve conferir.

---

## A2.1 — T8b confere escopo do plano e bloqueia plano impossível

**Mudou:**
- `src/core/orchestrator/plan-scope-check.ts` (novo): `checkPlanScope` (REQ repetido; arquivo citado × escopo da etapa ∪ ancestrais), `planStagesFromNodes`, `validateFinalPlan` (regras antigas de `validateMacrobriefMechanical` + as novas).
- `src/core/orchestrator/execution-trigger.ts`: depois de `splitNodesByJev`, `validateFinalPlan`; trilha `PLANO_T8B_OK` / `PLANO_REPROVADO`; reprovado → `applyPhaseEvent(PLANO_REPROVADO, { detalheAviso })` e retorno sem criar `TaskNode`.
- `src/core/orchestrator/phase-machine.ts`: evento `PLANO_REPROVADO` em `PLANEJAMENTO` → `BLOQUEADA` (`faseAntesDoBloqueio: SPEC_REVISAO`) com `AVISAR_HUMANO`.
- `src/core/skills/spec-decomposer.ts` (`decomposeSpec`): `reqOwnerGroup` — cada REQ em uma etapa (a última com arquivo citado; nome genérico não conta).
- Testes: `tests/orchestrator/plan-scope-check.test.ts` (novo, 8); `PLANO_REPROVADO` acrescentado às listas de eventos de `tests/orchestrator/phase-machine.test.ts` e `tests/orchestrator/sem-parada-silenciosa.test.ts` (as duas listas enumeram todos os eventos; sem isso a checagem de consistência falha).

**Prova real (cópia do `dev.db`, script temporário apagado depois):**

| Spec | REQ | etapas | antes (A2.0) | depois |
|---|---|---|---|---|
| teste real `934939fc` | 43 | 17 | T8b `valid: true`, 29 REQ repetidos, 186 pares fora do escopo | **reprovado, 6 erros** (REQ que citam arquivos de etapas irmãs, ex. REQ-016 × `src/app/api/cobrancas/route.ts`) → BLOQUEADA, nada gasto |
| bench P1 | 3 | 3 | válido | válido |
| bench P2 | 4 | 4 | válido | válido |
| bench P3 | 5 | 3 | válido | válido |
| bench P4 | 3 | 2 | válido | válido |

A heurística ainda não acha plano válido para a Spec real — esperado: só o analista (A2.2) agrupa arquivos irmãos na mesma etapa.

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 126 passed (126)`, `Tests 840 passed (840)`.

**Auditor conferir:** a regra D1 não reprova arquivo consumido de dependência; `PLANO_REPROVADO` não cria `TaskNode`; aviso no chat sai 1 vez; fim de linha LF.

---

## A2.2 — Analista DeepSeek planeja; código confere e monta o Microbrief

**Mudou:**
- `src/core/skills/spec-decomposer.ts`: `decomposeWithAnalistaSkill` reescrito (lista de arquivos + REQ com arquivos citados no prompt; até 3 rodadas com os erros da T8b; trilha `ANALISTA_PLAN_APPROVED` / `ANALISTA_PLAN_RETRY` / `ANALISTA_PLAN_FALLBACK` em todo caminho; custo `recordLlmCost` papel `analista`); `parseAnalystPlan`, `buildDecompositionFromAnalystPlan` (Microbrief completo: critérios da Spec, `lerContratos` = arquivos das etapas ancestrais, dependências), constantes `ANALISTA_MAX_RODADAS`/`ANALISTA_MAX_TOKENS`/`ANALISTA_TIMEOUT_MS`.
- `src/core/orchestrator/plan-scope-check.ts`: `validatePlanStages` (+ arquivo da Spec sem etapa / arquivo inventado).
- `src/core/llm/cost.ts`: papel `analista` no tipo de `recordLlmCost`.
- `skills/analista/SKILL.md` reescrita (regras = as que o código confere; formato JSON; sem ferramentas).
- Testes: `tests/orchestrator/analista-plan.test.ts` (novo, 8); `tests/harness/orchestration-policy-and-skills.test.ts`: analista sai da lista de skills com ferramentas.

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 127 passed (127)`, `Tests 848 passed (848)`.

**Auditor conferir:** nenhum caminho de `decomposeWithAnalistaSkill` volta sem trilha; critérios do Microbrief = texto da Spec; nós do analista têm o mesmo formato de `payload` da heurística (o executor lê `microbrief`, `reqsCobertos`, `nodeFiles`).

---

## A2.3 — Replay real da Spec `934939fc` com o analista (+ A2.3b, A2.3c)

**Script:** `scripts/replay-analista-a23.ts` (cópia do `dev.db` em `%TEMP%/nc-a23-replay-analista`, telemetria em memória; `prisma/dev.db` mtime antes/depois: `2026-10-16 21:22:35.462675000` nas 3 rodadas).

| rodada do replay | configuração | resultado | custo |
|---|---|---|---|
| 1 | 16.000 tokens, prazo 120 s do gateway | 3 chamadas pararam em 16.000 tokens de saída sem JSON → reserva (heurística, 6 erros → seria BLOQUEADA) | US$ 0,2116 |
| 2 | 32.000 tokens, prazo 120 s | 3 chamadas cortadas em 120 s (teto fixo do `callGateway`) | não medido (sem `usage`) |
| 3 | 32.000 tokens, prazo 300 s (A2.3b) | **`ANALISTA_PLAN_APPROVED` na rodada 1**, 152 s, 15.063 tokens de entrada / 24.819 de saída | **US$ 0,0991** |

**Porta (rodada 3):** 35 etapas; REQ em mais de 1 etapa: **0**; REQ sem etapa: **0**; T8b final (`validateFinalPlan`): **válida, 0 erros**. Antes (A2.0): 16 etapas, 29 REQ repetidos, 186 pares fora do escopo.
**Reserva (A2.3c, sem LLM):** heurística na Spec real → 17 nós, T8b **válida, 0 erros** (antes do A2.3c: 6 erros).

**Mudou:**
- `src/core/router/smart-router.ts`: opção `gatewayTimeoutMs` repassada a `tryOpenAiGateway` → `callGateway`.
- `src/core/llm/gateways.ts`: `GatewayCallOptions.timeoutMs` (sem ele, comportamento antigo).
- `src/core/skills/spec-decomposer.ts`: analista 32.000 tokens / 300 s, erro `[CORTADA]` em `finish_reason: length`, trilha com `finishReason`/`contentChars`/`reasoningChars`; `decomposeSpec` acrescenta dependência entre etapas irmãs (A2.3c).
- Testes: `analista-plan.test.ts` (+1: `[CORTADA]` e prazo/teto repassados); `plan-scope-check.test.ts` (+1: dependência entre irmãs).

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 127 passed (127)`, `Tests 850 passed (850)`.

**Auditor conferir:** reproduzir com `npx tsx scripts/replay-analista-a23.ts` (custo ≈ US$ 0,10; resultado do LLM pode variar — a porta é T8b válida); `gatewayTimeoutMs` não muda nenhuma outra chamada (padrão inalterado).
