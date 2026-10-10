# Log de Implantação e Validação do JEV (TypeSafe AI) no NextCode

Documento físico oficial de registro de todas as alterações, implementações, ativações de governança e validações por testes automatizados do JEV no ecossistema NextCode.

---

## 1. Visão Geral e Princípios
- **Zero Invenção de Habilidades:** Todo comportamento, limiar ou integração deve ser respaldado pelas capacidades e saídas nativas do JEV e pelas políticas de governança do NextCode.
- **Validação Rigorosa:** Nenhuma alteração é promovida sem cobertura de testes automatizados (`vitest`) e tipagem estrita (`tsc --noEmit`).
- **Rastreabilidade e Custo:** Cada chamada ao JEV ou aos modelos de execução é mensurada em tokens, milissegundos e fração de USD.

---

## 2. Histórico de Implementações e Commits

### [Pacote S1 / Fase 1] Otimização de Avaliadores e Rastreamento de Custos
- **Commit `4447198`**: `feat(custo): S1.1 - custo por etapa (nodeId) na trilha e no bench`
  - Métricas de custo por etapa e nó na execução e relatórios de benchmark.
- **Commit `2e91335`**: `feat(skills): S1.2 - respostas do Jev decidem referencias do avaliador de tela`
  - Injeção dinâmica de referências para avaliação de interface guiada pelo JEV.
- **Commit `60e81f0`**: `refactor(skills): S1.3 - avaliadores sem promessas falsas e sem regras duplicadas`
  - Avaliador de frontend reduzido de 60.576 para 36.554 caracteres em dashboard ($\le 40.000$, redução de 39,7%).
  - Avaliadores zero-tool (`ferramentas: []`) para evitar alucinações de chamadas de ferramentas.
- **Commit `0afa285`**: `docs(bench): rodada S1`
  - Benchmark executado em contêiner Docker `nextcode-aceite:1` (16 execuções, P1 a P4, 100% ENTREGUE, custo acumulado US$ 0,9648).

### [Fase 2] Decisão de Intenção de Mensagens no Chat
- **Commit `c8ec38e`**: `feat(intake): integracao da decisao de intencao do JEV no chat com fallback seguro`
  - Interceptação de mensagens de aprovação/ajuste durante fases pré-execução (`SPEC_REVISAO`, `ELICITACAO`, etc.).
  - Integração com `decideSpecReviewMessageIntent` do JEV.
  - Reconhecimento de intenções naturais de aprovação e bloqueio de aprovações prematuras caso haja ressalvas ou pedidos de alteração.
  - Fallback determinístico caso o serviço JEV esteja indisponível ou retorne erro.
  - Cobertura com testes unitários e de integração (`tests/intake/chat-jev-intent.test.ts`) com isolamento estrito de dados no banco SQLite.

---

## 3. Fase 3: Ativação das Guardas de Execução na Governança

### 3.1 Guarda de Bloqueio por Spec Ambígua (`bloqueio_spec_ambigua`)
- **Status:** Ativado (`ativo`) na política de orquestração (`config/politicas-orquestracao.yaml` e `src/core/config/orchestration-policy.ts`).
- **Comportamento Operacional:**
  - Se um nó falha a 1ª tentativa e, na 2ª tentativa, a auditoria rejeita e o diagnóstico do JEV aponta `ambiguous_spec` com confiança $\ge 0.80$:
    - O nó não gasta a 3ª tentativa às cegas.
    - O status é imediatamente transitado para `blocked`.
    - Uma mensagem explicativa de incidente é postada no chat da sessão detalhando que a causa raiz é ambiguidade na especificação.
    - Dispara telemetria estruturada `JEV_WOULD_BLOCK_AMBIGUOUS_SPEC` com modo `"ativo"`.
- **Testes Validados:**
  - `tests/harness/orchestration-policy-and-skills.test.ts`: valida o carregamento de `bloqueioSpecAmbigua: "ativo"` a partir do YAML e padrões (12 testes passando).
  - `tests/decision/jev-failure-diagnosis.test.ts`: valida tanto o modo `"sombra"` (registro apenas sem bloqueio) quanto o modo `"ativo"` (bloqueio efetivo, sem incremento cego de attempts e aviso no chat) (5 testes passando).
  - `tests/intake/chat-jev-intent.test.ts`: validação contínua da intenção do chat sem regressão (3 testes passando).
  - Tipagem estrita: `tsc --noEmit` verificado com 0 erros.

### 3.2 Guarda de Verificação de Evidência (`verificacao_evidencia`)
- **Status Atual:** Em modo `sombra`.
- **Objetivo Próximo:** Avaliar amostras em modo sombra da verificação de evidência pelo JEV antes de promover para `ativo`.

---

## 4. Governança da DAG: Isolamento Estrito do Executor e Macrobrief

### 4.1 Trava Mecânica T-SPEC-SHIELD (Executor NUNCA Recebe Spec)
- **Princípio:** O executor implementa etapas atômicas e não deve carregar a Spec inteira em sua janela de contexto.
- **Implementação em `src/core/orchestrator/node-executor.ts`:**
  - Suprimida a injeção do bloco bruto `SPEC CANÔNICA APROVADA` quando o nó possuir `nodeMicrobrief`.
  - O executor recebe exclusivamente o Microbrief renderizado em Markdown + YAML com seus `REQ`s atômicos e o código compilado das dependências.
  - Criada a função guardiã `enforceExecutorSpecIsolation()`: se qualquer vazamento tentar reinserir a Spec completa para papéis executores, o bloco é cortado fail-closed e dispara telemetria `EXECUTOR_SPEC_LEAK_BLOCKED`.
- **Validação Automatizada:**
  - `tests/orchestrator/executor-spec-shield.test.ts`: 3/3 testes verdes comprovando bloqueio de vazamento, integridade para papéis limpos e preservação para papéis de auditoria.

### 4.2 Padronização do Macrobrief em Markdown + YAML
- **Implementação em `src/core/templates/artifact-templates.ts`:**
  - Criada a função `renderMacrobriefMarkdown(macrobrief: MacrobriefDocument): string`.
  - Gera frontmatter YAML formal com metadados do projeto, clusters, requisitos totais e partições dos Microbriefs, seguido de corpo Markdown com arquitetura e contratos TypeScript.
- **Validação Automatizada:**
  - `tests/templates/macrobrief-markdown.test.ts`: 1/1 teste verde validando estrutura e renderização.

### 4.3 Independência de Família do Avaliador (Claude Prioritário)
- **Princípio:** Quem executa (DeepSeek) NUNCA pode avaliar a si mesmo.
- **Implementação em `src/core/llm/evaluator-models.ts` e `src/core/orchestrator/node-executor.ts`:**
  - `dispatchStrongEvaluator` agora suporta `preferIndependentFirst: true`.
  - Quando o executor roda no DeepSeek, os modelos de famílias independentes (`nvidia/nemotron-3-ultra` e `claude/claude-sonnet-4-5`) são avaliados prioritariamente antes de qualquer tentativa da mesma família.
  - Com o saldo ativo no Claude, o avaliador obtém independência de julgamento e cumpre a Trava T4/T5.
- **Validação Automatizada:**
  - `tests/llm/evaluator-freellmapi.test.ts`: 8/8 testes verdes, incluindo novo teste comprovando que com `preferIndependentFirst: true`, Claude é consultado antes de DeepSeek quando Nemotron estiver indisponível.
  - `tests/harness/evaluator-and-tier.test.ts`: 7/7 testes verdes.

### 4.4 Conferência Macrobrief × Spec com Bateria Fan-Out do JEV (Travas T8a / T8b)
- **Princípio:** O Macrobrief precisa espelhar com precisão cirúrgica a Spec canônica aprovada. Para garantir isso com tolerância zero a falhas, o oráculo avaliador não é um analista LLM em prosa genérica, mas o JEV executando uma bateria Fan-Out de 6 perguntas estratégicas.
- **Bateria Fan-Out de 6 Perguntas (`src/core/decision/jev-execution-checks.ts`):**
  1. `cobertura_requisitos` (Noul, limiar $\ge 0.85$): valida que cada `REQ` funcional e critério de aceite da Spec foi mapeado em pelo menos uma etapa do Macrobrief.
  2. `fidelidade_sem_contradicao` (Noul, limiar $\ge 0.85$): valida que a stack, contratos e regras de negócio da Spec não foram alterados ou contraditos.
  3. `sem_escopo_inventado` (Noul, limiar $\ge 0.80$): valida que o Macrobrief não introduziu módulos, integrações ou complexidades inexistentes na Spec.
  4. `suficiencia_arquivos` (Noul, limiar $\ge 0.80$): valida se os caminhos de arquivos declarados são suficientes para compilar e implementar os contratos.
  5. `ordem_dependencias_valida` (Noul, limiar $\ge 0.80$): valida se as dependências DAG estão ordenadas topologicamente (base/modelos antes de consumidores).
  6. `isolamento_seguranca` (Noul, limiar $\ge 0.80$): valida que segredos, regras de backend e lógica privada não foram expostos em arquivos de cliente/frontend.
- **Integração na Máquina de Fases (`src/core/intake/intake-engine.ts`):**
  - Executada no método `runElicitadorAndAnalistaCycle` antes de conceder `CONFERENCIA_OK`.
  - Se aprovado, transiciona para `PLANEJAMENTO` com `voltasConferencia = 0`.
  - Se reprovado, gera apontamentos cirúrgicos com os scores correspondentes, emite `CONFERENCIA_FALHOU` com culpa `"macrobrief"` e repassa ao Elicitador via `onRepairCycle`.
  - Tolerância máxima de 3 ciclos de reparo. Na 4ª falha (`novasVoltas > 3`), transiciona a sessão para `BLOQUEADA` e emite o efeito `{ type: "AVISAR_HUMANO" }`.
  - Se a infraestrutura do JEV estiver temporariamente indisponível, aciona fallback gracioso emitindo telemetria `JEV_MACROBRIEF_CONFERENCE` com `jevDisponivel: false`.
- **Validação Automatizada:**
  - `tests/decision/jev-macrobrief-conference.test.ts`: 5/5 testes verdes cobrindo aprovação plena, reprovação por omissão/escopo, inversão de dependência/segurança e fallback sem JEV.
  - `tests/intake/jev-intake-conference.test.ts`: 2/2 testes verdes comprovando transição para `PLANEJAMENTO` quando aprovado e ciclo de 3 reparos com bloqueio e notificação humana na 4ª volta.
  - `tests/intake/jev-macrobrief-stress.test.ts`: 2/2 testes pesados de estresse com SaaS multi-tenant completo (4 módulos, 4 arquivos, regras e entidades).
  - Suíte completa de governança e intake (192 testes) passando com 100% de sucesso.

### 4.5 Portão Final de Entrega: JEV Audita Spec Canônica × Código Real no Disco (Trava T10)
- **Princípio:** Não basta verificar se arquivos existem ou se os nós individuais disseram que passaram. O produto consolidado no disco precisa provar matematicamente que atende ao contrato original da Spec Canônica aprovada.
- **Bateria Fan-Out de 6 Perguntas de Entrega (`src/core/decision/jev-execution-checks.ts`):**
  1. `requisitos_integralmente_implementados` (Noul, limiar $\ge 0.85$): valida que cada `REQ-001...` da Spec possui código real, substantivo e verificável no disco.
  2. `fidelidade_regras_negocio` (Noul, limiar $\ge 0.85$): valida que as regras de negócio, fluxos e validações da Spec foram estritamente honradas.
  3. `ausencia_stubs_e_placeholders` (Noul, limiar $\ge 0.85$): valida a ausência de funções vazias, TODOs, stubs falsos ou mocks decorativos.
  4. `aderencia_stack_e_contratos` (Noul, limiar $\ge 0.80$): valida a conformidade de assinaturas TypeScript, interfaces e bibliotecas da stack declarada.
  5. `isolamento_seguranca_e_segredos` (Noul, limiar $\ge 0.80$): valida que nenhuma credencial, chave ou lógica privada de servidor foi exposta no cliente.
  6. `integracao_e_consistencia_entre_arquivos` (Noul, limiar $\ge 0.80$): valida se todos os módulos conversam entre si sem rotas desconectadas ou imports órfãos.
- **Integração no Portão de Entrega (`src/core/orchestrator/job-queue.ts` e `node-executor.ts`):**
  - Quando a fila de tarefas conclui com sucesso (`allCompleted: true`), lê o código real dos arquivos via `readProjectFilesContent` e aciona `verifyProjectDeliveryWithJev`.
  - Se aprovado: emite telemetria `JEV_FINAL_DELIVERY_AUDIT` e transiciona com `VERIFICACAO_OK` para `ENTREGUE`.
  - Se reprovado: gera o `Laudo de Auditoria de Entrega` formal em Markdown + YAML, emite `VERIFICACAO_COM_LACUNAS` e grava mensagem com o laudo para o Analista.

### 4.6 Tratamento de Reprovação com Laudo Imutável e Microbrief de Reparo em Markdown + YAML
- **Princípio:** O brief anterior NUNCA é alterado ou sobrescrito. O histórico é preservado como fato consumado.
- **Formulação pelo Analista:** O Analista recebe o Laudo de Auditoria do JEV e formula um **Microbrief de Reparo** específico (`renderMicrobriefReparoMarkdown` em `src/core/templates/artifact-templates.ts`).
- **Isolamento Estrito:** O Executor recebe **exclusivamente o Microbrief de Reparo** com `files_scope` restrito apenas aos arquivos e funções onde a lacuna foi detectada, sem vazamento da Spec inteira (Trava T-SPEC-SHIELD preservada).
- **Validação Automatizada:**
  - `tests/decision/jev-final-delivery-audit.test.ts`: 5/5 testes verdes validando bateria de perguntas, aprovação, reprovação e renderização do Laudo e do Microbrief de Reparo em Markdown + YAML.
  - `tests/orchestrator/jev-delivery-gate.test.ts`: 2/2 testes verdes comprovando aprovação para `ENTREGUE` e reprovação para `PLANEJAMENTO` com Laudo formal.




