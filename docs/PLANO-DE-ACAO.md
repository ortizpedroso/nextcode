> **Referência atual:** [`NEXTCODE-REFERENCIA.md`](NEXTCODE-REFERENCIA.md) (08/10/2026). Este documento é histórico/detalhe; quando divergir, vale a referência.

# Plano de ação — NextCode como harness de skills

> **Fonte única do trabalho a partir de 06/10/2026.** Substitui as listas M1–M6 e R1–R7.
> Um item por vez; só se começa o próximo quando o anterior está **pronto** (definição abaixo).

## O modelo (decisão do fundador, D5)

O NextCode é **um harness**: máquina de fases, fila, ferramentas, quarentena, compilação, trilha,
roteamento de modelos. Os **papéis são skills** — arquivos que o harness carrega e executa, como os
agentes do opencode (`.opencode/agent/*.md`: frontmatter com `model`, `tools`, `permission`, `steps`
+ instruções) e as skills (`SKILL.md`: conhecimento carregado sob demanda).

| Papel (skill) | Faz | Entra | Sai (template) |
|---|---|---|---|
| `elicitador` | Triagem, perguntas, pesquisa oficial, escreve a Spec e o Macrobrief | conversa | Spec (com `REQ`), Macrobrief |
| `analista` | Confere Spec × Macrobrief (até 3 ciclos) e divide em Microbriefs por cluster | Spec, Macrobrief | Microbriefs |
| `executor-{core,backend,frontend,integration}` | Implementa um Microbrief, se autotesta, corrige até passar | Microbrief + código das dependências | arquivos + Relatório (template do Microbrief) |
| `avaliador-{core,backend,frontend,integration}` | Lente Cega por `REQ`; Lente 2 contra o relatório | Microbriefs, código, relatório | Veredito por `REQ` |

**Formato de uma skill** (`skills/<nome>/SKILL.md`):

```yaml
---
name: executor-backend
papel: executor
cluster: backend
nivel_modelo: forte          # o roteador/Jev escolhe o provedor dentro do nível
ferramentas: [read_file, list_files, grep, write_file, edit_file, run_check, finish]
permissoes:
  escrever: escopo           # só os arquivos do Microbrief — APLICADO PELO HARNESS
  comandos: [typecheck, test]
passos_max: 25
entrada: microbrief          # template validado antes de chamar
saida: relatorio_executor    # template validado depois
checagens: [compila, escopo, relatorio_bate_com_microbrief]
---
<instruções do papel, regras do cluster, exemplos>
```

**Travas:** a skill **declara**; o harness **aplica**. Uma regra só no texto do prompt é um pedido ao
modelo, não uma trava. Por isso `permissoes` e `checagens` viram código do runtime, e as travas
globais (T1 aprovação, T3 trilha, T4 quarentena + compilação + rollback, T6 3 tentativas) continuam
no harness para todas as skills.

## Itens

| # | Entrega | Pronto quando | Status (data) |
|---|---|---|---|
| **1** | **Fila nunca para**: falta de IA pausa a sessão (`PAUSADA`) sem consumir tentativa, aviso no chat em 1 min, retoma sozinha; supervisor periódico (sessão sem job, job travado, nó preso em `running`) | Teste com gateway falso fora do ar: nenhuma tentativa gasta, sessão volta a `EXECUCAO` e termina | **Parcial (07/10/2026)** — pausa sem IA sem gastar tentativa, aviso no chat e retomada sozinha (`supervisePausedSessions` em `job-worker.ts`, com probe real dos gateways) ligados e provados em `tests/harness/end-to-end-harness-plan.test.ts`. **Falta:** supervisor periódico para sessão sem job, job travado e nó preso em `running` — hoje `recoverOrphanExecutionSessions` só roda na partida do worker e o resgate de nó zumbi só quando a fila da sessão roda. |
| **2** | **Runtime de skills**: carrega `SKILL.md`, monta o prompt, laço com ferramentas (ler, escrever 1 arquivo por chamada, editar trecho, rodar checagem, finalizar), aplica `permissoes`, `passos_max`, valida entrada/saída contra o template, roda `checagens`. O executor atual vira a skill `executor-backend` | P1 (API de tarefas) entregue pela skill, com `tsc` 0 erros | **Concluído (07/10/2026)** — `loadRoleSkill`/`buildSkillSystemPrompt` + laço de ferramentas `runExecutorToolLoop` (`executor-tool-loop.ts`, leitor tolerante `parseExecutorToolAction`) ligado em `executeTaskNode` (`node-executor.ts`, `modo_executor: laco`), aplicando `enforceSkillToolPermission` (`permissoes`, `passos_max`, `SKILL_TOOL_DENIED`), `run_check` (`defaultRunTypecheckInQuarantine` com mutex `withProjectBuildLock` em `empirical-gate.ts`) e validação do relatório (`extractAndValidateExecutorReport`/`validateExecutorReportMechanical`); provado em 19 testes (`executor-tool-loop.test.ts`) e em execução real do P1 (`ENTREGUE`, `tsc` 0 erros, 0 tentativas reprovadas, US\$ 0,0247) e do P2 (`ENTREGUE`, `tsc` 0 erros, `ui-check` ok, 0 tentativas reprovadas, US\$ 0,1146). |
| **3** | **Templates + `REQ` + clusters**: Spec com `REQ-001…`; templates de Macrobrief, Microbrief, Relatório do Executor e Veredito (YAML + Markdown) com validadores mecânicos; cada arquivo com cluster | Validadores com testes; Spec do P1 sai com `REQ` | **Concluído (07/10/2026)** — `buildSpecWriterSystemPrompt`, `checkSpecStructure` e `applyCumulativeSpecGuard` exigem, validam e preservam `REQ-001…`; validadores mecânicos com testes; Spec do P1 gerada pelo chat saiu com `REQ-001..REQ-003` e rodou até `ENTREGUE`. |
| **4** | **Skill `analista`** + Microbriefs por cluster (cada arquivo em exatamente um executor, sem ciclo, todos os `REQ` cobertos — T8b) → DAG paralela por dependência | P1 e P2 divididos pelo analista, conferência T8b verde | **Parcial (07/10/2026)** — divisão em Microbriefs por cluster, DAG paralela e conferência T8b (`validateMacrobriefMechanical`) ligadas em `spec-decomposer.ts` e `execution-trigger.ts` (P1 e P2 divididos e entregues); a divisão ainda é determinística em código, sem chamada de modelo à skill `analista` sobre um Macrobrief. |
| **5** | **Executores por cluster** (`core`, `backend`, `frontend`, `integration`): autoteste, ciclo de correção, Relatório no template do Microbrief (2 reenvios só do relatório; código errado conta nas 3 tentativas) | P2 (CRUD com tela) entregue, relatório bate com o Microbrief | **Concluído (07/10/2026)** — skills `executor-*` ligadas por cluster, bloco `relatorio_executor` extraído, carimbado (`stampHarnessMeasuredFields`) e validado mecanicamente (`validateExecutorReportMechanical`) contra o Microbrief, com até 2 reenvios só do relatório sem consumir tentativa; P1 e P2 entregues. |
| **6** | **Avaliadores por cluster**: Lente Cega por `REQ` (não lê o relatório), Lente 2 contra o relatório, **modelo forte e diferente do executor** | Divergência plantada em teste é pega; P2 aprovado | **Concluído em código; avaliador independente bloqueado por saldo externo (07/10/2026)** — Lente 1 Cega por `REQ` e Lente 2 usando `executorReport` validado (ou `nao_declarado` sem falso positivo) ligadas e provadas em teste e no P1/P2; em execução real, Gemini (HTTP 402) e Claude (HTTP 400 sem saldo) caem para reserva `deepseek-v4-pro` (`independentFromExecutor: false`). |
| **7** | **Skill `elicitador`** completa: triagem (3ª rodada), Spec com `REQ`, **Macrobrief**, ciclo com o analista (3 ciclos — T8a); pesquisa oficial com orçamento (T7) por último | Conversa real → Spec + Macrobrief aprovados pelo analista | **Parcial (07/10/2026)** — triagem no chat e Spec com `REQ` + `checkSpecStructure` ligadas no `/api/chat`; geração de Macrobrief no chat, ciclo T8a (Elicitador × Analista) e pesquisa oficial T7 ainda não estão ligados no `/api/chat`. |
| **8** | **Jev como seletor**: por chamada, decide nível de modelo e se divide a tarefa; roteador escolhe o provedor (FreeLLMAPI, DeepSeek, …) | Medição com e sem Jev: custo, tempo, aprovação na 1ª | **Parcial (07/10/2026)** — Jev (`decideMicrobriefsPlanningBatch` em `execution-trigger.ts`, escalada por tentativa com `resolveExecutorTierForAttempt` em `node-executor.ts`) decidindo `nivelModelo` (`rapido` → FreeLLMAPI, `medio`/`pesado` → DeepSeek) e a divisão de etapas (`node-split.ts`); falta medição comparativa formal com e sem Jev. |
| **9** | **Entrega (T10)**: build do projeto inteiro + todos os `REQ` aprovados para dizer "Entregue" | Gateway do fundador entregue com build ok | **Parcial (07/10/2026)** — trava T10 (`verifyProjectDeliveryT10` estrita + build conferido + verificação de tela em contêiner `ui-check.ts`) ligada antes de `ENTREGUE` e provada no P1 e P2; falta o teste de entrega do projeto Gateway do fundador. |
| **10** | **Jev na execução (grupo A)**: política `jev_execucao` (10.1), diagnóstico de falha `JEV_FAILURE_DIAGNOSIS` + `bloqueio_spec_ambigua` (10.2), verificação de evidência por `REQ` `JEV_EVIDENCE_CHECK` (10.3), guarda de segredos no código `SECRET_GUARD` fail-closed (10.4), no chat `SECRET_GUARD_CHAT` (10.5) e na instalação de skill `SKILL_INSTALL_GUARD` (10.6) | Contrato HTTP 200 sem 422, suíte verde e P1/P2 reais entregues com `tsc` 0 erros | **Concluído (08/10/2026)** — `diagnoseStageFailureWithJev`, `verifyStageEvidenceWithJev` e `checkSkillInstallWithJev` (`jev-execution-checks.ts`) + `checkSecretsInCodeWithJev` e `redactSecretsInChatWithJev` (`secret-guard.ts`) ligados em `node-executor.ts`, `incident-reporter.ts`, `src/app/api/chat/route.ts` e `src/app/api/skills/install-github/route.ts`; provado em contrato real (HTTP 200 nas 4 perguntas), 582 testes (80 arquivos) e execução real do P1 (`ENTREGUE`, `tsc` 0 erros, `LLM_COST` US\$ 0,0394, Jev 7.089 tokens = US\$ 0,0003) e do P2 (`ENTREGUE`, `tsc` 0 erros, `UI_CHECK_PASSED`, `LLM_COST` US\$ 0,1398, Jev 8.902 tokens = US\$ 0,0004). **Em modo sombra aguardando decisão do fundador:** `bloqueio_spec_ambigua: sombra` (`JEV_WOULD_BLOCK_AMBIGUOUS_SPEC`, 0 disparos em P1/P2) e `verificacao_evidencia: sombra` (`JEV_EVIDENCE_CHECK`, 0 divergências em 3 `REQ` do P1 e 4 `REQ` do P2). |
| **Extra** | **Fora da tabela**: teto de custo por sessão (`cost.ts`, `budget-guard.ts`), cadeia de avaliador pago com disjuntor de 10 min (`evaluator-models.ts`), verificação de tela em contêiner Playwright (`ui-check.ts`) e Tailwind v4 na base de projetos com tela | P2 entregue com verificação de tela (`report.json` ok + prints) e custo rastreado em `LLM_COST` | **Concluído (07/10/2026)** — ligado no fluxo real (`session-queue.ts`, `job-queue.ts`, `node-executor.ts`, `evaluator-models.ts`) e provado em execução real do P1 (US\$ 0,0416) e do P2 (US\$ 0,0774, `UI_CHECK_PASSED`, prints com Tailwind v4). |

## Projetos de teste (sempre os mesmos, do menor ao maior)

- **P1** — API de tarefas em memória (Next.js): 1 lib + 2 rotas.
- **P2** — CRUD com tela (backend + frontend): exercita clusters e paralelismo.
- **Gateway** — só no item 9.

## Regras de trabalho

1. **Um item por vez, até o fim**: código + testes automáticos + execução real no P1/P2 + commit.
2. Nada de tópico novo no meio de um item; o que aparecer vira linha nova nesta tabela.
3. Toda afirmação de "funciona" vem com a saída real (teste ou execução), nunca de memória.
4. Dúvida de desenho → consultar opencode, deepseek-harness, FreeLLMAPI antes de inventar.

## Pendências do fundador

- **Avaliador forte e diferente do executor** (item 6): ativar o *billing* do projeto da chave Google
  (hoje no nível gratuito, 20 pedidos/dia) **ou** colocar crédito na API da Anthropic. O executor
  usa DeepSeek (pago, com crédito).
