# Relatório A3 — Falha de etapa roteada ao dono (mudança 16)

1. **Identificação:** pacote A3 · hash de partida `e8a1736966887cce041e68fd0477eae6cc9db285` (prompt citava `9193175`; HEAD atual ao iniciar A3.0) · commits: _(após A3.0)_.

---

## PASSO A3.0 — Inventário (sem código)

Fatos com `arquivo:linha` no HEAD de partida acima.

### 1. Onde `criteriosPorReq` e `taskDb.filesScope` ficam disponíveis antes do diagnóstico

| Dado | Onde é definido / lido | Linhas |
|------|------------------------|--------|
| Escopo da etapa (`filesScope` → `filesScopeArr`) | `taskDb.filesScope` parseado em JSON | `src/core/orchestrator/node-executor.ts:1037` |
| `criteriosPorReq` | Montado a partir de `nodeMicrobrief.criteriosAceitePorReq`, fallback Spec em `nodePayload.goal` | `src/core/orchestrator/node-executor.ts:1446-1457` |
| Chamada ao diagnóstico Jev | Usa `rejectionReason`, `newAttempts`, histórico; **não** passa escopo nem critérios hoje | `src/core/orchestrator/node-executor.ts:1564-1584` |

Ambos (`filesScopeArr` e `criteriosPorReq`) existem no **mesmo fluxo** de execução/auditoria do nó, **antes** do bloco `if (finalStatus === "failed" && !evaluatorOutageFreeRetry …)` que chama `diagnoseStageFailureWithJev` (`1565` ← após `1446-1457` e após uso de `filesScopeArr` desde `1037`).

### 2. Onde a tentativa é somada e onde a etapa vira falha definitiva (T6 / D-RANHO)

| Evento | Onde | Linhas |
|--------|------|--------|
| Contagem da tentativa **desta execução** | `newAttempts = (taskDb.attempts \|\| 0) + 1` | `node-executor.ts:1260` |
| Limiar de bloqueio (T6: esgotar ciclo) | `wouldReachBlockThreshold = newAttempts >= maxAttempts` (`maxAttempts` ≈ 3) | `node-executor.ts:1259-1261` |
| Status `blocked` vs `failed` na rejeição de auditoria | `finalStatus = wouldReachBlockThreshold && !evaluatorOutageFreeRetry ? "blocked" : "failed"` | `node-executor.ts:1536` |
| Bloqueio extra por `ambiguous_spec` (política ativa) | `finalStatus = "blocked"`, `blockedByAmbiguousSpec = true` | `node-executor.ts:1604-1618` |
| Persistência: **soma** `attempts` no banco | `updatedAttempts = … ? newAttempts : taskDb.attempts` quando `failed`/`blocked`, exceto `evaluatorOutageFreeRetry` ou `blockedByAmbiguousSpec` | `node-executor.ts:1709-1714` |
| Persistência: status definitivo no nó | `prisma.taskNode.update` com `status: finalStatus`, `attempts: updatedAttempts` | `node-executor.ts:1716-1723` |
| Relatório D-RANHO no chat (Trava T6) | `IncidentReporter.generateIncidentReport` quando `finalStatus === "blocked"` | `node-executor.ts:1632-1648` |

Referência política: Trava T6 / D-RANHO em `src/core/governance/incident-reporter.ts:1-10`, `docs/NEXTCODE-REFERENCIA.md` (T6 — 3 tentativas).

_(Outro caminho com `newAttempts` na linha `723` — fluxo distinto do bloco de diagnóstico ≈1564.)_

### 3. `evaluatorOutageFreeRetry` e reaproveitamento para `evaluator_error`

**Como evita gastar tentativa hoje**

- Condição: avaliador indisponível — `type1Res.passed && type2Res.method === "heuristic_fallback"` (`1472-1475`).
- Streak: `evaluatorOutageStreak` + `MAX_FREE_EVALUATOR_RETRIES = 2` (`356`, `1474-1475`).
- Efeitos: não entra em `blocked` por limiar se free retry (`1536`); **não roda** diagnóstico Jev (`1565`: `!evaluatorOutageFreeRetry`); **não incrementa** `attempts` no update (`1709-1714`).
- Trilha: `EVALUATOR_UNAVAILABLE` com `attemptConsumed: !evaluatorOutageFreeRetry` (`1476-1479`).

**Dá para reaproveitar o mesmo caminho para `evaluator_error` sem mudar avaliador fora do ar?**

**Não**, se for a **mesma variável** `evaluatorOutageFreeRetry`:

1. Ela só é setada no ramo `heuristic_fallback` (`1472-1475`); `evaluator_error` pressupõe veredito/rejeição do avaliador (não outage).
2. Enquanto `evaluatorOutageFreeRetry === true`, o diagnóstico **não executa** (`1565`); para `evaluator_error` a A3.2 exige diagnóstico **antes** da ação.
3. O streak lê/grava `evaluatorOutageStreak` no `result` do nó — misturar com `evaluator_error` alteraria semântica da trilha de outage.

**Sim**, no **padrão** de `updatedAttempts` (`1709-1714`): flag **separada** (ex.: free retry pós-diagnóstico só para `evaluator_error`), sem tocar `1472-1480`.

### 4. Relatório de incidente no chat e campo “Dono”

| Item | Onde | Linhas |
|------|------|--------|
| Função que monta o markdown | `IncidentReporter.generateIncidentReport` | `src/core/governance/incident-reporter.ts:153-224` |
| Opções atuais | `IncidentReportOptions`: `maxAttempts`, `blockedDependents`, `unblockHint` | `incident-reporter.ts:26-33`, uso em `node-executor.ts:1634-1641` |
| Classificação por texto do motivo | `classifyFailure(rejectionReason)` (regex) — não usa causa Jev | `incident-reporter.ts:140-142`, `161-162`, `210-216` |
| Diagnóstico Jev no histórico | Campo opcional `diagnostico` em `FailureAttemptRecord`, renderizado na seção 3 | `incident-reporter.ts:18-24`, `214-216` |

**Como receber “Dono” hoje (sem alterar arquivos fora da lista R1):** `incident-reporter.ts` **não** está em R1. Opções futuras documentadas (implementação depende de exceção R1 ou passo que autorize):

- Estender `IncidentReportOptions` com `dono?: string` (ou mapa causa→dono) e uma linha em “Causa principal” / “O que você precisa fazer”; **ou**
- Incluir `dono` em `FailureAttemptRecord` / payload `diagnostico` e renderizar na seção 3 (já lista `diagnostico.causa`); **ou**
- Prefixar `unblockHint` / mensagem do chat em `node-executor.ts:1648` com o dono (só texto, sem mudar `incident-reporter.ts`).

**Não verificado** qual opção o fundador prefere para A3.2.

---

## PASSO A3.0 — Verificação (commit só relatório)

### `npx tsc --noEmit`

```
(exit 0 — sem saída)
```

### `npx vitest run` (últimas linhas, run imediatamente antes do commit)

```
 Test Files  124 passed (124)
      Tests  804 passed (804)
   Start at  08:12:18
   Duration  236.66s (transform 5.08s, setup 2.51s, collect 30.39s, tests 138.50s, environment 52ms, prepare 22.47s)
```

_(Run anterior na mesma sessão: 802/804 verdes — 2 falhas intermitentes; rerun completo passou.)_

### Commit

- Mensagem: `docs(relatorio): A3.0 inventario falha roteada ao dono`
- Arquivos: apenas `docs/relatorios/A3-falha-roteada-ao-dono.md`

### Desvios A3.0

Nenhum.

### O que não foi feito

A3.1 em diante — aguardando OK do fundador.

---

## PASSO A3.1 — Causa `plan_error`, pré-checagem mecânica, estado curto

### Falhas intermitentes A3.0 (802/804)

Rodadas completas após A3.1 (3×): **810/810** verdes — **não reproduzido em 3 rodadas**.

Na sessão A3.0, uma execução registrou **802 passed / 2 failed** (124 arquivos), mas a saída **não preservou** as linhas `FAIL` / nomes dos testes (terminal truncado). **Nomes dos 2 testes: não verificado** (falha não reproduzida).

### O que mudou

| Arquivo | Mudança (linhas aprox.) |
|---------|-------------------------|
| `src/core/decision/jev-execution-checks.ts` | `plan_error` + critérios/labels/guidance; `detectPlanErrorMechanically`, `extractFilePathsFromCriteriaText`, `pathInStageScope`, estado ≤8k com `arquivos_escopo` / `reqs_com_arquivos`; trilha `fonte`/`foraDoEscopo`; `maxStateChars: 8000` |
| `src/core/orchestrator/node-executor.ts` | Chamada `diagnoseStageFailureWithJev`: `arquivosEscopo: filesScopeArr`, `criteriosPorReq` (~1580-1581) |
| `tests/decision/a3-failure-routing.test.ts` | 6 testes (a–f) |

**Nota:** `fonte: "jev"` vai na trilha `JEV_FAILURE_DIAGNOSIS`; no objeto retornado ao executor, `fonte` só aparece quando `fonte === "mecanica"` (compatível com `jev-failure-diagnosis.test.ts`).

### `npx tsc --noEmit`

```
(exit 0 — sem saída)
```

### `npx vitest run` (últimas linhas)

```
 Test Files  125 passed (125)
      Tests  810 passed (810)
   Start at  08:34:00
   Duration  241.34s (transform 5.40s, setup 2.42s, collect 32.06s, tests 140.55s, environment 40ms, prepare 23.20s)
```

### Commit

**`5f8fbf5`** — `feat(jev): plan_error mecanico e estado curto no diagnostico de falha (A3.1)`

```
 docs/relatorios/A3-falha-roteada-ao-dono.md |  47 +++++++
 src/core/decision/jev-execution-checks.ts   | 195 ++++++++++++++++++++++++--
 src/core/orchestrator/node-executor.ts      |   2 +
 tests/decision/a3-failure-routing.test.ts   | 209 ++++++++++++++++++++++++++++
 4 files changed, 439 insertions(+), 14 deletions(-)
```

### Desvios A3.0 / A3.1

Nenhum. `incident-reporter.ts` não alterado (A3.2).

### O que não foi feito

A3.2 em diante (A3.1 **não aprovado** até A3.1b).

---

## PASSO A3.1b — Pré-checagem: motivo deve citar o arquivo fora do escopo

**Motivo:** auditor reprovou A3.1 — falso positivo quando só o REQ aparecia no motivo; `pathInStageScope` tratava `page.tsx` como equivalente a `homepage.tsx`.

### Diff resumido

- `motivoCitaReqOuArquivo` → **`motivoCitaArquivo(motivo, arquivo)`**: sem REQ; caminho normalizado no motivo **ou** basename não genérico (`GENERIC_FILE_NAMES`).
- **`pathInStageScope`:** removida a 3ª condição (`endsWith` sem `/`); permanecem igualdade e sufixo com `/`.
- Testes **7–10** em `a3-failure-routing.test.ts` (total **10** testes no arquivo).

### `npx tsc --noEmit`

```
(exit 0 — sem saída)
```

### `npx vitest run` (últimas linhas)

```
 Test Files  125 passed (125)
      Tests  814 passed (814)
   Start at  09:16:30
   Duration  271.06s (transform 6.43s, setup 2.69s, collect 35.02s, tests 161.37s, environment 45ms, prepare 26.75s)
```

### Commit

**`1b659c4`** — `fix(a3): pre-checagem exige arquivo fora do escopo citado no motivo (A3.1b)`

```
 docs/relatorios/A3-falha-roteada-ao-dono.md | 41 +++++++++++++++++++-
 src/core/decision/jev-execution-checks.ts   | 22 ++++++++---
 tests/decision/a3-failure-routing.test.ts   | 60 +++++++++++++++++++++++++++++
 3 files changed, 117 insertions(+), 6 deletions(-)
```

### Desvios

Nenhum.

### O que não foi feito

A3.2 — aguardando OK do fundador.

---

## A3.2 — Roteamento de falha (`roteamentoFalha`, padrão sombra)

### Diff resumido

| Arquivo | Mudança |
|---------|---------|
| `src/core/decision/jev-execution-checks.ts:84` | `export const GENERIC_FILE_NAMES` |
| `src/core/decision/jev-execution-checks.ts:198-312` | `FAILURE_ROUTE_DONO`, `failureRouteApplies`, `failureRouteAcao`, `computeFailureRoutePersistence` |
| `src/core/config/orchestration-policy.ts:112,301,533-541` | tipo/padrão/leitura `roteamentoFalha` |
| `config/politicas-orquestracao.yaml` | `roteamento_falha: sombra` |
| `src/core/orchestrator/node-executor.ts:1255-1259,1624-1675,1690-1720,1783-1790` | roteamento pós-diagnóstico; flags `planErrorSkipAttempt` / `evaluatorErrorFreeRetry` (separadas de `evaluatorOutageFreeRetry`); trilha `FAILURE_ROUTE_WOULD_ACT`; `updatedAttempts` |
| `src/core/governance/incident-reporter.ts:33,191` | `dono?: string`; linha `**Dono:**` opcional |
| `tests/decision/a3-failure-routing.test.ts` | +12 testes A3.2 (sombra por causa, ativo plan/evaluator, golden incidente sem dono) |

Produção: YAML e defaults em **`sombra`** — fluxo igual ao anterior; só trilha `FAILURE_ROUTE_WOULD_ACT`. Modo **`ativo`** coberto por testes unitários de `computeFailureRoutePersistence` (não ligado fora de testes).

### `npx tsc --noEmit`

```
(saída vazia — exit 0)
```

### `npx vitest run` (totais)

```
 Test Files  125 passed (125)
      Tests  826 passed (826)
   Duration  219.69s
```

### Desvios

- **`tests/harness/orchestration-policy-and-skills.test.ts`** (fora da lista R1 do A3.2): três `expect(policy.jevExecucao).toEqual` atualizados com `roteamentoFalha: "sombra"`. Sem isso, vitest quebra ao carregar `config/politicas-orquestracao.yaml` (item 4). Incluído no mesmo commit por exigência de suite verde.

### Commit

_(preencher após `git commit`)_

---
