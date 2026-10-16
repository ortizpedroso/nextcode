# Relatório P5c.3 — Elicitador Claude por streaming

## 0. Leitura

A chamada `callElicitadorClaude` passa a usar `stream: true` e a montar texto/uso a partir de eventos SSE, evitando o corte de ~300 s do `fetch` quando os cabeçalhos HTTP só chegam no fim. Assinatura e tipo de retorno permanecem iguais; `route.ts` não foi alterado **neste pacote isolado** (ver desvios abaixo).

## 1. Identificação

- **Prompt:** `docs/prompts/P5c.3-elicitador-claude-stream.md`
- **Data:** 16/10/2026
- **Verificação:** `npx tsc --noEmit` (0 erros); `npx vitest run tests/llm/elicitador-claude.test.ts tests/harness/budget-ceiling.test.ts tests/intake/spec-check.test.ts` — 22 testes verdes
- **Suite completa `vitest run`:** não executada nesta entrega (recomendado antes de commit)

## 2. O que mudou (arquivo:linha)

| Arquivo | Mudança |
|---------|---------|
| `src/core/llm/elicitador-claude.ts` | `stream: true`; leitor SSE (`message_start`, `content_block_delta`, `message_delta`, `error`); `ms` medido ao fim do stream |
| `tests/llm/elicitador-claude.test.ts` | Casos (a)–(i) com `ReadableStream` SSE simulado |

## 3. Escopo (`git diff --stat` da sessão de evolução)

Além de P5c.3, a mesma sessão incluiu pacotes P1 (teto), S2 (skill no chat) e P5-seg (máscara na entrada do dispatch) — ver §5.

## 4. Desvios em relação ao prompt P5c.3 (T-B)

**Houve desvios.** O prompt P5c.3 limitava alterações a `elicitador-claude.ts` e `tests/llm/elicitador-claude.test.ts`. Na execução do plano maior acordado com o fundador, também foram alterados:

- `src/core/llm/cost.ts` — papel `elicitador`, breakdown `execucaoUsd` / `elicitadorUsd`
- `src/core/config/orchestration-policy.ts`, `config/politicas-orquestracao.yaml` — `conta_elicitador_no_teto: false`
- `src/core/orchestrator/budget-guard.ts` — teto usa execução + legacy `outro`, não elicitador
- `src/app/api/chat/route.ts` — `recordLlmCost` com `papel: "elicitador"`, `buildElicitadorSpecSystemPrompt`, `maskSecretsForJev` nas mensagens user do dispatch
- `src/core/orchestrator/spec-draft.ts` — `buildElicitadorSpecSystemPrompt`
- `tests/harness/budget-ceiling.test.ts` — teste “elicitador não conta para teto”

Commits separados T-E / Co-Authored-By do prompt **não** foram feitos (fundador não pediu commit nesta rodada).

## 5. Checklist T-A…T-O (P5c.3 estrito)

| Trava | Status |
|-------|--------|
| T-B escopo | ⚠️ desvio (§4) |
| T-E commits + vitest full | ⬜ pendente |
| T-J sem rede nos testes | ✅ |
| T-H sem pacotes novos | ✅ |

## 6. Sugestões

1. Rodar `npx vitest run` completo e uma Spec longa (Gateway) pelo chat para validar latência &lt; 540 s sem `fetch failed`.
2. Atualizar linha E1/P5c em `docs/NEXTCODE-REFERENCIA.md` para ✅ P5c.3 + decisão teto (b).

## 7. Dúvidas

Nenhuma bloqueante para merge local; B1/J2b/J3/J4 permanecem fora deste pacote.
