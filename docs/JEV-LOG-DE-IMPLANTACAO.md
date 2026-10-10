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
