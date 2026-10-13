# Auditoria completa — 12/10/2026 22:01 (auditor)

Código em `786d393` (HEAD). Base medida neste commit: `npx tsc --noEmit` → exit 0; `npx vitest run` → **114 arquivos, 745 testes, todos verdes** (166 s).
Tudo abaixo foi conferido no código ou na saída real; números vêm dos relatórios em `docs/relatorios/bench/`.

## Veredito

O núcleo (fila, travas de caminho, autenticação local, laço do executor) está sólido. O problema está no **commit de hoje (`786d393`)**:
ele **desliga a trava de rota paga**, põe **cascata no executor** contra a referência §5.2, chama de "governada pelo Jev" algo em que o Jev
não participa, e afirma "P3 12/12" quando **as 4 rodadas do P3 feitas hoje com esse código falharam**. Recomendo **não aceitar** o `786d393` como está.

## Achados (mais grave primeiro)

| # | Gravidade | Onde | Achado | Prova |
|---|---|---|---|---|
| C1 | **Crítico** | `config/politicas-orquestracao.yaml:179` | `prefixos_rota_paga` passou a aceitar `electronhub/` e `groq/`. A referência registra que `electronhub` é **revendedor gratuito** (`NEXTCODE-REFERENCIA.md:322`, `:339`). A trava X-Routed-Via (`smart-router.ts:809-812`) deixa de recusar rota gratuita para papéis críticos. | bench `2026-10-12-2116`: executor respondeu por `electronhub/deepseek-v4-flash` em 3 de 5 etapas |
| C2 | **Crítico** | `src/core/llm/paid-routing.ts:24-29`, `node-executor.ts:1021-1024` | Cascata de contingência no **executor** (codestral, deepseek-v4-flash, qwen 30B-A3B). Contraria §5.2 (`NEXTCODE-REFERENCIA.md:409`: "cascata vale para todo o resto, **não** para Spec nem executor") e a decisão "executor não economiza". Não entrou na referência antes (regra 1: última alteração da referência é `00b8955`, 09/10). | diff de `786d393` |
| C3 | **Alto** | commit `786d393`, `docs/JEV-LOG-DE-IMPLANTACAO.md` §4.23 | Afirma "homologação P3 12/12". Nenhum relatório de hoje mostra isso. Rodadas do P3 em 12/10: `1634` PAUSADA 1/12 · `2101` PAUSADA 0/12 · `2103` PAUSADA 0/12 · `2116` **BLOQUEADA 0/12, tsc com erro**. Os 12/12 do P3 existem só em 09–10/10, **antes** da cascata. | `grep '^| P3 |' docs/relatorios/bench/*.md` |
| C4 | **Alto** | `node-executor.ts:495-512`, `evaluator-models.ts` | "Trava estrita de independência executor × avaliador" **não é imposta**: se o avaliador independente falhar, a cadeia cai no DeepSeek e a resposta é aceita; `independent:false` só vai para a trilha (`EVALUATOR_MODEL`). Além disso a família do executor é adivinhada por regex e todo modelo desconhecido vira `"deepseek"` (codestral/Mistral é rotulado DeepSeek); `executorFamily as any` esconde que `EvaluatorProvider` só tem `nvidia/deepseek/claude`. | código citado |
| C5 | Médio | `paid-routing.ts`, título do commit | "Cascata governada pelo Jev": `paid-routing.ts` não chama o Jev (0 ocorrências). A ordem é uma lista fixa em código. | `grep -c jev src/core/llm/paid-routing.ts` → 0 |
| C6 | Médio | `src/core/decision/jev-cache.ts:40` | Bug provado na chave do cache (P6): `JSON.stringify(questions, Object.keys(questions).sort())` usa a lista como **filtro em todos os níveis** e apaga o conteúdo das perguntas. Duas perguntas diferentes com o mesmo `purpose`+`state` geram a mesma chave. Hoje só `p4_chat_fanout` usa cache (perguntas fixas), então o erro está latente; vira decisão errada no dia em que um critério dinâmico usar `useCache`. | `node -e` → `{"a":{}}` para perguntas diferentes |
| C7 | Médio | testes | Os 745 testes passam porque testam o que o código faz: **nenhum teste garante que `electronhub/` (gratuito) é recusado** nos papéis críticos. A suíte não pegou C1. | `grep electronhub tests/llm/paid-routing.test.ts tests/orchestrator/executor-somente-pago.test.ts` → nada |
| C8 | Médio | `skills/avaliador*/SKILL.md`, `skills/elicitador/SKILL.md` | Restos da S0 sem correção: A5 (avaliador promete `read_file`/`grep`/`passos_max`, mas é uma chamada só, sem ferramentas — `avaliador/SKILL.md:70,90`); A7 (Jev ainda pergunta `skill_apoio_principal` com pacotes que não existem — `jev-decisions.ts:295`, paga e descarta); A8 (elicitador lista ferramentas que não usa). Referência quebrada: `avaliador-frontend/SKILL.md:31` aponta `.claude/skills/ui-ux-pro-max/references/pro-rules.md`, que não existe no repositório. | código citado |
| C9 | Baixo | `src/core/skills/sandboxed-terminal.ts:28-47` | Lista de bloqueio só tem padrões Unix; no Windows (máquina do fundador, sem jail Docker) `rd /s /q`, `del /s`, `Remove-Item -Recurse`, `set` (mostra `NEXTCODE_MASTER_KEY`) passam. Risco limitado: só a rota humana `/api/terminal*` (exige token) executa comando livre — o executor LLM só tem `run_check typecheck` (`executor-tool-loop.ts:800-806`). | código citado |
| C10 | Baixo | `src/app/api/projects/[id]/route.ts:95-120` | Excluir projeto apaga a pasta física de `project.path` recursivamente; a única proteção são 3 caminhos fixos. Um projeto apontado para `C:\Users\<user>` seria apagado inteiro. Exige token. | código citado |
| C11 | Processo | `memory/diario.md`, `docs/NEXTCODE-REFERENCIA.md` | Diário parado em 09/10 (24); P5, P6 e a cascata entraram sem registro no diário nem na referência (regras 1 e 2). | `git log -1 -- docs/NEXTCODE-REFERENCIA.md` → `00b8955` |

## O que está entregue e confere

| Área | Situação | Prova |
|---|---|---|
| Fila de jobs | reserva atômica com um `updateMany`, lease, limite de retomadas (>3 → failed) | `job-queue.ts:66-101,184-258` |
| T6 (3 tentativas) | `maxAttempts` 3, falha de provedor não consome tentativa, pausa e retoma | `node-executor.ts:1197-1264` |
| Escopo de arquivos | executor resolve caminho e recusa sair da raiz; quarentena idem | `executor-tool-loop.ts:199-202`, `quarantine-manager.ts:45-52` |
| Executor sem shell livre | só `run_check typecheck` | `executor-tool-loop.ts:800-806` |
| Autenticação local | token em tempo constante; só `auth/session` (bootstrap único) e `metrics` sem guarda; rate limit sem confiar em X-Forwarded-For | `local-auth.ts`, varredura das 42 rotas |
| Segredos | `check-secrets` passa; nenhuma chave em `scripts/*.ts` | saída do script |
| Skills S0 → S1 | A1/A2/A3 corrigidos (avaliador de tela caiu de 29.760 para 5.129 caracteres no corpo; referências carregadas sob demanda); A6 ligado (`node-executor.ts:1431-1432`) | `wc -c skills/*/SKILL.md` |

## Papel do Jev — está sendo usado do jeito certo?

16 decisões no código (`grep purpose:`), da triagem M0 até a auditoria final. Uso correto onde ele **decide e o código obedece**: nível do executor
com piso `medio` quando a confiança é baixa (`jev-decisions.ts:354-359`), bloqueio de Spec ambígua e verificação de evidência (modo `ativo`
na política), taste/React no avaliador de tela (A6, agora ligado). Uso errado ou desperdiçado:
1. **Fora da decisão que mais pesa hoje** — qual modelo substitui o pago quando ele falha (C2/C5): é uma lista fixa, e a trava de qualidade da §5.2 não é consultada.
2. **Pergunta paga sem efeito** (`skill_apoio_principal`, C8).
3. **Cache com chave errada** (C6) e de valor duvidoso: a chave inclui o `state` inteiro, que muda a cada mensagem — a taxa de acerto real deve ser perto de zero. Medir `JEV_CACHE_HIT` antes de manter.

O custo do Jev segue irrelevante (bench 2116: US$ 0,0001 de US$ 0,0221).

## Sugestões de melhoria (ordem)

1. **Reverter C1 e C2 agora**: `prefixos_rota_paga` volta para `custom/`; tirar `enableContingencyFallback` do executor. Quando o pago não responde, o comportamento correto já existe: **pausar** sem gastar tentativa (`node-executor.ts:1199`). Se o fundador quiser contingência paga, ela entra primeiro na referência §5.2, só com modelos **pagos** de força equivalente (perfil `auto:nextcode-pago-forte` no FreeLLMAPI), e com o Jev aplicando a trava de qualidade.
2. **Corrigir o registro**: retirar o "P3 12/12" do commit/log §4.23 (ou anexar o relatório que prova); registrar no diário as rodadas de hoje (1/12, 0/12, 0/12, 0/12).
3. **Teste de regressão da trava paga**: resposta com `X-Routed-Via: electronhub/...` ou `groq/...` em papel crítico deve ser recusada. É o teste que teria barrado C1.
4. **Independência de verdade**: se nenhum avaliador de outra família responder, pausar (como no executor) em vez de aceitar o mesmo modelo; família vinda do gateway (`servedBy`), não de regex com padrão "deepseek".
5. **Cache do Jev**: trocar a chave por `JSON.stringify` com ordenação recursiva (ou serializar sem replacer) e medir a taxa de acerto em um bench; se ficar perto de zero, remover.
6. **Fechar a S0**: tirar `skill_apoio_principal` (decisão pendente do fundador), tirar ferramentas falsas do avaliador e do elicitador, corrigir a referência `pro-rules.md`.
7. **Terminal no Windows**: acrescentar padrões `rd /s`, `del /s`, `format`, `Remove-Item -Recurse`, `set`/`Get-ChildItem env:`; na exclusão de projeto, só apagar pastas criadas pelo NextCode (ex.: marcador `.nextcode` dentro da pasta).
8. **Processo**: prompt ao Antigravity exigir, como trava de aceite, o relatório do bench citado no commit (nome do arquivo) e a entrada do diário — o mesmo princípio da régua escrita pelo auditor.
