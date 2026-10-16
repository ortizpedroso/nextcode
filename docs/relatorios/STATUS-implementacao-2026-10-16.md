# Status da implementação — NextCode (16/10/2026)

> **Papel deste documento:** relatório emitido pela sessão de implementação (Cursor) — **o que já está no código/docs** e **o que falta**, alinhado a `docs/NEXTCODE-REFERENCIA.md` §5.0.  
> **HEAD de referência:** `7c564a3`  
> **Auditoria externa:** opcional neste ciclo; checklist técnico permanece em `AUDITORIA-E1-FASES-1-8-implementacao.md` se a auditora quiser usar.

---

## 1. Resumo em uma frase

**E0 fechada.** **E1 parcial fechada até a Fase 8 + P5c.4** (Spec Opus no chat com smoke real). **Próximo trabalho de implementação:** Fase 9 **B1** (bench executor Claude × DeepSeek), depois **J2b+J2.7 → J3 → J4**.

---

## 2. Já implementado (neste repositório)

### 2.1 E0 — base (antes de 16/10, ✅)

Bench B0, P0–P3, R1, travas P5.x, J1/J2, C1, D1, etc. — ver §5.0 linhas E0; provas em §9 e `docs/relatorios/bench/2026-10-15-1927.md`.

### 2.2 E1 — pacote P5c + entrada Spec (16/10)

| Entrega | O que faz | Commits principais |
|---------|-----------|-------------------|
| **P5c (base 15/10)** | Claude Opus direto na Spec; teto tokens/chars; `ELICITADOR_CLAUDE` | `95f6c23`, `ba893ce` (+ relatório `P5c-elicitador-opus-teto.md`) |
| **Teto (b)** | Custo `elicitador` **fora** do US$ 0,50 de **execução** | `de6d338` |
| **S2** | Skill elicitador no system prompt da fase Spec | `1c3aeb6` |
| **P5-seg** | Máscara de segredos nas mensagens `user` do dispatch LLM | `962292b` |
| **P5c.3** | Streaming SSE Anthropic (evita timeout ~300 s) | `4283a68` |
| **S2-lite / mudança 8** | Skill sem T7/`fetch_official_docs_t7` até P8 | `ade8160` |
| **P5c.4 / mudança 9** | UI: pedido visível + **Gerando Spec…** (anti-reenvio) | `ed803ff` |

**Arquivos de código tocados no bloco 16/10:**  
`route.ts`, `elicitador-claude.ts`, `spec-draft.ts`, `cost.ts`, `budget-guard.ts`, `orchestration-policy.ts`, `politicas-orquestracao.yaml`, `skills/elicitador/SKILL.md`, `page.tsx`, `workspace.tsx`, testes `budget-ceiling`, `elicitador-claude`.

**Qualidade automatizada (última confirmação local):** `tsc` 0; **792** testes vitest.

### 2.3 Prova de ponta (Fase 8 — fundador)

| Item | Resultado |
|------|-----------|
| Pedido | `docs/rascunhos/FASE8-pedido-sintetico-p5c.md` |
| Sessão | **`c0377632`** — 167 s, `ELICITADOR_CLAUDE` ok, ~US$ 0,43 elicitador |
| Spec | 56 REQ, 10/10 totais corretos, `SPEC_REVISAO` |
| Ressalvas | Ano `2025-10-16` na Spec; reenvio duplicado antes do P5c.4 (~US$ 0,85 total no dia) |

Documentação de fechamento: `F8-smoke-P5c-fechamento.md`, §5.0 P5c ✅.

### 2.4 Governança e prompts prontos (sem executar)

| Artefato | Estado |
|----------|--------|
| §5.0 / §5.0.1 | Atualizados (Fases 1–8 ✅, Fase 9 🔄) |
| Prompt **B1** | Escrito: `docs/prompts/B1-bench-claude-executor.md` |
| Relatórios §8.4 / consolidado | `P5c.3`, `P5c.4`, `F8-smoke`, `AUDITORIA-E1-FASES-1-8-implementacao.md` |

### 2.5 Congelado (não implementar sem descongelar)

Decomposer / analista LLM de planejamento / `splitNodesByJev` (M3) — intactos.

---

## 3. Falta implementar (ordem §5.0)

### 3.1 Imediato — E1 (restante)

| Ordem | Item | O que falta | Porta / nota |
|-------|------|-------------|--------------|
| **1** | **B1** (Fase 9) | Variante bench executor Claude; avaliador Claude 1º; rodada P1–P4; `medicoes.md` | Prompt pronto; **só código após 「aprovado Fase 9」**; sonda FreeLLMAPI vs rota direta Anthropic (passo B1.0 do prompt) |
| **2** | **J2b + J2.7** | Reparo pós-reprovação → `PLANEJAMENTO`, até 3 rodadas | J2.7 tem prompt; J2b **sem** prompt em `docs/prompts/` |
| **3** | **J3** | Auditoria final atômica por REQ (4 controles) | Sem prompt |
| **4** | **J4** | Evidência Jev ativa; bench com × sem Jev | Sem prompt |

### 3.2 Opcional / validação manual (não bloqueia B1)

- Checklist Fase 8 **V2:** aprovar Spec cara e confirmar que 1º lote de execução **não** bloqueia só por elicitador > US$ 0,50 (teto b).
- Smoke **visual** P5c.4 no browser (balão durante Spec).
- Corrigir ano errado na Spec (comportamento do modelo/prompt — não há fix dedicado no código).

### 3.3 Depois de E1 — E2 em diante (§5.0)

Não iniciados: P5.4 ativo, J11, J7–J9, P8/T7, P10 Gate 1, P6, J23 ativo, autoteste T, P7, infra §3.2, P9, Gates 2…n.

**Fora da ordem (decisão fundador):** mudança 7 (laço Jev→elicitador por lacuna); limpeza M1/M4; alinhar YAML evidência sombra; D2 amplo na referência §3/§4.

---

## 4. Linha do tempo de commits (bloco E1 documentado, `f0bcc43` → HEAD)

```
f0bcc43 → acbe398   docs decisões / referência
de6d338             teto (b)
1c3aeb6             S2
962292b             P5-seg
4283a68             P5c.3
58cacd3, d6cf037    relatório + diário
ade8160, 12445ba    S2-lite + Fase 8 pedido
d1a45f4             correção auditoria 58
ec82544             P5c ✅ + Fase 8 ✅ docs
ed803ff             P5c.4 UX
cc14ea2, 7c564a3    relatórios §8.4 + AUDITORIA consolidada
```

---

## 5. O que o fundador / auditor precisa decidir (não é implementação)

| Decisão | Efeito |
|---------|--------|
| 「**aprovado Fase 9**」 | Autoriza executar prompt B1 (custo bench; T-J US$ 2/execução no prompt) |
| Auditoria do bloco 1–8 | Usar `AUDITORIA-E1-FASES-1-8-implementacao.md` §8 — veredito no diário |
| Mudança 7 (E2) | Ainda **aguarda** — não entra no B1 |

---

## 6. Documentos relacionados

| Se precisar de… | Arquivo |
|-----------------|---------|
| Status (este) | `STATUS-implementacao-2026-10-16.md` |
| Detalhe técnico para auditoria | `AUDITORIA-E1-FASES-1-8-implementacao.md` |
| Fonte de ordem | `docs/NEXTCODE-REFERENCIA.md` §5.0 |
| Narrativa | `memory/diario.md` entradas 53–64 |

---

*Emitido: 16/10/2026 — sessão Cursor (implementação E1 parcial).*
