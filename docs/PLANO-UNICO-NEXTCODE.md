# Plano único NextCode — acervo aproveitável e fases com commit

> **Data:** 16/10/2026  
> **Autoridade:** [`NEXTCODE-REFERENCIA.md`](NEXTCODE-REFERENCIA.md) §5.0 (cronograma E0–E6).  
> **Este arquivo** é o **único plano de execução** com fases e commits; [`GUIA-UNICO-SEGUIR.md`](GUIA-UNICO-SEGUIR.md) permanece como inventário detalhado dos 198 arquivos em `docs/`.  
> **Regra:** após cada fase, **para** até o fundador escrever **「aprovado Fase N」** (ou ajustes). Só então: commits da fase + `tsc` + `vitest run` completos.

---

## 1. Regras do plano

1. **Um passo = uma fase**; uma fase pode ter **1 ou mais commits**, listados abaixo.
2. **Não mexer** sem reporte: decomposer, analista LLM no planejamento, `splitNodesByJev` (divisão M3).
3. **Testes:** Spec/conversa do **Gateway** não entram em auditoria nem smoke (decisão 16/10); smoke Spec longa = **pedido sintético** aprovado pelo fundador.
4. **Política viva:** `config/politicas-orquestracao.yaml` — não copiar de `docs/rascunhos/politicas-orquestracao.yaml` (fallback desatualizado).
5. **Prova:** número citado → arquivo em `docs/relatorios/bench/` ou relatório do pacote; veredito no `memory/diario.md`.

---

## 2. Acervo aproveitável (o que reutilizamos)

### 2.1 Já entregue e auditado — **manter, não reimplementar**

| Código | Evidência em `docs/` | Uso no NextCode |
|--------|----------------------|-----------------|
| R1, P0, P1, P2, P2b, P3 | `relatorios/P0`…`P3`, `R1`, `P2`, `P2b` | Roteamento pago, Jev, bench, avaliador |
| S1, C1, D1 | `relatorios/S1`, `C1`, `D1` | Skills, correções 12/10, §9 referência |
| J1, J2 | `relatorios/J1`, `J2` | Base J3/J4; auditoria final em **sombra** |
| I1 | `relatorios/I1` | Mapa ligado/desligado — consulta antes de entrada/reparo |
| P5.1–P5.4, P5.5, P5.5b | `relatorios/P5`, `P5.5`, `P5.5b` | Máscara Jev, M0/M2, conferência (sombra) |
| P5c (auditado 15/10) | `relatorios/P5c-elicitador-opus-teto.md` | Opus 1º, limites tokens/chars Spec |
| B0 | `relatorios/bench/2026-10-15-1927.md` | Porta: P1–P4 100% ENTREGUE |

**Prompts correspondentes:** `docs/prompts/` (23 arquivos) — travas §8 da referência.

### 2.2 Implementado no working tree (16/10) — **aproveitar via Fases 2–6**

| Pacote | Função | Arquivos principais |
|--------|--------|---------------------|
| Teto **(b)** | Custo Spec (`elicitador`) **fora** do US$ 0,50 de execução | `cost.ts`, `orchestration-policy.ts`, `config/politicas-orquestracao.yaml`, `budget-guard.ts`, `route.ts`, `budget-ceiling.test.ts` |
| **S2** | Skill `elicitador` + contrato YAML na fase Spec | `spec-draft.ts`, `route.ts` |
| **P5-seg** | Máscara de segredos nas mensagens `user` antes do LLM | `route.ts` |
| **P5c.3** | Streaming Claude no elicitador (timeout fetch) | `elicitador-claude.ts`, `elicitador-claude.test.ts` |
| Docs | Relatório P5c.3 + trechos referência | `relatorios/P5c.3-…`, `NEXTCODE-REFERENCIA.md` |

**Verificação já rodada:** `tsc` 0; `vitest run` **792/792** (122 arquivos).

### 2.3 Consulta contínua (não viram fase sozinhas)

| Recurso | Aproveitamento |
|---------|----------------|
| `NEXTCODE-REFERENCIA.md` §4–§5 | Ordem E1→E6, detalhe J*, P* futuros |
| `memory/decisoes.md` | Decisões do fundador |
| `rascunhos/JEV-DECISOES.md` | Desenho de perguntas Jev (J3, J11) |
| `rascunhos/TEMPLATES.md` | Templates de artefatos (código já usa) |
| `terceiros/jev-docs/llms-full.txt` | Doc Jev offline (routing, citation, guardrails) |
| `ARQUITETURA-ORQUESTRACAO.md` | Fluxo pensado; nomes de skills desatualizados em partes |
| `relatorios/diagnostico-docs-2026-10-13.md` | Governo: um plano só, sem log paralelo |
| Bench 12/10 | Histórico de falhas P3/P4 — alerta em medições J4 |

### 2.4 Não usar como guia de evolução

- Planos apagados no D1 (§9.0 referência): `PLANO-EVOLUCAO`, `JEV-LOG`, etc. — só `git show 54e08bd:…` se precisar de histórico.
- `specs/gatway-system-spec.md` — exemplo antigo; Gate 1 = Spec nova pelo chat (E3).
- `docs/rascunhos/politicas-orquestracao.yaml` — fallback perigoso se desatualizado.

### 2.5 Backlog documentado **sem prompt ainda** (fases 8+)

Ordem §5.0 após fechar P5c: **B1 → J2b+J2.7 → J3 → J4 → E2 (P5.4 ativo, J7–J11, P8/T7) → E3 (Gate 1) → E4–E6**.

Origem: §5.0, §5.5, `prompts/J2.7-teste-estrutural-completo.md`; **falta** redigir prompts: J2b, J3, J4, B1, P8, P6–P10, T.

---

## 3. Fases de implantação e commits

Cada fase termina com: **diff + saída tsc/vitest** (quando houver código) → **sua aprovação** → commits listados.

---

### Fase 0 — Aprovação deste plano

| Item | Entrega |
|------|---------|
| Objetivo | Fundador aceita este documento como plano único de commits |
| Commits | **Nenhum** |
| Você responde | 「aprovado Fase 0」 ou ajustes ao texto |

---

### Fase 1 — Registrar decisões e referência mínima (só documentação)

| Item | Conteúdo |
|------|----------|
| Objetivo | Alinhar memória institucional com 16/10 (teto b, foco NextCode, mudança 7 proposta) |
| Aproveita | `decisoes.md`, `NEXTCODE-REFERENCIA.md` (cabeçalho testes 792/122, P5c, portas sem Gateway nos testes) |
| Commits propostos | **1)** `docs(decisoes): registrar decisões 16/10 teto elicitador e foco de testes` · **2)** `docs(referencia): D2 mínimo status P5c e testes` |
| Prova | Diff legível; **sem** alteração de código |
| Aguarda | 「aprovado Fase 1」 |

---

### Fase 2 — Teto de custo (b): elicitador fora da execução

| Item | Conteúdo |
|------|----------|
| Objetivo | Spec cara não bloqueia fila antes do 1º lote |
| Aproveita | Decisão 16/10; teste em `budget-ceiling.test.ts` |
| Arquivos | `src/core/llm/cost.ts`, `src/core/config/orchestration-policy.ts`, `config/politicas-orquestracao.yaml`, `src/core/orchestrator/budget-guard.ts`, `src/app/api/chat/route.ts` (apenas `papel: "elicitador"`), `tests/harness/budget-ceiling.test.ts` |
| Commit | `fix(orçamento): custo elicitador fora do teto de execução` |
| Prova | `npx tsc --noEmit`; `npx vitest run` |
| Aguarda | 「aprovado Fase 2」 |

---

### Fase 3 — S2: skill elicitador na fase Spec

| Item | Conteúdo |
|------|----------|
| Objetivo | Chat Spec usa `buildElicitadorSpecSystemPrompt` (skill + contrato YAML) |
| Aproveita | `skills/elicitador/SKILL.md`, `spec-draft.ts`, ordem P5 / mudança 4 (P5b depois) |
| Arquivos | `src/core/orchestrator/spec-draft.ts`, `src/app/api/chat/route.ts` (prompt Spec) |
| Commit | `feat(chat): skill elicitador na fase Spec (S2)` |
| Prova | tsc + vitest; `spec-check.test.ts` |
| Aguarda | 「aprovado Fase 3」 |

---

### Fase 4 — P5-seg: máscara na entrada do LLM (chat)

| Item | Conteúdo |
|------|----------|
| Objetivo | Mensagens `user` ao dispatch passam por `maskSecretsForJev` (complemento P5.1) |
| Aproveita | P5.5/P5.5b, achado Regra 7 (referência §5.0 “fora da ordem”) |
| Arquivos | `src/app/api/chat/route.ts` (trecho dispatch) |
| Commit | `fix(chat): máscara de segredos nas mensagens user do dispatch` |
| Prova | tsc + vitest |
| Aguarda | 「aprovado Fase 4」 |

---

### Fase 5 — P5c.3: streaming Claude no elicitador

| Item | Conteúdo |
|------|----------|
| Objetivo | Evitar corte ~300 s do `fetch` na Spec longa |
| Aproveita | `prompts/P5c.3-elicitador-claude-stream.md` |
| Arquivos | `src/core/llm/elicitador-claude.ts`, `tests/llm/elicitador-claude.test.ts` |
| Commit | `fix(elicitador): chamada Claude por streaming (P5c.3)` |
| Prova | tsc + vitest |
| Aguarda | 「aprovado Fase 5」 |

---

### Fase 6 — Documentação do pacote E1 parcial

| Item | Conteúdo |
|------|----------|
| Objetivo | Fechar trilha de auditoria dos pacotes 2–5 |
| Aproveita | Formato §8.4 |
| Arquivos | `docs/relatorios/P5c.3-elicitador-claude-stream.md`, ajustes finais `docs/NEXTCODE-REFERENCIA.md` (linha E1/P5c) |
| Commit | `docs: relatório P5c.3 e status E1 P5c` |
| Prova | — |
| Aguarda | 「aprovado Fase 6」 |

---

### Fase 7 — Diário (opcional)

| Item | Conteúdo |
|------|----------|
| Objetivo | Entrada no topo de `memory/diario.md` (Fases 2–6, hashes, vitest) |
| Commit | `docs(diario): fechamento E1 parcial P5c S2 teto b` |
| Aguarda | 「aprovado Fase 7」 ou 「pular Fase 7」 |

---

### Fase 8 — Porta P5c (verificação, pode ser sem commit)

| Item | Conteúdo |
|------|----------|
| Objetivo | Cumprir porta §5.0 linha P5c |
| Ações | **V1** Spec longa **sintética** pelo chat (streaming, sem `fetch failed`) · **V2** fila segue após custo Spec · **V3** marcar P5c ✅ na §5.0 |
| Commits | Só se V3 alterar referência: `docs(referencia): P5c entregue porta V1-V2` |
| Aguarda | 「aprovado Fase 8」 + seu OK nos testes manuais |

---

### Fase 9 — B1 (medição executor Claude × DeepSeek)

| Item | Conteúdo |
|------|----------|
| Objetivo | Mudança 6 §5.0; custo e aceite em `memory/medicoes.md` |
| Pré-requisito | Fase 8 ✅ |
| Aproveita | Bench B0, política de modelos §5.2 |
| Antes do código | Claude redige `docs/prompts/B1-bench-claude-executor.md` → **você aprova o prompt** |
| Commits | Conforme prompt (config + bench + relatório) |
| Aguarda | 「aprovado Fase 9」 + prompt aprovado |

---

### Fase 10 — J2b + J2.7 (fluxo que se conserta)

| Item | Conteúdo |
|------|----------|
| Objetivo | Reparo automático até 3×; teste estrutural com listas reais de `phase-machine.ts` |
| Pré-requisito | Fase 8 ✅ (B1 pode correr em paralelo se você autorizar, mas §5.0 sugere P5c → B1 → J2b) |
| Aproveita | `359e06b`, `19d5758`, §2.2 arquitetura, `prompts/J2.7-teste-estrutural-completo.md`, §5.5 J2b |
| Antes do código | Redigir `docs/prompts/J2b-reparo-automatico.md` → **você aprova** |
| Porta | P4 com bug → ENTREGUE ou BLOQUEADA com relatório em ≤ 3 rodadas |
| Aguarda | 「aprovado Fase 10」 |

---

### Fase 11 — J3 (perguntas atômicas da auditoria final)

| Item | Conteúdo |
|------|----------|
| Objetivo | Perguntas no sentido certo; 4 controles J1 |
| Aproveita | `relatorios/J1`, §5.5 J3, `JEV-DECISOES.md` |
| Antes | Prompt J3 aprovado |
| Porta | P1 correto 5/5; cada controle reprovado pelo defeito certo |
| Aguarda | 「aprovado Fase 11」 |

---

### Fase 12 — J4 (auditoria ativa + medição)

| Item | Conteúdo |
|------|----------|
| Objetivo | `auditoria_entrega: ativo`; remediação Jev × sem Jev P1–P3 |
| Pré-requisito | Fase 11 ✅ |
| Aguarda | 「aprovado Fase 12」 |

---

### Fases 13–17 — Cronograma E2–E6 (planejadas, detalhe na referência)

| Fase | Etapa §5.0 | Conteúdo resumido |
|------|------------|-------------------|
| **13** | E2 | P5.4 → `ativo`; J11 citação REQ; J7–J9; **P8/T7** + elicitador com ferramenta real |
| **14** | E3 | P10 Gate 1 — Spec Gateway **reescrita** pelo chat |
| **15** | E4 | P6 contexto/skills; analista LLM (O3); J23 ativo |
| **16** | E5 | Autoteste T (§6 itens 6–7 pendentes fundador) |
| **17** | E6 | P7 supervisor/UI; infra §3.2; P9; Gates 2…n |

Cada uma: **aprovação fundador → prompt §8 → execução → auditoria → commits** (mesmo ritual das Fases 2–6).

---

## 4. Decisões pendentes (informar na Fase 0 ou 1)

| # | Pergunta | Default do plano |
|---|----------|------------------|
| 1 | **Mudança 7** (laço Jev → elicitador por lacuna) | Adiar para Fase 13 (E2/J8) |
| 2 | **Fase 7** (diário) | Opcional após Fase 6 |
| 3 | **Ordem B1 vs J2b** | B1 (9) antes J2b (10), conforme §5.0 |
| 4 | Texto do **pedido sintético** Fase 8 | Fundador aprova ou delega rascunho |

---

## 5. Checklist — sua resposta inicial

Copie e marque no chat:

```
[ ] Fase 0 — Aprovo o PLANO-UNICO-NEXTCODE.md
[ ] Fases 1–7 — Autorizo executar em sequência, parando após cada fase para minha revisão
[ ] Fase 8 — Quem roda smoke: fundador / agente (pedido sintético: _______)
[ ] Mudança 7: adiar E2 / sim agora / não
[ ] Ajustes: _______
```

**Até receber 「aprovado Fase 0」 (e demais fases), nenhum commit será feito.**

---

## 6. Mapa rápido: fase → origem em `docs/`

| Fase | Pacote | Prompt | Relatório / bench |
|------|--------|--------|-------------------|
| 2–5 | teto b, S2, P5-seg, P5c.3 | P5c.3 (+ decisão) | P5c.3 (Fase 6) |
| 8 | porta P5c | P5c, P5c.3 | medicoes / smoke |
| 9 | B1 | *criar* | bench novo |
| 10 | J2b, J2.7 | J2.7 ✅, J2b *criar* | bench P4 |
| 11–12 | J3, J4 | *criar* | J1, medicoes |
| 13+ | E2–E6 | §5.0 | Gate 1, etc. |
