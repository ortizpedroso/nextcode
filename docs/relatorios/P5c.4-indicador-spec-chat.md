# Relatório P5c.4 — Indicador "Gerando Spec…" no chat (mudança 9)

## 0. Leitura

Durante a fase Spec, `/api/chat` permanece bloqueado até `callElicitadorClaude` terminar (~3 min no smoke F8). A UI só atualizava ao fim do JSON, o que levou a reenvio duplicado (~US$ 0,85). Este pacote mostra o pedido do usuário na hora e um balão **Gerando Spec…** com aviso para não reenviar.

---

## 1. Identificação

| Campo | Valor |
|-------|--------|
| **Pacote** | P5c.4 / mudança 9 |
| **Hash de partida** | `ec82544` |
| **Commit** | `ed803ff` — `feat(chat): indicador Gerando Spec durante elicitador (P5c.4)` |
| **Data** | 16/10/2026 |
| **Diário** | entrada **63** |

```
ed803ff feat(chat): indicador Gerando Spec durante elicitador (P5c.4)
```

---

## 2. Por commit (`ed803ff`)

| Arquivo | Mudança |
|---------|---------|
| `src/app/page.tsx` | Estado `optimisticChat`; mensagem user otimista; `chatLoadingKind` |
| `src/components/layout/workspace.tsx` | Balão loading Spec vs resposta genérica; scroll |
| `docs/NEXTCODE-REFERENCIA.md` | Mudança 9 implementada |
| `memory/diario.md` | Entrada 63 |

**Verificação no commit:**

- `npx tsc --noEmit` — **0 erros**
- `npx vitest run` — **122 arquivos, 792 testes**, todos verdes (~171 s)

---

## 3. Testes novos

Nenhum teste automatizado novo (mudança só de UI). Regressão coberta pela suíte completa.

---

## 4. Evidência de comportamento (esperado)

| Condição | UI |
|----------|-----|
| Envio com Spec **não** aprovada (`!isSpecApproved`) | Pedido visível + **Gerando Spec…** + texto "não reenvie" |
| Envio com Spec já aprovada | **Processando resposta…** |
| Durante loading | Botão **Parar** na `PromptBar` (já existia) |

Heurística client: `kind: isSpecApproved ? "reply" : "spec"` — alinhada à fase em que o elicitador Opus costuma bloquear.

---

## 5. Execução real

Smoke manual **pendente** após deploy local (fundador). Smoke F8 anterior **não** incluía este indicador (commit posterior).

---

## 6. Desvios do prompt

**Nenhum prompt §8** foi escrito antes da implementação — decisão implícita ao fundador pedir "continuar" após recomendação mudança 9 (antes do B1).

---

## 7. Checklist travas (adaptado)

| Trava | Status |
|-------|--------|
| Escopo mínimo (só chat UI) | ✅ |
| Sem segredos | ✅ |
| `tsc` + vitest full | ✅ |
| Prova visual E2E | ⬜ recomendada |

---

## 8. Dúvidas abertas

1. Confirmar no browser que o empty-state some ao enviar a 1ª mensagem (mensagem otimista).
2. **B1:** `docs/prompts/B1-bench-claude-executor.md` — aguarda 「aprovado Fase 9」.
