# Prompt P3 — Avaliador pelo FreeLLMAPI: Nemotron → DeepSeek pago → Claude

> Decisão do fundador (08/10 noite, `memory/decisoes.md`): avaliador na ordem Nemotron (NVIDIA, gratuito, outra família) → DeepSeek pago → Claude.
> Análise e evidências: `docs/NEXTCODE-REFERENCIA.md` §5.2 "Avaliador (08/10 noite)". Copie de **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa P3 — Avaliador sai das APIs diretas e passa pelo FreeLLMAPI, com cadeia Nemotron → DeepSeek pago → Claude e trava de rota por modelo

## OBJETIVO
Hoje `dispatchStrongEvaluator` (`src/core/llm/evaluator-models.ts`) chama Gemini, Claude e DeepSeek **direto** (fora do FreeLLMAPI) e, sem crédito em Gemini/Claude, o avaliador cai no **mesmo DeepSeek do executor** (sem independência). Passa a valer:
1. o avaliador chama **só o FreeLLMAPI** (via `callGateway`), nesta ordem: **`nemotron-3-ultra`** (NVIDIA, outra família) → **`deepseek-v4-pro`** (pago) → **Claude**;
2. cada item da cadeia só é aceito se o `X-Routed-Via` (`servedBy`) começar com um prefixo **daquele item**; senão é recusado e passa ao próximo;
3. falha de conta/limite (401/402/403/429 ou "credit/billing/quota" no corpo) tira o item por 10 min (regra que já existe, estendida ao 429).

Fatos conferidos pelo auditor em 08/10: `nemotron-3-ultra` → 200 via `ollama/nemotron-3-ultra`; `nemotron-3-ultra-550b` → 200 via `nvidia/nvidia/nemotron-3-ultra-550b-a55b`; `deepseek-v4-pro` → 200 via `custom/deepseek-v4-pro`; `claude-sonnet-4-5` → 404 "not in the catalog" (Claude ainda não configurado no FreeLLMAPI — o 3º item vai falhar até o fundador configurar; isso é esperado).

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/P3-avaliador-freellmapi.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só os arquivos de PODE ALTERAR. Nunca aumente timeout, nunca `try {} catch {}` vazio novo, `.skip`/`.only`, nem altere teste existente além do escrito aqui.
- **T-C Literalidade.** Nomes, modelos, prefixos e ordem exatamente como escritos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais.** Todo nome citado existe (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**, com `npx tsc --noEmit` (0) e `npx vitest run` completo verde **nesse estado**; saídas coladas. Proibido `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; cópia temporária.
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Preserve (`git ls-files --eol`).
- **T-J Paradas obrigatórias.** Teste antigo quebrando por motivo não previsto aqui (cole e PARE); arquivo fora do escopo; contradição prompt × código; custo real > US$ 0,50; **qualquer avaliação real atendida por rota fora dos prefixos do item**.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel.** Todo valor do relatório (fase, custo, contagens) é **copiado da saída real**, nunca reescrito de memória; cole o trecho bruto da saída logo abaixo de cada número. (Motivo: o relatório do P1 trouxe a fase `CONCLUIDO`, que não existe; a execução real do auditor deu `ENTREGUE`.)

## LEITURA OBRIGATÓRIA
- `src/core/llm/evaluator-models.ts` inteiro.
- `src/core/llm/gateways.ts`: `loadGatewayConfigs`, `callGateway`, `GatewayAttempt` (`servedBy` = `X-Routed-Via`).
- `src/core/orchestrator/node-executor.ts`: `makeBlindAuditDispatchFn` (uso de `dispatchStrongEvaluator`, evento `EVALUATOR_MODEL`, `recordLlmCost` com `papel: "avaliador"`).
- `src/core/config/orchestration-policy.ts`: `isEvaluatorModelIndependent` (`detectFamily`).
- `tests/harness/evaluator-and-tier.test.ts` (describe "Cadeia do avaliador pago"), `tests/orchestrator/avaliador-somente-pago.test.ts`.

---

## PASSO P3.1 — Cadeia do avaliador pelo FreeLLMAPI

**PODE ALTERAR:** `src/core/llm/evaluator-models.ts`, `src/core/config/orchestration-policy.ts` (somente `detectFamily` dentro de `isEvaluatorModelIndependent`), `tests/harness/evaluator-and-tier.test.ts` (somente o `describe("Cadeia do avaliador pago (Gemini → Claude → DeepSeek)"` — substituir pelos testes do item 6), `tests/harness/orchestration-policy-and-skills.test.ts` (somente acrescentar 1 teste do item 5), `tests/llm/evaluator-freellmapi.test.ts` (NOVO).

1. `EvaluatorProvider` passa a ser `"nvidia" | "deepseek" | "claude"`.
2. `EvaluatorCandidate` passa a ser `{ provider: EvaluatorProvider; model: string; routedPrefixes: string[] }` e `EVALUATOR_CHAIN`:
   ```ts
   export const EVALUATOR_CHAIN: EvaluatorCandidate[] = [
     { provider: "nvidia", model: process.env.EVALUATOR_NEMOTRON_MODEL || "nemotron-3-ultra", routedPrefixes: ["ollama/nemotron", "nvidia/"] },
     { provider: "deepseek", model: process.env.EVALUATOR_DEEPSEEK_MODEL || "deepseek-v4-pro", routedPrefixes: ["custom/deepseek"] },
     { provider: "claude", model: process.env.EVALUATOR_CLAUDE_MODEL || "claude-sonnet-4-5", routedPrefixes: ["anthropic/", "custom/claude"] },
   ];
   ```
3. Remover `EvaluatorKeys`, `keyFor` e `callOne` (chamadas diretas a Gemini/Claude/DeepSeek). Nova assinatura:
   ```ts
   export async function dispatchStrongEvaluator(
     messages: ChatMessage[],
     opts: { timeoutMs?: number; executorFamily?: EvaluatorProvider; loader?: () => Promise<GatewayConfig[]> } = {}
   ): Promise<EvaluatorCallResult>
   ```
   Regra: `free = (await (opts.loader ?? loadGatewayConfigs)()).find((g) => g.id === "freellmapi")`; sem `free` → `{ content: null, provider: null, model: null, independent: false, failures: ["freellmapi: não configurado"] }`. Para cada candidato, em ordem:
   - pulado se estiver na pausa de 10 min (`skippedUntil`, como hoje);
   - `attempt = await callGateway(free, { messages, model: c.model, stream: false, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000), maxTokens: 8000 })`;
   - `attempt.ok` e `attempt.servedBy` começa (sem diferenciar maiúsculas) com um de `c.routedPrefixes` → ler o corpo (`choices[0].message.content`, `usage`); conteúdo não vazio → devolver `{ content, provider: c.provider, model: attempt.servedBy, independent: c.provider !== executorFamily, failures, usage }`; vazio → falha "resposta vazia";
   - `attempt.ok` mas prefixo não casa → `await attempt.response.body?.cancel().catch(() => {})` e falha `"<provider>/<model>: rota recusada <servedBy>"` (**sem** pausa);
   - `!attempt.ok` → se `attempt.status` ∈ {401, 402, 403, 429} ou `/credit|billing|prepayment|quota|rate.?limit/i` em `attempt.detail` → pausa de 10 min; falha `"<provider>/<model>: <kind> <status> <detail até 140>"`.
   Sem nenhum aceito → `{ content: null, provider: null, model: null, independent: false, failures }`.
4. `executorFamily` padrão continua `"deepseek"`.
5. `orchestration-policy.ts`, `detectFamily`: acrescentar, **antes** da última linha, `if (val.includes("nemotron") || val.includes("nvidia")) return "nvidia";`. Teste novo em `orchestration-policy-and-skills.test.ts`: `P3: ollama/nemotron e nvidia/nemotron são família nvidia, independente de deepseek`.
6. Testes (`tests/llm/evaluator-freellmapi.test.ts` e o `describe` substituído em `evaluator-and-tier.test.ts`), com `loader` falso e `fetch` simulado:
   - `nemotron responde via ollama/nemotron → usado, independent true, model = servedBy`;
   - `nemotron via nvidia/ também é aceito`;
   - `nemotron servido por rota fora dos prefixos → recusado, segue para deepseek (custom/deepseek-v4-pro), independent false`;
   - `nemotron 429 → pausa 10 min; 2ª chamada nem tenta nemotron`;
   - `nemotron e deepseek falham, claude 404 → content null com 3 falhas`;
   - `sem freellmapi configurado → content null`;
   - `nenhuma chamada vai a api.deepseek.com, api.anthropic.com ou googleapis` (inspecionar URLs do `fetch`).

Commit: `feat(avaliador): P3.1 - cadeia do avaliador pelo FreeLLMAPI (Nemotron, DeepSeek, Claude)`.

---

## PASSO P3.2 — Ligar no executor da etapa

**PODE ALTERAR:** `src/core/orchestrator/node-executor.ts` (somente `makeBlindAuditDispatchFn`), `tests/orchestrator/avaliador-somente-pago.test.ts`.

1. Em `makeBlindAuditDispatchFn`: trocar a chamada `dispatchStrongEvaluator(messages, { geminiKey, claudeKey, deepseekKey })` por `dispatchStrongEvaluator(messages)`. O resto (evento `EVALUATOR_MODEL`, `recordLlmCost`, regra `isPaidOnlyRouting` → `null` sem rota gratuita) **não muda**.
2. `avaliador-somente-pago.test.ts`: ajustar **somente** os valores simulados de `dispatchStrongEvaluator` ao novo formato (sem chaves no 2º argumento; `provider` pode ser `"nvidia"`). Nenhuma asserção muda de sentido.
3. Se outro teste antigo quebrar → PARE e cole a lista.

Commit: `feat(avaliador): P3.2 - executor usa a cadeia do avaliador pelo FreeLLMAPI`.

---

## PASSO P3.3 — Prova: divergência plantada + P1 e P2 reais

1. **Divergência plantada (sem commit de código, script temporário fora do repositório):** chamar `dispatchStrongEvaluator` (com o FreeLLMAPI real) com o prompt do avaliador de uma etapa simples **e** um código que **não** cumpre um REQ (ex.: rota `POST` que devolve 200 em vez de 201 exigido no critério). Repetir 3 vezes. Colar: modelo que respondeu (`servedBy`), e se o veredito marcou o REQ como **não implementado**. Chame `DualLensAuditor.validateType2(type1Aprovado, briefMarkdown, relatorioExecutor, codeContentMap, dispatchFn)` (método público em `src/core/governance/dual-lens-auditor.ts`), com `type1Aprovado` = `{ passed: true, ... }` no formato de `ValidationType1Result` e `dispatchFn = async (messages) => (await dispatchStrongEvaluator(messages)).content`. Colar também o `verdict` e os `reqVerdicts`. Se não for possível sem mexer em arquivo de produção, PARE e relate.
2. **P1 e P2 reais** com `C:\Users\ortiz\.gemini\antigravity\brain\cfd46d9b-2068-4522-b4ee-6460554ba0ab\scratch\smoke-p1-p2-10-7-2.ts` (`p1`, `p2`), cópia nova do banco cada. Acrescentar ao script só a listagem de `EVALUATOR_MODEL`. Teto US$ 0,50 por projeto.
3. Gravar `docs/relatorios/P3-avaliador-freellmapi.md` e commitar `docs(relatorio): P3`.

## RELATÓRIO (formato obrigatório; T-L vale para tudo)
1. Identificação: hash de partida; `git log --oneline <partida>..HEAD`.
2. Por commit: `git show --stat`; `npx tsc --noEmit`; linha final do `npx vitest run` daquele commit.
3. Testes novos: `arquivo › nome › o que prova`.
4. Evidência de nomes: `nome › git grep -n`.
5. Divergência plantada: tabela `rodada › servedBy › REQ marcado como não implementado? › trecho bruto do veredito`.
6. P1/P2: fase final **(linha bruta "Fase final: …")**; `tsc` do projeto; por etapa `nodeId › avaliador servedBy › independent › aprovada na 1ª?`; custo por papel; eventos `EVALUATOR_MODEL` brutos.
7. Desvios do prompt (obrigatório).
8. Checklist T-A…T-L.
9. Dúvidas abertas.

===== FIM DO PROMPT =====
