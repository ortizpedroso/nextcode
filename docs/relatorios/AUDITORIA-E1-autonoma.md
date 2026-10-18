# Auditoria da execução autônoma da E1 (mudança 23) — para o Cursor auditar

Implementador: Claude. Auditor: Cursor. Hash de partida: `7067106` (`docs: mudanca 23 execucao autonoma da E1; checklist na 5.0 (136)`).
Decisões tomadas em nome do fundador: `docs/relatorios/DECISOES-AUTONOMAS-E1.md` (D1–D39).

## 1. Identificação (§8.4)
`git log --oneline 7067106..c10d3b7` — 12 commits de código, 1 por passo, cada um com o seu registro no diário e nesta auditoria no mesmo commit:

| hash | passo | tsc | vitest (arquivos/testes) |
|---|---|---|---|
| `3ea5ef9` | A2.1 T8b escopo + bloqueio | 0 | 126 / 840 |
| `801864b` | A2.2 analista planeja | 0 | 127 / 848 |
| `f404648` | A2.3 replay real + A2.3b/c | 0 | 127 / 850 |
| `a06fa8d` | AV1.1 cadeia Claude | 0 | 127 / 846 |
| `37108c9` | AV1.2 arquivo inteiro | 0 | 127 / 847 |
| `d3b9f86` | AV1.3 problemas + evidência + skills | 0 | 128 / 854 |
| `522f7f8` | AV1.4 porteiro | 0 | 129 / 856 |
| `42b878e` | AV1.5 controles reais | — (só script e docs) | — |
| `5005022` | PJ1.6b reabrir projeto | 0 | 129 / 858 |
| `324a586` | M20 memória desligada | 0 | 129 / 858 |
| `3ad117b` | AV1.4b porteiro só com projeto | 0 | 129 / 858 |
| `c10d3b7` | SM1 conferência da Spec | 0 | 130 / 863 |

Escopo total: `git diff --stat 7067106..c10d3b7` → 46 arquivos, +2.409 / −1.056 (código, testes, skills, scripts, docs). `git reflog` do período: **0** amend/reset/rebase.
Gasto real com LLM na execução: analista US$ 0,31 (3 replays) · avaliador US$ 0,31 (controles) + US$ 0,0004 (sonda) · **≈ US$ 0,62**.

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

---

## AV1.1 — Cadeia do avaliador: Claude, nunca a família do executor

**Mudou:**
- `src/core/llm/evaluator-models.ts`: `defaultEvaluatorChain()` (Sonnet 5.5 → Opus 5.5, lida a cada chamada); `dispatchStrongEvaluator` recusa a família do executor, chama a Anthropic direto para Claude, registra 404 sem trocar de modelo, pausa 10 min em 401/402/403/429; outras famílias só se a cadeia for trocada (bench), pelo FreeLLMAPI com a trava de rota. Removida a auto-cura pelo catálogo.
- `src/core/orchestrator/node-executor.ts` `makeBlindAuditDispatchFn`: sem queda para o roteador livre; `EVALUATOR_MODEL` com `provider: "nenhum"` quando ninguém responde; queda só em `NODE_ENV=test` (D21).
- Testes reescritos: `tests/llm/evaluator-freellmapi.test.ts` (10: cadeia, família recusada, 404 → Opus, sem chave, 429, B1c 1a/1b/1c), `tests/harness/evaluator-and-tier.test.ts` (cadeia trocada pelo FreeLLMAPI), `tests/orchestrator/avaliador-somente-pago.test.ts` (modo estrito; sem queda mesmo com `somentePago: false`), `tests/orchestrator/characterization.test.ts` (avaliador não recebe chaves Groq/NVIDIA/DeepSeek).

**Prova real (sonda, 17/10):** `claude-sonnet-5-5` → `{"ok":true}`, US$ 0,00013; `claude-opus-5-5` → `{"ok":true}`, US$ 0,00026; nenhuma falha.

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 127 passed (127)`, `Tests 846 passed (846)` (4 a menos que o A2.3: testes da cadeia antiga removidos/fundidos, ver D22).

**Auditor conferir:** nenhum caminho de produção chega a `smartRouter.dispatchWithFallback` no avaliador; `independent` só `true`; o bench ainda troca o modelo por `EVALUATOR_CLAUDE_MODEL`.

---

## AV1.2 — Avaliador não aprova o que não leu inteiro

**Mudou:** `src/core/governance/dual-lens-auditor.ts` — `oversizedFilesForBlindLens` (60 mil / arquivo, 200 mil / etapa, ajustáveis por `BLIND_AUDIT_MAX_FILE_CHARS` / `BLIND_AUDIT_MAX_TOTAL_CHARS`); `validateType2` reprova antes de chamar o LLM (`method: "limite_tamanho"`); `runBlindLens` manda o arquivo inteiro (removido o corte com "NÃO reprove por isso").
**Testes:** `tests/governance/blind-audit-full-code.test.ts` — o teste que exigia o aviso de corte foi substituído por 2 (arquivo acima do limite → reprovado sem chamar o LLM; soma acima do total → reprovado).
**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 127 passed (127)`, `Tests 847 passed (847)`.
**Auditor conferir:** `method: limite_tamanho` não é tratado como avaliador fora (`evaluatorOutage` só olha `heuristic_fallback`), então gasta tentativa — correto, o executor tem de dividir o arquivo.

---

## AV1.3 — Problemas por severidade, evidência do avaliador conferida, skills alinhadas

**Mudou:**
- `src/core/governance/dual-lens-auditor.ts`: `BlindAuditProblem`, `fileLineRefExists` (exportada); `runBlindLens` pede `problemas` e aplica D24/D25; os críticos (e os importantes quando ≥ 3) entram em `missingRequirements` → motivo de rejeição para o executor; importantes viram `ressalvas`.
- `skills/avaliador/SKILL.md` reescrita (D26); `skills/avaliador-core/SKILL.md` (1 linha) e `skills/avaliador-frontend/SKILL.md` (1 linha): Lente 2 é do harness.
- Testes: `tests/governance/av13-problemas-evidencia.test.ts` (novo, 7); `tests/harness/end-to-end-harness-plan.test.ts`: o avaliador falso passa a citar a linha 1 do 1º arquivo gerado (antes `arquivo:1`, que não existe — a conferência nova recusou, como deve).

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 128 passed (128)`, `Tests 854 passed (854)`.

**Auditor conferir:** citação inventada → `null` → 2ª chamada → sem resposta válida, `heuristic_fallback` (avaliador fora, não aprova); problema `menor` sem linha não descarta a resposta.

---

## AV1.4 — Porteiro: tsc + ESLint do projeto antes do avaliador

**Mudou:**
- `src/core/governance/empirical-gate.ts`: `promoteWithEmpiricalGate(..., { checkOnly })` — no modo conferir desfaz a promoção mesmo passando (dentro da mesma trava do projeto); corpo movido para `runEmpiricalGate`; se a quarentena já foi limpa e há retrato, reaplica.
- `src/core/governance/quarantine-manager.ts`: `hasPromotionSnapshot`.
- `src/core/orchestrator/node-executor.ts`: porteiro logo depois do Tipo 1 (`PORTEIRO_OK` / `PORTEIRO_REPROVADO` na trilha); reprovado → `type1Res.passed = false` com `[PORTEIRO …]`.
- `skills/avaliador/SKILL.md`: item 4 do "harness já fez" (agora verdadeiro).
- Testes: `tests/governance/av14-porteiro.test.ts` (novo, 2); `tests/governance/secret-guard.test.ts`: o portão é chamado 2× (conferir + promover).

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 129 passed (129)`, `Tests 856 passed (856)`.

**Auditor conferir:** o projeto fica igual ao de antes depois do porteiro (rollback); promoção real roda o tsc de novo; tempo extra por etapa = 1 tsc.

---

## AV1.5 — Controles com defeito plantado no avaliador real (Claude Sonnet 5.5)

**Script:** `scripts/controles-avaliador-av15.ts [repetições]` (cadeia de produção; chave lida de cópia do `dev.db`; nada gravado). Etapa de 1 arquivo (`src/app/api/tarefas/route.ts`), REQ-001 (POST 201/400) e REQ-002 (GET 200), skill `avaliador-backend`.

| caso | defeito plantado | esperado | rodada final | quem pegou | REQ / divergência |
|---|---|---|---|---|---|
| 1 correto | — | APPROVED | APPROVED ✅ | Sonnet | 001 implementado, 002 implementado |
| 2 POST devolve 200 | status errado | REJECTED | REJECTED ✅ | Sonnet | 001 parcial · `divergencia_otimista` |
| 3 POST é stub (501, TODO) | não implementado | REJECTED | REJECTED ✅ | Sonnet | 001 ausente · `alucinacao_grave` |
| 4 arquivo de 52.912 caracteres, bug no fim | status errado no fim | REJECTED | REJECTED ✅ | Sonnet (leu até o fim) | 001 parcial |
| 5 arquivo de 150.873 caracteres | acima do limite | REJECTED | REJECTED ✅ | mecânico (`limite_tamanho`, AV1.2) | — |
| 6 sem validar título + relatório diz "atendido" | validação faltando + mentira | REJECTED | REJECTED ✅ | Sonnet + Lente 2 | 001 parcial · `divergencia_otimista` |
| 7 código correto, executor cita `:999` | evidência inventada | REJECTED | REJECTED ✅ | Lente 2 mecânica | 001 implementado · `alucinacao_grave` |

**Rodadas:** 1ª (2 repetições): 14/14, mas o caso 4 tinha 59 mil+ caracteres e caiu no limite (não testou leitura do fim) — corrigido para 52.912; 2ª: 7/7, caso 5 reprovado por erro de sintaxe do próprio controle (corte no meio de função) — corrigido; 3ª (final): **7/7, cada um pelo motivo certo**. Custo: US$ 0,1005 + 0,1065 + 0,1070 = **US$ 0,314** (≈ US$ 0,01 por avaliação do Sonnet).

**Porta do AV1:** defeito plantado reprovado pelo motivo certo ✅; código correto aprovado ✅; 0 avaliação por mesma família ✅ (cadeia só Claude, executor DeepSeek); 0 aprovação só por gratuito ✅ (sem gratuito na cadeia). Bench P1–P4 sem regressão: **não rodado** (bench completo executa projetos inteiros; fica para o teste pesado, último item do checklist).

**Auditor conferir:** rodar `npx tsx scripts/controles-avaliador-av15.ts 2` (≈ US$ 0,13); o caso 1 tem de aprovar e os 6 outros reprovar.

---

## PJ1.6b — Reabrir projeto só desarquiva e acha a pasta escolhida

**Mudou:** `src/app/api/projects/route.ts` (POST): `requestedResolved` guardado antes do slug; a busca de projeto existente compara com a pasta escolhida e com o caminho final; reabrir faz `update` só de `{ isArchived: false }`.
**Testes:** `tests/api/projects-open-existing.test.ts` +2 — (a) reabrir com nome/descrição/fixado diferentes mantém os antigos; (b) pasta `…/gateway` aberta com nome "Gateway Pagamentos" → mesmo `id`, `reopened: true`, sem criar `…/gateway/gateway-pagamentos`.
**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 129 passed (129)`, `Tests 858 passed (858)`.
**Não feito:** smoke PJ1.5 na tela (D33).

---

## M20 — Memória do projeto desligada

**Mudou:** `src/core/orchestrator/execution-trigger.ts` — sem `consolidateMemoryFromSpec` na aprovação (e sem o import); `src/core/project/project-context.ts` — o snapshot não lê `.nextcode/MEMORY.md` e `formatProjectContext` não injeta a seção. `src/core/memory/project-memory.ts` intacto.
**Testes:** `tests/memory/project-memory.test.ts` — 2 testes invertidos (snapshot não lê / contexto não inclui, com o arquivo ainda no disco; aprovar não grava).
**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 129 passed (129)`, `Tests 858 passed (858)`. Na 1ª rodada da suíte, 1 falha em `end-to-end-harness-plan.test.ts` › "Item 1 (Fila nunca para)"; isolado passou 2/2 (3,9 s) e a suíte seguinte passou inteira → instável sob carga, sem relação com a M20 (registrar como dívida).

---

## AV1.4b — Porteiro só com pasta de projeto vinculada (correção de D30)

**Achado (durante o SM1):** `tests/decision/jev-failure-diagnosis.test.ts` estourou 15 s — sem projeto, `targetProjectRoot` = `process.cwd()` e o porteiro promovia arquivos no repositório do NextCode e rodava o tsc dele.
**Mudou:** `src/core/orchestrator/node-executor.ts` — condição do porteiro passa a exigir `taskDb.session.project?.path`. Testes: `av14-porteiro.test.ts` usa projeto em `os.tmpdir()` (portão simulado); `secret-guard.test.ts` volta a esperar 1 chamada do portão (sem projeto, sem porteiro).
**Verificação (estado do commit, sem o SM1):** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 129 passed (129)`, `Tests 858 passed (858)`.

---

## SM1 — Conferência mecânica da Spec (a)–(e)

**Mudou:**
- `src/core/intake/spec-auto-heal.ts`: `isConcreteFilePath` aceita dotfile com extensão (a); `specDateToday` e data sempre carimbada, com correção registrada (c).
- `src/core/intake/spec-check.ts`: `checkSpecStructure` reprova REQ que cita arquivo fora de `arquivos_afetados` (b); `citedFilePaths` (mesma regex de `extractFilePathsFromCriteriaText`, copiada para evitar import circular intake → decision → governance → templates → intake).
- `src/core/orchestrator/spec-draft.ts`: `REMOVAL_INTENT_REGEX` exportada e ampliada (d).
- `src/app/api/chat/route.ts`: `SPEC_FIX_CALL` + aviso 🔧 na mensagem (e); `SPEC_AUTO_HEAL` + lista 🛠️ das correções; `SPEC_REINJECTION`.
- Testes: `tests/intake/sm1-conferencia-spec.test.ts` (novo, 5).

**Verificação:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 130 passed (130)`, `Tests 863 passed (863)` (rodado com SM1 + AV1.4b, que é o estado deste commit).
**Não testado:** a rota do chat com Spec real (exige chamada ao Opus); as mudanças nela são só trilha e texto do aviso.
**Auditor conferir:** porta do SM1 — Spec com `.env.example` preservada ✅ (teste a); REQ citando arquivo fora da lista reprovado na conferência ✅ (teste b); data = dia real ✅ (teste c).

---

## Checklist das travas (§8.2) para toda a execução

| trava | cumprida | evidência |
|---|---|---|
| T-A pré-condição | sim | partida `7067106`, `git status` só `.claude/` e `.serena/` (não tocados) |
| T-B escopo | sim, com o escopo da mudança 23 | arquivos acima; `.claude/` e `.serena/` nunca adicionados |
| T-C literalidade | ver desvios | decisões D1–D39 registradas antes de cada commit |
| T-D nomes reais | sim | todo nome citado aqui existe no HEAD (auditor: `git grep -n`) |
| T-E 1 passo = 1 commit, tsc 0, vitest verde | sim | tabela da seção 1; SM1 e AV1.4b separados com stash para cada commit ter a própria suíte |
| T-F banco | sim | todos os scripts usam cópia em `%TEMP%`; `prisma/dev.db` mtime `2026-10-16 21:22:35` antes e depois dos replays |
| T-G segredos | sim | chaves só lidas da cópia do banco e enviadas à própria API; nada em log/relatório |
| T-H dependências | sim | nenhum pacote novo |
| T-I fim de linha | sim | arquivos em LF (`git ls-files --eol`) |
| T-J paradas | sim | nenhuma 422 do Jev; custo muito abaixo de qualquer teto |
| T-K co-autoria | sim | todos os commits com `Co-Authored-By: Claude Opus 5.5` |

## Desvios e dívidas
1. **D30 errada, corrigida no AV1.4b** (porteiro sem projeto rodava no repositório do harness).
2. **Testes reescritos porque testavam o comportamento proibido** (D22): cadeia antiga do avaliador, auto-cura de modelo, chaves BYOK no avaliador, queda para gratuito, aviso de corte do arquivo, memória lida/gravada.
3. **Queda do avaliador para o roteador só em teste** (D21) — código de produção com ramo de teste, no mesmo padrão do `skipModel` do analista.
4. **Teste instável:** `end-to-end-harness-plan.test.ts` › "Item 1 (Fila nunca para)" falhou 1 vez sob a suíte inteira (M20), passou isolado 2/2 e na rodada seguinte.
5. **Não feito:** smoke da tela PJ1.5 (D33); bench P1–P4 completo; teste pesado (último item do checklist, depois desta auditoria); rota do chat com Spec real (SM1 e).
6. **Fora do escopo, visto e não mexido:** `makeBlindAuditDispatchFn` mantém os parâmetros `smartRouter`/`setting` (usados só no ramo de teste); avaliador fora do ar por mais de 2 vezes ainda gasta tentativa (não vira PAUSADA) — a mudança 10 pedia PAUSADA.

## Dúvidas abertas para o fundador
- (a) Aceita D21 (ramo de teste no avaliador) ou prefere trocar os testes de integração por dublês de módulo?
- (b) Avaliador fora do ar persistente → PAUSADA em vez de gastar tentativa (mudança 10)? Recomendo sim, num passo próprio.
- (c) Teste pesado agora (Spec real `934939fc`, sem teto, decisão de 16/10) logo depois da auditoria do Cursor?

---

## Fechamento das ressalvas do Cursor (`docs/relatorios/AUDITORIA-E1-autonoma-cursor.md`, `f4d0401`)

| ressalva | ação | prova |
|---|---|---|
| vitest falhou nos commits isolados (sqlite sem tabelas) | causa: o worktree não tem `prisma/test.db` (o vitest usa esse arquivo, `vitest.config` → `DATABASE_URL`) nem `.env` (ignorado pelo git). Refeito para `3ad117b` (o commit separado por stash) com `prisma db push` no `test.db` do worktree | `tsc` 0; vitest **127/129 arquivos, 855/858**; reexecução das falhas: `step-4b` passa (instável na 1ª rodada fria), `mega-stress` › "TESTE PESADO 3" falha só por falta de `.env` (Jev não configurado no worktree) e passa no repositório (16/16). Nenhuma falha de código |
| `skipModel` volta sem trilha `ANALISTA_PLAN_*` | `ANALISTA_PLAN_FALLBACK` com `reason: modelo_desligado_em_teste` / `sem_roteador` | `spec-decomposer.ts` (início de `decomposeWithAnalistaSkill`) |
| SM1 (e) sem teste de rota | teste novo em `tests/orchestrator/step-4b.test.ts` › "SM1 (e)": Spec com REQ citando `vitest.config.ts` → `SPEC_FIX_CALL` (`adotada: true`), aviso "2ª chamada" e "Data da Spec corrigida" na mensagem, Spec gravada sem a citação | passa |
| skills de cluster ainda falavam em "duas lentes" e `passos_max` 25/35 | `description` dos 4 `avaliador-*` diz Lente 1 (Lente 2 no harness); `passos_max: 1` | `grep "duas lentes" skills/avaliador-*/SKILL.md` → vazio |

**Verificação deste commit:** `npx tsc --noEmit` exit 0; `npx vitest run` → `Test Files 130 passed (130)`, `Tests 864 passed (864)`.
