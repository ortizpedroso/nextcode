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
