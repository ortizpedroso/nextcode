# Prompt P5 — Entrada como pensada: Jev na Spec sem segredo, sem chute e com conferência

> Origem: auditoria do I1 (diário 39) e decisão do fundador de 14/10 (diário 40, referência §5.5 parágrafo "P5").
> Ordem: I1 ✅ → **P5 (este)** → J2b → J3 → J4. Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa P5 — entrada como pensada (4 passos, um commit cada)

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro e todos os arquivos citados antes de alterar qualquer coisa. Na seção 0 do relatório, escreva em 5 linhas o que vai mudar.
2. **Faça exatamente o que está escrito, nada além.** Não "melhore" nada fora do descrito. Ideias → "Sugestões de melhoria".
3. **Não mexa no que funciona.** Qualquer teste existente que quebrar → **PARE** e relate (nome do teste, saída bruta). **Não altere teste existente** para fazê-lo passar.
4. Trecho citado não existe como descrito, ou precisou mexer em algo não descrito → **PARE** e pergunte.
5. Todo nome que usar confira antes com `git grep -n` (saída colada no relatório).

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/P5-entrada-como-pensada.md`. Diferente → PARE.
- **T-B** PODE ALTERAR só: `src/core/decision/jev.ts`, `src/core/governance/secret-guard.ts`, `src/core/intake/universal-funnel.ts`, `src/app/api/chat/route.ts`, `src/core/decision/jev-decisions.ts` (só a linha do `slice` do M2), `src/core/orchestrator/execution-trigger.ts`, `src/core/config/orchestration-policy.ts`, `config/politicas-orquestracao.yaml`. PODE CRIAR: `tests/decision/jev-mascara-segredo.test.ts`, `tests/intake/universal-funnel-conversa.test.ts`, `tests/orchestrator/conferencia-na-aprovacao.test.ts`, `docs/relatorios/P5-entrada-como-pensada.md`. Mais nada.
- **T-C** Literalidade. **T-D** nomes conferidos com `git grep -n`.
- **T-E** um commit por passo + commit R; **cada** commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde, saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-F** nunca escreva em `prisma/dev.db` (testes usam `prisma/test.db`). **T-G** nenhum segredo em código, teste, saída ou relatório (nos testes use valores falsos montados em tempo de execução, ex.: `"sk-" + "a".repeat(10) + "Zx9Qw..."`). **T-H** nenhum pacote novo. **T-I** preservar o fim de linha de cada arquivo; arquivos novos em LF.
- **T-J** nenhuma chamada real a LLM, ao Jev ou à rede nos testes (use `vi.spyOn(globalThis, "fetch")` como em `tests/decision/jev-retry.test.ts:1-45`). Não rode o bench.
- **T-K** commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L** relatório fiel: saídas brutas coladas (inclusive `git diff --stat` real); "Desvios" obrigatório e verdadeiro; checklist com o nome certo de cada trava **deste** prompt. **T-O** nenhum plano ou log paralelo.

## LEITURA OBRIGATÓRIA
- `docs/NEXTCODE-REFERENCIA.md` §5.5 (parágrafo "P5 — entrada como pensada") e `CLAUDE.md` Regra 7.
- `docs/relatorios/I1-inventario-ligado-desligado.md` (Tabelas B e C).
- `src/core/decision/jev.ts` (`postJev` linhas 81-110, `askJevBatch` linhas 256-320), `src/core/governance/secret-guard.ts` (linhas 96-175 e `evaluateCandidatesWithJev`).
- `src/core/intake/universal-funnel.ts` (inteiro), `src/app/api/chat/route.ts` linhas 296-345, 548-612 e 780-860.
- `src/core/intake/intake-engine.ts` linhas 214-400 (`runElicitadorAndAnalistaCycle`), `src/core/orchestrator/execution-trigger.ts` linhas 21-30 e 49-245.

---

## PASSO P5.1 — Regra 7: nada de segredo vai ao Jev (um ponto só)
1. `src/core/governance/secret-guard.ts`: acrescente (sem alterar nada existente)
   `export function maskSecretsForJev(text: string): { text: string; count: number }` — chama `findSecretCandidatesInText("jev_state", text)`; para cada candidato, troca **todas** as ocorrências de `valorSegredo` no texto pela descrição de `describeSecretShape(valorSegredo)`; devolve o texto e quantos valores distintos foram trocados.
2. `src/core/decision/jev.ts`, em `postJev`: antes do `safeFetch`, se `body` for objeto com `state` do tipo string, substitua `state` pelo resultado de `maskSecretsForJev(state).text` (num objeto novo; não altere o objeto recebido). Se `count > 0`, registre `TelemetryLogger.log({ sessionId, action: "JEV_STATE_MASKED", details: { purpose, count } })` — **nunca** o valor. Faça isso uma vez, antes do laço de tentativas.
   - Isso cria import `jev.ts → secret-guard.ts` e `secret-guard.ts` já importa `jev.ts`. Os dois só se usam dentro de funções, então o ciclo é seguro; se `tsc` ou algum teste acusar problema de import circular → PARE.
3. Teste novo `tests/decision/jev-mascara-segredo.test.ts` (padrão de `jev-retry.test.ts`): (a) `askJevBatch` com `state` contendo um segredo falso de alta entropia em atribuição (`apiKey = "<valor>"`) → o `body` capturado no `fetch` não contém o valor e contém `«valor oculto:`; (b) `state` sem segredo → `body` idêntico ao original; (c) `JEV_STATE_MASKED` registrado com `count: 1` e sem o valor em `details`.
Commit: `feat(seguranca): P5.1 - mascara segredos antes de qualquer envio ao Jev`.

## PASSO P5.2 — Peneira M0: conversa inteira, tempo próprio, incerteza vira pergunta
1. `src/core/decision/jev.ts`: `askJevBatch` ganha parâmetro opcional `timeoutMs?: number`, repassado a `postJev` (parâmetro opcional novo, usado no lugar de `jevTimeoutMs()` quando informado). Sem ele, comportamento idêntico ao de hoje.
2. `src/core/intake/universal-funnel.ts`:
   - `promptText = params.prompt.slice(0, 16000)` (era 8000); chamada `askJevBatch` com `timeoutMs: 10000`.
   - `IntakeFunnelResult` ganha `aConfirmar: string[]`. Quando `source: "jev"`: entra em `aConfirmar` o id de cada pergunta `noul` com `0.25 < noul < 0.75` e de cada pergunta `choice` com `confidence < 0.6`. Os booleanos continuam calculados como hoje (`>= 0.6`). Quando `source: "fallback"`: `aConfirmar` = os ids das 7 perguntas `noul` (`has_database`, `has_auth`, `has_financial_payments`, `has_external_comms`, `has_public_api`, `has_whitelabel`, `has_strict_business_rules`).
   - `formatIntakeFunnelBrief`: (a) se `aConfirmar` não for vazio, acrescente depois do cabeçalho a linha `"- ATENÇÃO: os itens abaixo marcados [A CONFIRMAR] não são requisito; viram pergunta objetiva na seção 7 (Dúvidas em aberto) da Spec."`; (b) em cada linha já existente, quando o item correspondente estiver em `aConfirmar`, troque o texto da linha por `"- <rótulo atual da linha>: [A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)"` (para os itens que hoje só aparecem quando `true`, mostre a linha `[A CONFIRMAR]` também quando o booleano for `false`); (c) quando `source: "fallback"`, acrescente depois do cabeçalho `"- Estimativa por palavras-chave (o Jev não respondeu)."`. Itens fora de `aConfirmar` saem exatamente como hoje (os testes de `tests/intake/universal-funnel.test.ts` precisam continuar passando sem mudança; se precisar mudar → PARE).
3. `src/app/api/chat/route.ts` (bloco da linha ~578): em vez de `prompt: targetPrompt`, passe a conversa do usuário: busque `prisma.message.findMany({ where: { sessionId: activeSessionId, role: "user" }, orderBy: { createdAt: "asc" }, select: { content: true } })`, junte os `content` com `"\n---\n"`; se o último não for igual a `targetPrompt`, acrescente `targetPrompt` no fim. Nada mais muda no bloco.
4. Teste novo `tests/intake/universal-funnel-conversa.test.ts`: (a) Jev responde `has_database` com `noul: 0.58` → `aConfirmar` contém `has_database` e o brief mostra `Banco de Dados: [A CONFIRMAR]`; (b) `noul: 0.95` → fora de `aConfirmar`, linha igual à de hoje; (c) `notification_channels` com `confidence: 0.4` → em `aConfirmar`; (d) Jev indisponível → `source: "fallback"`, 7 itens em `aConfirmar` e a linha de estimativa; (e) o `body` enviado ao Jev contém trechos de **duas** mensagens diferentes do usuário (monte a conversa e chame `runUniversalIntakeFunnel` com ela); (f) `timeoutMs: 10000` chega ao `fetch` (confira pelo `signal` ou por espião em `AbortSignal.timeout`).
Commit: `feat(intake): P5.2 - peneira M0 le a conversa inteira e incerteza vira pergunta`.

## PASSO P5.3 — M2 passa a ser usada (aviso, sem bloquear)
1. `src/core/decision/jev-decisions.ts`: no `decideSpecClarity`, `params.rascunhoSpec.slice(0, 12000)` → `slice(0, 22000)`. Só essa linha neste arquivo.
2. `src/app/api/chat/route.ts` (bloco da linha ~795): guarde o resultado: `const clareza = await decideSpecClarity({...mesmos parâmetros...}).catch(() => null);`. Se `clareza && clareza.source === "jev" && !clareza.readyForUserApproval`, acrescente ao fim de `guardRes.finalMessageContent`:
   `\n\n⚠️ O Jev avaliou que esta Spec ainda não está pronta para aprovar — clareza ${clareza.clarityScore}/3 (confiança ${clareza.clarityConfidence.toFixed(2)}), escopo fechado ${clareza.escopoFechadoProb.toFixed(2)}, sem contradições ${clareza.semContradicoesProb.toFixed(2)}. Revise os requisitos e a seção 7 antes de aprovar.`
   Não bloqueia a aprovação (T2: quem aprova é o usuário). `canonicalSpec` gravada **não** recebe o aviso (só a mensagem). Confira os nomes dos campos em `SpecClarityDecision` (`jev-decisions.ts:124-131`) antes de usar.
3. Sem teste novo de rota neste passo (a suíte existente precisa continuar verde). No relatório, cole o trecho final com `arquivo:linha`.
Commit: `feat(intake): P5.3 - clareza da Spec (M2) vira aviso ao usuario`.

## PASSO P5.4 — Conferência Macrobrief × Spec na aprovação
1. `config/politicas-orquestracao.yaml`, seção `jev_execucao`, logo abaixo de `auditoria_entrega`: `  conferencia_entrada: ativo         # ativo | sombra | desligado (P5, 14/10: conferência Macrobrief × Spec na aprovação)`.
2. `src/core/config/orchestration-policy.ts`: campo `conferenciaEntrada: "ativo" | "sombra" | "desligado"` em `jevExecucao`, padrão `"desligado"` no `DEFAULT_ORCHESTRATION_POLICY`, leitura igual à de `auditoria_entrega` (linhas ~532-539).
3. `src/core/orchestrator/execution-trigger.ts`:
   - `ApproveSpecResult`, variante `ok: false`: acrescente `problems?: string[]` (opcional).
   - Em `approveSpecAndStart`, **imediatamente antes** do comentário `// 3. Aplica SPEC_APROVADA`, com `const policyConf = loadOrchestrationPolicy().jevExecucao.conferenciaEntrada;` (`loadOrchestrationPolicy` já é importado na linha 15; importe `IntakeEngine` de `@/core/intake/intake-engine`):
     - `desligado` → nada muda.
     - `ativo` ou `sombra` → `const conf = await IntakeEngine.runElicitadorAndAnalistaCycle({ initialSpec: effectiveSpec, sessionId });` (sem `onRepairCycle`; confira o nome exato dos campos de `ElicitadorAnalistaCycleOptions` com `git grep -n`). Registre `TelemetryLogger.log({ sessionId, action: "CONFERENCIA_ENTRADA", details: { modo: policyConf, ok: conf.ok, cyclesUsed: conf.cyclesUsed, problemas: conf.problems.length } })`.
     - Se `ativo` e `!conf.ok` → `return { ok: false, reason: "CONFERENCIA_REPROVADA", problems: conf.problems.slice(0, 10) };` (a sessão continua em `SPEC_REVISAO`; nada de fase muda). Em `sombra`, segue o fluxo normal.
     - Se a chamada lançar erro → registre `CONFERENCIA_ENTRADA` com `{ modo, erro: <mensagem curta> }` e siga o fluxo normal (o Jev fora do ar já aprova sozinho dentro de `verifyMacrobriefCoverageWithJev`; não trave a aprovação por falha de infraestrutura).
4. `src/app/api/chat/route.ts` (bloco de recusa da linha ~330): acrescente o caso `if (approvalTriggerResult.reason === "CONFERENCIA_REPROVADA") refusalText = "⚠️ A conferência entre a Spec e o plano de execução encontrou problemas. Corrija e aprove de novo:\n" + (approvalTriggerResult.problems ?? []).map((p) => "- " + p).join("\n");` — siga o estilo dos casos vizinhos.
5. Teste novo `tests/orchestrator/conferencia-na-aprovacao.test.ts`: (a) modo `ativo`, Spec que falha na checagem mecânica → `ok: false`, `reason: "CONFERENCIA_REPROVADA"`, `problems` não vazio, fase continua `SPEC_REVISAO`, nenhum `TaskNode` criado; (b) modo `sombra`, mesma Spec → segue o fluxo de hoje e `CONFERENCIA_ENTRADA` registrado com `ok: false`; (c) modo `desligado` → `runElicitadorAndAnalistaCycle` não é chamado (espião). Use o modo por espião em `loadOrchestrationPolicy`, não alterando o YAML no teste.
6. **Atenção:** com `conferencia_entrada: ativo` no YAML, testes existentes que aprovam Specs podem passar a ser recusados. Se **qualquer** teste existente quebrar → **PARE** (não troque o YAML para `sombra`, não altere teste) e relate a lista com a saída bruta. O auditor decide.
Commit: `feat(orquestracao): P5.4 - conferencia Macrobrief x Spec na aprovacao`.

## RELATÓRIO — `docs/relatorios/P5-entrada-como-pensada.md` (commit R: `docs(relatorio): P5 - entrada como pensada`)
0. Leitura feita (5 linhas). 1. Identificação (partida e `git log --oneline <partida>..HEAD`). 2. Por commit: `git show --stat`, `tsc`, `vitest` (resumo bruto).
3. O que mudou, com `arquivo:linha`, passo a passo. 4. Saídas do `git grep -n` dos nomes usados. 5. Escopo: `git diff --stat <partida>..HEAD` real, colado.
6. Desvios (obrigatório). 7. Checklist T-A…T-O. 8. Sugestões de melhoria (nada implementado). 9. Dúvidas para o fundador.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
