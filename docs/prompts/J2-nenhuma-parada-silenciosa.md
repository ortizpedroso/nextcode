# Prompt J2 — Nenhuma parada silenciosa + auditoria final do Jev em modo sombra

> Origem: J1 (`docs/relatorios/J1-diagnostico-entrega-jev.md`, auditoria do Claude no diário, entradas 32–33) e decisão do
> fundador de 13/10 (`memory/decisoes.md`; referência §5.5). Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa J2 — o NextCode nunca para calado; auditoria final do Jev passa a modo sombra

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro e a LEITURA OBRIGATÓRIA antes de alterar qualquer arquivo. Na seção 0 do relatório, escreva em 6 linhas o que vai mudar.
2. **Faça exatamente o que está escrito, nada além.** Não melhore, não refatore, não renomeie, não mude texto de mensagens existentes.
3. **Não se mexe no que está funcionando.** Os avisos que já existem (etapa bloqueada `reportBlockedNodeToHuman`, teto de custo `enforceBudgetBeforeBatch`, pausa sem LLM em `node-executor.ts`) continuam **idênticos**.
4. Achou outro problema? Não conserte: anote em "Sugestões de melhoria".
5. Precisou mexer em algo não descrito, o trecho citado não existe como descrito, ou um teste **existente** fora da lista PODE ALTERAR quebrou → **PARE** e relate. Dúvida → **PARE e pergunte.**

## OBJETIVO (decisão do fundador, 13/10)
- Toda parada da sessão gera **aviso no chat** e tem saída. Nada de sessão parada sem ninguém saber.
- A auditoria final do Jev (`verifyProjectDeliveryWithJev`) deixa de bloquear a entrega (**modo sombra**): o J1 mediu que ela reprova até código correto (P1 de referência 0/5), porque 2 das 6 perguntas têm a polaridade invertida. Ela volta a bloquear só depois de corrigida e provada (J3/J4). Nenhum limiar muda.
- Prazo do fundador para avisos de pausa e de silêncio: **5 minutos**.
- Reparo automático da entrega **não** entra aqui (fica para o J2b).

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/J2-nenhuma-parada-silenciosa.md`. Diferente → PARE.
- **T-B** PODE ALTERAR (só o descrito em cada passo): `src/core/config/orchestration-policy.ts`, `config/politicas-orquestracao.yaml`, `src/core/orchestrator/job-queue.ts`, `src/core/orchestrator/session-phase.ts`, `src/core/orchestrator/phase-machine.ts`, `src/core/orchestrator/job-worker.ts`, `src/core/orchestrator/budget-guard.ts`, `docs/ARQUITETURA-ORQUESTRACAO.md` (1 linha, J2.3), `tests/harness/orchestration-policy-and-skills.test.ts`, `tests/orchestrator/jev-delivery-gate.test.ts`, `tests/orchestrator/phase-machine.test.ts` (só a lista `SAMPLE_EVENTS`). PODE CRIAR: `src/core/orchestrator/human-notice.ts`, `tests/orchestrator/sem-parada-silenciosa.test.ts`, `docs/relatorios/J2-nenhuma-parada-silenciosa.md`. Mais nada.
- **T-C** Literalidade: nomes, textos de mensagem e valores exatamente como abaixo. **T-D** todo nome citado conferido com `git grep -n` antes de usar.
- **T-E** um commit por passo (J2.1 … J2.6) + commit R do relatório; **cada** commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde, saídas coladas no relatório. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-F** nunca escreva em `prisma/dev.db` (os testes usam `prisma/test.db`, `vitest.config.ts`). **T-G** nenhum segredo em código, teste, saída ou relatório. **T-H** nenhum pacote novo.
- **T-I** preservar o fim de linha de cada arquivo alterado; arquivos novos em LF. **T-K** commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L** relatório fiel: saídas brutas coladas (inclusive `git diff --stat` real); "Desvios" obrigatório e verdadeiro. **T-N** nenhuma chamada real a LLM ou ao Jev (tudo com mock). **T-O** nenhum plano ou log paralelo.

## LEITURA OBRIGATÓRIA
- `src/core/orchestrator/phase-machine.ts` (tipos `PhaseEvent`, `PhaseEffect`; fases `EXECUCAO`, `BLOQUEADA`, `VERIFICACAO`; `transition`).
- `src/core/orchestrator/session-phase.ts` (`ApplyPhaseEventOptions`, `applyPhaseEvent`).
- `src/core/orchestrator/job-queue.ts` ~286-430 (verificação de entrega e o `catch` do job).
- `src/core/orchestrator/job-worker.ts` (`supervisePausedSessions`, `superviseExecutionQueue`, `runOnce`).
- `src/core/orchestrator/budget-guard.ts` (`enforceBudgetBeforeBatch`), `src/core/orchestrator/node-executor.ts:139-190` (`reportBlockedNodeToHuman`), `src/core/orchestrator/session-queue.ts:87,201`.
- `src/core/config/orchestration-policy.ts` (`jevExecucao`, padrão de `verificacaoEvidencia` ~111, ~295, ~523).
- `src/core/governance/secret-guard.ts` (`isHighEntropySecretLiteral`), `src/core/telemetry/telemetry-logger.ts`.
- `tests/orchestrator/jev-delivery-gate.test.ts` (modelo de teste com `enqueueSessionQueueJob`/`claimJob`/`executeClaimedJob` e mocks).

---

## PASSO J2.1 — Auditoria final do Jev com interruptor (padrão: sombra)
1. `orchestration-policy.ts`: em `jevExecucao` acrescente `auditoriaEntrega: "ativo" | "sombra" | "desligado";`; no padrão `DEFAULT_ORCHESTRATION_POLICY`, `auditoriaEntrega: "sombra",`; leitura da chave YAML `auditoria_entrega` **igual** à de `verificacao_evidencia` (mesmos três valores; inválido mantém o padrão).
2. `config/politicas-orquestracao.yaml`: logo abaixo da linha `verificacao_evidencia`, acrescente exatamente:
   `  auditoria_entrega: sombra          # ativo | sombra | desligado (J2, 13/10: sombra até J3/J4 provarem as perguntas)`
   (`docs/rascunhos/politicas-orquestracao.yaml` não tem `jev_execucao`: **não** mexa nele.)
3. `job-queue.ts`, bloco "Auditoria Final do JEV": leia `loadOrchestrationPolicy().jevExecucao.auditoriaEntrega` (import de `@/core/config/orchestration-policy`).
   - `"desligado"`: não chama `verifyProjectDeliveryWithJev` (nenhum código vai ao Jev).
   - `"ativo"`: comportamento atual, sem nenhuma mudança.
   - `"sombra"`: chama `verifyProjectDeliveryWithJev` como hoje, **não** altera `deliveryT10`, **não** grava o laudo no chat, e registra `TelemetryLogger.log({ sessionId: job.sessionId, action: "JEV_FINAL_DELIVERY_AUDIT_SOMBRA", details: { modo: "sombra", aprovadoJev: jevAudit.aprovado, jevDisponivel: jevAudit.jevDisponivel, scores: jevAudit.scores, lacunas: jevAudit.lacunas.map((l) => l.categoria) } })`.
4. Testes:
   - `orchestration-policy-and-skills.test.ts`: nos 3 `toEqual` de `jevExecucao` (~47, ~70, ~108), acrescente `auditoriaEntrega` com o valor que o carregador devolve em cada caso (confira: `"sombra"`, salvo se o YAML do teste definir outro). Nada mais.
   - `jev-delivery-gate.test.ts`: o 1º teste fica como está. O 2º passa a provar o modo sombra: Jev reprova → fase `ENTREGUE`, **nenhuma** mensagem com `documento: laudo_auditoria_entrega`, e `TelemetryLogger.log` chamado com `action: "JEV_FINAL_DELIVERY_AUDIT_SOMBRA"` (use `vi.spyOn(TelemetryLogger, "log")`; não leia a trilha do banco, o log não é aguardado). Novo 3º teste: com `loadOrchestrationPolicy` mockado em `"ativo"` (padrão de `tests/decision/jev-evidence-check.test.ts:28-29`), Jev reprova → laudo no chat + fase `PLANEJAMENTO` (o J2.3 muda esta expectativa). Novo 4º teste: `"desligado"` → `verifyProjectDeliveryWithJev` não é chamado e a fase é `ENTREGUE`.
Commit: `feat(entrega): J2.1 - auditoria final do Jev com interruptor, padrao sombra`.

## PASSO J2.2 — Aviso ao humano num lugar só
1. CRIAR `src/core/orchestrator/human-notice.ts` com `export async function postHumanNotice(sessionId: string, motivo: string, detalhe?: string): Promise<void>` que:
   - grava `prisma.message.create({ data: { sessionId, role: "assistant", content } })` com `content` = `` `🛑 **Sessão bloqueada — ${motivo}.**` `` + (`detalhe` ? `"\n\n" + detalhe` : `""`) + `"\n\nPara continuar, responda aqui no chat dizendo o que ajustar: a Spec volta para revisão e, aprovada, a execução recomeça."`;
   - registra `TelemetryLogger.log({ sessionId, action: "HUMAN_NOTIFIED", details: { motivo } })`.
2. `session-phase.ts`: em `ApplyPhaseEventOptions` acrescente `avisoJaPostado?: boolean;` e `detalheAviso?: string;` (com comentário de 1 linha cada). Em `applyPhaseEvent`, quando `updated.count === 1`, depois de gravar `PHASE_TRANSITION` e antes do `return result`: para cada efeito `AVISAR_HUMANO` de `result.effects`, se `options?.avisoJaPostado !== true`, `await postHumanNotice(sessionId, efeito.motivo, options?.detalheAviso)`.
3. Quem já avisa passa `avisoJaPostado: true` (para não duplicar):
   - `job-queue.ts`, `applyPhaseEvent(job.sessionId, { type: "EXECUTOR_BLOQUEADO" })` → acrescente `{ avisoJaPostado: true }` (o aviso já sai em `reportBlockedNodeToHuman`, chamado em `session-queue.ts:87` e `:201`);
   - `budget-guard.ts`, `applyPhaseEvent(sessionId, { type: "TETO_CUSTO" })` → acrescente `{ avisoJaPostado: true }` (o aviso sai logo abaixo, `postOnce`).
4. CRIAR `tests/orchestrator/sem-parada-silenciosa.test.ts` (limpeza de registros no padrão de `jev-delivery-gate.test.ts`) com:
   - **(estrutural)** para toda fase de `Phase` e toda variante de `PhaseEvent` (inclua cada `MENSAGEM_CLASSIFICADA` com cada intenção e cada `ESCOLHA_INTERVENCAO`; ctx com `faseAntesDaPausa` e `faseAntesDoBloqueio` preenchidos; `etapa1Ativa` `true` e `false`): se `transition` devolve `ok` com fase final `BLOQUEADA` e a fase inicial não era `BLOQUEADA`, então `effects` contém `AVISAR_HUMANO`. Mantenha a lista de eventos do teste numa constante; os passos seguintes acrescentam os eventos novos nela;
   - `applyPhaseEvent` de `EXECUCAO` com `EXECUTOR_BLOQUEADO` **sem** `avisoJaPostado` → exatamente 1 mensagem contendo `Sessão bloqueada — executor esgotou 3 tentativas`; **com** `avisoJaPostado: true` → nenhuma mensagem nova.
Commit: `feat(orquestracao): J2.2 - aviso ao humano centralizado em applyPhaseEvent`.

## PASSO J2.3 — Entrega reprovada vai para BLOQUEADA com relatório
1. `phase-machine.ts`, fase `VERIFICACAO`, evento `VERIFICACAO_COM_LACUNAS`: passa a devolver `ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' }` e `effects: [{ type: 'AVISAR_HUMANO', motivo: 'entrega reprovada na verificação final' }]`.
2. `job-queue.ts`, `applyPhaseEvent(job.sessionId, { type: "VERIFICACAO_COM_LACUNAS" }, { extraDetails: … })`: acrescente nas opções `detalheAviso` = `"**Lacunas encontradas:**\n" + (deliveryT10.gaps.length > 0 ? deliveryT10.gaps.map((g) => `- ${g}`).join("\n") : "- (a verificação não detalhou a lacuna)")`.
3. `docs/ARQUITETURA-ORQUESTRACAO.md`: a linha `  VERIFICACAO --> PLANEJAMENTO: falta requisito/arquivo no disco (T10)` passa a ser exatamente `  VERIFICACAO --> BLOQUEADA: lacuna na T10 — avisa o humano (J2, 13/10); reparo automático no J2b`.
4. Testes: em `jev-delivery-gate.test.ts`, o 3º teste (modo ativo) passa a esperar `BLOQUEADA`. Em `sem-parada-silenciosa.test.ts`: com `verifyProjectDeliveryT10` mockado em `passed: false, gaps: ["Arquivo faltando: src/x.ts"]`, o job termina com a sessão em `BLOQUEADA` e 1 mensagem contendo `entrega reprovada na verificação final` e `Arquivo faltando: src/x.ts`; depois `applyPhaseEvent(DESBLOQUEIO_HUMANO)` leva a `EXECUCAO`.
Commit: `feat(orquestracao): J2.3 - entrega reprovada bloqueia e avisa com as lacunas`.

## PASSO J2.4 — Erro repetido no job bloqueia e avisa
1. `phase-machine.ts`: novo evento `{ type: 'FALHA_REPETIDA' }` em `PhaseEvent`; acrescente `'FALHA_REPETIDA'` em `allowedEvents` de `EXECUCAO` e de `VERIFICACAO`; nas duas, o handler devolve `ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' }` e `effects: [{ type: 'AVISAR_HUMANO', motivo: 'erro interno repetido na execução' }]`.
2. `job-queue.ts`: nova função exportada `handleJobFailureForSession(sessionId: string, errorMessage: string): Promise<void>`:
   - lê a fase da sessão; se `VERIFICACAO` → aplica `FALHA_REPETIDA` já (ninguém retoma `VERIFICACAO` sozinho);
   - se `EXECUCAO` → busca os 3 jobs mais recentes da sessão (`orderBy: { createdAt: "desc" }, take: 3`); se forem 3 e todos `status: "failed"` → aplica `FALHA_REPETIDA`;
   - outras fases → não faz nada;
   - `detalheAviso` = `` "**Último erro:** `" + seguro + "`" `` onde `seguro` = `errorMessage` cortado em 500 caracteres e com cada pedaço separado por espaço em que `isHighEntropySecretLiteral(pedaço)` for verdadeiro trocado por `[oculto]`.
   No `catch` de `executeClaimedJob`, quando `failedUpdate.count > 0`, descubra o `sessionId` do job (`prisma.job.findUnique({ where: { id: jobId }, select: { sessionId: true } })`) e chame `await handleJobFailureForSession(sessionId, errorMessage).catch(() => {})`.
3. Testes: `phase-machine.test.ts` → acrescente `{ type: 'FALHA_REPETIDA' }` em `SAMPLE_EVENTS` (só isso). `sem-parada-silenciosa.test.ts` → acrescente o evento na constante do teste estrutural; com `processSessionQueue` mockado para lançar `new Error("falha simulada")`, 3 jobs seguidos em `EXECUCAO`: após o 1º e o 2º a fase segue `EXECUCAO`; após o 3º, `BLOQUEADA` + 1 mensagem contendo `erro interno repetido na execução` e `falha simulada`; `handleJobFailureForSession` em sessão `VERIFICACAO` → `BLOQUEADA` na 1ª chamada; em `ELICITACAO` → nada muda.
Commit: `feat(orquestracao): J2.4 - erro repetido no job bloqueia a sessao e avisa`.

## PASSO J2.5 — Pausa longa (mais de 5 minutos) avisa de novo
1. `job-worker.ts`: `export const LONG_PAUSE_NOTICE_MS = 300_000;`. Em `supervisePausedSessions`, quando `reachable` for falso, antes do `return 0`, para cada sessão pausada:
   - início da pausa = `createdAt` do `telemetryLog` mais recente com `sessionId` da sessão, `action: "PHASE_TRANSITION"` e `details` contendo `"to":"PAUSADA"`; sem registro → pula a sessão;
   - se `agora − início ≥ LONG_PAUSE_NOTICE_MS` e **não** existe mensagem `assistant` da sessão criada depois do início contendo `Execução pausada há mais de 5 minutos` → grava a mensagem exatamente: `⏳ **Execução pausada há mais de 5 minutos:** nenhum provedor de modelo respondeu. A sessão continua guardada e retoma sozinha quando um provedor voltar. Confira crédito, cota e chaves dos provedores no painel.`
   - acrescente o parâmetro opcional `now: Date = new Date()` **depois** de `probeGatewayFn` (chamadas atuais continuam válidas).
2. Teste em `sem-parada-silenciosa.test.ts`: sessão `PAUSADA` com `phaseContext` contendo `faseAntesDaPausa: "EXECUCAO"` e `PHASE_TRANSITION` para `PAUSADA` gravado; `supervisePausedSessions(async () => false, <início + 6 min>)` → 1 mensagem; chamar de novo → continua 1; com `<início + 2 min>` → 0.
Commit: `feat(orquestracao): J2.5 - aviso de pausa longa apos 5 minutos`.

## PASSO J2.6 — Vigia de silêncio
1. `phase-machine.ts`: novo evento `{ type: 'SILENCIO_DETECTADO' }`; acrescente em `allowedEvents` de `PLANEJAMENTO`, `EXECUCAO` e `VERIFICACAO`; nas três, o handler devolve `ctx: { ...ctx, phase: 'BLOQUEADA', faseAntesDoBloqueio: 'EXECUCAO' }` e `effects: [{ type: 'AVISAR_HUMANO', motivo: 'parada sem atividade há mais de 5 minutos' }]`.
2. `job-worker.ts`: `export const SILENCE_NOTICE_MS = 300_000;` e nova função exportada `superviseSilentSessions(options?: { now?: Date; silenceMs?: number; force?: boolean; onlySessionIds?: string[] }): Promise<number>`, com o mesmo controle de intervalo de `superviseExecutionQueue` (variável própria, intervalo de 60 s; `force` ignora). Ela:
   - busca sessões com `phase` em `["PLANEJAMENTO", "EXECUCAO", "VERIFICACAO"]`, **sem** job `queued`/`running` e **sem** `taskNode` `running` (filtrando por `onlySessionIds` quando dado — usado só em teste);
   - última atividade = a mais recente entre `session.updatedAt`, a última `message.createdAt` e o último `telemetryLog.createdAt` da sessão;
   - se `agora − última atividade ≥ silenceMs` (padrão `SILENCE_NOTICE_MS`) → `applyPhaseEvent(id, { type: "SILENCIO_DETECTADO" }, { detalheAviso: "Fase em que parou: " + fase + ". Última atividade: " + ultima.toISOString() + "." })` e `TelemetryLogger.log({ sessionId: id, action: "QUEUE_STALLED", details: { reason: "silent_session", phase: fase } })`;
   - devolve quantas sessões bloqueou.
   Em `runOnce`, logo depois de `superviseExecutionQueue`, acrescente `await superviseSilentSessions().catch(() => 0);`.
3. Testes: `SAMPLE_EVENTS` de `phase-machine.test.ts` e a constante do teste estrutural recebem `{ type: 'SILENCIO_DETECTADO' }`. Em `sem-parada-silenciosa.test.ts` (sempre com `force: true` e `onlySessionIds`): sessão `VERIFICACAO` sem job, `now` = agora + 6 min → `BLOQUEADA` + 1 mensagem contendo `parada sem atividade há mais de 5 minutos` e `Fase em que parou: VERIFICACAO`; sessão `EXECUCAO` com job `queued` → não muda; sessão `ELICITACAO` → não muda; sessão `VERIFICACAO` com `now` = agora → não muda.
Commit: `feat(orquestracao): J2.6 - vigia de silencio bloqueia e avisa sessoes paradas`.

## RELATÓRIO — `docs/relatorios/J2-nenhuma-parada-silenciosa.md` (commit R: `docs(relatorio): J2 - nenhuma parada silenciosa`)
0. Leitura feita (6 linhas). 1. Identificação (partida e `git log --oneline <partida>..HEAD`). 2. Por commit: `git show --stat`, `tsc`, `vitest` (resumo bruto colado).
3. Para cada passo: o que mudou, com `arquivo:linha`. 4. Tabela "situação → antes → depois" para: entrega reprovada (T10, tela, Jev), erro repetido, pausa longa, silêncio, executor bloqueado, teto de custo.
5. Escopo: `git diff --stat <partida>..HEAD` **real, colado da saída**. 6. Desvios (obrigatório; "nenhum" só se for verdade). 7. Checklist T-A…T-O (sim/não com evidência).
8. Sugestões de melhoria (nada implementado). 9. Dúvidas para o fundador.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
