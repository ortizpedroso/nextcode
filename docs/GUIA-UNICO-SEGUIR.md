# NextCode — Guia único (inventário completo de `docs/`)

> **Data:** 16/10/2026 · **Inventário:** 198 arquivos sob `docs/` (conferido por listagem recursiva).  
> **Plano de fases e commits:** use **[`PLANO-UNICO-NEXTCODE.md`](PLANO-UNICO-NEXTCODE.md)** — documento único de execução com aprovação por fase.  
> **Autoridade:** [`NEXTCODE-REFERENCIA.md`](NEXTCODE-REFERENCIA.md) §0 e §5.0 prevalecem.

---

## Parte A — O que decidimos (consolidado)

### A.1 Produto e arquitetura

- Harness + **skills** (elicitador, analista, executor/avaliador por cluster) + **Jev** (decisão atômica) + LLM (texto).
- Spec/Macrobrief, executor e avaliador: **não economizar**; Jev escolhe modelo/divisão onde já está ligado.
- Papéis críticos: **só pago** (FreeLLMAPI perfis `auto:nextcode-pago-*`); sem pago → pausa, não gratuito silencioso.
- **Não mexer** no miolo que entrega hoje: decomposer, analista LLM no planejamento, `splitNodesByJev` / M3 — salvo reporte prévio.
- Auditoria final Jev: **sombra** até J3/J4; **não rebaixar** limiares.
- Entrega reprovada: J2 avisa; **J2b** reparo automático (até 3×) — ainda **não implementado**.
- Ordem oficial (§5.0): **E0 ✅ → E1 (em curso) → E2…E6**.

### A.2 Decisões com data (fonte: `memory/decisoes.md` + diário)

| Data | Decisão |
|------|---------|
| 08–09/10 | R1, P0–P3, P2 bench, S1 skills; régua do bench escrita pelo **auditor** |
| 13/10 | Documento único = referência + §9; J2/J2b/J3/J4; nenhuma parada silenciosa; D1 **depois** do C1 |
| 14/10 | Ordem **I1 → P5 → J2b → J3 → J4**; P5.4 conferência em **sombra**; visão global antes de mexer |
| 15/10 | §5.0 aprovada; mudanças 1–6 (B0, J2.7+J2b, Gate1 antes P6, P5b dividido, **P5c**, **B1**); Opus 1º elicitador; teto tokens Spec |
| 16/10 | Foco **NextCode**; **não** usar conversa/Spec Gateway em testes; teto custo **(b)** elicitador fora dos US$ 0,50 de execução |
| 16/10 | **Proposta** mudança 7: laço Jev → elicitador por lacuna (E2/J8) — **aguarda** |

### A.3 O que a pasta `docs/` **não** é mais (pós-D1)

Estes planos/logs foram **apagados** e só existem no git (§9.0 da referência): `PLANO-DE-ACAO.md`, `PLANO-ETAPA-0.md`, `PLANO-EVOLUCAO.md`, `JEV-PLANO-DIRETOR.md`, `JEV-LOG-DE-IMPLANTACAO.md`, `LLM-GATEWAYS.md`, `SPEC-TEMPLATE-NEXTCODE-V5.md`, `rascunhos/skills/*`.  
**Não usar** como guia de evolução — só recuperar com `git show 54e08bd:docs/...` se precisar de histórico.

---

## Parte B — Inventário **completo** de `docs/` (198 arquivos)

### B.1 Raiz (`docs/` — 4 arquivos)

| Arquivo | Papel | Evolução NextCode |
|---------|--------|-------------------|
| `NEXTCODE-REFERENCIA.md` | Fonte única: estado, §5.0 cronograma, Jev §4, protocolo §8 | **Manter atualizado** (D2: status desatualizados — ver B.8) |
| `ARQUITETURA-ORQUESTRACAO.md` | Desenho v4, travas P1–P17, Mermaid | **Detalhe**; nomes de skills antigos em trechos; alinhar quando tocar fases |
| `GUIA-UNICO-SEGUIR.md` | Este documento | **Operação** até fundador absorver na referência |
| `specs/gatway-system-spec.md` | Spec Gateway formato **antigo** | **Referência histórica**; Gate 1 (E3) = reescrever pelo chat; **não** régua de teste (16/10) |

### B.2 `docs/prompts/` (23 arquivos — **contratos de execução**)

| Prompt | Pacote | Relatório existe? | Status implantação | Evolução |
|--------|--------|-------------------|-------------------|----------|
| `P0-arrumacao.md` | P0 | ✅ | ✅ E0 | Manutenção |
| `P1-nucleo-jev.md` | P1 | ✅ | ✅ E0 | Base Jev |
| `P2-bench-real.md` | P2 | ✅ | ✅ E0 | Bench |
| `P2b-bench-dificil.md` | P2b | ✅ | ✅ E0 | P3/P4 no bench |
| `P3-avaliador-freellmapi.md` | P3 | ✅ | ✅ E0 | Avaliador |
| `R1-roteamento-pago-primeiro.md` | R1 | ✅ | ✅ E0 | Roteamento |
| `R1-continuacao-*.md` (3) | R1 | (no R1) | ✅ E0 | Histórico execução R1 |
| `S1-skills-ligar-e-enxugar.md` | S1 | ✅ | ✅ E0 | Skills |
| `C1-correcoes-auditoria.md` | C1 | ✅ | ✅ E0 | Correções 12/10 |
| `D1-documento-unico.md` | D1 | ✅ | ✅ §9 | Limpeza docs feita |
| `D1b-correcao-d1.md` | D1b | ❌ | ⚠️ verificar diff D1 | Só doc, se ainda pendente |
| `J1-diagnostico-entrega-jev.md` | J1 | ✅ | ✅ | Medição perguntas Jev |
| `J2-nenhuma-parada-silenciosa.md` | J2 | ✅ | ✅ E0 | Sombra auditoria |
| `J2.7-teste-estrutural-completo.md` | J2.7 | ❌ | ⬜ **E1** (com J2b) | Testes phase-machine |
| `I1-inventario-ligado-desligado.md` | I1 | ✅ | ✅ | Diagnóstico mapa código |
| `P5-entrada-como-pensada.md` | P5.1–4 | ✅ | ✅ E0 (+ P5.5/5.5b) | Entrada Jev/M0/M2/conferência |
| `P5.5-mascara-json-asaas.md` | P5.5 | ✅ | ✅ | Máscara |
| `P5.5b-mascara-duas-passadas.md` | P5.5b | ✅ | ✅ | Máscara |
| `P5c-elicitador-opus-teto.md` | P5c | ✅ | 🔄 código + audit 15/10 | Opus, limites Spec |
| `P5c.3-elicitador-claude-stream.md` | P5c.3 | ✅ | 🔄 working tree 16/10 | Streaming |
| `README.md` | — | — | — | Índice prompts |

**Prompts que §5.0 exige e ainda NÃO existem em `prompts/`:**  
**J2b**, **J3**, **J4**, **B1**, **S2** (skill elicitador — hoje só na referência/descrição), **P5-seg** (máscara LLM chat — achado 15/10), **P8/T7**, **P6–P10**, **T** (autoteste).  
Protocolo §8.1: Claude escreve prompt **antes** de cada pacote novo.

### B.3 `docs/relatorios/` (21 `.md` + 32 bench = 53 arquivos — **prova**)

| Relatório | Uso evolutivo |
|-----------|----------------|
| `P0` … `P3`, `R1`, `S1`, `C1`, `P2`, `P2b` | Baseline E0 — **não reabrir** salvo regressão |
| `J1`, `J2` | Fundamenta J3/J4 e modo sombra |
| `I1` | Mapa ligado/desligado/morto — **leitura obrigatória** antes de P5b/J2b |
| `P5`, `P5.5`, `P5.5b` | Entrada; lacunas M0/M2 documentadas |
| `P5c`, `P5c.3` | E1 elicitador; P5c.3 registra desvios P1/S2/P5-seg |
| `D1` | Registro limpeza docs |
| `diagnostico-docs-2026-10-13.md` | **Auditoria de governo** da pasta docs — ainda válida (exceto arquivos já apagados) |
| `auditoria-completa-2026-10-12.md` | Entrada do **C1** — histórico |
| `auditoria-skills-S0.md` | Método auditoria skills — usar em revisões futuras |
| `README.md` | Formato §8.4 |

### B.4 `docs/relatorios/bench/` (16 rodadas × 2 formatos ≈ 32 arquivos)

| Rodada | Evolução / lição |
|--------|------------------|
| `2026-10-09-*` | Primeiras medições; régua auditor |
| `2026-10-10-*` | Evolução P2 |
| `2026-10-12-*` (várias) | Instabilidade P3/P4; variantes **com Jev parando em PLANEJAMENTO** (diagnóstico 13/10 — investigar se ainda ocorre) |
| `2026-10-13-0552` | P3 PAUSADA 0/12 — motivo B0 antes J2b |
| **`2026-10-15-1927`** | **Porta E0/E1:** P1–P4 100% ENTREGUE — **régua atual** |
| Futuro **B1** | Nova pasta bench + `memory/medicoes.md` |

### B.5 `docs/rascunhos/` (4 arquivos)

| Arquivo | Evolução |
|---------|----------|
| `JEV-DECISOES.md` | Catálogo decisões Jev do **projeto** — consulta ao implementar J* |
| `TEMPLATES.md` | Base `artifact-templates.ts` — **código depende** |
| `TERCEIROS.md` | Licenças — compliance |
| `politicas-orquestracao.yaml` | **Fallback** se `config/` faltar — **desatualizado** (06/10); risco silencioso — **D2:** banner “use `config/`” |

### B.6 `docs/terceiros/jev-docs/` (~126 arquivos + `llms-full.txt`)

| Tipo | Evolução |
|------|----------|
| `llms-full.txt` | Entrada única offline (21k linhas) — preferir a abrir cada `.md` |
| `cookbooks_*`, `patterns_*`, `concepts_*` | **Referência** para desenhar perguntas J3/J11/J18 (citation, guardrails, routing) — **não é plano NextCode** |
| `sdk_*` | API Jev — implementação já em `src/core/decision/` |
| `model-jaggedness_jev-1.13.md` | Ordem de opções choice — relevante a T2 aprovação |

**Veredito:** manter; **zero pacotes de implantação** aqui — só consulta.

### B.7 Documentos históricos citados na referência §7 (fora de `docs/` ou apagados)

Recuperáveis só via git §9.0 — **não evoluir** a partir deles.

### B.8 Lacunas documentais (auditoria 16/10 — **evolução = corrigir na referência/D2**)

1. Cabeçalho referência: “586 testes” → hoje **792** / **122** arquivos.  
2. §3.1 bench, §3.2 `McpServer.env`, §4.2 R3/R22: alguns ❌ **desatualizados** vs código.  
3. §5 ainda marca “📝 aguarda aprovação” no título — §5.0 já aprovada 15/10.  
4. §6 itens 1/1b: decisões já tomadas — marcar resolvido ou mover.  
5. Portas E1/E3 citando Spec Gateway — conflito decisão 16/10.  
6. `ARQUITETURA`: paths `skills/elicitor` vs `skills/elicitador`.  
7. Três catálogos Jev (§4.4, §5.2b, `JEV-DECISOES.md`) — usar §4.4 + §5.0 na prática.

---

## Parte C — Mapa “documento → evolução NextCode” (síntese)

| Se você quer… | Leia / use |
|---------------|------------|
| **Ordem do que fazer** | Referência §5.0 + Parte D deste guia |
| **Por que não mexer em X** | I1 + decisões 16/10 “congelar” decomposer/Jev M3 |
| **Como executar pacote Y** | `prompts/<Y>.md` → relatório → auditoria §8.5 |
| **Provar número** | `relatorios/bench/*.md` + YAML par |
| **Desenhar pergunta Jev** | §4 referência + `terceiros/jev-docs/patterns_*` + J1 |
| **Política runtime** | `config/politicas-orquestracao.yaml` (não rascunho) |
| **O que já foi feito** | Referência §9 + diário |
| **Erros de governo passados** | `diagnostico-docs-2026-10-13.md` |

### C.1 Pacotes da referência §5.3 / §5.5 vs pasta `docs/`

| Código | Onde está o detalhe | Prompt | Relatório | Próximo passo evolutivo |
|--------|---------------------|--------|-----------|-------------------------|
| P0–P3, R1, S1, C1, D1 | §9 | ✅ | ✅ | — |
| P2, P2b, B0 | §5.0 E0 | ✅ | ✅ bench | — |
| P5.1–5.4, 5.5, 5.5b | §5.5 | ✅ | ✅ | P5.4→ativo na **E2** |
| P5c + P5c.3 | §5.0 E1 | ✅ | ✅ | Commit + smoke **V1** |
| S2 (skill Spec) | §5.0 linha P5c | ❌ | ❌ | Commit **C2**; prompt opcional |
| P5-seg (máscara LLM) | §5.0 “fora ordem” | ❌ | ❌ | Commit **C3** ou prompt P5-seg |
| Teto (b) | decisão 16/10 | ❌ | (em P5c.3 desvios) | Commit **C1** |
| B1 | mudança 6 | ❌ | ❌ | **E1-B1** após P5c fechado |
| J2 | §5.5 | ✅ | ✅ | — |
| J2.7 | §5.0 | ✅ | ❌ | **E1-J2** com J2b |
| J2b | §5.5 | ❌ | ❌ | **E1-J2** — **escrever prompt** |
| J3, J4 | §5.5 | ❌ | ❌ | **E1** sequencial |
| P5b (J7–J11 chat) | mudança 4 | (dentro P5) | — | **E2** |
| P8/T7, O1/O4 | §5.0 E2 | ❌ | ❌ | E2 |
| P10 Gate 1 | §5.0 E3 | ❌ | ❌ | E3 |
| P6–P9, P7 | §5.3 | ❌ | ❌ | E4–E6 |
| T autoteste | §5.5 + §6 | ❌ | ❌ | E5 + decisões §6.6–7 |
| D2 | diagnóstico 13/10 + 16/10 | ❌ | ❌ | Fase documental |

---

## Parte D — Plano de execução por fases (para aprovação)

Cada fase: eu executo → você revisa → só então a próxima.

### D.0 — Governança (só documentação / registro)

| ID | O quê | Entregável | Depende de |
|----|--------|------------|------------|
| **G1** | Fundador aprova **este guia** como mapa até absorver na referência | OK no chat | — |
| **G2** | Registrar decisões 16/10 (teto b, foco Gateway, mudança 7 sim/não) em `memory/decisoes.md` | 1 commit doc | G1 |
| **G3** | **D2 mínimo:** atualizar cabeçalho testes + linha P5c + portas sem Gateway + §5 título | 1 commit `NEXTCODE-REFERENCIA.md` | G1 |

### D.1 — Consolidar código já feito (working tree 16/10)

| ID | Commit | Arquivos | Teste |
|----|--------|----------|-------|
| **C1** | `fix(orçamento): elicitador fora do teto de execução` | cost, policy, yaml, budget-guard, route (papel), test teto | tsc + vitest |
| **C2** | `feat(chat): skill elicitador na fase Spec (S2)` | spec-draft, route | idem |
| **C3** | `fix(chat): máscara segredos no dispatch LLM (P5-seg)` | route | idem |
| **C4** | `fix(elicitador): P5c.3 streaming Claude` | elicitador-claude + test | idem |
| **C5** | `docs: relatório P5c.3 e referência E1` | relatorios + referência | — |
| **C6** | `docs(diario): sessão 16/10 pós-C1–C5` | diário topo | opcional |

**Excluir** de C1–C5 salvo ordem explícita: `.serena/`, `.claude/`.

### D.2 — Porta P5c (prova, não necessariamente commit)

| ID | O quê | Critério |
|----|--------|----------|
| **V1** | Smoke: pedido **sintético longo** (regra taxas ou equivalente) pelo chat | Sem `fetch failed`; streaming ok; trilha `elicitador` |
| **V2** | Smoke: após Spec cara, **1º lote** da fila não bloqueia só por custo Spec | `enforceBudgetBeforeBatch` ok |
| **V3** | Marcar P5c ✅ na §5.0 | Após V1+V2 |

### D.3 — E1 restante (código — prompts faltantes primeiro)

| ID | Pré-requisito | Ação |
|----|---------------|------|
| **P-J2b** | G1, V3 | Claude redige `prompts/J2b-reparo-automatico.md` (fundador aprova prompt) |
| **E1-J2** | P-J2b + J2.7 prompt ✅ | Antigravity: J2b+J2.7 um pacote ou dois commits encadeados |
| **P-B1** | V3 | Claude redige prompt B1 bench Claude executor |
| **E1-B1** | P-B1 | Rodar bench variantes → `medicoes.md` |
| **P-J3** | E1-J2 auditado | Prompt J3 perguntas atômicas |
| **E1-J3** | P-J3 | Implementar + 4 controles J1 |
| **P-J4** | E1-J3 | Prompt J4 |
| **E1-J4** | P-J4 | `auditoria_entrega: ativo` + medição × sem Jev |

### D.4 — E2 em diante (só planejamento; ordem §5.0)

E2: P5.4 ativo, J11, J7–J9, P8/T7  
E3: P10 Gate 1  
E4: P6, O3/J15/J16, J23 ativo  
E5: T autoteste (§6.6–7)  
E6: P7, infra §3.2, P9, Gates 2…n  

Cada item: **aprovação fundador → prompt §8 → execução → auditoria**.

---

## Parte E — Checklist de aprovação (responda no chat)

Marque ou responda por texto:

1. [ ] **G1** — Aceito `GUIA-UNICO-SEGUIR.md` (inventário 198 arquivos + plano).  
2. [ ] **G2** — Autorizo commit de decisões 16/10 em `decisoes.md`.  
3. [ ] **G3** — Autorizo D2 mínimo na referência.  
4. [ ] **C1–C5** — Autorizo sequência de commits (fase a fase: C1, depois C2, …).  
5. [ ] **C6** — Diário: sim / não / após V1.  
6. [ ] **V1** — Quem roda smoke: fundador / agente com texto que eu aprovar.  
7. [ ] **Mudança 7** (laço Jev→elicitador): sim / não / depois E1.  
8. Ajustes ao plano: _______________

**Até marcar os itens acima, nenhum commit nem pacote de código novo será feito.**
