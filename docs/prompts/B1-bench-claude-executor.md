# Prompt B1 — Bench: avaliador Claude Opus 5.5 × cadeia atual (executor DeepSeek fixo)

> Item **B1** da referência §5.0 (mudança 6, reduzida pela mudança 10 — fundador 16/10, diário 68/69). **Pré-requisito:** P5c ✅.
> **Não executar** sem 「aprovado Fase 9」 do fundador.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa B1 — medir P1–P4 com avaliador Claude Opus 5.5 como 1º, executor DeepSeek sem mudança

## OBJETIVO
Decisão do fundador (16/10): Spec = Claude Opus (já em produção); **executor = DeepSeek** (provado no B0); **avaliador = Claude → Nemotron → gratuitos medidos**, sempre de família diferente do executor.
Antes de mudar a cadeia do avaliador em produção, o B1 mede **uma única pergunta**: com o avaliador `claude-opus-5-5` como 1º, o aceite e as reprovações mudam em relação à cadeia atual, e quanto custa a mais?
- **`padrao`** — cadeia atual (`EVALUATOR_CHAIN` em `evaluator-models.ts`: Nemotron → DeepSeek → Claude, com `preferIndependentFirst`).
- **`avaliador-claude`** (nova) — avaliador `claude-opus-5-5`; executor igual ao `padrao`.
Teto de custo do projeto **US$ 3,00 só no bench**, nas duas variantes (uso normal continua US$ 0,50).
**Fora do escopo do B1:** executor Claude, nova ordem da cadeia em produção, gratuitos na cadeia, regra "gratuito não aprova sozinho" — isso é o item seguinte da §5.0 (B1b), com prompt próprio, depois deste resultado.

## REGRAS DE TRABALHO (fundador, obrigatórias)
- **R1 — Nada fora do prompt.** Você só altera os arquivos listados em "PODE ALTERAR" de cada passo. Qualquer outro arquivo (inclusive "melhoria óbvia", formatação, documentação, diário, referência) é **proibido**. Se achar que algo fora do escopo precisa mudar → **PARE e escreva no relatório**; o fundador decide.
- **R2 — Relatório sempre.** Ao fim de **cada** passo (inclusive B1.0, que não tem commit), acrescente uma seção em `docs/relatorios/B1-bench-avaliador-claude.md` com: o que foi feito; arquivos alterados com `git show --stat <hash>`; saída real de `npx tsc --noEmit` e do resumo do `npx vitest run`; desvios e dúvidas; o que **não** foi feito. Esse relatório é o único arquivo de documentação que você pode criar/alterar (além de `memory/medicoes.md` e do relatório do bench no B1.2). Formato §8.4 da referência.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/` e `.serena/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/B1-bench-claude-executor.md`. Diferente → PARE.
- **T-B Escopo fechado (R1).** **Proibido** alterar `src/`, `config/`, `bench/aceite/`, `bench/specs/`, `bench/projetos/`, `skills/`, `docs/NEXTCODE-REFERENCIA.md`, `memory/diario.md`, `memory/decisoes.md`.
- **T-C Literalidade.** Nomes e formatos exatos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**; cada commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde **no repositório principal** (worktree sem `.env` dá falhas falsas); saídas coladas no relatório. **Proibido** `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; o bench já usa cópia temporária (`rodarUmaExecucao`).
- **T-G Segredos.** Nenhuma chave em código, log, trilha ou relatório.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas.** (1) Uma execução (projeto × variante) chega a US$ 3,00 → o bench bloqueia pelo teto; registre e siga. (2) Custo **acumulado** da rodada > US$ 10,00 → PARE e grave relatório parcial. (3) Contradição prompt × código → PARE. (4) B1.0 mostra Claude indisponível pelos dois caminhos → PARE.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-M** código gerado pelo bench roda só no contêiner de aceite (`docker/aceite/run.sh`).
- **T-N Independência (T4/T5).** Não desligar `preferIndependentFirst` nem a detecção `actualExecutorFamily` (`node-executor.ts:1044-1079`). Na trilha, `EVALUATOR_MODEL.independentFromExecutor` deve ser `true` nas duas variantes; se não for → desvio no relatório.

## LEITURA OBRIGATÓRIA
- `scripts/bench.ts` — `VarianteBench`, `rodarUmaExecucao` (subprocesso `--uma`; envs setadas antes dos imports dinâmicos; `prisma.session.create` ≈ linha 472), variante `avaliador-deepseek` (≈ linha 277) como modelo.
- `src/core/llm/evaluator-models.ts` — `EVALUATOR_CHAIN` (envs `EVALUATOR_NEMOTRON_MODEL`, `EVALUATOR_DEEPSEEK_MODEL`, `EVALUATOR_CLAUDE_MODEL`, lidas na importação do módulo) e o ramo Anthropic direto (≈ 140–240).
- `src/core/orchestrator/node-executor.ts` — `makeBlindAuditDispatchFn` (≈ 486–540), telemetria `EVALUATOR_MODEL`.
- `src/core/orchestrator/budget-guard.ts` — `getSessionBudget`, `authorizedExtraUsd`, `BUDGET_AUTHORIZED_ACTION`.
- `src/core/llm/cost.ts` — preço `claude-opus-5-5` (linha 30).
- `tests/bench/bench-relatorio.test.ts`; `docs/relatorios/bench/2026-10-15-1927.md` (B0).

---

## PASSO B1.0 — Sonda (sem commit, sem código no repo)
Script temporário **fora do repo**, `max_tokens` ≤ 16, chaves lidas sem imprimir:
1. FreeLLMAPI `POST /v1/chat/completions` com `model: "claude-opus-5-5"` → status e cabeçalho `X-Routed-Via`.
2. Anthropic direto `POST https://api.anthropic.com/v1/messages` com `claude-opus-5-5` → status.
Registrar no relatório (R2) **só** status, modelo e `X-Routed-Via`. Basta um dos dois responder 200: `dispatchStrongEvaluator` já tenta o FreeLLMAPI e cai no ramo Anthropic direto para o candidato `claude`. Os dois falharem → PARE (T-J 4).

---

## PASSO B1.1 — Variante `avaliador-claude` + teto do bench

**PODE ALTERAR:** `scripts/bench.ts`, `tests/bench/bench-relatorio.test.ts`, e o relatório (R2).

1. `VarianteBench` passa a incluir `"avaliador-claude"`. A lista padrão de variantes (sem `--variantes`) **não muda**.
2. Em `rodarUmaExecucao`, antes dos imports dinâmicos (como `avaliador-deepseek`), quando `variante === "avaliador-claude"`:
   `process.env.EVALUATOR_NEMOTRON_MODEL = "bench-desligado"`, `process.env.EVALUATOR_DEEPSEEK_MODEL = "bench-desligado"`, `process.env.EVALUATOR_CLAUDE_MODEL = "claude-opus-5-5"`. Nada mais muda.
3. **Teto US$ 3,00 em todas as variantes do bench**, sem tocar YAML nem `budget-guard.ts`: logo após o `prisma.session.create` da execução, gravar um `telemetryLog` com `action: BUDGET_AUTHORIZED_ACTION` (importar a constante) e `details` = `JSON.stringify({ acrescimoUsd: 2.5, motivo: "bench B1 (fundador 16/10)" })` — `authorizedExtraUsd` já soma (0,50 + 2,50 = 3,00).
4. O relatório markdown do bench mostra, por linha, a variante e o teto efetivo.

Testes novos (espelhar os de variantes existentes): (a) relatório inclui a linha `avaliador-claude`; (b) sem `--variantes` a lista continua `padrao,sem-jev,avaliador-deepseek`.

Commit: `feat(bench): variante avaliador-claude e teto US$ 3 so no bench (B1.1)`.

---

## PASSO B1.2 — Rodada e medições

```bash
npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes padrao,avaliador-claude --repeticoes 1
```
**PODE ALTERAR:** novo `docs/relatorios/bench/YYYY-MM-DD-HHmm.md` (gerado pelo bench), `memory/medicoes.md` (só **acrescentar** seção datada no fim), e o relatório (R2).

Por projeto × variante, copiado da trilha (não estimado):
- aceite (`bench/aceite/`) e fase final (ENTREGUE / REPROVADA / BLOQUEADA);
- nº de reprovações do avaliador e se a reprovação era procedente (o REQ estava mesmo errado?);
- custo executor / avaliador / total (`LLM_COST`);
- avaliador efetivo (`EVALUATOR_MODEL`: provider, model, `independentFromExecutor`, `failures`).

**Porta B1:** as 2 variantes rodam P1–P4 até fase final; em `avaliador-claude` a trilha mostra avaliador `claude-opus-5-5` em todas as etapas avaliadas; custos da trilha. Execução que parar por falha de rota (não por qualidade) não conta — registrar e repetir 1 vez.

Commit: `docs: relatorio bench B1 avaliador Claude x cadeia atual`.

---

## PASSO B1.R — Fechamento do relatório
Fechar `docs/relatorios/B1-bench-avaliador-claude.md` (§8.4): sonda B1.0, tabelas, desvios (inclusive T-N), resposta à pergunta do OBJETIVO com números, lista de **todos** os arquivos tocados na tarefa (`git diff --stat <HEAD inicial>..HEAD`) para provar R1, próximo passo (B1b). Commit: `docs(relatorio): B1 fechamento`.

===== FIM DO PROMPT =====
