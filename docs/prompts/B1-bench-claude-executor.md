# Prompt B1 — Bench: executor Claude Opus 5.5 × DeepSeek; avaliador Claude em variante separada

> Item **B1** da referência §5.0 (mudança 6, corrigida pela auditoria 16/10 — diário 66/67). **Pré-requisito:** P5c ✅.
> **Não executar** sem 「aprovado Fase 9」 do fundador.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa B1 — medir P1–P4 com executor Claude Opus 5.5 e, separado, com avaliador Claude

## OBJETIVO
Hoje o bench (`scripts/bench.ts`) roda `padrao`, `sem-jev`, `avaliador-deepseek`. O executor usa FreeLLMAPI + `deepseek-v4-pro` (`paid-routing.ts`); o avaliador segue `EVALUATOR_CHAIN` (`evaluator-models.ts`: Nemotron → DeepSeek → Claude).
O B1 responde **duas perguntas separadas**, uma mudança por variante:
1. **`executor-claude`** — o executor `claude-opus-5-5` entrega mais/melhor que o DeepSeek, e a que custo? (avaliador = cadeia atual, sem mudança)
2. **`avaliador-claude`** — o avaliador `claude-opus-5-5` como 1º pago muda o veredito? (executor = DeepSeek, sem mudança)
Baseline = `padrao` (DeepSeek + cadeia atual), que o B0 de 15/10 já mediu (P1–P4 ENTREGUE 100%).

**Decisões do fundador (16/10) que este prompt aplica:** modelo Claude medido = **`claude-opus-5-5`** (provado 10/10 na Spec, `medicoes.md` 15/10 e sessão `c0377632`); teto de custo do projeto **US$ 3,00 só no bench** (uso normal continua US$ 0,50).

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`, `.serena/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/B1-bench-claude-executor.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só os arquivos do "PODE ALTERAR" de cada passo. **Proibido** alterar `bench/aceite/`, `bench/specs/`, `bench/projetos/`, `config/politicas-orquestracao.yaml`, `src/core/orchestrator/budget-guard.ts`.
- **T-C Literalidade.** Nomes e formatos exatos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**; cada commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde **no repositório principal** (worktree sem `.env` dá falhas falsas); saídas coladas. **Proibido** `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; o bench já usa cópia temporária (`rodarUmaExecucao`).
- **T-G Segredos.** Nenhuma chave em código, log, trilha ou relatório. Chave Claude só via `readSecret(setting.claudeKey)` (padrão de `elicitador-claude.ts` / `evaluator-models.ts`).
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas.** (1) Custo de **uma** execução (projeto × variante) > US$ 3,00 → o bench já bloqueia pelo teto; registre e siga para a próxima. (2) Custo **acumulado** da rodada > US$ 15,00 → PARE e grave relatório parcial. (3) Contradição prompt × código → PARE. (4) B1.0 = Caminho B → PARE e espere 「aprovado B1.2」 (ver B1.0).
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel** (§8.4 da referência). **T-M** código gerado pelo bench roda só no contêiner de aceite (`docker/aceite/run.sh`).
- **T-N Independência (T4/T5).** Executor e avaliador de **famílias diferentes**. Já existe no código: `node-executor.ts:1044-1079` detecta `actualExecutorFamily` pelo modelo usado e `makeBlindAuditDispatchFn` chama `dispatchStrongEvaluator(..., { executorFamily, preferIndependentFirst: true })`. **Não** desligar isso. Na variante `executor-claude`, se a trilha mostrar avaliador Claude (`independent: false`) → registrar como desvio no relatório.

## LEITURA OBRIGATÓRIA
- `scripts/bench.ts` — `VarianteBench`, `rodarUmaExecucao` (subprocesso `--uma` por execução; envs setadas antes dos imports dinâmicos), variante `avaliador-deepseek` (linha ~277) como modelo.
- `src/core/llm/paid-routing.ts`, `src/core/orchestrator/node-executor.ts` (≈1030–1111), `src/core/skills/executor-tool-loop.ts` (≈470 `dispatchWithFallback`) — rota paga do executor e `allowedRoutedViaPrefixes`.
- `src/core/llm/evaluator-models.ts` — `EVALUATOR_CHAIN` (env `EVALUATOR_NEMOTRON_MODEL`, `EVALUATOR_DEEPSEEK_MODEL`, `EVALUATOR_CLAUDE_MODEL`, lidas na importação do módulo), ramo Anthropic direto (≈140–240).
- `src/core/orchestrator/budget-guard.ts` — `getSessionBudget`, `authorizedExtraUsd` / `BUDGET_AUTHORIZED_ACTION`.
- `src/core/llm/cost.ts` — preço `claude-opus-5-5` (linha 30).
- `docs/relatorios/bench/2026-10-15-1927.md` (B0 baseline).

---

## PASSO B1.0 — Sonda (sem commit, sem código no repo)
Script temporário **fora do repo**, `max_tokens` ≤ 16, chaves lidas do banco/`.env` sem imprimir:
1. FreeLLMAPI `GET /v1/models` → a lista tem algum `claude-*`? E `POST /v1/chat/completions` com `model: "claude-opus-5-5"` → status e cabeçalho `X-Routed-Via`.
2. Anthropic direto `POST https://api.anthropic.com/v1/messages` com `claude-opus-5-5` → status (esperado 200, já sondado em 15/10).
Colar no relatório **só** status, IDs de modelo e `X-Routed-Via` (sem chaves).

**Decisão:**
- **Caminho A** — FreeLLMAPI responde 200 para `claude-opus-5-5` com `X-Routed-Via` começando por um prefixo de `prefixos_rota_paga` (`custom/`) → B1.2 é pulado; a variante só troca o modelo do executor (B1.1).
- **Caminho B** — FreeLLMAPI **não** serve Claude (era 404 em 08/10, `medicoes.md`) → o executor precisa de rota direta à Anthropic **dentro do laço de ferramentas** (`executor-tool-loop.ts`), que fala formato OpenAI com `tools`. Isso **não** é "espelhar o elicitador" (o elicitador não usa ferramentas). Antes de codar: **PARE**, descreva no relatório o desenho mínimo (onde entra, como converte mensagens/ferramentas, como passa por `allowedRoutedViaPrefixes`, como grava `LLM_COST`) e espere 「aprovado B1.2」.

---

## PASSO B1.1 — Variantes `executor-claude` e `avaliador-claude` + teto do bench

**PODE ALTERAR:** `scripts/bench.ts`, `tests/bench/bench-relatorio.test.ts`.

1. `VarianteBench` passa a incluir `"executor-claude"` e `"avaliador-claude"`. A lista padrão de variantes (sem `--variantes`) **não muda**.
2. Em `rodarUmaExecucao`, antes dos imports dinâmicos (como faz `avaliador-deepseek`):
   - `executor-claude`: `process.env.BENCH_EXECUTOR_MODEL = "claude-opus-5-5"`. Avaliador: nada muda.
     - Caminho A: aplicar o modelo no ponto em que o bench já monta a configuração/política do executor, **sem** editar `paid-routing.ts` nem o YAML. Se não existir ponto assim só em `scripts/bench.ts` → PARE (contradição; o fundador decide se B1.2 cobre).
     - Caminho B: só a env; quem a lê é o B1.2.
   - `avaliador-claude`: `process.env.EVALUATOR_NEMOTRON_MODEL = "bench-desligado"`, `process.env.EVALUATOR_DEEPSEEK_MODEL = "bench-desligado"`, `process.env.EVALUATOR_CLAUDE_MODEL = "claude-opus-5-5"`. Executor: nada muda. (Usa só as envs que `EVALUATOR_CHAIN` já lê — **sem** mexer em `evaluator-models.ts`.)
3. **Teto do bench = US$ 3,00** para **todas** as variantes da rodada (comparação justa), sem tocar no YAML nem no `budget-guard.ts`: logo depois que a execução cria a sessão na cópia do banco, gravar uma linha `telemetryLog` com `action: BUDGET_AUTHORIZED_ACTION` e `details: {"acrescimoUsd": 2.5, "motivo": "bench B1 (fundador 16/10)"}` — o mecanismo que `authorizedExtraUsd` já soma (`0,50 + 2,50 = 3,00`). Importar a constante, não repetir a string.
4. O relatório markdown do bench mostra, por linha, a variante e o teto efetivo.

Testes novos (espelhar os testes de variantes existentes): (a) relatório inclui linhas `executor-claude` e `avaliador-claude`; (b) a variante sem `--variantes` continua `padrao,sem-jev,avaliador-deepseek`.

Commit: `feat(bench): variantes executor-claude e avaliador-claude, teto US$ 3 so no bench (B1.1)`.

---

## PASSO B1.2 — Executor Claude direto (SÓ se B1.0 = Caminho B **e** 「aprovado B1.2」)

**PODE ALTERAR:** novo `src/core/llm/executor-claude.ts`; os pontos de dispatch em `src/core/skills/executor-tool-loop.ts` e/ou `src/core/orchestrator/node-executor.ts` descritos e aprovados no B1.0; `tests/llm/executor-claude.test.ts` (fetch mockado).

Comportamento: só quando `process.env.BENCH_EXECUTOR_MODEL` começar com `claude-` o executor usa Anthropic direto com a chave de `readSecret(setting.claudeKey)`, com ferramentas; grava `LLM_COST` papel executor com o modelo real; o nome do modelo contém `claude` para `actualExecutorFamily` virar `"claude"` (T-N). **Fora** dessa env, comportamento idêntico ao HEAD (teste prova).

Commit: `feat(executor): rota Claude direta so para bench B1 (B1.2)`.

---

## PASSO B1.3 — Rodada e medições

Rodar (crédito do fundador; T-J):
```bash
npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes padrao,executor-claude,avaliador-claude --repeticoes 1
```
Gerar `docs/relatorios/bench/YYYY-MM-DD-HHmm.md` e acrescentar seção datada em `memory/medicoes.md` com, por projeto × variante:
- aceite (testes de `bench/aceite/`) e fase final (ENTREGUE / REPROVADA / BLOQUEADA);
- custo executor / avaliador / total, **copiado da trilha** (`LLM_COST`);
- modelos efetivos na trilha (`EXECUTOR_ROTA_PAGA`, `EVALUATOR_MODEL`, `llm.gateway_call`) e `independent` do avaliador.

**Porta B1:** as 3 variantes rodam P1–P4 até fase final mensurável; em `executor-claude` a trilha mostra executor `claude-opus-5-5` e avaliador de outra família; em `avaliador-claude` a trilha mostra avaliador `claude-opus-5-5`; custos da trilha, não estimados. Execução que parar por falha de rota (não por qualidade) **não** conta como resultado do modelo — registrar e repetir 1 vez.

Commit: `docs: relatorio bench B1 Claude x DeepSeek`.

---

## PASSO B1.R — Relatório
Criar `docs/relatorios/B1-bench-claude-executor.md` (formato §8.4): sonda B1.0, caminho A/B, tabelas, desvios (inclusive T-N), leitura separada das duas perguntas do OBJETIVO, próximo passo (J2b). Diário: entrada nova no topo.

===== FIM DO PROMPT =====
