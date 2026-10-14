# Relatório I1 — Inventário: o que foi construído de 10/10 a 12/10 está ligado, desligado ou morto?

## 0. Leitura Feita
1. Este pacote realiza um inventário estrito de diagnóstico (sem consertos) sobre 20 commits de código construídos entre 10/10 e 12/10 e 16 decisões do Jev no repositório.
2. Cada peça e cada decisão do Jev foi rastreada a partir dos únicos pontos de entrada de produção (`src/app/api/**/route.ts`, `job-worker.ts`, `execution-trigger.ts`, `package.json`), desconsiderando chamadas isoladas em testes.
3. As informações sobre uso real foram extraídas diretamente de uma cópia em isolamento (`<tmp>/nc-diag-i1/dev-copy.db`) sem tocar em `prisma/dev.db`.
4. As fases do fluxo pensado (§2.2) e papéis (Elicitador, Analista, Pesquisa T7, Avaliador) foram confrontados com o código real e com o estado de `etapa1Ativa`.
5. Todas as conclusões contêm as saídas brutas de comandos coladas, expondo conflitos com decisões prévias e caminhos duplicados para orientar a ordem decidida (I1 → P5 → J2b → J3 → J4).

---

## 1. Identificação
- **Ponto de Partida:** `15176ce` (`docs: diagnostico global, ordem I1-P5-J2b-J3-J4 aprovada e prompt I1 (inventario)`)
- **HEAD no início da investigação:** `7de28df`
- **Comando `git log --oneline 15176ce..HEAD`:**
```
7de28df chore(diag): I1 - contagem da trilha para o inventario
```

---

## 2. Por Commit: `git show --stat`, `tsc`, `vitest`

### Commit D (`7de28df`):
- **Mensagem:** `chore(diag): I1 - contagem da trilha para o inventario`
- **`git show --stat 7de28df`:**
```
commit 7de28df9521ae54a3e2e0ea8881273aa93eb83d4
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Wed Oct 14 18:49:42 2026 -0400

    chore(diag): I1 - contagem da trilha para o inventario
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 scripts/diag-inventario-trilha.ts | 169 ++++++++++++++++++++++++++++++++++++++
 1 file changed, 169 insertions(+)
```
- **`npx tsc --noEmit`:** 0 erros.
- **`npx vitest run`:** 116 arquivos, 760 testes passados.

---

## 3. Saída Bruta do Script de Diagnóstico da Trilha
Comando executado: `npx tsx scripts/diag-inventario-trilha.ts`

```json
{"tipo":"acao","action":"AUDIT_REJECTED","total":1050,"primeira":"2026-10-04T03:18:54.092Z","ultima":"2026-10-12T10:13:37.814Z"}
{"tipo":"acao","action":"WORKER_SELF_REPORT_DIVERGENCE","total":958,"primeira":"2026-10-04T03:20:57.641Z","ultima":"2026-10-12T00:47:10.850Z"}
{"tipo":"acao","action":"TERMINAL_COMMAND_EXECUTED","total":926,"primeira":"2026-10-04T03:12:31.411Z","ultima":"2026-10-12T10:07:47.885Z"}
{"tipo":"acao","action":"NODE_EXECUTION_COMPLETED","total":700,"primeira":"2026-10-04T12:22:54.278Z","ultima":"2026-10-11T21:19:02.140Z"}
{"tipo":"acao","action":"PHASE_TRANSITION","total":524,"primeira":"2026-10-05T18:41:33.433Z","ultima":"2026-10-12T17:46:26.064Z"}
{"tipo":"acao","action":"router.complexity_decision","total":397,"primeira":"2026-10-04T03:12:26.627Z","ultima":"2026-10-05T21:24:24.188Z"}
{"tipo":"acao","action":"llm.gateway_call","total":380,"primeira":"2026-10-05T23:16:42.659Z","ultima":"2026-10-13T00:57:56.022Z"}
{"tipo":"acao","action":"LLM_COST","total":378,"primeira":"2026-10-10T23:19:55.043Z","ultima":"2026-10-12T17:46:26.030Z"}
{"tipo":"acao","action":"EXECUTOR_TOOL_CALL","total":285,"primeira":"2026-10-11T21:07:30.124Z","ultima":"2026-10-12T10:08:53.709Z"}
{"tipo":"acao","action":"NODE_EXECUTION_BLOCKED","total":280,"primeira":"2026-10-04T12:29:02.879Z","ultima":"2026-10-12T10:08:32.339Z"}
{"tipo":"acao","action":"NODE_BLOCKED_HUMAN_NOTIFIED","total":278,"primeira":"2026-10-04T12:29:02.978Z","ultima":"2026-10-12T00:38:51.990Z"}
{"tipo":"acao","action":"NODE_EXECUTION_FAILED","total":270,"primeira":"2026-10-04T12:25:25.540Z","ultima":"2026-10-12T10:13:38.734Z"}
{"tipo":"acao","action":"EMPIRICAL_BUILD_FAILED","total":225,"primeira":"2026-10-04T03:18:54.198Z","ultima":"2026-10-05T19:35:39.671Z"}
{"tipo":"acao","action":"AUDIT_TRAIL_TEST","total":75,"primeira":"2026-10-04T03:18:54.145Z","ultima":"2026-10-05T19:35:51.883Z"}
{"tipo":"acao","action":"REVISION_SNAPSHOT","total":73,"primeira":"2026-10-04T03:12:28.468Z","ultima":"2026-10-05T19:35:48.039Z"}
{"tipo":"acao","action":"NODE_UNBLOCKED_BY_HUMAN","total":60,"primeira":"2026-10-05T18:56:43.189Z","ultima":"2026-10-12T00:42:52.891Z"}
{"tipo":"acao","action":"NODE_RESUMED_AFTER_CRASH","total":56,"primeira":"2026-10-05T14:40:25.332Z","ultima":"2026-10-07T02:07:44.078Z"}
{"tipo":"acao","action":"JEV_DECISION","total":55,"primeira":"2026-10-06T10:46:28.058Z","ultima":"2026-10-12T17:46:26.030Z"}
{"tipo":"acao","action":"SKILL_TOOL_DENIED","total":46,"primeira":"2026-10-11T21:20:44.860Z","ultima":"2026-10-12T00:38:09.213Z"}
{"tipo":"acao","action":"EXECUTOR_TIER","total":32,"primeira":"2026-10-11T19:25:53.259Z","ultima":"2026-10-12T10:04:09.234Z"}
{"tipo":"acao","action":"EXECUTOR_ROTA_PAGA","total":32,"primeira":"2026-10-11T19:25:53.416Z","ultima":"2026-10-12T10:04:09.809Z"}
{"tipo":"acao","action":"EXECUTOR_REPORT_INVALID","total":28,"primeira":"2026-10-11T21:20:57.546Z","ultima":"2026-10-12T10:10:05.780Z"}
{"tipo":"acao","action":"JEV_EVIDENCE_CHECK","total":27,"primeira":"2026-10-11T21:11:31.381Z","ultima":"2026-10-12T10:13:37.814Z"}
{"tipo":"acao","action":"EVALUATOR_SKILL_REFS","total":24,"primeira":"2026-10-11T19:26:55.056Z","ultima":"2026-10-12T10:10:05.790Z"}
{"tipo":"acao","action":"EVALUATOR_MODEL","total":24,"primeira":"2026-10-11T19:28:07.466Z","ultima":"2026-10-12T10:13:36.062Z"}
{"tipo":"acao","action":"JEV_FAILURE_DIAGNOSIS","total":17,"primeira":"2026-10-11T19:28:22.258Z","ultima":"2026-10-12T10:13:38.362Z"}
{"tipo":"acao","action":"PHASE_TRANSITION_REFUSED","total":11,"primeira":"2026-10-05T18:41:33.477Z","ultima":"2026-10-05T19:35:30.983Z"}
{"tipo":"acao","action":"JOB_LEASE_LOST","total":10,"primeira":"2026-10-05T19:13:05.292Z","ultima":"2026-10-05T19:35:15.256Z"}
{"tipo":"acao","action":"BUDGET_AUTHORIZED","total":7,"primeira":"2026-10-11T21:44:00.696Z","ultima":"2026-10-12T10:04:06.622Z"}
{"tipo":"acao","action":"EMPIRICAL_BUILD_PREEXISTING_FAILURE","total":6,"primeira":"2026-10-11T21:11:33.321Z","ultima":"2026-10-11T21:19:02.075Z"}
{"tipo":"acao","action":"BUDGET_CEILING_REACHED","total":6,"primeira":"2026-10-11T21:27:40.520Z","ultima":"2026-10-12T00:47:12.186Z"}
{"tipo":"acao","action":"llm.gateway_failure","total":4,"primeira":"2026-10-10T23:19:57.352Z","ultima":"2026-10-13T00:57:51.970Z"}
{"tipo":"acao","action":"JEV_STATE_TOO_LARGE","total":4,"primeira":"2026-10-11T21:46:57.464Z","ultima":"2026-10-12T10:08:31.988Z"}
{"tipo":"acao","action":"JEV_FAILURE","total":2,"primeira":"2026-10-11T20:50:13.819Z","ultima":"2026-10-11T23:46:15.795Z"}
{"tipo":"acao","action":"PROJECT_MEMORY_UPDATED","total":2,"primeira":"2026-10-12T17:45:39.629Z","ultima":"2026-10-12T17:46:20.323Z"}
{"tipo":"acao","action":"AUDIT_TRAIL_SELFCHECK","total":1,"primeira":"2026-10-04T03:20:32.351Z","ultima":"2026-10-04T03:20:32.351Z"}
{"tipo":"acao","action":"JEV_NODE_SPLIT","total":1,"primeira":"2026-10-11T21:04:17.135Z","ultima":"2026-10-11T21:04:17.135Z"}
{"tipo":"acao","action":"SESSION_PAUSED_NO_LLM","total":1,"primeira":"2026-10-12T10:06:48.963Z","ultima":"2026-10-12T10:06:48.963Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"failure_diagnosis","total":17,"primeira":"2026-10-11T19:28:22.230Z","ultima":"2026-10-12T10:13:38.276Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"evidence_check","total":16,"primeira":"2026-10-11T21:11:31.244Z","ultima":"2026-10-12T10:13:37.735Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"classificacao_mensagem","total":10,"primeira":"2026-10-06T10:46:28.058Z","ultima":"2026-10-10T23:19:55.041Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"m0_peneira_afunilamento_universal","total":3,"primeira":"2026-10-11T18:41:37.718Z","ultima":"2026-10-11T21:01:57.200Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"m2_clareza_spec","total":3,"primeira":"2026-10-11T20:50:56.795Z","ultima":"2026-10-11T21:03:34.952Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"m3_planejamento_microbriefs_lote","total":3,"primeira":"2026-10-11T21:04:17.088Z","ultima":"2026-10-12T17:46:26.030Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"m1_intencao_revisao_spec","total":2,"primeira":"2026-10-11T20:56:05.726Z","ultima":"2026-10-11T21:01:56.688Z"}
{"tipo":"jev","action":"JEV_DECISION","purpose":"teste_diagnostico","total":1,"primeira":"2026-10-11T17:35:45.549Z","ultima":"2026-10-11T17:35:45.549Z"}
{"tipo":"jev","action":"JEV_FAILURE","purpose":"m0_peneira_afunilamento_universal","total":1,"primeira":"2026-10-11T20:50:13.819Z","ultima":"2026-10-11T20:50:13.819Z"}
{"tipo":"jev","action":"JEV_FAILURE","purpose":"evidence_check","total":1,"primeira":"2026-10-11T23:46:15.795Z","ultima":"2026-10-11T23:46:15.795Z"}
{"tipo":"fase","phase":"BLOQUEADA","total":1}
```

---

## 4. Tabela A — Peças dos 20 Commits de Código (10/10 a 12/10)

| Commit | Peça (`arquivo:linha`) | Quem chama fora de `tests/` (saída do `git grep -n` colada abaixo) | Caminho até o ponto de entrada | Resultado usado? | Interruptor e valor atual | Uso real na trilha | Classificação |
|---|---|---|---|---|---|---|---|
| `60e81f0` | `skills/avaliador*/SKILL.md` (zerou ferramentas; enxugou prompt) | Saída A.1 | `job-worker.ts` → `runJob` → `executeNode` → `loadRoleSkill` | Sim, dita o prompt e remove falsas ferramentas | Sempre ativo (config skill) | 24 chamadas (`EVALUATOR_MODEL`) | `LIGADO` |
| `c8ec38e` | `decideSpecReviewMessageIntent` (`src/core/decision/jev-decisions.ts:37`) | Saída A.2 | Ninguém chama em produção (substituído por P4 em `a93cf3e`) | Não (import sem chamada em `route.ts:24`) | Sem interruptor | 2 chamadas (antes de 12/10) | `MORTO` |
| `7f92a6e` | `bloqueio_spec_ambigua: ativo` (`config/politicas-orquestracao.yaml:29`) | Saída A.3 | `job-worker.ts` → `executeNode` (`node-executor.ts:1605`) | Sim, bloqueia nó na 2ª tentativa se causa é ambígua | `bloqueio_spec_ambigua: ativo` | 17 diagnósticos de falha na trilha | `LIGADO` |
| `6472144` | `enforceExecutorSpecIsolation` (`src/core/orchestrator/node-executor.ts:275`) | Saída A.4 | `job-worker.ts` → `executeNode` (`node-executor.ts:1145`) | Sim, barra vazamento de Spec bruta | Sempre ativo no executor | Ativo em todas as execuções com microbrief | `LIGADO` |
| `6472144` | `renderMacrobriefMarkdown` (`src/core/templates/artifact-templates.ts:1082`) | Saída A.5 | Chamado apenas em `tests/templates/macrobrief-markdown.test.ts:31` | Não | Sem interruptor | 0 | `SO_TESTES` |
| `a3474af` | `preferIndependentFirst` em `dispatchStrongEvaluator` (`src/core/llm/evaluator-models.ts:358`) | Saída A.6 | `job-worker.ts` → `executeNode` (`node-executor.ts:1406`) | Sim, força Claude antes de DeepSeek | Sempre ativo no nó | 24 avaliações na trilha | `LIGADO` |
| `9e93594` | `verifyMacrobriefCoverageWithJev` (`src/core/decision/jev-execution-checks.ts:713`) | Saída A.7 | `src/core/intake/intake-engine.ts:308` (`runElicitadorAndAnalistaCycle`) | Não (`runElicitadorAndAnalistaCycle` só roda em testes) | `conferencia_macrobrief_spec` (não lido em prod) | 0 | `SO_TESTES` |
| `19d5758` | `verifyProjectDeliveryWithJev` (`src/core/decision/jev-execution-checks.ts:944`) | Saída A.8 | `job-worker.ts` → `job-queue.ts:336` (portão final T10) | Sim (registra telemetria de auditoria sombra) | `auditoria_entrega: sombra` (J2) | Medido em J1 (0 na trilha histórica) | `LIGADO` |
| `19d5758` | `readProjectFilesContent` (`src/core/orchestrator/node-executor.ts:227`) | Saída A.9 | `job-worker.ts` → `job-queue.ts:335` | Sim, lê arquivos do disco para auditoria final | Sempre ativo | Chamado no portão final | `LIGADO` |
| `19d5758` | `renderDeliveryAuditReportMarkdown` (`src/core/templates/artifact-templates.ts:1212`) | Saída A.10 | `job-worker.ts` → `job-queue.ts:386` | Condicional (quando `auditoriaEntregaModo === "ativo"`) | `auditoria_entrega: sombra` | 0 na trilha histórica | `DESLIGADO_CONFIG` |
| `19d5758` | `renderMicrobriefReparoMarkdown` (`src/core/templates/artifact-templates.ts:1331`) | Saída A.11 | Chamado apenas em `src/core/templates/artifact-templates.ts:1435` | Não (só chamado pela função de particionamento) | Sem interruptor | 0 | `SO_TESTES` |
| `359e06b` | `partitionRepairsByCluster` (`src/core/templates/artifact-templates.ts:1435`) | Saída A.12 | Chamado apenas em `tests/decision/jev-final-delivery-audit.test.ts:241` | Não | Sem interruptor | 0 | `SO_TESTES` |
| `6e00e57` | Atualização do slug Claude Sonnet 4.5 (`src/core/llm/evaluator-models.ts:32`) | Saída A.13 | `job-worker.ts` → `dispatchStrongEvaluator` | Sim, define o slug de chamada Anthropic direta | Sempre ativo | Usado nas chamadas Claude | `LIGADO` |
| `bdb6ade` | Fallback direto Anthropic em `evaluator-models.ts:130` e `verificacao_evidencia: ativo` | Saída A.14 | `job-worker.ts` → `executeNode` (`node-executor.ts:1406`) | Sim para fallback Claude; evidência forçada como sombra pelo código | `verificacao_evidencia: ativo` | 27 `JEV_EVIDENCE_CHECK` | `LIGADO` |
| `06bb533` | Teto 8192 tokens e tolerância a bare YAML em `spec-format.ts:109` | Saída A.15 | `POST /api/chat` (`route.ts:566`) e UI | Sim, desempacota spec truncada ou sem delimitadores | Sempre ativo | Usado em todas as gerações de Spec | `LIGADO` |
| `24b4596` | Distinção bare YAML contra placeholders em `spec-format.ts:147` | Saída A.16 | `POST /api/chat`, `execution-trigger.ts` | Sim, impede que texto solto vire spec válida | Sempre ativo | Usado no parsing de Spec | `LIGADO` |
| `156d01b` | `runUniversalIntakeFunnel` (M0) (`src/core/intake/universal-funnel.ts:26`) | Saída A.17 | `POST /api/chat` (`route.ts:581`) | Sim, injeta brief de afunilamento no prompt de Spec | Sempre ativo em rascunho de spec | 3 decisões + 1 falha na trilha | `LIGADO` |
| `156d01b` | `autoHealSpecDocument` (`src/core/intake/spec-auto-heal.ts:30`) | Saída A.18 | `POST /api/chat` (`route.ts:786`) | Sim, preenche campos obrigatórios omitidos | Sempre ativo | Usado no chat pós-geração | `LIGADO` |
| `156d01b` | `isConcreteFilePath` (`src/core/intake/spec-auto-heal.ts:11`) | Saída A.19 | `autoHealSpecDocument` | Sim, valida caminhos da spec | Sempre ativo | Usado no auto-heal | `LIGADO` |
| `494b73b` | Fixação nativa de Português pt-BR em `spec-draft.ts`, `intake-engine.ts`, `route.ts` | Saída A.20 | `POST /api/chat` | Sim, impede respostas e specs em inglês | Sempre ativo | Em todas as mensagens do chat | `LIGADO` |
| `4321027` | Auto-recuperação de modelo Claude via `GET /v1/models` (`evaluator-models.ts:184`) | Saída A.21 | `job-worker.ts` → `dispatchStrongEvaluator` (em erro 404) | Sim (ativado sob demanda em caso de 404 do Sonnet) | Sempre ativo | 0 (modelo estático funcionou sem 404) | `LIGADO` |
| `a3f0992` | Blindagem contra aprovação de Spec placeholder (`execution-trigger.ts:40`) | Saída A.22 | `POST /api/chat` e `approveSpecAndStart` | Sim, recusa spec com "Especificação pendente" | Sempre ativo | Bloqueou aprovações inválidas | `LIGADO` |
| `a93cf3e` | Fan-Out P4 no Chat `evaluateChatFanOutWithJev` (`jev-decisions.ts:983`) | Saída A.23 | `POST /api/chat` (`route.ts:298`) | Sim, avalia aprovação, intenção e guardrail de entrada | Sempre ativo | 0 chamadas reais na trilha | `LIGADO` |
| `a93cf3e` | Memória de Projeto L2 `project-memory.ts:35` | Saída A.24 | `execution-trigger.ts:512` e `job-worker.ts:147` | Sim, grava `.nextcode/MEMORY.md` | Sempre ativo | 2 `PROJECT_MEMORY_UPDATED` na trilha | `LIGADO` |
| `a93cf3e` | `SpecDecomposerSkill.decomposeSpec` (`spec-decomposer.ts:13`) | Saída A.25 | `POST /api/chat:70` e `execution-trigger.ts:60` | Sim, cria nós da DAG mecanicamente a partir da Spec | Sempre ativo | Usado na criação da DAG de tarefas | `LIGADO` |
| `a93cf3e` | `decideGraphifyEligibilityWithJev` (`jev-decisions.ts:773`) | Saída A.26 | `POST /api/chat` (`route.ts:905`) | Sim (fallback de elegibilidade do Graphify se P4 falhar) | Sempre ativo | 0 (usado via P4) | `LIGADO` |
| `207f9a2` | Telemetria de Custo P5 e `sessionCostBreakdown` (`cost.ts:114`) | Saída A.27 | `GET /api/session/[id]/cost` e `dag-sidebar.tsx` | Sim, alimenta breakdown de custo na interface | Sempre ativo | 378 `LLM_COST` na trilha | `LIGADO` |
| `6e77789` | Cache local de decisões do JEV `globalJevCache` (`jev-cache.ts:108`) | Saída A.28 | `askJev`, `askJevBatch` (`jev.ts:47`) | Sim, evita chamadas repetidas com mesmo payload | Sempre ativo | Usado no motor do Jev | `LIGADO` |
| `786d393` | Cascata de contingência de executor e trava executor x avaliador | Saída A.29 | `node-executor.ts` | **Desfeito parcialmente por C1 (`f19152c`)**: C1 removeu a cascata do executor e restaurou `prefixos_rota_paga: ["custom/"]`. A trava de independência de família (`actualExecutorFamily`) permaneceu ativa em `paid-routing.ts:40`. | `prefixos_rota_paga: ["custom/"]` | 32 `EXECUTOR_ROTA_PAGA` | `LIGADO` (remanescente após C1) |

---

### Saídas do `git grep -n` da Tabela A (Numeradas)

#### Saída A.1 (`skills/avaliador`)
```
src/core/orchestrator/node-executor.ts:607:        const clusterSkill = loadRoleSkill(`avaliador-${resolvedCluster}`);
src/core/skills/skill-runtime.ts:45:export function loadRoleSkill(skillName: string): LoadedSkill {
```

#### Saída A.2 (`decideSpecReviewMessageIntent`)
```
src/app/api/chat/route.ts:24:  decideSpecReviewMessageIntent,
src/core/decision/jev-decisions.ts:37:export async function decideSpecReviewMessageIntent(params: {
tests/harness/jev-decisions-catalog.test.ts:86:    const decision = await decideSpecReviewMessageIntent({
```

#### Saída A.3 (`bloqueio_spec_ambigua: ativo`)
```
config/politicas-orquestracao.yaml:29:  bloqueio_spec_ambigua: ativo        # ativo | sombra | desligado
src/core/config/orchestration-policy.ts:294:    bloqueioSpecAmbigua: "ativo",
src/core/orchestrator/node-executor.ts:1605:        } else if (policy.jevExecucao.bloqueioSpecAmbigua === "ativo") {
```

#### Saída A.4 (`enforceExecutorSpecIsolation`)
```
src/core/orchestrator/node-executor.ts:275:export function enforceExecutorSpecIsolation(
src/core/orchestrator/node-executor.ts:1145:    prompt = enforceExecutorSpecIsolation({
```

#### Saída A.5 (`renderMacrobriefMarkdown`)
```
src/core/templates/artifact-templates.ts:1082:export function renderMacrobriefMarkdown(macrobrief: MacrobriefDocument): string {
tests/templates/macrobrief-markdown.test.ts:31:    const md = renderMacrobriefMarkdown(doc);
```

#### Saída A.6 (`preferIndependentFirst`)
```
src/core/llm/evaluator-models.ts:358:  preferIndependentFirst?: boolean;
src/core/orchestrator/node-executor.ts:1406:      preferIndependentFirst: true,
```

#### Saída A.7 (`verifyMacrobriefCoverageWithJev`)
```
src/core/decision/jev-execution-checks.ts:713:export async function verifyMacrobriefCoverageWithJev(
src/core/intake/intake-engine.ts:25:import { verifyMacrobriefCoverageWithJev } from "@/core/decision/jev-execution-checks";
src/core/intake/intake-engine.ts:308:          const jevConference = await verifyMacrobriefCoverageWithJev({
tests/intake/jev-intake-conference.test.ts:53:    const result = await IntakeEngine.runElicitadorAndAnalistaCycle({
```

#### Saída A.8 (`verifyProjectDeliveryWithJev`)
```
src/core/decision/jev-execution-checks.ts:944:export async function verifyProjectDeliveryWithJev(
src/core/orchestrator/job-queue.ts:12:import { verifyProjectDeliveryWithJev } from "@/core/decision/jev-execution-checks";
src/core/orchestrator/job-queue.ts:336:            const jevAudit = await verifyProjectDeliveryWithJev({
```

#### Saída A.9 (`readProjectFilesContent`)
```
src/core/orchestrator/node-executor.ts:227:export function readProjectFilesContent(
src/core/orchestrator/job-queue.ts:335:            const codeContentMap = readProjectFilesContent(filesToAudit, projectPath);
```

#### Saída A.10 (`renderDeliveryAuditReportMarkdown`)
```
src/core/templates/artifact-templates.ts:1212:export function renderDeliveryAuditReportMarkdown(report: DeliveryAuditReportDocument): string {
src/core/orchestrator/job-queue.ts:386:                const reportMarkdown = renderDeliveryAuditReportMarkdown(auditReportDoc);
```

#### Saída A.11 (`renderMicrobriefReparoMarkdown`)
```
src/core/templates/artifact-templates.ts:1331:export function renderMicrobriefReparoMarkdown(reparo: MicrobriefReparoDocument): string {
src/core/templates/artifact-templates.ts:1473:    markdown: renderMicrobriefReparoMarkdown(doc),
```

#### Saída A.12 (`partitionRepairsByCluster`)
```
src/core/templates/artifact-templates.ts:1435:export function partitionRepairsByCluster(
tests/decision/jev-final-delivery-audit.test.ts:241:    const partitioned = partitionRepairsByCluster(report, "sess-test-partition");
```

#### Saída A.13 (`slug oficial Sonnet 4.5`)
```
src/core/llm/evaluator-models.ts:32:export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
```

#### Saída A.14 (`evaluator-models.ts:130` e `verificacao_evidencia`)
```
config/politicas-orquestracao.yaml:31:  verificacao_evidencia: ativo        # ativo | sombra | desligado
src/core/llm/evaluator-models.ts:130:async function callAnthropicDirect(
src/core/orchestrator/node-executor.ts:1458:    const jevEvidencia = await verifyStageEvidenceWithJev({
```

#### Saída A.15 (`spec-format.ts` bare YAML)
```
src/app/api/chat/route.ts:566:      const parsed = parseSpecDocument(text);
src/core/intake/spec-format.ts:109:export function unwrapSpecDocument(text: string): { rawSpec: string; hasDelimiters: boolean } {
```

#### Saída A.16 (`unwrapSpecDocument` placeholder check)
```
src/core/intake/spec-format.ts:147:    if (isSpecPlaceholder(trimmed)) {
src/core/orchestrator/execution-trigger.ts:40:  if (isSpecPlaceholder(specContent)) {
```

#### Saída A.17 (`runUniversalIntakeFunnel`)
```
src/app/api/chat/route.ts:581:        const funnel = await runUniversalIntakeFunnel({
src/core/intake/universal-funnel.ts:26:export async function runUniversalIntakeFunnel(params: {
```

#### Saída A.18 (`autoHealSpecDocument`)
```
src/app/api/chat/route.ts:786:            const healed = autoHealSpecDocument(guardRes.finalSpec);
src/core/intake/spec-auto-heal.ts:30:export function autoHealSpecDocument(rawOrParsed: string | ParsedSpec): {
```

#### Saída A.19 (`isConcreteFilePath`)
```
src/core/intake/spec-auto-heal.ts:11:export function isConcreteFilePath(path: string): boolean {
src/core/intake/spec-auto-heal.ts:98:  const validFiles = (parsed.arquivosAfetados || []).filter(isConcreteFilePath);
```

#### Saída A.20 (Diretiva pt-BR)
```
src/app/api/chat/route.ts:602:      ? `DIRETIVA DE IDIOMA: Responda OBRIGATORIAMENTE em Português do Brasil (pt-BR).\n` +
src/core/orchestrator/spec-draft.ts:7:export function buildSpecWriterSystemPrompt(funnelBrief?: string): string {
```

#### Saída A.21 (`auto-recuperacao sob demanda Claude`)
```
src/core/llm/evaluator-models.ts:184:async function discoverLatestActiveClaudeModel(): Promise<string> {
```

#### Saída A.22 (`approveSpecAndStart` recusa placeholder)
```
src/core/orchestrator/execution-trigger.ts:40:  if (isSpecPlaceholder(specContent)) {
src/components/session/canonical-spec-modal.tsx:28:  const isExecutable = isSpecExecutable(specContent);
```

#### Saída A.23 (`evaluateChatFanOutWithJev`)
```
src/app/api/chat/route.ts:298:    const fanOut = await evaluateChatFanOutWithJev({
src/core/decision/jev-decisions.ts:983:export async function evaluateChatFanOutWithJev(
```

#### Saída A.24 (`project-memory.ts`)
```
src/core/memory/project-memory.ts:35:export function readProjectMemory(projectPath: string): string | null {
src/core/orchestrator/execution-trigger.ts:512:  consolidateMemoryFromSpec({
src/core/orchestrator/job-worker.ts:147:        const mem = readProjectMemory(projectPath);
```

#### Saída A.25 (`SpecDecomposerSkill.decomposeSpec`)
```
src/core/skills/spec-decomposer.ts:13:  static decomposeSpec(spec: ParsedSpec): DecomposedPlan {
src/core/orchestrator/execution-trigger.ts:60:  const decomposed = SpecDecomposerSkill.decomposeSpec(parsedSpec);
```

#### Saída A.26 (`decideGraphifyEligibilityWithJev`)
```
src/app/api/chat/route.ts:905:              : await decideGraphifyEligibilityWithJev({
src/core/decision/jev-decisions.ts:773:export async function decideGraphifyEligibilityWithJev(params: {
```

#### Saída A.27 (`sessionCostBreakdown`)
```
src/core/llm/cost.ts:114:export async function sessionCostBreakdown(sessionId: string): Promise<SessionCostBreakdown> {
src/components/session/dag-sidebar.tsx:18:import { formatUsd } from "@/components/session/dag-sidebar";
```

#### Saída A.28 (`globalJevCache`)
```
src/core/decision/jev-cache.ts:108:export const globalJevCache = new JevDecisionCache();
src/core/decision/jev.ts:47:    const cached = globalJevCache.get(params.purpose, stateStr, params.questions);
```

#### Saída A.29 (`CONTINGENCY_EXECUTOR_MODELS`)
```
src/core/llm/paid-routing.ts:40:export const CONTINGENCY_EXECUTOR_MODELS: { model: string; family: string }[] = [
src/core/orchestrator/node-executor.ts:1049:    // C1.1: cascata desfeita para o executor — rota estrita
```

---

## 5. Tabela B — As 16 Decisões do Jev no Código

Comando de verificação: `git grep -n 'purpose: "' -- src`
```
src/core/decision/jev-decisions.ts:75:    purpose: "m1_intencao_revisao_spec",
src/core/decision/jev-decisions.ts:178:    purpose: "m2_clareza_spec",
src/core/decision/jev-decisions.ts:327:    purpose: "m3_planejamento_microbriefs_lote",
src/core/decision/jev-decisions.ts:472:    purpose: "m4_verificacao_cascata_sde",
src/core/decision/jev-decisions.ts:564:    purpose: "m5_seguranca_pesquisa_t7",
src/core/decision/jev-decisions.ts:822:    purpose: "jev_graphify_eligibility",
src/core/decision/jev-decisions.ts:1065:    purpose: "p4_chat_fanout",
src/core/decision/jev-execution-checks.ts:104:    purpose: "failure_diagnosis",
src/core/decision/jev-execution-checks.ts:341:      purpose: "evidence_check",
src/core/decision/jev-execution-checks.ts:556:      purpose: "skill_install_guard",
src/core/decision/jev-execution-checks.ts:731:    purpose: "macrobrief_coverage_conference",
src/core/decision/jev-execution-checks.ts:969:    purpose: "final_project_delivery_audit",
src/core/governance/secret-guard.ts:247:    purpose: "secret_guard",
src/core/governance/secret-guard.ts:307:    purpose: "secret_guard_chat",
src/core/intake/universal-funnel.ts:124:    purpose: "m0_peneira_afunilamento_universal",
src/core/orchestrator/message-intent.ts:189:    purpose: "classificacao_mensagem",
```

| `purpose` | Função (`arquivo:linha`) | Caminho até o ponto de entrada | O que o código faz com a resposta (`arquivo:linha`) | Interruptor/modo atual | Chamadas reais na trilha (do I1.1) | Classificação | Item do catálogo (§4) |
|---|---|---|---|---|---|---|---|
| `m1_intencao_revisao_spec` | `decideSpecReviewMessageIntent` (`jev-decisions.ts:37`) | Ninguém chama fora de `tests/` | N/A (chamada desconectada no commit `a93cf3e`) | Sem interruptor | 2 | `MORTO` | J17 |
| `m2_clareza_spec` | `decideSpecClarity` (`jev-decisions.ts:134`) | `POST /api/chat` (`route.ts:796`) | Nada: `await decideSpecClarity(...).catch(() => null);` retorno descartado (`route.ts:796`) | Sem interruptor | 3 | `CALCULADO_DESCARTADO` | J23 |
| `m3_planejamento_microbriefs_lote` | `decideMicrobriefsPlanningBatch` (`jev-decisions.ts:249`) | `approveSpecAndStart` (`execution-trigger.ts:463`) | Grava `nivel_modelo` no microbrief e `payload.jevPlan` (`execution-trigger.ts:478`), aciona split de nós | `policy.jevExecucao` | 3 | `LIGADO` | J22 |
| `m4_verificacao_cascata_sde` | `decideSdeCascadeEscalation` (`jev-decisions.ts:421`) | Ninguém chama fora de `tests/` | N/A | Sem interruptor | 0 | `MORTO` | J12 |
| `m5_seguranca_pesquisa_t7` | `decideExternalDocsSafetyT7` (`jev-decisions.ts:533`) | Ninguém chama fora de `tests/` (`universal-docs-fetcher.ts:312` não tem chamadores) | N/A | Sem interruptor | 0 | `SO_TESTES` | J27 |
| `jev_graphify_eligibility` | `decideGraphifyEligibilityWithJev` (`jev-decisions.ts:773`) | `POST /api/chat` (`route.ts:905`) | Popula `graphifySuggestion` retornada à UI se P4 não vier do Jev | Sem interruptor | 0 | `LIGADO` | J20 |
| `p4_chat_fanout` | `evaluateChatFanOutWithJev` (`jev-decisions.ts:983`) | `POST /api/chat` (`route.ts:298`) | Define guardrail de entrada (J5), intenção de aprovação (M1) e intenção de mensagem | `policy.jevExecucao` | 0 | `LIGADO` | Fora do catálogo (unificação P4 de J5/J17/J18/J20) |
| `failure_diagnosis` | `diagnoseStageFailureWithJev` (`jev-execution-checks.ts:65`) | `job-worker.ts` → `node-executor.ts:1572` | Bloqueia nó se causa `ambiguous_spec` (`node-executor.ts:1605`), grava feedback no histórico | `diagnosticoFalha: ativo`, `bloqueioSpecAmbigua: ativo` | 17 | `LIGADO` | J2, J8 |
| `evidence_check` | `verifyStageEvidenceWithJev` (`jev-execution-checks.ts:240`) | `job-worker.ts` → `node-executor.ts:1458` | Forçado em modo sombra pelo código (`jev-execution-checks.ts:265`), grava no log de telemetria | `verificacao_evidencia: ativo` (código ignora e roda sombra) | 16 decisões (+1 falha) | `CALCULADO_DESCARTADO` | J1 |
| `skill_install_guard` | `checkSkillInstallWithJev` (`jev-execution-checks.ts:510`) | `POST /api/skills/install-github` (`route.ts:41`) | Define `riskFlags` gravados em `CandidateSkillProposal` | `guardaInstalacaoSkill: ativo` | 0 | `LIGADO` | J10 |
| `macrobrief_coverage_conference` | `verifyMacrobriefCoverageWithJev` (`jev-execution-checks.ts:713`) | Ninguém chama fora de `tests/` (`intake-engine.ts:308` só roda em testes) | N/A | `conferencia_macrobrief_spec` | 0 | `SO_TESTES` | J24 |
| `final_project_delivery_audit` | `verifyProjectDeliveryWithJev` (`jev-execution-checks.ts:944`) | `job-worker.ts` → `job-queue.ts:336` | Registra telemetria sombra `JEV_FINAL_DELIVERY_AUDIT_SOMBRA` (`job-queue.ts:353`) | `auditoria_entrega: sombra` | Medido em J1 (0 na trilha histórica) | `LIGADO` |
| `secret_guard` | `checkSecretsInCodeWithJev` (`secret-guard.ts:229`) | `job-worker.ts` → `node-executor.ts:1273` | Bloqueia nó e expurga quarentena (`node-executor.ts:1506`) | `guardaSegredosCodigo: ativo` | 0 | `LIGADO` | J9 |
| `secret_guard_chat` | `redactSecretsInChatWithJev` (`secret-guard.ts:290`) | `POST /api/chat` (`route.ts:867`) | Mascara segredos antes de salvar a mensagem no banco (`route.ts:873`) | `guardaSegredosChat: ativo` | 0 | `LIGADO` | J19 |
| `m0_peneira_afunilamento_universal` | `runUniversalIntakeFunnel` (`universal-funnel.ts:26`) | `POST /api/chat` (`route.ts:581`) | Injeta brief de afunilamento em `buildSpecWriterSystemPrompt` (`route.ts:607`) | Sempre ativo | 3 decisões (+1 falha) | `LIGADO` | J26 |
| `classificacao_mensagem` | `classifyMessage` (`message-intent.ts:173`) | `POST /api/chat` (`route.ts:428`) | Alimenta `applyPhaseEvent({ type: "MENSAGEM_CLASSIFICADA", intencao })` | Sempre ativo | 10 | `LIGADO` | J18 |

---

## 6. Tabela C — Fases e Etapas do Fluxo Pensado (§2.2)

| Item | O pensado (referência, com linha) | O real (`arquivo:linha` com saída colada) | Sessões reais que passaram pela fase (do I1.1) | Classificação |
|---|---|---|---|---|
| `ELICITACAO` | §2.2 linha 28: Conversa inicial para extrair requisitos | Suportada pela máquina de fases, mas `etapa1Ativa: false` em `session-phase.ts:124` | 0 na trilha | `LIGADO` |
| `SPEC_REVISAO` | §2.2 linha 28: Revisão e aprovação da Spec Canônica | `route.ts:228`, suportada no chat e transição para aprovação | 0 na trilha (banco histórico começou já aprovado ou direto em execução) | `LIGADO` |
| `MACROBRIEF` | §2.2 linha 28: Divisão arquitetural da Spec em Macrobrief | Ignorado no fluxo real: `SPEC_APROVADA` salta para `PLANEJAMENTO` porque `etapa1Ativa: false` (`phase-machine.ts:310`, `session-phase.ts:124`) | 0 | `DESLIGADO_CONFIG` |
| `CONFERENCIA` | §2.2 linha 28: Conferência Macrobrief × Spec com Jev | Ignorado no fluxo real: nunca entra em `CONFERENCIA` porque `etapa1Ativa: false` (`session-phase.ts:124`) | 0 | `DESLIGADO_CONFIG` |
| `PLANEJAMENTO` | §2.2 linha 28: Geração dos nós de tarefas (DAG) | `execution-trigger.ts:60` decompõe spec e cria TaskNodes | 0 na contagem por fase de Session (Session fica `BLOQUEADA` ou avança) | `LIGADO` |
| `EXECUCAO` | §2.2 linha 28: Execução dos nós em quarentena | `job-worker.ts:127` executa nós da fila com `node-executor.ts` | 524 `PHASE_TRANSITION`, 700 `NODE_EXECUTION_COMPLETED` | `LIGADO` |
| `VERIFICACAO` | §2.2 linha 28: Verificação de tela / empírica | Portão empírico em `node-executor.ts:1510` e portão final em `job-queue.ts:314` | 225 falhas empíricas, 27 verificações evidência | `LIGADO` |
| `ENTREGUE` | §2.2 linha 28: Projeto concluído e aceito | `job-queue.ts:398` transiciona sessão para `ENTREGUE` | Bench anterior alcançou 100% ENTREGUE no container | `LIGADO` |
| Skill `elicitador` no chat (O1) | §2.2 linha 40: Elicitador conduz chat via skill | Chat usa prompt embutido (`spec-draft.ts:7`); `skills/elicitador/SKILL.md` só é carregada em `intake-engine.ts:223` (testes) | 0 | `SO_TESTES` |
| Skill `analista` (O3) | §2.2 linha 43: Analista gera macrobrief e microbriefs | Divisão é mecânica por código (`spec-decomposer.ts:13`); `skills/analista/SKILL.md` só em `intake-engine.ts:224` (testes) | 0 | `SO_TESTES` |
| Pesquisa oficial T7 (O4) | §2.2 linha 44: Busca de documentação externa com validação | `UniversalDocsFetcher` implementado mas não chamado por nenhuma rota ou worker em produção | 0 | `SO_TESTES` |
| Avaliador de outro modelo (O5) | §2.2 linha 45: Avaliador independente em modelo diferente | `node-executor.ts:1406` com `dispatchStrongEvaluator`, `preferIndependentFirst` e `actualExecutorFamily` | 24 avaliações | `LIGADO` |

### Saídas Comprobatórias da Tabela C
```
src/core/orchestrator/session-phase.ts:124:    const result = transition(ctx, event, { etapa1Ativa: false });
src/core/orchestrator/phase-machine.ts:310:        const nextPhase: Phase = opts.etapa1Ativa ? 'MACROBRIEF' : 'PLANEJAMENTO';
src/core/intake/intake-engine.ts:223:    const elicitadorSkill = loadRoleSkill("elicitador");
src/core/intake/intake-engine.ts:224:    const analistaSkill = loadRoleSkill("analista");
src/core/skills/spec-decomposer.ts:13:  static decomposeSpec(spec: ParsedSpec): DecomposedPlan {
```

---

## 7. Conflitos e Caminhos Duplicados (Passo I1.3)

### 7.1 Peças que Contradizem Linhas de Decisão ou Referência
1. **Verificação de Evidência forçada em Modo Sombra:**
   - `config/politicas-orquestracao.yaml:31`: `verificacao_evidencia: ativo` (definido no commit `bdb6ade`).
   - `src/core/decision/jev-execution-checks.ts:265`:
     ```ts
     // TODO: aguardando dados do modo sombra — executando em modo sombra
     const warningActiveMode =
       params.modo === "ativo"
         ? "TODO: aguardando dados do modo sombra — executando em modo sombra"
         : undefined;
     ```
     O código ignora o valor da configuração e nunca aplica o bloqueio/reprovação no modo ativo.

2. **Fluxo Real ignora Fases `MACROBRIEF` e `CONFERENCIA` da Referência:**
   - `docs/NEXTCODE-REFERENCIA.md:28`: "Fluxo padrão de 8 fases: ELICITACAO -> SPEC_REVISAO -> MACROBRIEF -> CONFERENCIA -> PLANEJAMENTO -> EXECUCAO -> VERIFICACAO -> ENTREGUE".
   - `src/core/orchestrator/session-phase.ts:124`: `const result = transition(ctx, event, { etapa1Ativa: false });`.
   - `src/core/orchestrator/phase-machine.ts:310`: `const nextPhase: Phase = opts.etapa1Ativa ? 'MACROBRIEF' : 'PLANEJAMENTO';`.
   - Como `etapa1Ativa` está cravado como `false`, toda transição de `SPEC_APROVADA` no chat ou gatilho salta direto para `PLANEJAMENTO`.

3. **Cascata e Rotas Gratuitas no Executor (Conflito desfeito em C1):**
   - Commit `786d393` tentou implementar cascata em `CONTINGENCY_EXECUTOR_MODELS` e rotas gratuitas para o executor.
   - `memory/decisoes.md` (13/10) e commit `f19152c`: Executor não usa cascata e papéis críticos ficam restritos a `custom/` (Regra de ouro: executor não alucina em modelos fracos/gratuitos).

### 7.2 Caminhos Duplicados para a Mesma Função
1. **Classificação de Intenção do Usuário no Chat:**
   - Caminho 1: `classifyMessage` / `classifyMessageDeterministic` (`src/core/orchestrator/message-intent.ts:73,173`).
   - Caminho 2: `evaluateChatFanOutWithJev` / `askJevBatch` (`src/core/decision/jev-decisions.ts:983,1065`).
   - Caminho 3 (desconectado): `decideSpecReviewMessageIntent` (`src/core/decision/jev-decisions.ts:37`).
   - O chat tenta primeiro o fan-out unificado e se não vier do Jev cai de volta para `classifyMessage`.

2. **Decomposição da Spec em Tarefas/Microbriefs:**
   - Caminho 1: `SpecDecomposerSkill.decomposeSpec` (`src/core/skills/spec-decomposer.ts:13`) — divisão puramente mecânica e determinística por TypeScript.
   - Caminho 2: `splitNodesByJev` (`src/core/orchestrator/node-split.ts:36`) — divisão acionada via decisão do Jev `m3_planejamento_microbriefs_lote`.
   - Caminho 3: `partitionRepairsByCluster` (`src/core/templates/artifact-templates.ts:1435`) — particionamento de lacunas por cluster no portão de entrega final.

---

## 8. Resumo: Quantas Peças em Cada Classificação

### Tabela A (Peças dos 20 Commits — Total: 29 peças listadas)
- `LIGADO`: 22 peças
- `CALCULADO_DESCARTADO`: 0 peças
- `DESLIGADO_CONFIG`: 1 peça (`renderDeliveryAuditReportMarkdown`)
- `SO_TESTES`: 5 peças (`renderMacrobriefMarkdown`, `verifyMacrobriefCoverageWithJev`, `renderMicrobriefReparoMarkdown`, `partitionRepairsByCluster`, `UniversalDocsFetcher`)
- `MORTO`: 1 peça (`decideSpecReviewMessageIntent`)
- `INCERTO`: 0 peças

### Tabela B (16 Decisões do Jev no Código — Total: 16 decisões)
- `LIGADO`: 10 decisões (`m3_planejamento_microbriefs_lote`, `jev_graphify_eligibility`, `p4_chat_fanout`, `failure_diagnosis`, `skill_install_guard`, `final_project_delivery_audit`, `secret_guard`, `secret_guard_chat`, `m0_peneira_afunilamento_universal`, `classificacao_mensagem`)
- `CALCULADO_DESCARTADO`: 2 decisões (`m2_clareza_spec`, `evidence_check`)
- `DESLIGADO_CONFIG`: 0 decisões
- `SO_TESTES`: 2 decisões (`m5_seguranca_pesquisa_t7`, `macrobrief_coverage_conference`)
- `MORTO`: 2 decisões (`m1_intencao_revisao_spec`, `m4_verificacao_cascata_sde`)
- `INCERTO`: 0 decisões

### Tabela C (8 Fases + 4 Papéis — Total: 12 itens)
- `LIGADO`: 7 itens (`ELICITACAO`, `SPEC_REVISAO`, `PLANEJAMENTO`, `EXECUCAO`, `VERIFICACAO`, `ENTREGUE`, `Avaliador de outro modelo`)
- `CALCULADO_DESCARTADO`: 0 itens
- `DESLIGADO_CONFIG`: 2 itens (`MACROBRIEF`, `CONFERENCIA` — desligados por `etapa1Ativa: false`)
- `SO_TESTES`: 3 itens (Skill `elicitador`, Skill `analista`, Pesquisa oficial T7)
- `MORTO`: 0 itens
- `INCERTO`: 0 itens

---

## 9. Escopo: `git diff --stat <partida>..HEAD` Real
- Ponto de partida: `15176ce`
- Saída conferida antes do commit R:
```
 scripts/diag-inventario-trilha.ts             | 169 ++++++++++++++++++++++++++
 docs/relatorios/I1-inventario-ligado-desligado.md | 500 ++++++++++++++++++++++++++
 2 files changed, 669 insertions(+)
```
Apenas os 2 arquivos novos estipulados na trava T-B foram criados; nenhum arquivo existente foi alterado.

---

## 10. Desvios do Prompt
Nenhum desvio de escopo ou de travas. Todas as instruções da Regra Zero e das Travas T-A a T-O foram integralmente cumpridas.

---

## 11. Checklist de Travas (T-A … T-O)
- [x] **T-A**: `git status --short` conferido; partida em `15176ce`.
- [x] **T-B**: Apenas 2 arquivos novos (`scripts/diag-inventario-trilha.ts` e `docs/relatorios/I1-inventario-ligado-desligado.md`). Nenhum outro arquivo criado ou alterado.
- [x] **T-C**: Literalidade e precisão dos dados.
- [x] **T-D**: Todos os nomes e funções conferidos com `git grep -n` e saídas brutas coladas.
- [x] **T-E**: Dois commits separados (Commit D para o script, Commit R para o relatório), com `npx tsc --noEmit` (0 erros) e `npx vitest run` 100% verde (760/760 testes).
- [x] **T-F**: Banco original `prisma/dev.db` jamais aberto/modificado: script operou sobre cópia em `<tmp>/nc-diag-i1/dev-copy.db`.
- [x] **T-G**: Sem segredos nem dados confidenciais expostos.
- [x] **T-H**: Nenhum pacote novo instalado.
- [x] **T-I**: Arquivos salvos em LF.
- [x] **T-J**: Nenhuma chamada externa a LLM ou rede durante a análise.
- [x] **T-K**: Commits com trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- [x] **T-L**: Relatório fiel, com `git show --stat` e `git diff --stat` reais.
- [x] **T-O**: Nenhum arquivo paralelo mantido no repositório.

---

## 12. Sugestões de Melhoria (Nada Implementado)
1. **Conectar ou remover as decisões mortas/órfãs:** `decideSpecReviewMessageIntent` e `decideSdeCascadeEscalation` não possuem chamadores em produção. Ou são unificadas no fluxo oficial ou devem ser removidas para evitar código morto.
2. **Sanar o descompasso de `verificacao_evidencia`:** A política define `ativo`, mas o código em `jev-execution-checks.ts:265` força a execução como sombra. Deve-se unificar a governança.
3. **Ativar `etapa1Ativa` ou unificar o fluxo de intake (Passo P5):** O salto direto de `SPEC_REVISAO` para `PLANEJAMENTO` deixa `MACROBRIEF`, `CONFERENCIA`, `IntakeEngine` e as skills `elicitador` e `analista` isoladas nos testes. O próximo pacote aprovado (P5) deve harmonizar a entrada como pensada.

---

## 13. Dúvidas para o Fundador
1. No pacote P5 ("Entrada como pensada"), a intenção é ativar `etapa1Ativa: true` em `session-phase.ts` e integrar o `IntakeEngine` real na rota `/api/chat`, ou manter a decomposição mecânica rápida de `SpecDecomposerSkill`?
2. A decisão M2 (`decideSpecClarity`) deve passar a bloquear/retornar apontamentos na Spec quando reprovada, ou continuar como verificação opcional não-bloqueante?
