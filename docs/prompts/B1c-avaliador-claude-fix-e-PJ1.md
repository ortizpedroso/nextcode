# Prompt B1c + PJ1 — corrigir o avaliador Claude direto, medir de novo; projetos e sessões soltas

> Itens **B1c** e **PJ1** da referência §5.0 (auditoria do B1, diário 73–74; mudança 11). **Não executar** sem 「aprovado B1c」 do fundador.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa B1c + PJ1

## OBJETIVO
1. **B1c.** A auditoria do B1 (diário 73) mostrou que a variante `avaliador-claude` **não mediu o Opus**: em 47 chamadas de avaliação, só 3 tiveram veredito do Opus. O resto voltou `nenhum-pago`: o FreeLLMAPI dá 404 para o Opus, e o ramo Anthropic direto de `dispatchStrongEvaluator` (`src/core/llm/evaluator-models.ts` ≈136–250) devolveu **sem texto e sem registrar falha** (só lê `antJson.content?.[0]?.text`), mais 1× `claude/direct: HTTP 400` sem o motivo. Os 4 BLOQUEADA vieram de `EVALUATOR_UNAVAILABLE`, não de reprovação. Corrigir o ramo direto, fazer o bench marcar execução invalidada por falha de rota e medir de novo só `avaliador-claude`.
2. **PJ1.** Projetos e sessões (fundador 16/10): o **Arquivar continua com o nome e a função atuais**; corrigir: (a) projeto arquivado não volta (a tela nunca lista arquivados); (b) abrir a mesma pasta cria projeto duplicado; (c) Apagar remove a pasta do disco sem perguntar; (d) sessão sem projeto que aprova a Spec executa gravando na pasta do próprio NextCode (`node-executor.ts:1038`, `process.cwd()`).

**Papéis (mudança 10, não mudar):** executor = DeepSeek; avaliador alvo = Claude → Nemotron → gratuitos medidos; executor e avaliador de famílias diferentes. **Não** mudar a ordem de `EVALUATOR_CHAIN` em produção nesta tarefa (isso é o B1b, depois deste resultado).

## REGRAS DE TRABALHO (fundador, obrigatórias)
- **R1 — Nada fora do prompt.** Só os arquivos de "PODE ALTERAR" de cada passo. Qualquer outro arquivo (inclusive "melhoria óbvia", formatação, documentação, diário, referência, skills) é proibido. Algo fora do escopo precisa mudar → **PARE e escreva no relatório**; o fundador decide.
- **R2 — Relatório sempre.** Ao fim de **cada** passo (inclusive os sem commit), acrescente uma seção em `docs/relatorios/B1c-PJ1.md` (formato §8.4) com: o que foi feito; `git show --stat <hash>`; saída real de `npx tsc --noEmit` e do resumo de `npx vitest run`; desvios e dúvidas; o que **não** foi feito. No fim, `git diff --stat <HEAD inicial>..HEAD` para provar R1.
- **R3 — Conclusão só com dado.** Toda afirmação sobre resultado do bench cita a trilha (`TelemetryLog` da cópia do banco: ação, contagem). Execução com falha de rota não é resultado de modelo.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra `.claude/` e `.serena/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/B1c-avaliador-claude-fix-e-PJ1.md`. Diferente → PARE.
- **T-B Escopo (R1).** Proibido alterar `config/`, `bench/aceite/`, `bench/specs/`, `bench/projetos/`, `skills/`, `prisma/schema.prisma`, `docs/NEXTCODE-REFERENCIA.md`, `memory/diario.md`, `memory/decisoes.md`.
- **T-C Literalidade.** Nomes e formatos exatos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**; `npx tsc --noEmit` (0) e `npx vitest run` completo verde **no repositório principal**; saídas no relatório. Proibido `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`.
- **T-G Segredos.** Nenhuma chave em código, log, trilha ou relatório. Corpo de erro da Anthropic só truncado em 200 caracteres e sem cabeçalhos.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas.** Rodada do B1c.3 com custo acumulado > US$ 4,00 → PARE e relatório parcial. Contradição prompt × código → PARE.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-M** código gerado pelo bench roda só no contêiner de aceite (`docker/aceite/run.sh`).

## LEITURA OBRIGATÓRIA
- `src/core/llm/evaluator-models.ts` (todo); `tests/llm/evaluator-freellmapi.test.ts`.
- `src/core/llm/elicitador-claude.ts` — como o P5c lê a resposta da Anthropic.
- `src/core/orchestrator/node-executor.ts` — `makeBlindAuditDispatchFn` (≈486–540), `EVALUATOR_UNAVAILABLE`.
- `scripts/bench.ts`, `tests/bench/bench-relatorio.test.ts`; `docs/relatorios/B1-bench-avaliador-claude.md`.
- `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/sessions/[id]/route.ts`, `src/app/api/chat/route.ts` (≈325–360, aprovação), `src/core/orchestrator/execution-trigger.ts` (`approveSpecAndStart`, `ApproveSpecResult`).
- `src/app/page.tsx` (`fetchProjects`, `handleDeleteProject`, `handleAttachSessionToProject`), `src/components/layout/sidebar.tsx`, `src/components/projects/project-actions-menu.tsx`, `src/components/projects/session-actions-menu.tsx`.
- `tests/api/projects-delete.test.ts`, `tests/core/session-attach.test.ts`.

---

## PASSO B1c.0 — Sonda da causa (sem commit, script fora do repo)
1 chamada real `POST https://api.anthropic.com/v1/messages`, `model: "claude-opus-5-5"`, `max_tokens: 8000`, com `system` + 1 mensagem `user` no formato do avaliador (pode ser um Microbrief sintético curto + código curto, **sem** dado real de usuário). Registrar no relatório **só**: status HTTP, `stop_reason`, lista de `content[].type` na ordem, tamanho do texto de cada bloco `text`, `usage`. Repetir 1× com o mesmo pedido. Custo esperado < US$ 0,10.
Se algum status ≠ 200: registrar `error.type` e `error.message` (truncado 200). Conclusão no relatório: a causa confirmada (ex.: 1º bloco não é `text`) ou "não reproduzido".

## PASSO B1c.1 — Ramo Claude direto: ler o texto certo e registrar a falha

**PODE ALTERAR:** `src/core/llm/evaluator-models.ts` (somente o ramo Anthropic direto, ≈136–250), `tests/llm/evaluator-freellmapi.test.ts` (testes novos).
1. Texto da resposta = concatenação de **todos** os blocos `content[]` com `type === "text"`, na ordem (ignorar outros tipos). Mesmo critério nas duas chamadas (a normal e a da auto-recuperação 404).
2. Resposta 200 sem texto → `failures.push("claude/direct: sem texto (stop_reason=<x>; blocos=<tipos>)")`.
3. Status ≠ 200 → `failures.push("claude/direct: HTTP <status> <error.type>: <error.message truncada 200>")` (ler o corpo JSON com `.catch`).
4. Nada mais muda (cadeia, prefixos, `independent`, custo, auto-recuperação).
Testes novos (fetch mockado, como os existentes): (a) resposta `[{type:"thinking"},{type:"text",text:"VEREDITO"}]` → `content` = "VEREDITO", `provider` = "claude"; (b) 200 só com bloco não-texto → `content` null e `failures` contém "sem texto"; (c) 400 com corpo de erro → `failures` contém "HTTP 400" e a mensagem; (d) teste existente do caminho feliz continua verde.
Commit: `fix(avaliador): ramo Claude direto le blocos de texto e registra falha (B1c.1)`.

## PASSO B1c.2 — Bench: execução invalidada por falha de rota

**PODE ALTERAR:** `scripts/bench.ts`, `tests/bench/bench-relatorio.test.ts`.
1. Em `MetricasExecucao`, campo novo `avaliadorIndisponivel: number` = contagem de `EVALUATOR_UNAVAILABLE` da sessão, e `avaliacoesPorProvedor: Record<string, number>` = contagem de `EVALUATOR_MODEL` por `details.provider`.
2. Na tabela do relatório markdown: colunas "Aval. indisp." e "Aval. por provedor"; quando `avaliadorIndisponivel > 0`, a fase aparece como `<fase> (INVÁLIDA: rota)` e a linha **não entra** nas médias por projeto × variante (rodapé diz quantas foram excluídas).
3. Testes novos: (a) linha com `avaliadorIndisponivel > 0` marcada INVÁLIDA e fora da média; (b) linha sem indisponibilidade inalterada.
Commit: `feat(bench): marca execucao invalida por falha de rota do avaliador (B1c.2)`.

## PASSO B1c.3 — Rodada só `avaliador-claude`
```bash
npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes avaliador-claude --repeticoes 1
```
**PODE ALTERAR:** novo `docs/relatorios/bench/YYYY-MM-DD-HHmm.md` (+ `.yaml` gerado), `memory/medicoes.md` (só acrescentar seção datada no fim), relatório R2.
Baseline: `padrao` de `docs/relatorios/bench/2026-10-16-1658.md` (4/4, US$ 0,19) — não rodar de novo.
Por projeto: fase, aceite, reprovações e se procedentes (o REQ estava mesmo errado? conferir no código entregue), custo executor/avaliador/total da trilha, `avaliacoesPorProvedor`, `avaliadorIndisponivel`, `failures` distintos do `EVALUATOR_MODEL`.
Execução INVÁLIDA (rota) → repetir aquele projeto 1×; se repetir INVÁLIDA → PARE e relatório (causa nas `failures`).
**Porta B1c:** P1–P4 válidas, com o Opus em ≥ 90% das `EVALUATOR_MODEL` de cada projeto.
Commit: `docs: bench B1c avaliador Claude corrigido`.

---

## PASSO PJ1.1 — Arquivados visíveis e Desarquivar

**PODE ALTERAR:** `src/app/page.tsx`, `src/components/layout/sidebar.tsx`, `src/components/projects/project-actions-menu.tsx` (só se precisar), testes novos em `tests/components/` ou `tests/api/` seguindo o padrão existente.
1. A tela busca `/api/projects?includeArchived=true` (a rota já aceita).
2. Barra lateral: lista ativa igual à de hoje; abaixo, seção recolhida **"Arquivados (n)"** (fechada por padrão) com os arquivados; cada um com o menu atual, onde "Desarquivar" já existe.
3. O texto "Arquivar" e o que ele faz (`isArchived`, nenhum arquivo do disco) **não mudam**.
Commit: `feat(projetos): lista de arquivados com desarquivar (PJ1.1)`.

## PASSO PJ1.2 — Abrir a mesma pasta não duplica

**PODE ALTERAR:** `src/app/api/projects/route.ts`, `tests/api/projects-open-existing.test.ts` (novo).
No `POST`, depois de resolver `targetPath` e **antes** de criar pasta ou arquivos: se existir `Project` com o mesmo caminho (comparar `path.resolve` e, no Windows, sem diferenciar maiúsculas), atualizar esse registro para `isArchived: false` e devolver `{ success: true, project, reopened: true }` com o mesmo formato de hoje, sem tocar no disco. Senão, comportamento atual.
Testes: (a) 2º POST com a mesma pasta devolve o mesmo `id`, `reopened: true`, e desarquiva; (b) pasta nova continua criando.
Commit: `feat(projetos): abrir pasta existente reabre o projeto (PJ1.2)`.

## PASSO PJ1.3 — Apagar pergunta sobre a pasta

**PODE ALTERAR:** `src/app/api/projects/[id]/route.ts`, `src/app/page.tsx`, `src/components/layout/sidebar.tsx` (só repassar a escolha), `src/components/projects/project-actions-menu.tsx`, `tests/api/projects-delete.test.ts`.
1. `DELETE /api/projects/[id]?apagarPasta=true|false`. **Sem o parâmetro = `false`** (não apaga a pasta). Só com `true` roda o bloco atual de remoção física (com a trava atual).
2. Na tela, a confirmação de Apagar oferece duas opções explícitas: "Remover só do NextCode (a pasta fica no computador)" e "Remover e apagar a pasta do computador"; a 2ª mostra o caminho da pasta. Usar o diálogo que já existe no menu (`showDeleteConfirm` em `project-actions-menu.tsx`) trocando o botão único por esses dois; sem `window.confirm`/`alert`.
3. Testes: sem parâmetro → registro removido e pasta **existe**; `apagarPasta=true` → comportamento atual.
Commit: `feat(projetos): apagar pergunta se remove a pasta do disco (PJ1.3)`.

## PASSO PJ1.4 — Sessão sem projeto não executa

**PODE ALTERAR:** `src/app/api/chat/route.ts` (bloco de aprovação ≈325–360), `src/app/api/sessions/[id]/route.ts` (antes de `approveSpecAndStart`), testes novos `tests/intake/aprovacao-sem-projeto.test.ts`; e, **só se algum teste existente quebrar por esta trava**, o fixture desse teste para criar a sessão com projeto (listar cada arquivo e linha no relatório).
1. Antes de chamar `approveSpecAndStart`: se a sessão não tem projeto ou o projeto não tem `path` → não aprova; resposta com `reason: "SESSAO_SEM_PROJETO"` e, no chat, a mensagem: "⚠️ Para executar, vincule esta sessão a um projeto com pasta (menu da sessão → mover para projeto). A Spec continua salva." A conversa e a Spec seguem normais.
2. **Não** alterar `approveSpecAndStart` nem o bench (o bench já cria projeto com pasta).
3. Testes: (a) sessão sem projeto pedindo aprovação → recusa `SESSAO_SEM_PROJETO`, fase não muda, nenhum `Job`; (b) a mesma sessão depois de vinculada (`PATCH /api/sessions/[id]` com `projectId`) → aprovação segue.
Commit: `feat(sessoes): sessao sem projeto so executa depois de vinculada (PJ1.4)`.

## PASSO PJ1.5 — Smoke na tela (sem commit de código)
Com o servidor local: arquivar e desarquivar um projeto de teste; abrir a mesma pasta de novo (não duplica); apagar escolhendo "só do NextCode" (pasta fica); criar sessão ad-hoc, pedir aprovação (recusa com a mensagem), vincular, aprovar. Registrar no relatório o resultado de cada item (o que apareceu na tela). Não usar projeto real do fundador.

## PASSO FINAL — Fechamento
Fechar `docs/relatorios/B1c-PJ1.md`: causa do B1c.0, tabela do B1c.3 × baseline `padrao`, resposta com números (o Opus avaliando muda aceite/reprovações? custo a mais?), resultados PJ1, desvios, `git diff --stat` (R1). Commit: `docs(relatorio): B1c e PJ1 fechamento`.

===== FIM DO PROMPT =====
