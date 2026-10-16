# Relatório de auditoria — E1 parcial implementado (Fases §5.0.1: 1–8 + P5c.4)

> **Obrigatório:** ao fechar **qualquer fase** de implementação, este pacote de auditoria deve existir antes de pedir 「aprovado Fase N+1」 ou iniciar a fase seguinte.  
> **Para:** IA auditora (Antigravity / Claude) — **somente leitura + verificação**; não implementar B1/J2b sem 「aprovado Fase 9」.  
> **De:** sessão Cursor, 16/10/2026.  
> **HEAD alvo:** `cc14ea2` (ou o commit mais recente em `main` se este relatório for atualizado).

---

## 1. Identificação

| Campo | Valor |
|-------|--------|
| **Escopo** | E1 — **P5c** (mudança 5) + **S2** (mudança 8) + **teto (b)** + **P5-seg** + **P5c.3** + **P5c.4** (mudança 9) + governança docs + **Fase 8 smoke** |
| **Fora do escopo (não mexer na auditoria deste bloco)** | B1, J2b, J2.7, J3, J4, P8/T7, decomposer, analista LLM planejamento, `splitNodesByJev` |
| **Pré-requisito P5c (15/10, já auditado)** | `95f6c23`, `ba893ce` — ver `docs/relatorios/P5c-elicitador-opus-teto.md` |
| **Fonte de ordem** | `docs/NEXTCODE-REFERENCIA.md` §5.0, §5.0.1, §8.4–§8.5 |
| **Veredito** | _(preencher auditora no topo de `memory/diario.md`)_ |

---

## 2. Commits a auditar (ordem cronológica, `f0bcc43` → HEAD)

| # | Hash | Pacote / Fase §5.0.1 |
|---|------|----------------------|
| 1 | `f0bcc43` | Fase 1 — decisões docs |
| 2 | `acbe398` | Fase 1 — referência D2 mínimo |
| 3 | `de6d338` | Fase 2 — teto **(b)** elicitador fora US$ 0,50 execução |
| 4 | `1c3aeb6` | Fase 3 — **S2** skill elicitador no prompt Spec |
| 5 | `962292b` | Fase 4 — **P5-seg** máscara `user` no dispatch |
| 6 | `4283a68` | Fase 5 — **P5c.3** streaming elicitador Claude |
| 7 | `58cacd3` | Fase 6 — relatório P5c.3 |
| 8 | `d6cf037` | Fase 7 — diário 53 |
| 9 | `ade8160` | Fase 7b — **S2-lite** / mudança 8 (sem T7) |
| 10 | `12445ba` | Fase 7b — §5.0.1, pedido Fase 8 |
| 11 | `a4ea3e2` | _(superseded)_ marcação prematura P5c ✅ |
| 12 | `32a2bb2` | Handoff E1 P5c–F8 |
| 13 | `d1a45f4` | Correção auditoria 58 (tabela F8, P5c 🔄) |
| 14 | `ec82544` | Fase 8 docs — P5c ✅ com prova smoke |
| 15 | `ed803ff` | **P5c.4** — indicador "Gerando Spec…" |
| 16 | `cc14ea2` | Relatórios §8.4 F8 + P5c.4 |

**Diff acumulado (código + docs deste bloco, excl. `.next` / banco):** 23 arquivos, +1081 / −81 linhas (entre `f0bcc43^` e `cc14ea2`).

---

## 3. O que foi implementado (arquivo → comportamento)

### 3.1 Orçamento — teto (b)

| Arquivo | Efeito |
|---------|--------|
| `config/politicas-orquestracao.yaml` | `conta_elicitador_no_teto: false` |
| `src/core/config/orchestration-policy.ts` | Lê flag; expõe na política |
| `src/core/llm/cost.ts` | Breakdown `execucaoUsd` / `elicitadorUsd`; `sessionCostUsd` documentado |
| `src/core/orchestrator/budget-guard.ts` | Teto US$ 0,50 usa execução + legacy `outro`, **não** soma elicitador quando flag falsa |
| `src/app/api/chat/route.ts` | `recordLlmCost` com `papel: "elicitador"` na Spec Claude |
| `tests/harness/budget-ceiling.test.ts` | Teste: elicitador > 0,50 não bloqueia 1º lote de execução |

### 3.2 S2 — skill elicitador na fase Spec

| Arquivo | Efeito |
|---------|--------|
| `src/core/orchestrator/spec-draft.ts` | `buildElicitadorSpecSystemPrompt()` |
| `src/app/api/chat/route.ts` | System prompt Spec usa builder acima quando `isSpecDraftingPhase` |

### 3.3 S2-lite — mudança 8

| Arquivo | Efeito |
|---------|--------|
| `skills/elicitador/SKILL.md` | Removido `fetch_official_docs_t7` até **P8** |

### 3.4 P5-seg

| Arquivo | Efeito |
|---------|--------|
| `src/app/api/chat/route.ts` | Mensagens `user` no dispatch passam por `maskSecretsForJev` |

### 3.5 P5c.3 — streaming Anthropic (elicitador)

| Arquivo | Efeito |
|---------|--------|
| `src/core/llm/elicitador-claude.ts` | `stream: true`, parser SSE, timeout 540 s, max tokens 48k |
| `tests/llm/elicitador-claude.test.ts` | Casos (a)–(i) com stream simulado |

Detalhe: `docs/relatorios/P5c.3-elicitador-claude-stream.md`.

### 3.6 P5c.4 — feedback UI (mudança 9)

| Arquivo | Efeito |
|---------|--------|
| `src/app/page.tsx` | `optimisticChat`; mensagem user imediata; `chatLoadingKind` |
| `src/components/layout/workspace.tsx` | Balão **Gerando Spec…** / **Processando resposta…** |

Detalhe: `docs/relatorios/P5c.4-indicador-spec-chat.md`.

### 3.7 Governança / prova

| Arquivo | Efeito |
|---------|--------|
| `docs/NEXTCODE-REFERENCIA.md` | P5c ✅, Fases 8 ✅, mudanças 8–9, §5.0.1 |
| `docs/rascunhos/FASE8-pedido-sintetico-p5c.md` | Pedido smoke + checklist [x] 1–4 |
| `docs/prompts/B1-bench-claude-executor.md` | Prompt Fase 9 (**não executado**) |
| `memory/decisoes.md`, `memory/diario.md` | Decisões e entradas 53–63 |

---

## 4. Testes novos / alterados (o que prova)

| Arquivo | Teste (resumo) | Prova |
|---------|----------------|-------|
| `tests/harness/budget-ceiling.test.ts` | elicitador não conta para teto | Teto (b) |
| `tests/llm/elicitador-claude.test.ts` | SSE ok/erro/timeout/chunks | P5c.3 sem rede real |

**Suíte completa (HEAD `ed803ff`, ambiente local):**

```
Test Files  122 passed (122)
Tests       792 passed (792)
npx tsc --noEmit → 0 erros
```

Auditora: repetir `npx tsc --noEmit` e `npx vitest run` 2× no HEAD.

---

## 5. Execução real — Fase 8 (porta P5c)

| Campo | Valor |
|-------|--------|
| Pedido | `docs/rascunhos/FASE8-pedido-sintetico-p5c.md` |
| Sessão canônica | **`c0377632`** |
| Tempo | 167 s |
| Trilha | `ELICITADOR_CLAUDE` ok; `LLM_COST` `papel: elicitador` ~US$ 0,43 |
| Spec | 56 REQ; 10/10 totais; `SPEC_REVISAO` |
| UX (antes P5c.4) | Reenvio `95f9f2e9` ~US$ 0,42 — UI muda |

Detalhe: `docs/relatorios/F8-smoke-P5c-fechamento.md`.

**Checklist V2** (fila após Spec elicitador > US$ 0,50): ainda **não** executado manualmente.

---

## 6. Evidência de nomes (amostra — auditora completar se rejeitar)

| Nome | Onde |
|------|------|
| `callElicitadorClaude` | `src/core/llm/elicitador-claude.ts` |
| `buildElicitadorSpecSystemPrompt` | `src/core/orchestrator/spec-draft.ts` |
| `maskSecretsForJev` | dispatch em `src/app/api/chat/route.ts` |
| `conta_elicitador_no_teto` | `config/politicas-orquestracao.yaml` |
| `enforceBudgetBeforeBatch` | `src/core/orchestrator/budget-guard.ts` |

Comando: `git grep -n '<nome>'` no HEAD.

---

## 7. Desvios conhecidos (transparência)

| Desvio | Status |
|--------|--------|
| P5c.3 prompt T-B estrito vs commits P1/S2/P5-seg na mesma sessão Antigravity | Documentado em `P5c.3-elicitador-claude-stream.md` §4 |
| `a4ea3e2` marcou P5c ✅ sem trilha | Revertido lógico em `d1a45f4` + prova em `ec82544` |
| P5c.4 implementado sem prompt §8 prévio | Fundador pediu continuar; mudança 9 registrada na referência |
| Co-Authored-By nos commits Cursor | Nem todos usam `Co-Authored-By: Claude Opus 5.5` (T-K Antigravity) |

---

## 8. Checklist auditoria §8.5

Executar e colar saídas no veredito (diário):

| # | Verificação | Esperado |
|---|-------------|----------|
| 1 | `git diff --stat f0bcc43^..HEAD` | Escopo §3 apenas; **sem** phase-machine / decomposer |
| 2 | `npx tsc --noEmit` | 0 erros (2×) |
| 3 | `npx vitest run` | 792/792 (2×) |
| 4 | `npx vitest run tests/harness/budget-ceiling.test.ts` | Verde |
| 5 | `npx vitest run tests/llm/elicitador-claude.test.ts` | Verde |
| 6 | `skills/elicitador/SKILL.md` | **Sem** `fetch_official_docs_t7` |
| 7 | §5.0 P5c ✅ + sessão `c0377632` | Referência alinhada |
| 8 | §5.0.1 Fases 1–8 ✅; Fase 9 🔄 | B1 só prompt |
| 9 | Segredos no diff | Nenhum |
| 10 | Smoke UI P5c.4 | Manual: balão "Gerando Spec…" na fase Spec |

**Veredito sugerido:** aceito / aceito com ressalvas / rejeitado — **obrigatório** registrar como nova entrada no topo de `memory/diario.md`.

---

## 9. O que NÃO foi feito (próximo cronograma)

| Item | Bloqueio |
|------|----------|
| **B1** bench Claude × DeepSeek | 「aprovado Fase 9」 |
| J2b + J2.7 | Após B1 |
| J3, J4 | §5.0 |
| Fase 8 checklist V2 | Opcional manual |
| Correção ano Spec `2025-10-16` | Defeito menor; fora deste bloco |

---

## 10. Índice de relatórios deste bloco

| Documento | Conteúdo |
|-----------|----------|
| **Este arquivo** | Auditoria consolidada Fases 1–8 + P5c.4 |
| `HANDOFF-E1-P5c-F8-para-auditoria.md` | Handoff código + checklist (atualizar HEAD) |
| `HANDOFF-E1-P5c-F8-fechamento.md` | Fechamento smoke |
| `P5c.3-elicitador-claude-stream.md` | Streaming |
| `P5c.4-indicador-spec-chat.md` | UX |
| `F8-smoke-P5c-fechamento.md` | Prova trilha |
| `P5c-elicitador-opus-teto.md` | Pré-requisito 15/10 |

---

## 11. Regra permanente (fundador, 16/10 — não negociável)

**Ao terminar uma fase de implementação (§5.0.1 ou pacote §5.0):**

1. Relatório §8.4 por pacote técnico (`docs/relatorios/<pacote>.md`), quando houver código.
2. **Relatório consolidado de auditoria** `docs/relatorios/AUDITORIA-<escopo>.md` (como este) no **último commit da fase**.
3. Entrada no `memory/diario.md` com link para o relatório consolidado.
4. Só então solicitar 「aprovado Fase N」 para a fase seguinte.

Registrado também em `CLAUDE.md` e `docs/NEXTCODE-REFERENCIA.md` §8.1.
