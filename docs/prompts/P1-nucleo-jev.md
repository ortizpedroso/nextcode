# Prompt P1 — Núcleo do Jev (custo na conta, novas tentativas, estado inteiro, limiares do YAML)

> Pacote P1 de `docs/NEXTCODE-REFERENCIA.md` §5.3. Achados que o motivam: §5.2 e `memory/diario.md` (08/10, auditoria do P0).
> Decisão: **não adotar o SDK `@typesafe-ai/sdk` agora** — o adaptador próprio já usa `safeFetch` (anti-SSRF) e a trilha; o que o SDK
> traria (novas tentativas em 429/529) são ~20 linhas. Reavaliar se o adaptador crescer.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa P1 — Núcleo do Jev: custo do Jev no teto, nova tentativa em 429/529, alerta em 422, estado nunca cortado, score lido certo, limiares do YAML lidos de verdade

## OBJETIVO
Corrigir cinco defeitos do adaptador do Jev (`src/core/decision/jev.ts`) e da política, conferidos pelo auditor em 08/10:
1. o custo do Jev **não entra** em `LLM_COST` (o teto de custo não o vê) e `usage` não vai para a trilha;
2. HTTP **429/529** (limite/sobrecarga, a documentação manda tentar de novo com espera) vira "Jev indisponível" na hora;
3. HTTP **422** (pergunta mal formada = bug nosso) é tratado igual a queda, sem alerta;
4. `askJevBatch` **corta o JSON do estado no meio** (`state.slice(0, maxChars)`) e 4 chamadores também cortam (`.slice(0, 24000)`), mandando JSON inválido;
5. a resposta `score` traz `probabilities` como **objeto** `{"0":p,"1":p}` (documentação oficial) e o código só aceita array → perde as probabilidades;
6. o bloco `jev_limiares` de `config/politicas-orquestracao.yaml` **não é lido** por `loadOrchestrationPolicy` (só valem os padrões do código).

## TRAVAS (obrigatórias; violar qualquer uma = PARAR e relatar)
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/P1-nucleo-jev.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só altere os arquivos de PODE ALTERAR do passo em curso. Precisou de outro → PARE e relate. Nunca aumente timeout, nunca use `try {} catch {}` vazio, `.skip`/`.only`, nem altere teste existente além do escrito aqui.
- **T-C Literalidade.** Exatamente o que está escrito (nomes, eventos, números). Nada de refatoração extra. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais.** Todo nome citado existe (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit.** Antes de cada commit: `npx tsc --noEmit` (0 erros) e `npx vitest run` completo verde **nesse estado**. Cole as saídas. Proibido `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; use cópia temporária (`DATABASE_URL`).
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório ou saída colada.
- **T-H Dependências.** Nenhum pacote novo (o SDK da TypeSafe **não** entra).
- **T-I Fim de linha.** Preserve o fim de linha de cada arquivo (`git ls-files --eol`).
- **T-J Paradas obrigatórias.** Teste antigo quebrando por motivo não previsto aqui (cole a lista e PARE); arquivo fora do escopo; contradição prompt × código; custo real > US$ 0,50.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## LEITURA OBRIGATÓRIA
- `src/core/decision/jev.ts` inteiro (`askJevChoice`, `askJevBatch`, `JevScoreResult`, `estimateJevCostUsd`, `jevTimeoutMs`, `JEV_MODEL`).
- `src/core/llm/cost.ts` (`PRICES`, `costFromUsage`, `recordLlmCost`, `UsageLike`).
- `src/core/decision/jev-execution-checks.ts` (linhas com `.slice(0, 24000)`), `src/core/governance/secret-guard.ts` (`evaluateCandidatesWithJev`).
- `src/core/config/orchestration-policy.ts` (`jevLimiares`, `DEFAULT_ORCHESTRATION_POLICY`, `extractScalarNumber`, `loadOrchestrationPolicy`) e `config/politicas-orquestracao.yaml` (bloco `jev_limiares`).
- `tests/decision/jev.test.ts` (estilo de simulação do Jev).
- Documentação oficial (já conferida pelo auditor): erros `422` = corpo inválido; `429`/`529` = tentar de novo com espera; resposta traz `usage.input_tokens`/`usage.output_tokens`; `score.probabilities` é objeto com chaves `"0"`, `"1"`…

---

## PASSO P1.1 — Custo do Jev em `LLM_COST` e `usage` na trilha

**PODE ALTERAR:** `src/core/llm/cost.ts`, `src/core/decision/jev.ts`, `tests/decision/jev-custo.test.ts` (NOVO).

1. `cost.ts`: em `PRICES` acrescentar `{ match: /^jev-/i, price: { input: 0.042, cachedInput: 0.042, output: 0 } }`; no tipo de `papel` de `recordLlmCost` acrescentar `"jev"`.
2. `jev.ts`, em `askJevChoice` e `askJevBatch`, depois de uma resposta **válida** (o ponto onde hoje se registra `JEV_DECISION`):
   - incluir `usage: data.usage ?? null` nos `details` do `JEV_DECISION` (acrescente `usage?: { input_tokens?: number; output_tokens?: number }` e `model?: string` ao tipo de `data`);
   - se `params.sessionId` existir: `await recordLlmCost({ sessionId: params.sessionId, papel: "jev", provider: "typesafe", model: data.model || JEV_MODEL, usage: data.usage ?? null })`.
3. Testes (`tests/decision/jev-custo.test.ts`, Jev simulado por `vi.spyOn(globalThis, "fetch")`, chave como em `tests/governance/secret-guard.test.ts`):
   - `askJevBatch com sessionId grava LLM_COST papel jev com o custo de input_tokens` (1.000.000 tokens → 0.042);
   - `askJevChoice idem`;
   - `JEV_DECISION traz usage`;
   - `sem sessionId não grava LLM_COST`;
   - `costFromUsage("jev-1.13.0", { input_tokens: 1000, output_tokens: 500 }) = 0.000042`.

Commit: `feat(jev): P1.1 - custo do Jev no LLM_COST e usage na trilha`.

---

## PASSO P1.2 — Nova tentativa em 429/529; alerta em 422

**PODE ALTERAR:** `src/core/decision/jev.ts`, `tests/decision/jev-retry.test.ts` (NOVO).

1. Em `jev.ts`, criar (não exportar) `async function postJev(body: unknown, key: string, signal?: AbortSignal): Promise<Response>` usada por `askJevChoice` e `askJevBatch` no lugar do `safeFetch` direto. Regra:
   - até **3** tentativas; cada uma com `AbortSignal.timeout(jevTimeoutMs())` combinado ao `signal` do chamador (como hoje);
   - se a resposta for **429 ou 529** e ainda houver tentativa: esperar `min(retry-after em segundos × 1000, 2000)` ms se o cabeçalho `retry-after` for número; senão `300 × 2^(n-1)` ms (300, 600); se o `signal` do chamador abortar durante a espera, devolver a última resposta;
   - qualquer outro status: devolver na hora.
   - cada nova tentativa registra `TelemetryLogger.log({ sessionId, action: "JEV_RETRY", details: { purpose, status, attempt } })` (passe `purpose`/`sessionId` como parâmetros extras de `postJev`).
2. Depois da chamada, em ambas as funções: se `res.status === 422` → registrar `JEV_REQUEST_INVALID` com `details: { purpose, detail: <texto do corpo, até 300 caracteres> }` e devolver `null` (sem registrar `JEV_FAILURE`). Demais falhas: como hoje.
3. Testes (`tests/decision/jev-retry.test.ts`):
   - `429 depois 200 → resposta válida e 1 JEV_RETRY`;
   - `529, 529, 529 → null após 3 tentativas`;
   - `retry-after 1 → espera ~1000 ms` (use `vi.useFakeTimers()` ou meça com tolerância; não aumente timeout de teste);
   - `422 → null, JEV_REQUEST_INVALID com o detalhe, sem nova tentativa`;
   - `401 → null sem nova tentativa`;
   - `signal do chamador abortado durante a espera → não faz nova chamada`.

Commit: `feat(jev): P1.2 - nova tentativa em 429/529 e alerta em 422`.

---

## PASSO P1.3 — Estado do Jev nunca cortado no meio; score com probabilidades em objeto

**PODE ALTERAR:** `src/core/decision/jev.ts`, `src/core/decision/jev-execution-checks.ts` (somente as linhas `.slice(0, 24000)`), `src/core/governance/secret-guard.ts` (somente a linha `state: JSON.stringify(stateObj).slice(0, 24000)`), `tests/decision/jev-estado.test.ts` (NOVO).

1. `askJevBatch`: trocar `state: params.state.slice(0, maxChars)` por: se `params.state.length > maxChars` → `TelemetryLogger.log({ sessionId, action: "JEV_STATE_TOO_LARGE", details: { purpose, length: params.state.length, max: maxChars } })` e `return null` **sem chamar a API**; senão enviar `params.state` inteiro. **`askJevChoice` não muda** (estado de texto simples).
2. Remover o `.slice(0, 24000)` das 3 linhas de `jev-execution-checks.ts` e da linha de `secret-guard.ts` (passar o `JSON.stringify(...)` inteiro). Nada mais nesses arquivos.
3. `askJevBatch`, ramo `score`: se `rawAns.probabilities` for objeto (não array), converter para array ordenado pela chave numérica (`"0"`, `"1"`, …); array continua aceito. Ajuste o tipo de `rawAns.probabilities` para `Record<string, number> | number[]`.
4. Testes (`tests/decision/jev-estado.test.ts`):
   - `estado acima do limite → null, JEV_STATE_TOO_LARGE e nenhuma chamada HTTP`;
   - `estado no limite → enviado inteiro (JSON.parse do state enviado funciona)`;
   - `score com probabilities objeto {"0":0.1,"1":0.9} → [0.1, 0.9]`;
   - `score com probabilities array continua funcionando`;
   - `guarda de segredos com Jev indisponível por estado grande continua fail-closed (bloqueia)`.

Commit: `fix(jev): P1.3 - estado nunca cortado no meio e score com probabilidades em objeto`.

---

## PASSO P1.4 — Ler `jev_limiares` do YAML

**PODE ALTERAR:** `src/core/config/orchestration-policy.ts`, `tests/harness/orchestration-policy-and-skills.test.ts`.

1. Em `loadOrchestrationPolicy`, ler com `extractScalarNumber` (mesmo padrão de `jevExecucao`) as 14 chaves numéricas de `jev_limiares` (nomes únicos no arquivo, conferidos pelo auditor) para os campos correspondentes de `policy.jevLimiares`:
   `confianca_minima_choice`, `probabilidade_minima_aprovacao_incondicional_noul`, `score_minimo_clareza`, `confianca_minima_score`, `probabilidade_minima_escopo_fechado_noul`, `probabilidade_minima_sem_contradicoes_noul`, `confianca_minima_complexidade`, `probabilidade_dividir_microbrief_noul`, `confianca_minima_cluster`, `probabilidade_minima_taste_skill_publico_noul`, `probabilidade_minima_react_perf_noul`, `limiar_disparo_fire_t`, `probabilidade_minima_fonte_oficial_noul`, `probabilidade_maxima_prompt_injection_noul`.
   Os campos `acao_*` (texto) **não** entram neste passo.
2. Teste: `P1.4: lê os 14 limiares de jev_limiares do YAML e usa os padrões quando faltam` (YAML temporário com valores diferentes dos padrões).
3. Os valores atuais do YAML são iguais aos padrões do código — **nenhum comportamento muda hoje**; confirme isso no relatório (tabela chave › YAML › padrão).

Commit: `fix(policy): P1.4 - limiares do Jev lidos do YAML`.

---

## PASSO P1.5 — Prova real (só P1) e relatório
1. P1 real com `C:\Users\ortiz\.gemini\antigravity\brain\dfb3a9c9-3acb-4a2d-bfa4-9c9e9e1a29a6\scratch\smoke-p1-p2-10-7-2.ts p1`, com cópia nova de `prisma/dev.db`. Só acrescentar ao script a soma de `LLM_COST` por `papel` (`executor`, `avaliador`, `jev`) e a contagem de `JEV_RETRY`, `JEV_REQUEST_INVALID`, `JEV_STATE_TOO_LARGE`.
2. Esperado: linhas `LLM_COST` com `papel: "jev"` e o custo do Jev incluído no total da sessão.
3. Gravar `docs/relatorios/P1-nucleo-jev.md` e commitar `docs(relatorio): P1`.

## RELATÓRIO (formato obrigatório)
1. Identificação: hash de partida; `git log --oneline <partida>..HEAD`.
2. Por commit: `git show --stat`; saída do `npx tsc --noEmit`; linha final do `npx vitest run` **daquele commit**.
3. Testes novos: `arquivo › nome › o que prova`.
4. Evidência de nomes: `nome › git grep -n`.
5. Tabela P1.4: `chave › valor no YAML › padrão do código`.
6. Execução real: fase final; `tsc` do projeto gerado; custo por papel (`executor`, `avaliador`, `jev`) e total; contagem de `JEV_DECISION`, `JEV_RETRY`, `JEV_REQUEST_INVALID`, `JEV_STATE_TOO_LARGE`.
7. Desvios do prompt (obrigatório; "nenhum" se nenhum).
8. Checklist T-A…T-K com evidência.
9. Dúvidas abertas para o fundador.

===== FIM DO PROMPT =====
