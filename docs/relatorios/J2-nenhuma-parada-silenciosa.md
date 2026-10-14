# Relatório da Tarefa J2 — Nenhuma Parada Silenciosa e Auditoria do Jev em Modo Sombra

## 0. Leitura Feita (Resumo em 6 linhas)
1. **Passo J2.1:** Cria o interruptor `auditoria_entrega` na política (`sombra` por padrão, `ativo` e `desligado`), rodando o Jev em sombra sem reprovar nem poluir o chat com falsos laudos.
2. **Passo J2.2:** Centraliza os avisos de parada no chat via `postHumanNotice` em `applyPhaseEvent` para o efeito `AVISAR_HUMANO`, evitando avisos duplicados quando quem já avisa passa `avisoJaPostado: true`.
3. **Passo J2.3:** Altera a transição de `VERIFICACAO_COM_LACUNAS` para `BLOQUEADA` com relatório das lacunas no chat, em vez de retornar calada para `PLANEJAMENTO`.
4. **Passo J2.4:** Cria o evento `FALHA_REPETIDA` e bloqueia a sessão com aviso e segredos sanitizados caso um job falhe 3 vezes seguidas em `EXECUCAO` ou 1 vez em `VERIFICACAO`.
5. **Passo J2.5:** Adiciona vigia de pausa prolongada (> 5 min sem gateway LLM) que repete o aviso no chat a cada sessão pausada para que o humano não fique sem resposta.
6. **Passo J2.6:** Adiciona o vigia de silêncio para sessões em `PLANEJAMENTO`, `EXECUCAO` e `VERIFICACAO` sem jobs ou nós em andamento há mais de 5 minutos, bloqueando e avisando no chat.

---

## 1. Identificação
- **Commit de Partida:** `b612596` (Tarefa D1b concluída)
- **Histórico de Commits (`git log --oneline b612596..HEAD`):**
```text
3cbcde1 feat(orquestracao): J2.6 - vigia de silencio bloqueia e avisa sessoes paradas
acf3a89 feat(orquestracao): J2.5 - aviso de pausa longa apos 5 minutos
8ece017 feat(orquestracao): J2.4 - erro repetido no job bloqueia a sessao e avisa
db34802 feat(orquestracao): J2.3 - entrega reprovada bloqueia e avisa com as lacunas
9a90425 feat(orquestracao): J2.2 - aviso ao humano centralizado em applyPhaseEvent
b7a21e2 feat(entrega): J2.1 - auditoria final do Jev com interruptor, padrao sombra
```

---

## 2. Execução por Commit

### Commit J2.1 (`b7a21e2`)
- **Mensagem:** `feat(entrega): J2.1 - auditoria final do Jev com interruptor, padrao sombra`
- **`git show --stat --oneline b7a21e2`:**
```text
b7a21e2 feat(entrega): J2.1 - auditoria final do Jev com interruptor, padrao sombra
 config/politicas-orquestracao.yaml                 |   1 +
 src/core/config/orchestration-policy.ts            |  11 ++
 src/core/orchestrator/job-queue.ts                 |  62 +++++---
 tests/harness/orchestration-policy-and-skills.test.ts |   4 +
 tests/orchestrator/jev-delivery-gate.test.ts       | 166 ++++++++++++++++++++-
 5 files changed, 214 insertions(+), 30 deletions(-)
```
- **`npx tsc --noEmit`:** 0 erros (código de saída 0).
- **`npx vitest run`:** 115 arquivos, 752 testes passados (100% verde).

### Commit J2.2 (`9a90425`)
- **Mensagem:** `feat(orquestracao): J2.2 - aviso ao humano centralizado em applyPhaseEvent`
- **`git show --stat --oneline 9a90425`:**
```text
9a90425 feat(orquestracao): J2.2 - aviso ao humano centralizado em applyPhaseEvent
 src/core/orchestrator/budget-guard.ts            |   2 +-
 src/core/orchestrator/human-notice.ts            |  35 +++++
 src/core/orchestrator/job-queue.ts               |   2 +-
 src/core/orchestrator/session-phase.ts           |  12 ++
 tests/orchestrator/sem-parada-silenciosa.test.ts | 176 +++++++++++++++++++++++
 5 files changed, 225 insertions(+), 2 deletions(-)
```
- **`npx tsc --noEmit`:** 0 erros (código de saída 0).
- **`npx vitest run`:** 116 arquivos, 755 testes passados (100% verde).

### Commit J2.3 (`db34802`)
- **Mensagem:** `feat(orquestracao): J2.3 - entrega reprovada bloqueia e avisa com as lacunas`
- **`git show --stat --oneline db34802`:**
```text
db34802 feat(orquestracao): J2.3 - entrega reprovada bloqueia e avisa com as lacunas
 docs/ARQUITETURA-ORQUESTRACAO.md                 |  2 +-
 src/core/orchestrator/job-queue.ts               |  9 ++-
 src/core/orchestrator/phase-machine.ts           |  4 +-
 tests/harness/end-to-end-harness-plan.test.ts    |  2 +-
 tests/orchestrator/jev-delivery-gate.test.ts     |  2 +-
 tests/orchestrator/sem-parada-silenciosa.test.ts | 71 +++++++++++++++++++++++-
 6 files changed, 83 insertions(+), 7 deletions(-)
```
- **`npx tsc --noEmit`:** 0 erros (código de saída 0).
- **`npx vitest run`:** 116 arquivos, 756 testes passados (100% verde).

### Commit J2.4 (`8ece017`)
- **Mensagem:** `feat(orquestracao): J2.4 - erro repetido no job bloqueia a sessao e avisa`
- **`git show --stat --oneline 8ece017`:**
```text
8ece017 feat(orquestracao): J2.4 - erro repetido no job bloqueia a sessao e avisa
 src/core/orchestrator/job-queue.ts               | 53 +++++++++++++++
 src/core/orchestrator/phase-machine.ts           | 19 +++++-
 tests/orchestrator/phase-machine.test.ts         |  2 +
 tests/orchestrator/sem-parada-silenciosa.test.ts | 84 +++++++++++++++++++++++-
 4 files changed, 155 insertions(+), 3 deletions(-)
```
- **`npx tsc --noEmit`:** 0 erros (código de saída 0).
- **`npx vitest run`:** 116 arquivos, 758 testes passados (100% verde).

### Commit J2.5 (`acf3a89`)
- **Mensagem:** `feat(orquestracao): J2.5 - aviso de pausa longa apos 5 minutos`
- **`git show --stat --oneline acf3a89`:**
```text
acf3a89 feat(orquestracao): J2.5 - aviso de pausa longa apos 5 minutos
 src/core/orchestrator/job-worker.ts              | 53 +++++++++++++++++++++++-
 tests/orchestrator/sem-parada-silenciosa.test.ts | 44 ++++++++++++++++++++
 2 files changed, 96 insertions(+), 1 deletion(-)
```
- **`npx tsc --noEmit`:** 0 erros (código de saída 0).
- **`npx vitest run`:** 116 arquivos, 759 testes passados (100% verde).

### Commit J2.6 (`3cbcde1`)
- **Mensagem:** `feat(orquestracao): J2.6 - vigia de silencio bloqueia e avisa sessoes paradas`
- **`git show --stat --oneline 3cbcde1`:**
```text
3cbcde1 feat(orquestracao): J2.6 - vigia de silencio bloqueia e avisa sessoes paradas
 src/core/orchestrator/job-worker.ts              | 104 +++++++++++++++++++++++
 src/core/orchestrator/phase-machine.ts           |  28 +++++-
 tests/orchestrator/phase-machine.test.ts         |   2 +
 tests/orchestrator/sem-parada-silenciosa.test.ts | 101 +++++++++++++++++++++-
 4 files changed, 231 insertions(+), 4 deletions(-)
```
- **`npx tsc --noEmit`:** 0 erros (código de saída 0).
- **`npx vitest run`:** 116 arquivos, 760 testes passados (100% verde).

---

## 3. Detalhamento por Passo (`arquivo:linha`)

### Passo J2.1
- `config/politicas-orquestracao.yaml:26`: adicionado `auditoria_entrega: sombra`.
- `src/core/config/orchestration-policy.ts:51`: adicionado campo `auditoriaEntrega: "ativo" | "sombra" | "desligado"` na interface `jevExecucao`.
- `src/core/config/orchestration-policy.ts:109`: adicionado padrão `auditoriaEntrega: "sombra"` em `DEFAULT_ORCHESTRATION_POLICY`.
- `src/core/config/orchestration-policy.ts:401`: parser de `auditoria_entrega` lendo `"ativo" | "sombra" | "desligado"` com fallback para `"sombra"`.
- `src/core/orchestrator/job-queue.ts:327-376`: leitura da política `auditoriaEntrega`. Modo `desligado` ignora auditoria; modo `sombra` emite telemetria `JEV_FINAL_DELIVERY_AUDIT_SOMBRA` sem alterar `deliveryT10` e sem poluir chat com falso laudo; modo `ativo` preserva reprovação com laudo em Markdown + YAML.
- `tests/harness/orchestration-policy-and-skills.test.ts:51,75,113`: expectativas atualizadas com `auditoriaEntrega`.
- `tests/orchestrator/jev-delivery-gate.test.ts:125-260`: testes de modo sombra, modo ativo e modo desligado.

### Passo J2.2
- `src/core/orchestrator/human-notice.ts:1-35`: criação da função centralizada `postHumanNotice` com mensagem amigável no chat (papel `assistant`, emoji 🛑) e telemetria `HUMAN_NOTIFIED`.
- `src/core/orchestrator/session-phase.ts:70-73`: acréscimo de `avisoJaPostado?: boolean` e `detalheAviso?: string` em `ApplyPhaseEventOptions`.
- `src/core/orchestrator/session-phase.ts:178-182`: despacho automático de `postHumanNotice` para efeitos `AVISAR_HUMANO` quando `avisoJaPostado !== true`.
- `src/core/orchestrator/job-queue.ts:295`: `applyPhaseEvent(job.sessionId, { type: "EXECUTOR_BLOQUEADO" }, { avisoJaPostado: true })`.
- `src/core/orchestrator/budget-guard.ts:81`: `applyPhaseEvent(sessionId, { type: "TETO_CUSTO" }, { avisoJaPostado: true })`.
- `tests/orchestrator/sem-parada-silenciosa.test.ts:1-180`: criação do arquivo de teste com asserção estrutural (toda ida a `BLOQUEADA` a partir de fase não-bloqueada emite `AVISAR_HUMANO`) e testes de idempotência de aviso.

### Passo J2.3
- `src/core/orchestrator/phase-machine.ts:542`: na fase `VERIFICACAO`, o evento `VERIFICACAO_COM_LACUNAS` passa a transicionar para `BLOQUEADA` (`faseAntesDoBloqueio: 'EXECUCAO'`) com efeito `AVISAR_HUMANO` (motivo: `entrega reprovada na verificação final`).
- `src/core/orchestrator/job-queue.ts:405`: `applyPhaseEvent` de `VERIFICACAO_COM_LACUNAS` agora passa `detalheAviso` com as lacunas formatadas da T10.
- `docs/ARQUITETURA-ORQUESTRACAO.md:95`: transição Mermaid atualizada para `VERIFICACAO --> BLOQUEADA: lacuna na T10 — avisa o humano (J2, 13/10); reparo automático no J2b`.
- `tests/orchestrator/jev-delivery-gate.test.ts:286`: expectativa de fase em reprovação ativa atualizada para `BLOQUEADA`.
- `tests/orchestrator/sem-parada-silenciosa.test.ts:182-249`: teste end-to-end de T10 reprovada bloqueando a sessão com relatório de lacunas e desbloqueio retornando para `EXECUCAO`.
- `tests/harness/end-to-end-harness-plan.test.ts:139`: `expectedPhase` de teste de verificação de tela reprovada atualizada para `BLOQUEADA` (autorizado pelo fundador).

### Passo J2.4
- `src/core/orchestrator/phase-machine.ts:54`: adicionado evento `| { type: 'FALHA_REPETIDA' }` a `PhaseEvent`.
- `src/core/orchestrator/phase-machine.ts:420,556`: adicionado `'FALHA_REPETIDA'` em `allowedEvents` de `EXECUCAO` e `VERIFICACAO`, devolvendo `BLOQUEADA` com efeito `AVISAR_HUMANO`.
- `src/core/orchestrator/job-queue.ts:451-460`: chamada no `catch` de `executeClaimedJob` chamando `handleJobFailureForSession`.
- `src/core/orchestrator/job-queue.ts:463-507`: implementação da função `handleJobFailureForSession` checando 3 jobs seguidos com falha em `EXECUCAO` ou 1 falha em `VERIFICACAO`, com sanitização de segredos de alta entropia via `isHighEntropySecretLiteral`.
- `tests/orchestrator/phase-machine.test.ts:589,686`: inclusão de `FALHA_REPETIDA` em `allowedEvents` e `SAMPLE_EVENTS`.
- `tests/orchestrator/sem-parada-silenciosa.test.ts:98,252-328`: inclusão em `STRUCTURAL_TEST_EVENTS` e testes de 3 jobs seguidos com falha, bloqueio em `VERIFICACAO` e preservação de `ELICITACAO`.

### Passo J2.5
- `src/core/orchestrator/job-worker.ts:50`: constante exportada `LONG_PAUSE_NOTICE_MS = 300_000`.
- `src/core/orchestrator/job-worker.ts:57`: parâmetro `now: Date = new Date()` adicionado a `supervisePausedSessions`.
- `src/core/orchestrator/job-worker.ts:74-121`: quando `reachable` for falso, busca o log `PHASE_TRANSITION` para `PAUSADA`; se decorridos ≥ 5 minutos e não houver aviso no chat, grava mensagem de pausa longa sem duplicar.
- `tests/orchestrator/sem-parada-silenciosa.test.ts:329-373`: teste de aviso de pausa longa após 5 minutos, garantindo não duplicação e não postagem antes do prazo.

### Passo J2.6
- `src/core/orchestrator/phase-machine.ts:55`: adicionado evento `| { type: 'SILENCIO_DETECTADO' }` a `PhaseEvent`.
- `src/core/orchestrator/phase-machine.ts:397,422,556`: adicionado `'SILENCIO_DETECTADO'` em `allowedEvents` de `PLANEJAMENTO`, `EXECUCAO` e `VERIFICACAO`, transicionando para `BLOQUEADA` com efeito `AVISAR_HUMANO`.
- `src/core/orchestrator/job-worker.ts:270-372`: constante exportada `SILENCE_NOTICE_MS = 300_000` e implementação de `superviseSilentSessions` com controle de 60s, busca de sessões ativas sem jobs/tarefas e sem atividade por ≥ 5 minutos, transição com `SILENCIO_DETECTADO` e telemetria `QUEUE_STALLED`.
- `src/core/orchestrator/job-worker.ts:383`: chamada periódica de `superviseSilentSessions` em `runOnce`.
- `tests/orchestrator/phase-machine.test.ts:590,687`: inclusão em `allowedEvents` e `SAMPLE_EVENTS`.
- `tests/orchestrator/sem-parada-silenciosa.test.ts:99,375-470`: inclusão em `STRUCTURAL_TEST_EVENTS` e testes de vigia de silêncio para `VERIFICACAO`, `EXECUCAO` com job, `ELICITACAO` e atividade recente.

---

## 4. Tabela "Situação → Antes → Depois"

| Situação | Comportamento Antes do J2 | Comportamento Depois do J2 |
|---|---|---|
| **Entrega reprovada pela T10** | Transicionava para `PLANEJAMENTO` silenciosamente (`job-queue.ts:384`), sem aviso ao usuário no chat e sem continuidade automática. | Transiciona para `BLOQUEADA` com efeito `AVISAR_HUMANO`, postando no chat as lacunas exatas encontradas na T10 e orientando o desbloqueio. |
| **Entrega reprovada por verificação de tela** | Transicionava para `PLANEJAMENTO` silenciosamente (`job-queue.ts:384`). | Transiciona para `BLOQUEADA` com aviso no chat. |
| **Entrega avaliada pelo Jev (modo sombra padrão)** | Bloqueava a entrega reprovando código correto por polaridade invertida das perguntas e gravava laudo no chat. | Não bloqueia nem polui o chat com falso laudo; emite telemetria `JEV_FINAL_DELIVERY_AUDIT_SOMBRA` para calibração até J3/J4. |
| **Entrega avaliada pelo Jev (modo ativo explícito)** | Reprovação voltava para `PLANEJAMENTO`. | Transiciona para `BLOQUEADA` com laudo técnico e aviso no chat. |
| **Erro repetido no job da sessão** | Job marcava `failed` no banco e tentava de novo ou ficava parado sem notificação no chat. | 3 falhas consecutivas em `EXECUCAO` (ou 1 falha em `VERIFICACAO`) transicionam para `BLOQUEADA` e avisam no chat com erro sanitizado. |
| **Pausa longa (> 5 min sem gateway de LLM)** | Postava aviso no momento da pausa e nunca mais emitia atualização se a indisponibilidade persistisse. | Após 5 minutos de pausa contínua, posta aviso específico informando a persistência e orientando a checagem no painel. |
| **Silêncio prolongado (> 5 min sem jobs/atividade)** | Sessão permanecia inerte na fase indefinidamente sem ninguém saber. | Vigia periódico detecta o silêncio e transiciona a sessão para `BLOQUEADA`, avisando no chat com a fase em que parou e data da última atividade. |
| **Executor esgotou 3 tentativas (bloqueado)** | Chamava `reportBlockedNodeToHuman` e `applyPhaseEvent`, mas o efeito `AVISAR_HUMANO` não era processado centralmente. | `applyPhaseEvent` executa `postHumanNotice` centralmente; quem já avisou passa `avisoJaPostado: true` evitando mensagens duplicadas. |
| **Teto de custo atingido** | Postava aviso local em `budget-guard.ts` mas `AVISAR_HUMANO` na máquina de fases era inerte. | Centralizado no fluxo com `avisoJaPostado: true` preservado. |

---

## 5. Escopo Real (`git diff --stat b612596..HEAD`)

```text
 config/politicas-orquestracao.yaml                 |   1 +
 docs/ARQUITETURA-ORQUESTRACAO.md                   |   2 +-
 src/core/config/orchestration-policy.ts            |  11 +
 src/core/orchestrator/budget-guard.ts              |   2 +-
 src/core/orchestrator/human-notice.ts              |  35 ++
 src/core/orchestrator/job-queue.ts                 | 126 ++++--
 src/core/orchestrator/job-worker.ts                | 157 ++++++-
 src/core/orchestrator/phase-machine.ts             |  47 ++-
 src/core/orchestrator/session-phase.ts             |  12 +
 tests/harness/end-to-end-harness-plan.test.ts      |   2 +-
 tests/harness/orchestration-policy-and-skills.test.ts |   4 +
 tests/orchestrator/jev-delivery-gate.test.ts       | 168 +++++++-
 tests/orchestrator/phase-machine.test.ts           |   4 +
 tests/orchestrator/sem-parada-silenciosa.test.ts   | 470 +++++++++++++++++++++
 14 files changed, 999 insertions(+), 42 deletions(-)
```

---

## 6. Desvios do Prompt Original

1. **J2.3 — `tests/harness/end-to-end-harness-plan.test.ts:139` alterado (PLANEJAMENTO → BLOQUEADA), fora da T-B:**
   - **Causa:** O teste `Verificação de tela na entrega: quando 'reprova', a sessão termina em 'PLANEJAMENTO'` esperava a fase antiga `PLANEJAMENTO`. Como a verificação de tela reprovada dispara `VERIFICACAO_COM_LACUNAS` e o J2.3 mudou essa transição contratual para `BLOQUEADA`, o teste falhou.
   - **Tratamento:** Parada imediata realizada conforme a **Regra Zero (item 5)** e consulta feita ao fundador/auditor.
   - **Autorização:** Fundador autorizou a alteração estrita da linha 139 de `tests/harness/end-to-end-harness-plan.test.ts` (sem alterar a linha ~729 nem qualquer outra linha).
2. **J2.4 e J2.6 — Asserção de `allowedEvents` de `EXECUCAO` em `tests/orchestrator/phase-machine.test.ts:584`:**
   - **Causa:** O teste validava o array exato de `allowedEvents` na fase `EXECUCAO`. A adição dos eventos `FALHA_REPETIDA` e `SILENCIO_DETECTADO` exigiu a inclusão correspondente no array do teste.
   - **Tratamento:** Arquivo já constava na lista autorizada `PODE ALTERAR` (Trava T-B).

---

## 7. Checklist de Travas (T-A a T-O)

- [x] **T-A (Limpeza inicial):** Partida em `b612596` com working copy limpa (apenas `.claude/`).
- [x] **T-B (Lista de arquivos autorizados):** Todos os arquivos alterados constam na lista T-B (mais a linha 139 autorizada pelo fundador em Desvios).
- [x] **T-C (Literalidade textual):** Mensagens de aviso, labels, diagramas e nomes de eventos respeitados caractere por caractere.
- [x] **T-D (Tipagem estrita):** Nomes e tipos em camelCase e SCREAMING_SNAKE conforme contrato.
- [x] **T-E (Commits e suíte verde):** 1 commit atômico por passo com `npx tsc --noEmit` (0 erros) e `npx vitest run` 100% verde (760 testes passando).
- [x] **T-F (Sem rebaixamento de regras):** Nenhuma trava ou verificação foi enfraquecida; as paradas foram fortalecidas com notificações ativas.
- [x] **T-G (Sem mocks de dados reais de produção):** Mocks restritos aos testes unitários e de integração de infraestrutura.
- [x] **T-H (Sanitização de credenciais):** Mensagens de erro sanitizadas com `isHighEntropySecretLiteral`.
- [x] **T-I (Preservação de comentários e código alheio):** Nenhum código externo ao escopo foi modificado.
- [x] **T-J (Sem chamadas pagas desnecessárias):** Testes de entrega usaram mocks dos gateways.
- [x] **T-K (Trava append-only de telemetria):** Eventos `HUMAN_NOTIFIED`, `QUEUE_STALLED`, `JEV_FINAL_DELIVERY_AUDIT_SOMBRA` registrados via `TelemetryLogger`.
- [x] **T-L (Sem polling em loop):** Resposta reativa e sem laços ativos.
- [x] **T-M (Idempotência dos avisos):** Avisos de bloqueio e pausa longa protegidos contra duplicação.
- [x] **T-N (Trailer de commit):** Todos os commits contêm `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- [x] **T-O (Relatório completo):** Seções 0 a 9 preenchidas com dados reais.

---

## 8. Sugestões de Melhoria (Nada Implementado)
1. **Configuração de timeout do vigia de silêncio:** O valor de 5 minutos (`SILENCE_NOTICE_MS = 300_000`) atualmente é constante em código; futuramente poderia ser configurável via `politicas-orquestracao.yaml` sob o bloco de execução.
2. **Reativação automática após pausa longa:** No J2b, implementar retentativa automática com backoff exponencial para sessões pausadas antes de exigir intervenção manual.
3. **Métrica consolidada de sessões bloqueadas no painel:** Criar agregador no dashboard que destaque sessões atualmente em `BLOQUEADA` aguardando resposta humana.

---

## 9. Dúvidas para o Fundador
- Nenhuma dúvida pendente. Todos os passos da Tarefa J2 foram cumpridos, testados e validados com 100% de sucesso.
