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

_(preencher após commit B1.1)_

---
