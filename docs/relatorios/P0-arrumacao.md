# Relatório — Tarefa P0: Arrumação (`McpServer.env` cifrado em repouso e causa do teste intermitente)

## 1. Identificação

- **Hash de partida (`e2f2ee6`):** `e2f2ee64abd565711fb987c87ab7185dd14261ad`
- **`git log --oneline e2f2ee6..HEAD`:**
  - `77b3adb fix(security): P0.1 - McpServer.env cifrado em repouso e mascarado nas respostas`
  - Commit final deste pacote (`HEAD`): `test: P0.2 - causa do teste intermitente` (inclui `tests/harness/end-to-end-harness-plan.test.ts` e `docs/relatorios/P0-arrumacao.md`).

---

## 2. Por commit (`git show --stat`, `npx tsc --noEmit` e `npx vitest run`)

### 2.1 Commit P0.1 — `77b3adb` (`77b3adbd59ba997660a079f154973641b7c2a93e`)

- **`git show --stat 77b3adb`:**
  ```text
  commit 77b3adbd59ba997660a079f154973641b7c2a93e
  Author: ortizpedroso <ortizpedroso@hotmail.com>
  Date:   Thu Oct 8 13:19:53 2026 -0400

      fix(security): P0.1 - McpServer.env cifrado em repouso e mascarado nas respostas

      Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

   scripts/encrypt-stored-secrets.ts     |  27 ++++
   src/app/api/mcp/servers/[id]/route.ts |  15 ++-
   src/app/api/mcp/servers/route.ts      |  16 ++-
   src/core/security/mcp-env.ts          |  80 ++++++++++++
   tests/security/mcp-env.test.ts        | 229 ++++++++++++++++++++++++++++++++++
   5 files changed, 362 insertions(+), 5 deletions(-)
  ```
- **Saída do `npx tsc --noEmit`:** `0 erros` (saída vazia, exit code 0).
- **Linha final do `npx vitest run` completo:**
  ```text
   Test Files  86 passed (86)
        Tests  621 passed (621)
     Start at  13:17:00
     Duration  123.58s (transform 2.41s, setup 1.22s, collect 12.33s, tests 77.67s, environment 20ms, prepare 9.98s)
  ```

### 2.2 Commit P0.2 — `test: P0.2 - causa do teste intermitente` (inclui este relatório)

- **Estatística das alterações de código/teste (`git diff --stat 77b3adb -- tests/harness/end-to-end-harness-plan.test.ts`):**
  ```text
   tests/harness/end-to-end-harness-plan.test.ts | 21 +++++++++++----------
   1 file changed, 11 insertions(+), 10 deletions(-)
  ```
- **Saída do `npx tsc --noEmit`:** `0 erros` (saída vazia, exit code 0).
- **Linha final do `npx vitest run` completo (10ª execução consecutiva pós-correção):**
  ```text
   Test Files  86 passed (86)
        Tests  621 passed (621)
     Duration  122.58s (transform 4.77s, setup 1.15s, collect 14.83s, tests 76.73s, environment 18ms, prepare 8.68s)
  ```

---

## 3. Testes novos

| Arquivo | Nome do teste | O que prova |
|---|---|---|
| `tests/security/mcp-env.test.ts` | `encryptMcpEnv cifra todo valor e mantém as chaves` | Nenhum valor em texto plano aparece no JSON cifrado (`isEncrypted` verdadeiro para cada chave) e `readMcpEnv` devolve os valores originais. |
| `tests/security/mcp-env.test.ts` | `encryptMcpEnv aceita string JSON e objeto` | Tanto string JSON quanto objeto produzem o mesmo conjunto de chaves cifradas, o mesmo resultado decifrado em `readMcpEnv` e a mesma máscara em `maskMcpEnv`. |
| `tests/security/mcp-env.test.ts` | `encryptMcpEnv rejeita array e texto` | Lança `"env deve ser um objeto JSON"` para array, JSON de array, texto não-JSON, string JSON primitiva e número. |
| `tests/security/mcp-env.test.ts` | `valor mascarado mantém o segredo guardado` | `encryptMcpEnv({ API_KEY: "****" }, guardado)` preserva exatamente o segredo cifrado já armazenado em `guardado`. |
| `tests/security/mcp-env.test.ts` | `maskMcpEnv nunca devolve o valor` | Substitui todos os valores cifrados por `"****"`, nunca expondo o segredo em texto plano. |
| `tests/security/mcp-env.test.ts` | `API: POST /api/mcp/servers grava env cifrado e responde mascarado` | Com `prisma.mcpServer.create` e `findMany` espionados via `vi.spyOn`, `data.env` enviado ao Prisma está cifrado e as respostas de `POST` e `GET` trazem `env` mascarado (`"****"`). |
| `tests/security/mcp-env.test.ts` | `API: PATCH com env mascarado preserva o segredo` | Em `PATCH /api/mcp/servers/[id]`, enviar `{ env: { MCP_TOKEN: "****" } }` mantém o segredo cifrado de `atual.env` no banco e devolve `env` mascarado na resposta. |
| `tests/security/mcp-env.test.ts` | `API: env inválido responde 400` | `POST` e `PATCH` com `env` inválido (array ou texto não-JSON) respondem status `400` com `{ error: "env deve ser um objeto JSON" }`. |

---

## 4. Evidência de nomes (`git grep -n`)

| Nome citado | Saída de `git grep -n "<nome>"` |
|---|---|
| `encryptMcpEnv` | `src/core/security/mcp-env.ts:14:export function encryptMcpEnv(input: unknown, stored?: string | null): string {`<br>`src/app/api/mcp/servers/route.ts:76:      encryptedEnv = encryptMcpEnv(env);`<br>`src/app/api/mcp/servers/[id]/route.ts:26:        dataToUpdate.env = encryptMcpEnv(env, atual?.env);` |
| `maskMcpEnv` | `src/core/security/mcp-env.ts:60:export function maskMcpEnv(stored?: string | null): string {`<br>`src/app/api/mcp/servers/route.ts:17:      servers: servers.map((s) => ({ ...s, env: maskMcpEnv(s.env) })),`<br>`src/app/api/mcp/servers/[id]/route.ts:40:      server: { ...server, env: maskMcpEnv(server.env) },` |
| `readMcpEnv` | `src/core/security/mcp-env.ts:71:export function readMcpEnv(stored?: string | null): Record<string, string> {`<br>`tests/security/mcp-env.test.ts:6:import { encryptMcpEnv, maskMcpEnv, readMcpEnv } from "@/core/security/mcp-env";` |
| `writeSecret` | `src/core/security/crypto.ts:227:export function writeSecret(plaintext?: string | null): string | null {`<br>`src/core/security/mcp-env.ts:1:import { maskSecret, readSecret, writeSecret } from "@/core/security/crypto";` |
| `readSecret` | `src/core/security/crypto.ts:217:export function readSecret(stored?: string | null): string {`<br>`src/core/security/mcp-env.ts:1:import { maskSecret, readSecret, writeSecret } from "@/core/security/crypto";` |
| `isEncrypted` | `src/core/security/crypto.ts:116:export function isEncrypted(value?: string | null): boolean {`<br>`tests/security/mcp-env.test.ts:5:import { isEncrypted } from "@/core/security/crypto";` |
| `maskSecret` | `src/core/security/crypto.ts:255:export function maskSecret(value?: string | null): string {`<br>`src/core/security/mcp-env.ts:66:    out[key] = maskSecret(rawVal == null ? "" : String(rawVal));` |
| `isEncryptedWithActiveKey` | `src/core/security/crypto.ts:104:export function isEncryptedWithActiveKey(value?: string | null): boolean {`<br>`scripts/encrypt-stored-secrets.ts:13:  if (!value || isEncryptedWithActiveKey(value)) return undefined;` |
| `EXECUTOR_REPORT_INVALID` | `src/core/orchestrator/node-executor.ts:1210:          action: "EXECUTOR_REPORT_INVALID",`<br>`src/core/orchestrator/node-executor.ts:1309:          action: "EXECUTOR_REPORT_INVALID",`<br>`tests/harness/end-to-end-harness-plan.test.ts:1095:        where: { sessionId: session.id, action: "EXECUTOR_REPORT_INVALID" },` |
| `setPaidOnlyRoutingForTests` | `src/core/orchestrator/node-executor.ts:675:export function setPaidOnlyRoutingForTests(value: boolean | null): void {`<br>`tests/harness/end-to-end-harness-plan.test.ts:69:    setPaidOnlyRoutingForTests(false);` |
| `TelemetryLogger` | `src/core/telemetry/telemetry-logger.ts:16:export class TelemetryLogger {`<br>`src/core/orchestrator/node-executor.ts:31:import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";` |

---

## 5. Passo 0.2 — Investigação, reprodução, causa e correção do teste intermitente

### 5.1 Resultado das 10 execuções iniciais (antes da correção)

```text
=== RUN 1 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 127.48s
=== RUN 2 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 121.93s
=== RUN 3 (exit=1) ===
 FAIL  tests/harness/end-to-end-harness-plan.test.ts > Plano de Ação End-to-End — Fila nunca para (PAUSADA/LLM_VOLTOU), P1, P2 por Cluster e Lente 2 Plantada > Item 5 (Relatório do Executor): erro só no relatório pede só o relatório de novo (até 2 vezes) SEM gastar tentativa, grava executorReport validado no resultado e registra EXECUTOR_REPORT_INVALID na trilha
 Test Files  1 failed | 85 passed (86) | Tests  1 failed | 620 passed (621) | Duration 126.96s
=== RUN 4 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 119.79s
=== RUN 5 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 115.71s
=== RUN 6 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 122.01s
=== RUN 7 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 120.67s
=== RUN 8 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 124.77s
=== RUN 9 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 124.21s
=== RUN 10 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 119.21s
```

### 5.2 Falha encontrada (evidência literal da 3ª execução)

- **Arquivo:** `tests/harness/end-to-end-harness-plan.test.ts`
- **Teste:** `Plano de Ação End-to-End — Fila nunca para (PAUSADA/LLM_VOLTOU), P1, P2 por Cluster e Lente 2 Plantada > Item 5 (Relatório do Executor): erro só no relatório pede só o relatório de novo (até 2 vezes) SEM gastar tentativa, grava executorReport validado no resultado e registra EXECUTOR_REPORT_INVALID na trilha`
- **Saída da falha:**
  ```text
  FAIL  tests/harness/end-to-end-harness-plan.test.ts > Plano de Ação End-to-End — Fila nunca para (PAUSADA/LLM_VOLTOU), P1, P2 por Cluster e Lente 2 Plantada > Item 5 (Relatório do Executor): erro só no relatório pede só o relatório de novo (até 2 vezes) SEM gastar tentativa, grava executorReport validado no resultado e registra EXECUTOR_REPORT_INVALID na trilha
  AssertionError: expected '{"nodeId":"task-base-1791480309121-1"…' to contain 'possui 4 linha(s)'

  Expected: "possui 4 linha(s)"
  Received: "{"nodeId":"task-base-1791480309121-1","attempt":1,"retryIndex":1,"reason":"[RELATÓRIO P12] Requisito inventado \"REQ-999\" não pertence ao Microbrief \"task-base-1791480309121-1\".","errors":["[RELATÓRIO P12] Requisito inventado \"REQ-999\" não pertence ao Microbrief \"task-base-1791480309121-1\"."]}"

   ❯ tests/harness/end-to-end-harness-plan.test.ts:1102:36
      1100|     });
      1101|     expect(invalidLogs.length).toBe(2);
      1102|     expect(invalidLogs[0].details).toContain("possui 4 linha(s)");
         |                                    ^
      1103|     expect(invalidLogs[1].details).toContain("REQ-999");
      1104|   });
  ```

### 5.3 Causa

No teste do Item 5 (`tests/harness/end-to-end-harness-plan.test.ts`), `SmartRouter.prototype.dispatchWithFallback` é simulado em memória e resolve no mesmo tick/milissegundo. O laço de reenvio só do relatório em `executeTaskNode` dispara duas chamadas não-bloqueantes a `TelemetryLogger.log({ action: "EXECUTOR_REPORT_INVALID", details: { ..., retryIndex: 0 } })` e `TelemetryLogger.log({ action: "EXECUTOR_REPORT_INVALID", details: { ..., retryIndex: 1 } })` no mesmo milissegundo. Como `TelemetryLogger.log` dispara `prisma.telemetryLog.create` sem `await` (com chave primária `cuid()`) e o teste consultava `prisma.telemetryLog.findMany({ where: { sessionId: session.id, action: "EXECUTOR_REPORT_INVALID" } })` sem ordenação pelo `retryIndex` gravado em `details`, sob contenção de I/O no SQLite a linha com `retryIndex: 1` (`REQ-999`) ocasionalmente era inserida/retornada na posição `invalidLogs[0]` antes da linha com `retryIndex: 0` (`possui 4 linha(s)`).

### 5.4 Correção e reversão das mudanças de `9e88b59`

1. Em `tests/harness/end-to-end-harness-plan.test.ts`, os registros de `EXECUTOR_REPORT_INVALID` retornados por `prisma.telemetryLog.findMany` passaram a ser ordenados deterministicamente pelo campo `retryIndex` presente no JSON `details` (`(JSON.parse(a.details || "{}").retryIndex ?? 0) - (JSON.parse(b.details || "{}").retryIndex ?? 0)`).
2. Conforme o item 4 do Passo 0.2, foram desfeitas em `tests/harness/end-to-end-harness-plan.test.ts` as duas alterações paliativas do commit `9e88b59` (`{ timeout: 60000 }` no `describe` e `try { fs.rmSync(..., { maxRetries: 5, retryDelay: 100 }) } catch {}` no `afterEach`), mantendo intactas as chamadas `setPaidOnlyRoutingForTests(...)` do R1.4.

### 5.5 Resultado das 10 execuções consecutivas pós-correção (com `9e88b59` desfeito)

```text
=== RUN 1 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 123.16s
=== RUN 2 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 121.43s
=== RUN 3 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 120.09s
=== RUN 4 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 134.89s
=== RUN 5 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 128.62s
=== RUN 6 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 128.74s
=== RUN 7 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 129.83s
=== RUN 8 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 130.17s
=== RUN 9 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 125.77s
=== RUN 10 (exit=0) ===
 Test Files  86 passed (86) | Tests  621 passed (621) | Duration 122.58s
```

---

## 6. Desvios do prompt

nenhum

---

## 7. Checklist das travas T-A…T-K

| Trava | Cumprida? | Evidência |
|---|---|---|
| **T-A Pré-condição** | **Sim** | Antes de iniciar: `git status --short` continha apenas `?? .claude/.headroom_wrap_marker.json`; `git rev-parse HEAD` e `git log -1 --format=%H -- docs/prompts/P0-arrumacao.md` retornaram `e2f2ee64abd565711fb987c87ab7185dd14261ad`. |
| **T-B Escopo fechado** | **Sim** | Passo 0.1 alterou apenas os 5 arquivos listados em `PODE ALTERAR` (`77b3adb`). Passo 0.2 alterou apenas `tests/harness/end-to-end-harness-plan.test.ts` (mais este relatório `docs/relatorios/P0-arrumacao.md`). Nenhum timeout foi aumentado; o `{ timeout: 60000 }` e o `try {} catch {}` de `9e88b59` foram removidos. |
| **T-C Literalidade** | **Sim** | Assinaturas, mensagens de erro (`"env deve ser um objeto JSON"`), status HTTP (`400`), nomes de funções (`encryptMcpEnv`, `maskMcpEnv`, `readMcpEnv`) e nomes dos 8 testes idênticos ao prompt. |
| **T-D Nomes reais** | **Sim** | Todos os símbolos e caminhos citados neste relatório foram verificados com `git grep -n` (Seção 4). |
| **T-E Um passo = um commit** | **Sim** | Passo 0.1 (`77b3adb`) e Passo 0.2 precedidos de `npx tsc --noEmit` (0 erros) e `npx vitest run` completo (86 arquivos / 621 testes verdes). Nenhum uso de `--amend`, `rebase`, `reset`, `push --force` ou `--no-verify`. |
| **T-F Banco** | **Sim** | Todas as execuções da suíte usaram cópia temporária em `$env:TEMP` via `DATABASE_URL`; `prisma/dev.db` não foi modificado (`git status --short` limpo). |
| **T-G Segredos** | **Sim** | Nenhuma chave real em código, testes, logs ou relatório. |
| **T-H Dependências** | **Sim** | `package.json` e `package-lock.json` intocados. |
| **T-I Fim de linha** | **Sim** | Conferido com `git ls-files --eol` antes e depois: `scripts/encrypt-stored-secrets.ts` (`i/lf w/lf`), `src/app/api/mcp/servers/route.ts` (`i/lf w/lf`), `src/app/api/mcp/servers/[id]/route.ts` (`i/lf w/crlf`), `src/core/security/mcp-env.ts` (`i/lf w/lf`), `tests/security/mcp-env.test.ts` (`i/lf w/lf`), `tests/harness/end-to-end-harness-plan.test.ts` (`i/lf w/lf`). |
| **T-J Paradas obrigatórias** | **Sim** | Nenhuma condição de parada acionada (a causa da falha intermitente estava no próprio teste `tests/harness/end-to-end-harness-plan.test.ts`, não em `src/`). |
| **T-K Commits** | **Sim** | Todos os commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. |

---

## 8. Dúvidas abertas para o fundador

Nenhuma dúvida aberta neste pacote.
