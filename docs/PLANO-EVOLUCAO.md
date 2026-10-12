# Plano Diretor de Evolução e Otimização do NextCode (PLANO-EVOLUCAO.md)

> **Documento Oficial de Engenharia e Plano de Ação**  
> **Data de Atualização:** 12/10/2026  
> **Status:** Aprovado para Execução Sequencial com Validação Estrita  
> **Premissa Inegociável:** "O que está funcionando não se mexe sem justificativa e aprovação prévia. O Harness decide e trava; o Jev julga e classifica; o LLM escreve código e texto."  
> **Referência Canônica:** [`docs/NEXTCODE-REFERENCIA.md`](NEXTCODE-REFERENCIA.md) e [`docs/PLANO-DE-ACAO.md`](PLANO-DE-ACAO.md)

---

## 1. Contexto e Motivação: Por que este Plano Existe?

Após auditoria brutal do código-fonte e do histórico de testes, foram mapeados os gargalos crônicos que geraram retrabalho recente:

1. **Estouro de Janela de Tokens e Respostas Evasivas:**
   - O chat reenviando todo o histórico acumulado desde o início da sessão + a Spec inteira em duplicidade a cada mensagem, inflando prompts acima de 30.000 tokens e causando truncamento (`finish_reason: length`) ou respostas com comentários evasivos (`// TODO`).
2. **Ciclos Cegos de Tentativas (Gasto desnecessário de T6):**
   - O Jev diagnosticando ambiguidade na Spec ou falta de requisitos, mas atuando em modo "sombra", permitindo que o executor gastasse as 3 tentativas completas com modelos caros antes de finalmente bloquear.
3. **Concorrência entre Interface e Servidor:**
   - O frontend React (`page.tsx`) disparando comandos manuais de criação de DAG e avanço de fila (`create_dag` e `process_queue`), competindo com o worker autônomo do backend (`job-worker.ts`).
4. **Mapeamento Topológico de Arquitetura (Graphify):**
   - Utilização do JEV em 100ms para decidir telemetria arquitetural e acionar o pipeline do Graphify para bases complexas, reduzindo drasticamente o contexto necessário ao executor.

---

## 2. Visão Macro da Arquitetura Alvo

```
[Usuário no Chat]
       │ (Mensagem do usuário)
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. INTAKE & CHAT BLINDADO (Janela Deslizante de Contexto)              │
│    - Histórico enxuto: últimos 6 turnos (economia de ~85% de tokens)   │
│    - Memória Factual da Sessão (Decisões de negócio consolidadas)      │
│    - Jev Fan-Out (100ms): Intenção + Comando + Guardrail               │
│    - Elicitador atômico: focado em preencher requisitos REQ-001...     │
└────────────────────────────────────────────────────────────────────────┘
       │
       ▼ (Spec Gerada)
┌────────────────────────────────────────────────────────────────────────┐
│ 2. PORTÃO DA SPEC CANÔNICA (Validação Mecânica + Jev)                  │
│    - Spec só é habilitada para aprovação se contiver REQ-001 verificável│
│    - Sem aprovação de placeholders ou specs vazias                     │
│    - Botão de aprovação reflete estado real do banco de dados          │
└────────────────────────────────────────────────────────────────────────┘
       │
       ▼ (Aprovação Explícita T1)
┌────────────────────────────────────────────────────────────────────────┐
│ 3. ANALISTA & MACROBRIEF (Decomposição Estrita)                        │
│    - Skill Analista particiona em Microbriefs por cluster              │
│    - Validador mecânico T8b garante: 1 arquivo = 1 executor, 0 ciclos   │
│    - Trava T-SPEC-SHIELD: executor só recebe seu Microbrief            │
└────────────────────────────────────────────────────────────────────────┘
       │
       ▼ (Fila de Tarefas)
┌────────────────────────────────────────────────────────────────────────┐
│ 4. EXECUÇÃO DETERMINÍSTICA & GOVERNANÇA ATIVA                          │
│    - UI 100% Passiva: backend (job-worker) é o único condutor da fila  │
│    - Jev com Bloqueio de Spec Ambígua ATIVO na 2ª tentativa            │
│    - Jev aciona Graphify para extração cirúrgica de dependências       │
│    - Papéis críticos rodam apenas em modelos pagos consolidados        │
│    - Quarentena mecânica + Portão Empírico (tsc --noEmit)              │
└────────────────────────────────────────────────────────────────────────┘
       │
       ▼ (Conclusão)
┌────────────────────────────────────────────────────────────────────────┐
│ 5. PORTÃO FINAL T10: Entrega Auditada com Sucesso                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Matriz de Entregas do Plano de Ação

| Fase | Pacote | O que será feito | Critério de Aceite / Prova | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Fase 1** | **E1: Janela Deslizante no Chat (Solução do Estouro de Tokens)** | Limitar o histórico injetado em `/api/chat` aos últimos 6 turnos de conversa. Injetar a `canonicalSpec` como artefato de referência único. | Prompts do chat limitados. Teste de estresse com 25 mensagens passando (`chat-sliding-window-stress.test.ts`). | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 2** | **E2: Blindagem do Botão de Aprovação e Validação Prévia da Spec** | O botão de aprovação e a Trava T1 só são liberados se a Spec possuir ao menos 1 requisito formal `REQ-001...` e passar na validação mecânica. | Teste com specs vazias e inválidas rejeitadas deterministamente (`spec-t1-approval-guard.test.ts`). | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 3** | **E3: Ativação Definitiva das Guardas Jev (Fim do Modo Sombra)** | `bloqueio_spec_ambigua: "ativo"`. Se o Jev diagnosticar `ambiguous_spec` com confiança $\ge 0.80$, encerra o nó imediatamente no 2º retry sem queimar a 3ª tentativa. | Suíte de decisão com 44 testes verdes provando bloqueio ativo sem queima de modelos caros. | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 4** | **E4: Telemetria JEV para Ativação do Graphify** | Decisão rápida de 100ms do JEV (`M6`) acionando o Graphify quando a tarefa exigir mapeamento estrutural e o projeto não possuir grafo. | 5 testes de decisão (`jev-graphify-telemetry.test.ts`) e 2 de integração com chat (`chat-graphify-integration.test.ts`) 100% verdes. | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 5** | **E5: Passivação Completa da Interface (Eliminação de Concorrência)** | Removidos os disparos concorrentes de `create_dag` e `process_queue` do componente React `page.tsx`. A UI apenas envia a intenção de aprovação; o backend orquestra via job. A UI apenas escuta o estado. | Fila orquestrada estritamente no backend. Polling reativo a cada 2,5s. Zero nós duplicados. 111 testes passando. | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 6** | **E6: Prova de Fogo de Ponta a Ponta (Benchmark Gateway Real)** | Executar o fluxo completo desde a Spec até o código compilado com testes de aceite herméticos via script de benchmark oficial. | **10/10 testes de aceite aprovados** (100%), `tsc` com 0 erros, custo total de US$ 0.0180 (Relatório: `docs/relatorios/bench/2026-10-12-1240.md`). | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 7** | **E7: Skill de Memória Persistente de Projeto (`project-memory` - L2)** | Criação da skill canônica `skills/project-memory/SKILL.md`, persistência factual em `.nextcode/MEMORY.md` com teto de 50 linhas, consolidação automática ao aprovar specs e injeção transparente no `<project_context>`. | Suíte de 9 testes de estresse e concorrência (`tests/memory/project-memory.test.ts`), orçamento de tokens < 350 tokens, integração E2E com `approveSpecAndStart`. | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 8** | **E8: Benchmark Real do P2 (Homologação da Esteira Visual)** | Orquestração do projeto P2 (CRUD de Tarefas com Tela) do zero com aceite hermético em Docker sem rede e validação Playwright. | **13/13 testes de aceite aprovados** (100%), `UI_CHECK_PASSED`, `tsc` 0 erros, custo total US$ 0.1188 (Relatório: `docs/relatorios/bench/2026-10-12-1435.md`). | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 9** | **E9: Fan-Out Unificado do Jev no Chat (Pacote P4)** | Unificar as requisições HTTP dispersas do chat em uma única pergunta-lote de ~100ms (intenção, aprovação sem condições, guardrail de entrada, grafo e perfil do usuário), reduzindo a latência acumulada no chat de ~600ms para ~100ms. | Suíte `tests/decision/jev-chat-fanout.test.ts` (7/7 verdes), bancada total com 141 testes verdes (28 arquivos), `tsc` 0 erros e fallback determinístico local < 10ms. | **CONCLUÍDO E HOMOLOGADO** |
| **Fase 10** | **E10: Telemetria de Custos em Tempo Real na UI (Pacote P5)** | Exibir na interface visual da DAG barra de progresso proporcional à Trava T9, chips de custos por papel (Exec, Eval, Jev) e custo em tempo real por nó individual com precisão de 4 casas decimais. | Suíte `tests/governance/session-cost-breakdown.test.ts` (5/5 verdes), bancada com 73 testes de governança verdes, `tsc` 0 erros e respeito à Trava T3 (append-only). | **CONCLUÍDO E HOMOLOGADO** |

---

## 4. O Que Fica Proibido Neste Plano (Linhas Vermelhas)

1. **PROIBIDO mexer na Quarentena ou no Portão Empírico (`empirical-gate.ts`):** O que está funcionando e garantindo que código quebrado não entre em produção permanece 100% intocado.
2. **PROIBIDO usar modelos gratuitos em papéis executores ou avaliadores críticos:** Papel crítico exige estabilidade de contrato e tipagem estrita. Faltando modelo pago, a sessão pausa graciosamente (`PAUSADA`).
3. **PROIBIDO alterar código sem teste pesado prévio e posterior:** Cada pacote deve compilar com `tsc --noEmit` 0 erros e passar em suíte de testes unitários e de integração antes de ser considerado concluído.

---

## 5. Ordem de Execução Sequencial

1. Iniciar imediatamente pelo **Pacote E1 (Janela Deslizante no Chat)**.
2. Apresentar os resultados, o diff e os testes para homologação antes de tocar no Pacote E2.
