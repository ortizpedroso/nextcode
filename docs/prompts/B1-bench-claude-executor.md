# Prompt B1 — Bench executor Claude × DeepSeek; avaliador Claude 1º pago

> Item **B1** da referência §5.0 (mudança 6). **Pré-requisito:** P5c ✅ (rota Anthropic no elicitador, Fase 8 smoke).  
> **Não executar** sem 「aprovado Fase 9」 do fundador.  
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa B1 — medir P1–P4 com executor Claude vs DeepSeek e avaliador Claude como 1º pago

## OBJETIVO
Hoje o bench roda variantes `padrao`, `sem-jev`, `avaliador-deepseek` (`scripts/bench.ts`); o executor usa FreeLLMAPI + `deepseek-v4-pro` (`paid-routing.ts`); o avaliador tenta Nemotron antes de Claude (`evaluator-models.ts`). **B1** adiciona comparação explícita **executor Claude** vs **executor DeepSeek (baseline)** e força **Claude como 1º avaliador pago** na rodada B1, registrando aceite e custo em `memory/medicoes.md` e relatório em `docs/relatorios/bench/`.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/B1-bench-claude-executor.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só arquivos listados em cada passo. **Proibido** alterar `bench/aceite/`, `bench/specs/`, `bench/projetos/`.
- **T-C Literalidade.** Nomes e formatos exatos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**; cada commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde; saídas coladas. **Proibido** `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; bench já usa cópia temporária.
- **T-G Segredos.** Nenhuma chave em código, log, trilha ou relatório.
- **T-H Dependências.** Nenhum pacote novo (reutilizar padrão `elicitador-claude.ts` / `safeFetch` se precisar rota direta Anthropic).
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas.** Custo de **uma** execução bench > US$ 2,00 → PARE e grave relatório parcial; contradição prompt × código → PARE; B1.0 provar que **nenhum** caminho Claude no executor responde → PARE (fundador decide).
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel** (§8.4 da referência). **T-M** código gerado do bench roda só no contêiner de aceite quando aplicável (`docker/aceite/run.sh`).

## LEITURA OBRIGATÓRIA
- `scripts/bench.ts` — `VarianteBench`, `rodarUmaExecucao`, flags de ambiente da variante `avaliador-deepseek`.
- `src/core/llm/paid-routing.ts`, `src/core/orchestrator/node-executor.ts` — rota paga do executor.
- `src/core/llm/evaluator-models.ts` — `EVALUATOR_CHAIN`, `dispatchStrongEvaluator`, `preferIndependentFirst`.
- `src/core/llm/elicitador-claude.ts` — referência de chamada Anthropic direta (P5c).
- `config/politicas-orquestracao.yaml` — `prefixos_rota_paga`, `modelo_pago_forte`.
- `docs/relatorios/bench/2026-10-15-1927.md` (B0 baseline).

---

## PASSO B1.0 — Sonda: Claude no executor via FreeLLMAPI (sem commit)
Script temporário **fora do repo** ou comando documentado no relatório: com chaves do `.env`, chamar o mesmo endpoint/perfil que o executor usa hoje (`auto:` ou modelo fixo) para um modelo Claude listado na documentação interna / resposta da API. Colar **só** IDs de modelo e prefixo `X-Routed-Via` de uma resposta bem-sucedida (sem chaves).

**Decisão (registrar no relatório B1):**
- **Caminho A:** FreeLLMAPI roteia Claude com prefixo em `prefixos_rota_paga` → variante bench só troca `modelHeavy` / perfil.
- **Caminho B:** FreeLLMAPI **não** serve Claude no executor → implementar ramo bench (env `BENCH_EXECUTOR_CLAUDE=1`) com chamada direta Anthropic espelhando travas de `elicitador-claude.ts`, **somente** quando a env estiver setada (bench), sem mudar chat Spec.

Se Caminho B → PARE após B1.0 e descreva no relatório antes de codar (fundador já aprovou B1; implementação segue na mesma tarefa).

---

## PASSO B1.1 — Variante bench `executor-claude` + avaliador Claude 1º

**PODE ALTERAR:** `scripts/bench.ts`, `tests/bench/bench-relatorio.test.ts` (só testes novos citados aqui).

1. Estender `VarianteBench` com `"executor-claude"`.
2. Em `rodarUmaExecucao`, quando `variante === "executor-claude"`:
   - Configurar env documentada (ex.: `BENCH_EXECUTOR_CLAUDE=1`, `BENCH_EXECUTOR_CLAUDE_MODEL=claude-sonnet-4-5-20250929` ou modelo provado em B1.0).
   - Configurar avaliador: Claude **antes** de Nemotron/DeepSeek (ex.: `EVALUATOR_NEMOTRON_MODEL=bench-desligado` **e** reordenar chain via env `BENCH_EVALUATOR_CLAUDE_FIRST=1` implementada em `evaluator-models.ts` **ou** equivalente mínimo só lido quando a env bench estiver setada).
3. Baseline DeepSeek permanece variante `padrao` (sem regressão).

Teste novo: parse do relatório markdown inclui linha da variante `executor-claude` (espelhar testes existentes de variantes).

Commit: `feat(bench): variante executor-claude e avaliador Claude primeiro (B1.1)`.

---

## PASSO B1.2 — Executor: ramo Claude quando env bench (se B1.0 exigir Caminho B)

**PODE ALTERAR (somente se B1.0 = Caminho B):** novo módulo `src/core/llm/executor-claude.ts`, `node-executor.ts` / `executor-tool-loop.ts` nos pontos de dispatch, testes em `tests/llm/executor-claude.test.ts` (fetch mockado, como elicitador).

Comportamento: se `process.env.BENCH_EXECUTOR_CLAUDE === "1"`, usar Anthropic direto com chave `readSecret(setting.claudeKey)` (ou nome real no código); telemetria `LLM_COST` papel executor; **fora** dessa env, comportamento idêntico ao HEAD.

Se B1.0 = Caminho A, **pule** B1.2 (commit vazio não — apenas não altere estes arquivos; documente Caminho A no relatório).

Commit (se aplicável): `feat(executor): ramo Claude direto só para bench B1 (B1.2)`.

---

## PASSO B1.3 — Rodada bench e medições

Rodar (fundador com crédito; respeitar T-J):
```bash
npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes padrao,executor-claude --repeticoes 1
```

Gerar `docs/relatorios/bench/YYYY-MM-DD-HHmm.md` e atualizar `memory/medicoes.md` (seção datada 16/10+) com:
- aceite por projeto × variante;
- custo executor / avaliador / total;
- modelos efetivos na trilha (`EXECUTOR_ROTA_PAGA`, `EVALUATOR_MODEL`, `llm.gateway_call`).

**Porta B1:** ambas variantes rodam P1–P4 até fase final mensurável (ENTREGUE ou reprovação documentada); custos copiados da trilha, não estimados.

Commit: `docs: relatorio bench B1 Claude x DeepSeek`.

---

## PASSO B1.R — Relatório
Criar `docs/relatorios/B1-bench-claude-executor.md` (formato §8.4): sonda B1.0, caminho A/B, tabelas do bench, desvios, próximo passo (J2b).

---

## FIM DO PROMPT =====
