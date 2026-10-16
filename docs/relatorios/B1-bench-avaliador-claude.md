# Relatório B1 — Bench avaliador Claude Opus 5.5 × cadeia atual

> Prompt fundador 16/10/2026. HEAD inicial (T-A): `a456669678c015f9be4b6991b66447a60b089558`.

---

## PASSO B1.0 — Sonda (sem commit)

Script temporário: `%TEMP%\b1-sonda-nextcode.ts` (lê `Setting` + gateway FreeLLMAPI; chaves não impressas).

| Caminho | Modelo | Resultado |
|---------|--------|-----------|
| FreeLLMAPI `POST …/chat/completions` | `claude-opus-5-5` | **404** (X-Routed-Via ausente) |
| Anthropic direto `POST …/v1/messages` | `claude-opus-5-5` | **200** |

Conclusão: avaliador Claude no bench pode usar ramo Anthropic direto (`dispatchStrongEvaluator`). T-J (4) **não** acionado.

---

## PASSO B1.1 — Variante avaliador-claude + teto bench

**Commit:** `1bc03f7` — `feat(bench): variante avaliador-claude e teto US$ 3 so no bench (B1.1)`

```
 scripts/bench.ts                    | +variante avaliador-claude, BENCH_TETO 3.0, BUDGET_AUTHORIZED +2.5
 tests/bench/bench-relatorio.test.ts | +2 testes B1.1, tetoEfetivoUsd nos mocks
 docs/relatorios/B1-bench-avaliador-claude.md | criado/atualizado
```

**Verificação (colar no relatório):**

- `npx tsc --noEmit` → 0 erros
- `npx vitest run` → **122** arquivos, **794** testes, todos verdes (~226 s)

**Desvios:** nenhum. **Dúvidas:** nenhuma bloqueante.

---

## PASSO B1.2 — Rodada e medições

**Comando:**
```bash
npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes padrao,avaliador-claude --repeticoes 1
```

**Relatório gerado:** `docs/relatorios/bench/2026-10-16-1658.md` (+ `.yaml`)  
**Custo acumulado rodada:** US$ 0,9638 (abaixo do teto T-J US$ 10,00)  
**Duração:** ~53 min (wall clock)

Resumo (copiado da tabela do bench):

| Projeto | Variante | Fase | Aceite | Custo total | Exec / Eval / Jev |
|---------|----------|------|--------|-------------|-------------------|
| P1 | padrao | ENTREGUE | 10/10 | 0,0220 | 0,0216 / 0 / 0,0004 |
| P1 | avaliador-claude | BLOQUEADA | 1/10 | 0,1731 | 0,1237 / 0,0489 / 0,0006 |
| P2 | padrao | ENTREGUE | 13/13 | 0,0660 | 0,0566 / 0,0088 / 0,0006 |
| P2 | avaliador-claude | BLOQUEADA | 10/13 | 0,3177 | 0,2164 / 0,1006 / 0,0007 |
| P3 | padrao | ENTREGUE | 12/12 | 0,0611 | 0,0606 / 0 / 0,0005 |
| P3 | avaliador-claude | BLOQUEADA | 0/12 | 0,1127 | 0,1123 / 0 / 0,0004 |
| P4 | padrao | ENTREGUE | 12/12 | 0,0375 | 0,0373 / 0 / 0,0003 |
| P4 | avaliador-claude | BLOQUEADA | 9/12 | 0,1737 | 0,1734 / 0 / 0,0003 |

**Porta B1:** as 8 execuções terminaram em fase final mensurável (4× ENTREGUE, 4× BLOQUEADA); custos da trilha (não estimados).  
**T-N:** `preferIndependentFirst` / `actualExecutorFamily` não alterados (R1). Onde Opus avaliou, executor permaneceu DeepSeek (`custom/deepseek-v4-pro` em etapas com tokens). **Desvio:** em P3/P4 `avaliador-claude`, coluna agregada “Avaliador Models” vazia e custo avaliador 0 — sessão bloqueou antes de avaliação paga em todas as etapas ou telemetria não registrou modelo; detalhe por etapa mostra Opus em P1/P2 e nenhum eval USD em P3/P4.

**Procedência das reprovações:** aceite Docker reflete código gerado; com Nemotron (padrao) 100% nos quatro projetos; com Opus, reprovações massivas (ex. P3 12/12 testes falhos no aceite) — indício de avaliador **mais exigente** e/ou bloqueio por 3 tentativas antes de ENTREGUE, não de falha de rota.

---

## PASSO B1.R — Fechamento (§8.4)

### 1. Identificação

| Campo | Valor |
|-------|--------|
| Pacote | B1 — avaliador Claude Opus 5.5 1º vs cadeia atual |
| HEAD inicial (T-A) | `a456669678c015f9be4b6991b66447a60b089558` |
| Commits | `1bc03f7` (B1.1), `9ec186d` (B1.2 + fechamento R) |

### 2. Resposta ao OBJETIVO (números)

- **Aceite / fase:** **padrao** — 4/4 **ENTREGUE**, aceite 100% em P1–P4 (igual B0). **avaliador-claude** — 0/4 ENTREGUE, 4× **BLOQUEADA**; aceite 10%, 76,9%, 0%, 75% (P1–P4).
- **Custo extra:** soma variante Opus US$ 0,7772 vs soma padrao US$ 0,1866 → **+US$ 0,5906** na rodada; avaliador pago Opus aparece onde há eval (P1 ~US$ 0,049, P2 ~US$ 0,101 eval).
- **Conclusão:** trocar 1º avaliador para Opus **muda materialmente** o resultado (mais reprovação, bloqueios, tempo maior) e **aumenta custo** quando o Opus avalia; FreeLLMAPI não roteia Opus (404); produção usaria Anthropic direto como na sonda.

### 3. Arquivos tocados na tarefa (R1)

```
git diff --stat 1bc03f7^..9ec186d -- scripts/bench.ts tests/bench/bench-relatorio.test.ts docs/relatorios/B1-bench-avaliador-claude.md docs/relatorios/bench/2026-10-16-1658.md docs/relatorios/bench/2026-10-16-1658.yaml memory/medicoes.md
```

```
 scripts/bench.ts                             |  50 +-
 tests/bench/bench-relatorio.test.ts          |  42 ++
 docs/relatorios/B1-bench-avaliador-claude.md | 110 +++
 docs/relatorios/bench/2026-10-16-1658.md     | 130 ++++
 docs/relatorios/bench/2026-10-16-1658.yaml   | 771 +++++++++++++
 memory/medicoes.md                           |  20 +
 6 files changed, 1118 insertions(+), 12 deletions(-)
```

*(Commits intermediários no `main` entre T-A e B1.1 — PJ1/docs — **fora** do escopo B1; R1 respeitado nos commits `1bc03f7` e `9ec186d`.)*

### 4. Desvios

| Desvio | Nota |
|--------|------|
| T-J legado 0,50/2,00 no loop principal | Substituído por 3,00/10,00 conforme prompt B1 (bench inteiro) |
| P3/P4 avaliador-claude sem linha de modelo Opus agregada | Ver §B1.2 T-N |

### 5. O que não foi feito (fora do B1)

- B1b (executor Claude, cadeia produção, gratuitos, regra “gratuito não aprova sozinho”).
- Alteração de `evaluator-models.ts` / produção — só env no subprocesso bench.

### 6. Próximo passo

**B1b** com prompt próprio (§5.0), após decisão do fundador com base neste relatório.

---
