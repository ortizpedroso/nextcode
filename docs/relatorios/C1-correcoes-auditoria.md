# Relatório de Execução — Pacote C1 (Correções da Auditoria de 12/10)

## 0. Leitura Feita (Regra Zero)
O passo C1.1 reverte os prefixos de rota paga para aceitar estritamente `custom/` e desfaz a cascata de contingência no executor, garantindo que papéis críticos não recorram a provedores gratuitos.
O passo C1.2 corrige o algoritmo de geração de chave de cache do JEV para serializar recursivamente com ordenação estável as perguntas aninhadas, impedindo colisões de chave quando apenas os critérios internos diferem.
O passo C1.3 acrescenta formalmente a seção de retificação §4.24 ao log de implantação, desfazendo sem apagar os registros sem comprovação factual de 12/10 referentes a P3 12/12, economia de 57,2% do Jev e entrega do Gateway.
A prova real executa o benchmark do P3 em contêiner hermético para comprovar na prática que nenhum modelo não autorizado é acionado e que a sessão pausa graciosamente sem queimar tentativas quando o provedor primário esgota cota.
O pacote assegura a estanqueidade dos portões mecânicos e prepara o terreno limpo e auditado para a consolidação em documento único no pacote D1.

## 1. Identificação
- **Hash de partida:** `6076d2839a0af344de1c8ab5fd754fb9a499c14a` (`6076d28`)
- **Commits gerados (`git log --oneline 6076d28..HEAD`):**
```text
97b07fc docs(bench): C1 - rodada P3 apos correcoes
cdaf53e docs(jev-log): C1.3 - corrige registros sem prova das secoes 4.19, 4.20 e 4.23
af431e8 fix(jev): C1.2 - chave do cache considera o conteudo das perguntas
f19152c fix(rota): C1.1 - papeis criticos so em custom/ e executor sem cascata (desfaz parte de 786d393)
```

## 2. Por Commit

### Commit `f19152c` — Passo C1.1
- **`git show --stat f19152c`:**
```text
commit f19152c273177be153af11ac0b677a77a0953cf2
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Tue Oct 13 05:40:58 2026 -0400

    fix(rota): C1.1 - papeis criticos so em custom/ e executor sem cascata (desfaz parte de 786d393)
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 config/politicas-orquestracao.yaml                   |  2 +-
 src/core/orchestrator/node-executor.ts               |  5 +----
 tests/config/politica-rota-paga.test.ts              | 18 ++++++++++++++++++
 .../harness/orchestration-policy-and-skills.test.ts  |  2 +-
 tests/orchestrator/executor-somente-pago.test.ts     | 20 ++++++++++++++++++++
 5 files changed, 41 insertions(+), 6 deletions(-)
```
- **Saída do `tsc`:**
`npx tsc --noEmit` completado com exit 0 (0 erros).
- **Resumo do `vitest`:**
115 test files passed (115), 748 tests passed (748), 0 failed.

---

### Commit `af431e8` — Passo C1.2
- **`git show --stat af431e8`:**
```text
commit af431e8affa03072bc7a4b455ca72df21f78fa25
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Tue Oct 13 05:47:12 2026 -0400

    fix(jev): C1.2 - chave do cache considera o conteudo das perguntas
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/core/decision/jev-cache.ts   | 15 ++++++++++++++-
 tests/decision/jev-cache.test.ts | 30 ++++++++++++++++++++++++++++++
 2 files changed, 44 insertions(+), 1 deletion(-)
```
- **Saída do `tsc`:**
`npx tsc --noEmit` completado com exit 0 (0 erros).
- **Resumo do `vitest`:**
115 test files passed (115), 750 tests passed (750), 0 failed.

---

### Commit `cdaf53e` — Passo C1.3
- **`git show --stat cdaf53e`:**
```text
commit cdaf53eab8b4228483265ac4c31ece74e3ba0c5d
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Tue Oct 13 05:51:18 2026 -0400

    docs(jev-log): C1.3 - corrige registros sem prova das secoes 4.19, 4.20 e 4.23
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 docs/JEV-LOG-DE-IMPLANTACAO.md | 27 +++++++++++++++++++++++++++
 1 file changed, 27 insertions(+)
```
- **Saída do `tsc`:**
`npx tsc --noEmit` completado com exit 0 (0 erros).
- **Resumo do `vitest`:**
115 test files passed (115), 750 tests passed (750), 0 failed.

---

### Commit `97b07fc` — Prova Real
- **`git show --stat 97b07fc`:**
```text
commit 97b07fc9634e9d5aaef383fe5f98bfbebe82f939
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Tue Oct 13 05:55:14 2026 -0400

    docs(bench): C1 - rodada P3 apos correcoes
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 docs/relatorios/bench/2026-10-13-0552.md   |  34 ++++++
 docs/relatorios/bench/2026-10-13-0552.yaml | 131 +++++++++++++++++++++++++++++
 2 files changed, 165 insertions(+)
```

## 3. Testes Novos

| Arquivo | Nome do Teste | O que Prova |
|---|---|---|
| `tests/config/politica-rota-paga.test.ts` | `política real aceita só custom/` | Valida que `loadOrchestrationPolicy().roteamentoPapeisCriticos.prefixosRotaPaga` contém exatamente `["custom/"]` |
| `tests/config/politica-rota-paga.test.ts` | `nenhum prefixo de revendedor gratuito ou contingência` | Valida que nenhum item começa com `electronhub/`, `groq/` ou `mistral/` |
| `tests/orchestrator/executor-somente-pago.test.ts` | `C1.1: executor sem cascata — gateways só com o modelo pago e prefixos só custom/` | Valida que `allowedRoutedViaPrefixes` é `["custom/"]` e nenhum gateway recebe modelos de contingência |
| `tests/decision/jev-cache.test.ts` | `C1.2: perguntas com conteúdo diferente geram chaves diferentes` | Valida que perguntas com mesma chave e `instructions` diferentes geram chaves SHA-256 distintas |
| `tests/decision/jev-cache.test.ts` | `C1.2: ordem das chaves aninhadas não muda a chave` | Valida que a ordem das propriedades em objetos aninhados (`criteria`) é normalizada e não altera o hash |

### Prova de Falha Antes e Verde Depois

#### Passo C1.1 — Falha Antes da Correção:
```text
FAIL  tests/config/politica-rota-paga.test.ts > C1.1 — rota paga da política real > política real aceita só custom/
AssertionError: expected [ 'custom/', 'electronhub/', 'mistral/', 'groq/' ] to deeply equal [ 'custom/' ]

FAIL  tests/config/politica-rota-paga.test.ts > C1.1 — rota paga da política real > nenhum prefixo de revendedor gratuito ou contingência
AssertionError: expected true to be false

FAIL  tests/orchestrator/executor-somente-pago.test.ts > Passo R1.3 — Executor só no pago (Flash/Pro) > C1.1: executor sem cascata — gateways só com o modelo pago e prefixos só custom/
AssertionError: expected [ 'custom/', 'electronhub/', 'mistral/', 'groq/' ] to deeply equal [ 'custom/' ]
```

#### Passo C1.1 — Verde Depois da Correção:
```text
 ✓ tests/orchestrator/executor-somente-pago.test.ts (8 tests) 562ms
 ✓ tests/config/politica-rota-paga.test.ts (2 tests) 11ms
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

#### Passo C1.2 — Prova do Bug no Terminal (`node -e`):
```bash
node -e 'const q={a:{type:"choice",instructions:"X"}};console.log(JSON.stringify(q,Object.keys(q).sort()))'
# Saída:
{"a":{}}
```

#### Passo C1.2 — Falha Antes da Correção:
```text
FAIL  tests/decision/jev-cache.test.ts > Pacote P6 — Cache Local de Decisões do JEV (TypeSafe AI) > C1.2: perguntas com conteúdo diferente geram chaves diferentes
AssertionError: expected '015b30d9b6434ff8b39543a8166f09e13ec7f…' not to be '015b30d9b6434ff8b39543a8166f09e13ec7f…'
```

#### Passo C1.2 — Verde Depois da Correção:
```text
 ✓ tests/decision/jev-cache.test.ts (9 tests) 78ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

## 4. Evidência de Nomes (`git grep -n`)

- `prefixos_rota_paga`:
```text
config/politicas-orquestracao.yaml:179:  prefixos_rota_paga: "custom/"                         # X-Routed-Via aceito para papéis críticos (lista separada por vírgula)
src/core/config/orchestration-policy.ts:610:    "prefixos_rota_paga",
```

- `loadPaidGatewaysForTier`:
```text
src/core/llm/paid-routing.ts:36:export async function loadPaidGatewaysForTier(
src/core/orchestrator/node-executor.ts:12:import { loadPaidGatewaysForTier } from "@/core/llm/paid-routing";
src/core/orchestrator/node-executor.ts:1021:    ? await loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos)
```

- `computeKey`:
```text
src/core/decision/jev-cache.ts:38:  public computeKey(purpose: string, state: string, questions: unknown): string {
src/core/decision/jev.ts:159:    ? globalJevCache.computeKey(params.purpose, params.state, {
src/core/decision/jev.ts:282:    ? globalJevCache.computeKey(params.purpose, params.state, params.questions)
```

- `stableStringify`:
```text
src/core/decision/jev-cache.ts:39:    function stableStringify(val: unknown): string {
src/core/decision/jev-cache.ts:52:    const serializedQuestions = stableStringify(questions);
```

- `JevDecisionCache`:
```text
src/core/decision/jev-cache.ts:21:export class JevDecisionCache {
src/core/decision/jev-cache.ts:123:export const globalJevCache = new JevDecisionCache();
```

## 5. Prova Real

Executada com: `npm run bench -- --projetos p3 --variantes padrao --repeticoes 1`
Relatório: [`docs/relatorios/bench/2026-10-13-0552.md`](file:///c:/projetos/nextcode/docs/relatorios/bench/2026-10-13-0552.md)

- **Fase:** `⚠️ PAUSADA`
- **Aceite bruto:**
```text
RESUMO {"projeto":"p3","total":12,"aprovados":0,"reprovados":12}
```
- **Compilação TypeScript do projeto (`tsc`):** `erro (1)` (projeto pausou na primeira etapa sem gerar código).
- **Custo Total:** `US$ 0.0000` (zero custo consumido).
- **Tabela "Detalhe por etapa":**
```markdown
| Node ID | Título | Cluster | Nível Plan. | Fonte | Exec. Modelos | Tokens In | Tokens Out | Exec. USD | Aval. Modelos | Aval. USD |
|---|---|---|---|---|---|---|---|---|---|---|
| task-analista-mb-core-1 | Etapa 1 (core): src/lib/auth.ts | core | medio | ausente | - | 0 | 0 | 0.0000 | - | 0.0000 |
| task-analista-mb-backend-1 | Etapa 2 (backend): src/app/api/auth/registrar/route.ts | core | medio | ausente | - | 0 | 0 | 0.0000 | - | 0.0000 |
| task-analista-mb-backend-2 | Etapa 3 (backend): src/app/api/auth/login/route.ts | core | medio | ausente | - | 0 | 0 | 0.0000 | - | 0.0000 |
| task-analista-mb-backend-3 | Etapa 4 (backend): src/app/api/auth/sessao/route.ts | core | medio | ausente | - | 0 | 0 | 0.0000 | - | 0.0000 |
| task-analista-mb-backend-4 | Etapa 5 (backend): src/app/api/auth/logout/route.ts | core | medio | ausente | - | 0 | 0 | 0.0000 | - | 0.0000 |
```
- **Conferência de "Exec. Modelos":** Nenhuma linha acionou modelos de contingência. Zero ocorrência de `electronhub/`, `mistral/` ou `groq/`.
- **Trilha de Telemetria (`dev-copy.db`):**
```text
EXECUTOR_TIER {"nodeId":"task-analista-mb-core-1","plannedTier":"pesado","attempt":1,"executorTier":"pesado"}
EXECUTOR_ROTA_PAGA {"nodeId":"task-analista-mb-core-1","executorTier":"pesado","modelos":["deepseek-v4-pro"],"gateways":["freellmapi"]}
llm.gateway_failure {"gateway":"freellmapi","requestedModel":"deepseek-v4-pro","kind":"exhausted","status":429,"detail":"All models exhausted: 1 route checked (1 rate-limited or on cooldown). Add more API keys or wait for rate limits to reset. Soonest reset ~11h. 1 model skipped: no key configured for their platform."}
PHASE_TRANSITION {"from":"EXECUCAO","to":"PAUSADA","event":{"type":"SEM_LLM"},"effects":[]}
SESSION_PAUSED_NO_LLM {"nodeId":"task-analista-mb-core-1","title":"Etapa 1 (core): src/lib/auth.ts","attemptsPreserved":0}
```
- **Conclusão da Prova:** O sistema funcionou com precisão cirúrgica de acordo com o contrato da referência: sem rota paga acessível (`HTTP 429` no FreeLLMAPI), o executor não recorreu a nenhum modelo gratuito nem cascata de contingência; a sessão transitou para `PAUSADA` sem consumir nenhuma tentativa (`attemptsPreserved: 0`), mantendo o custo em zero (`US$ 0.0000`).

## 6. Escopo (`git diff --stat 6076d28..HEAD`)
```text
 config/politicas-orquestracao.yaml                 |   2 +-
 docs/JEV-LOG-DE-IMPLANTACAO.md                     |  27 +++++
 docs/relatorios/bench/2026-10-13-0552.md           |  34 ++++++
 docs/relatorios/bench/2026-10-13-0552.yaml         | 131 +++++++++++++++++++++
 src/core/decision/jev-cache.ts                     |  15 ++-
 src/core/orchestrator/node-executor.ts             |   5 +-
 tests/config/politica-rota-paga.test.ts            |  18 +++
 tests/decision/jev-cache.test.ts                   |  30 +++++
 .../orchestration-policy-and-skills.test.ts        |   2 +-
 tests/orchestrator/executor-somente-pago.test.ts   |  20 ++++
 10 files changed, 277 insertions(+), 7 deletions(-)
```

## 7. Desvios do Prompt
- Linha 184 de `tests/harness/orchestration-policy-and-skills.test.ts` restaurada ao valor de `786d393^` (`prefixosRotaPaga: ["custom/"]`), com autorização expressa do fundador (o prompt original não listava esse arquivo na lista de `PODE ALTERAR` do C1.1, e a parada obrigatória T-B foi acionada antes da modificação).

## 8. Checklist de Travas (T-A … T-N)

- **T-A Pré-condição:** Cumprida. `git status --short` limpo (apenas `.claude/`); `HEAD` bateu com commit de `C1-correcoes-auditoria.md` (`6076d28`).
- **T-B Escopo fechado:** Cumprida. Apenas os arquivos permitidos foram alterados (mais o teste autorizado explicitamente pelo fundador).
- **T-C Literalidade:** Cumprida. Nomes e mensagens de commit idênticos às especificações.
- **T-D Nomes reais:** Cumprida. Todos os nomes conferidos com `git grep -n`.
- **T-E Um passo = um commit:** Cumprida. Três commits atômicos de código/docs + um commit da prova real, com `tsc` e `vitest` verdes em cada um.
- **T-F Banco:** Cumprida. Nenhum dado escrito em `prisma/dev.db`; bench e testes usaram cópias temporárias isoladas.
- **T-G Segredos:** Cumprida. Nenhuma chave inserida em código, commits ou relatórios.
- **T-H Dependências:** Cumprida. Zero dependências novas adicionadas ao `package.json`.
- **T-I Fim de linha:** Cumprida. Fim de linha LF preservado em todos os arquivos modificados.
- **T-J Paradas obrigatórias:** Cumprida. Parada obrigatória acionada no C1.1 quando `tests/harness/orchestration-policy-and-skills.test.ts` falhou fora do escopo, aguardando aprovação do fundador. Na prova real, fase `PAUSADA` por falta de rota paga foi relatada sem tentativas de contorno indevido.
- **T-K Commits:** Cumprida. Todos os commits encerram com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel:** Cumprida. Números e dados copiados diretamente das saídas brutas.
- **T-M Código gerado nunca roda no host:** Cumprida. O aceite hermético do bench executou via contêiner `nextcode-aceite:1`.
- **T-N Histórico conferido:** Cumprida. Reflog preservado, comandos git estritamente limitados aos autorizados.

## 9. Sugestões de Melhoria (Opcional)
- `src/core/llm/paid-routing.ts`: o código de contingência `CONTINGENCY_EXECUTOR_MODELS` e as opções de fallback de contingência continuam presentes no arquivo, embora tenham sido desacoplados do `node-executor.ts`. Caso o fundador decida não utilizar contingência nem mesmo no futuro, esse bloco pode ser limpo ou formalizado na referência §5.2.
- `src/core/decision/jev-cache.ts`: `stableStringify` foi definida dentro de `computeKey` para manter escopo 100% restrito ao corpo do método sem tocar na classe; futuramente pode ser extraída para helper compartilhado se outros módulos necessitarem de ordenação canônica de JSON.

## 10. Dúvidas Abertas para o Fundador
- O FreeLLMAPI para a chave configurada no `.env` está retornando `HTTP 429` (All models exhausted). Quando os limites resetarem ou novas chaves forem inseridas, o benchmark P3 poderá ser re-executado para validar o fluxo até a fase `ENTREGUE`.
