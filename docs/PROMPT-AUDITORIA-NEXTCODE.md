# Prompt de Auditoria Completa — NextCode Pipeline Multi-Agente

## Instrução ao Auditor (LLM Externa)

Você foi contratado para auditar **de forma independente e cega** a implementação completa do sistema NextCode, um orquestrador de desenvolvimento de software autônomo baseado em agentes, contratos TypeScript estritos e validação cruzada.

**Sua missão:** Ler TODO o código-fonte do projeto (`src/`, `skills/`, `tests/`) e verificar se a implementação real corresponde à arquitetura especificada no documento único `docs/NEXTCODE-REFERENCIA.md`.

**Regras da Auditoria:**
1. **Não confie em comentários ou documentação** — verifique o código executável.
2. **Compile mentalmente o fluxo** — trace cada decisão desde a entrada do usuário até a entrega final.
3. **Identifique gaps** — onde a implementação diverge da especificação? Onde há lógica morta, travas desligadas ou validações ausentes?
4. **Teste os contratos** — verifique se os arquivos em `src/contracts/` são realmente gerados, gravados e conferidos pelo `tsc`.
5. **Valide as skills** — cada papel (`elicitador`, `analista`, `executor-*`, `avaliador-*`, `conferente-macrobrief`, `testador`) deve ter seu SKILL.md lido e seu comportamento no código verificado.

---

## 1. Visão Geral do Sistema a Ser Auditado

O NextCode é um harness que transforma um pedido textual em software entregue através de:
- **Fases sequenciais** (`phase-machine.ts`): ENTRADA → CONVERSA → ELICITAÇÃO → SPEC_REVISAO → MACROBRIEF → CONFERENCIA → PLANEJAMENTO → EXECUCAO → VERIFICACAO → ENTREGUE.
- **Contratos TypeScript reais** (`src/contracts/index.ts`): Interfaces, enums, assinaturas de função e rotas definidas pelo Analista e verificadas mecanicamente pelo compilador.
- **Travas de governança** (T1–T10): Aprovação humana, escopo fechado, quarentena, duas lentes, 3 tentativas, pesquisa oficial, conferência mecânica, revisão final com bancada.
- **Modelos separados por família**: Claude (Opus/Sonnet) para concepção e julgamento; DeepSeek (v4-pro/flash) para execução e contratos.
- **JEV (TypeSafe System One)**: Usado apenas para decisões estruturadas rápidas (`choice`, `score`, `noul`) em pontos de incerteza marcados pela Skill Conferente.

---

## 2. Pontos Críticos de Verificação (Checklist do Auditor)

### Fase 1: Entrada e Elicitação
- [ ] O `IntakeEngine.analyze()` classifica corretamente entre Cenários A (Macro), B (Micro), C (Ambíguo) e D (Dúvida)?
- [ ] A Spec gerada pelo elicitador segue o formato canônico YAML + Markdown (`spec-format.ts`)?
- [ ] A aprovação humana é obrigatória antes de qualquer geração de código (Trava T1)?
- [ ] O `universal-funnel.ts` usa o Jev (`m0_peneira_afunilamento_universal`) para classificar a intenção?

### Fase 2: Macrobrief e Conferência
- [ ] O elicitador gera um Macrobrief de escopo separado da Spec?
- [ ] A skill `conferente-macrobrief` produz um laudo JSON estruturado com `falhas[]` e `incertos[]`?
- [ ] O `intake-engine.ts` chama o Jev apenas nos itens `incertos` do laudo (`decideMacrobriefUncertainty`)?
- [ ] Se o laudo reprovar, o ciclo volta ao elicitador (máx 3 tentativas)?

### Fase 3: Análise e Contratos
- [ ] O analista (DeepSeek) lê o Macrobrief aprovado e gera Contratos TypeScript reais?
- [ ] A função `validateContract` em `artifact-templates.ts` verifica:
  - Entidades/campos com tipos corretos?
  - Enums com valores exatos da Spec?
  - Assinaturas de função exportadas?
  - Rotas com entrada/saída/erros mapeados?
  - Dono de cada símbolo e quem o consome (`usadoPor`)?
- [ ] O contrato é gravado em `src/contracts/index.ts` e travado para escrita do executor?
- [ ] Cada etapa gera um arquivo de conformidade (`renderConformance`) que o `tsc` confere?

### Fase 4: Execução por Cluster
- [ ] Os executores (`executor-core`, `backend`, `frontend`, `integration`) recebem a fatia do contrato relevante?
- [ ] O executor importa tipos de `@/contracts` e não redefine interfaces?
- [ ] A skill `autoteste` roda testes unitários e de integração antes da avaliação?
- [ ] O porteiro empírico (`empirical-gate.ts`) roda `tsc` + ESLint antes de promover o código?

### Fase 5: Avaliação Cega (Duas Lentes)
- [ ] **Lente 1 (Cega):** O avaliador Claude lê o Microbrief e a fatia do contrato SEM ver o relatório do executor?
- [ ] **Lente 2 (Mecânica):** O código cruza as declarações do executor com o veredito da Lente 1?
- [ ] Discordância entre as lentes reprova a etapa automaticamente?
- [ ] Violação de contrato é tratada como defeito `critico` (não `importante`)?

### Fase 6: Revisão Final e Bancada
- [ ] A skill `avaliador-final` lê a Spec original, o Macrobrief e o código integrado de todos os clusters?
- [ ] A bancada de testes (`test-bench.ts`) roda em contêiner Docker sem rede?
- [ ] O revisor reproduz suspeitas com testes automatizados (`defect-reproducer.ts`)?
- [ ] Falha na revisão final aciona o Analista para criar Microbrief de correção (até 3 rodadas)?

### Travas e Governança
- [ ] **T1:** Aprovação humana da Spec é obrigatória?
- [ ] **T4:** Quarentena + rollback em caso de falha?
- [ ] **T5:** Duas lentes independentes (cega + mecânica)?
- [ ] **T6:** Máximo 3 tentativas por etapa, depois bloqueio + relatório ao humano?
- [ ] **T7:** Pesquisa só em fonte oficial, com guarda de injeção (`injection-scan.ts`)?
- [ ] **T8a/T8b:** Spec × plano: todo REQ coberto, nenhum inventado, sem ciclos?
- [ ] **T10:** Entrega exige arquivos, REQ, build do projeto final e revisão com prova na bancada?

### Jev (Decisões Estruturadas)
- [ ] O Jev é usado apenas nos pontos `incertos` marcados pela Skill Conferente?
- [ ] As perguntas Jev são do tipo `noul` para desempate de ambiguidade?
- [ ] O estado enviado ao Jev é pequeno e focado (sem Spec inteira)?
- [ ] O custo do Jev é registrado em `LLM_COST`?

---

## 3. Formato do Relatório de Auditoria

Seu relatório deve ser estruturado assim:

```markdown
# Relatório de Auditoria NextCode — [Data]

## Resumo Executivo
- **Status Geral:** [APROVADO / REPROVADO / APROVADO COM RESSALVAS]
- **Gaps Críticos Encontrados:** [Lista numerada]
- **Pontos Fortes:** [Lista numerada]

## Detalhamento por Fase

### Fase 1: Entrada e Elicitação
- **Veredito:** [PASS / FAIL]
- **Evidências:** [Arquivos e linhas conferidas]
- **Problemas:** [Descrição técnica]

### Fase 2: Macrobrief e Conferência
- **Veredito:** [PASS / FAIL]
- ...

[Repetir para todas as fases]

## Conclusão e Recomendações
- O que deve ser corrigido imediatamente?
- O que pode ser otimizado?
- O que está funcionando conforme especificado?
```

---

## 4. Arquivos-Chave para Leitura Prioritária

1. `src/core/orchestrator/phase-machine.ts` — Máquina de estados do fluxo.
2. `src/core/intake/intake-engine.ts` — Classificação de intenção e ciclo Elicitador/Analista.
3. `src/core/skills/spec-decomposer.ts` — Geração de Macrobrief e Microbriefs.
4. `src/core/templates/artifact-templates.ts` — Validação mecânica de Spec, Macrobrief e Contratos.
5. `src/core/orchestrator/node-executor.ts` — Execução de etapas, autoteste e portão empírico.
6. `src/core/governance/dual-lens-auditor.ts` — Avaliação cega com duas lentes.
7. `src/core/governance/final-reviewer.ts` — Revisão final do projeto integrado.
8. `src/core/decision/jev-decisions.ts` — Catálogo de decisões do Jev.
9. `skills/conferente-macrobrief/SKILL.md` — Formato do laudo JSON.
10. `skills/analista/SKILL.md`, `skills/executor-*/SKILL.md`, `skills/avaliador-*/SKILL.md` — Definição dos papéis.

---

## 5. Critério de Aprovação Final

O sistema é considerado **APROVADO** se:
1. Todos os artefatos (Spec, Macrobrief, Contratos, Microbriefs, Código) são gerados e validados mecanicamente.
2. Os contratos TypeScript são gravados, travados e conferidos pelo `tsc`.
3. As duas lentes (cega + mecânica) operam independentemente.
4. A bancada de testes roda em ambiente isolado sem rede.
5. Nenhuma travas (T1–T10) está desligada ou burlada.
6. O Jev é usado apenas nos pontos de incerteza, não para varredura completa.

**Boa auditoria!**