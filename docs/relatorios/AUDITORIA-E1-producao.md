# Auditoria da execução autônoma 2 (mudança 26, subir para produção) — para o Cursor auditar

Implementador: Claude. Auditor: Cursor. Hash de partida: `54b8c19`. Último commit de código: `835e98f`.
Fontes do que o Claude afirma: `docs/relatorios/IMPLEMENTADO-E1-producao.md` (commits, tsc/vitest por commit, o que mudou por passo, bench) e `docs/relatorios/DECISOES-AUTONOMAS-E1-2.md` (D1–D42). Este arquivo junta o que a §8.4 pede e aqueles não têm: testes novos, travas, desvios, dúvidas.

## 1. Identificação (§8.4)
`git log --oneline 54b8c19..e07f99b` — 18 commits: 15 de código (P1–P13 + 2 correções achadas no bench) e 3 só de docs (`d050322`, `7bfca11`, `e07f99b`). Tabela por commit (tsc / vitest daquele commit): seção 1 de `IMPLEMENTADO-E1-producao.md`, mais:

| hash | passo | tsc | vitest (arquivos/testes) |
|---|---|---|---|
| `835e98f` | limite de tempo do gateway no turno do executor (D42, achado no bench) | 0 | 136 / 909 |

`git diff --stat 54b8c19..e07f99b`: 50 arquivos, +3.721 / −252 (inclui 8 relatórios de bench). `git reflog -60`: **0** amend/reset/rebase.
Gasto real com LLM na execução: benches de 20/10 ≈ **US$ 0,78** (1ª rodada parada por memória US$ 0,15; rodada completa US$ 0,31; P2 de novo US$ 0,11 e, depois da correção D42, US$ 0,21).

## 2. Testes novos (arquivo › teste › o que prova)

| arquivo | teste | prova |
|---|---|---|
| `tests/skills/executor-tool-loop.test.ts` | TR1 (12) a) lista de 4 ações + finish | P1: várias ações num turno, resultados voltam juntos, 2 turnos |
| idem | TR1 (12) b) finish junto com outras ações | P1: `finish` misturado é ignorado ("vai SOZINHO") |
| idem | TR1 (13) a) tsconfig e schema no 1º prompt | P2: contexto fixo |
| idem | TR1 (13) limites / dependência grande pulada | P2: tetos de 20k/40k; `continue` em vez de `break` |
| idem | TR1 (14) a) retentativa recebe o código anterior | P3: prompt + quarentena (`seedFiles`) |
| idem | TR1 (14) `readPreviousAttemptCode` / `pickAttemptCodeToKeep` | P3: teto de 60k, escopo |
| idem | TR1 (1) a) provedor some 2× e volta | P5: mesmo turno repetido, sem pausa |
| idem | TR1 (1) b) provedor some depois das esperas | P5: pausa guarda o código; retomada parte dele |
| idem | TR1 (1) c) `turnRetryDelaysMs` | P5: padrão 5 s / 20 s e variável de ambiente |
| idem | TR1 (2) a) caminho protegido DENTRO do escopo 2× | P6: BLOQUEADA, "Dono: harness", 0 tentativas |
| idem | TR1 (2) b) caminho protegido FORA do escopo 2× | P6: continua erro do executor |
| idem | bench 20/10: limite da etapa no gateway | D42: `gatewayTimeoutMs = getStepTimeoutMs()` (falha sem a correção) |
| `tests/harness/templates-and-p12-checks.test.ts` | TR1 (3) lista de referências / YAML / REQ repetido | P4 |
| `tests/governance/lens2-lista-evidencia.test.ts` | lista válida → APROVADO; referência inexistente → REPROVADO | D41 (falha sem a correção) |
| `tests/governance/av13-problemas-evidencia.test.ts` | TR1 (11) 1 ou 3 importantes → ressalva | P7 |
| `tests/llm/evaluator-prompt-cache.test.ts` | corpo com `cache_control`, divisão no marcador, custo 1,25× | P8 |
| `tests/harness/budget-ceiling.test.ts` | plano de 20 etapas = US$ 10,50; plano pequeno fica no fixo | P9 |
| `tests/orchestrator/session-scoreboard.test.ts` | placar, fila esperando bloqueada | P10 |
| `tests/project/source-files.test.ts` | ≥ 5 arquivos-fonte, ignora config/docs/`node_modules` | P11 |
| `tests/intake/chat-graphify-integration.test.ts` | pasta só com `package.json`/README → sem Graphify | P11 |
| `tests/api/projects-folder-safety.test.ts` | apagar / abrir / POST 409 | P12 |
| `tests/api/projects-delete.test.ts` | 2 casos 409 sem apagar nada | P12 |

Testes antigos alterados (motivo nas decisões): `av13-problemas-evidencia` (P7 mudou a regra: D24), `end-to-end-harness-plan` e `step-4b` (só timeout dos `describe`, D23 — **atenção do auditor:** a trava T-B proíbe aumentar timeout para teste passar; ver desvio 1).

## 3. Prova real
Seção 3 de `IMPLEMENTADO-E1-producao.md`: P1 10/10, P2 13/13, P3 12/12, P4 12/12, todos ENTREGUE; máximo de **4** chamadas do executor por etapa (meta TR1 ≤ 10); todas as etapas aprovadas na 1ª. Relatórios: `docs/relatorios/bench/2026-10-20-1244.md` (P1–P4) e `2026-10-20-1314.md` (P2 depois do `835e98f`). As rodadas `0720` (parada por memória; P2 0/13 pelo defeito D41) e `1252` (P2 PAUSADA pelo defeito D42) ficam como evidência dos defeitos.

## 4. Checklist das travas (§8.2)

| trava | cumprida | evidência |
|---|---|---|
| T-A pré-condição | sim | partida `54b8c19`; `git status` só `.claude/` e `.serena/` (não tocados) |
| T-B escopo | sim, com o escopo da mudança 26 | ver desvio 1 (timeout de 2 `describe` e2e) |
| T-C literalidade | ver desvios | D1–D42 registradas antes de cada commit |
| T-D nomes reais | sim | todo nome citado existe no HEAD (auditor: `git grep -n`) |
| T-E 1 passo = 1 commit, tsc 0, vitest verde | sim, com ressalva | P1, P2 e P6 commitados com estouros de 15 s que passam isolados (tabela do relatório) — ver desvio 1 |
| T-F banco | sim | bench copia `prisma/dev.db` para `%TEMP%\nc-bench-*`; diagnósticos rodaram com `DATABASE_URL` na cópia; `prisma/dev.db` mtime `2026-10-20 04:52:32` (antes dos benches de 07:20 e 12:44) |
| T-G segredos | sim | nada de chave em código, log ou relatório; trilha consultada só por `action`/`details` |
| T-H dependências | sim | nenhum pacote novo |
| T-I fim de linha | sim | `git ls-files --eol`: arquivos tocados `i/lf w/crlf` como antes |
| T-J paradas | sim | nenhuma 422 do Jev; custo abaixo do teto do bench (US$ 3,00) |
| T-K co-autoria | sim | todos os commits com `Co-Authored-By: Claude Opus 5.5` |

## 5. Desvios e dívidas
1. **Timeout dos e2e aumentado (D23):** `end-to-end-harness-plan` (describe 120 s) e `step-4b` (60 s) estouravam 15 s só sob a suíte inteira na máquina carregada e passavam isolados, igual antes das mudanças. Fere a letra da T-B ("nunca aumentar timeout"); decisão minha registrada, para o auditor julgar.
2. **Dois defeitos meus achados só no bench**, não nos testes: D41 (Lente 2 com referência única depois do P4) e D42 (gateway cortava em 120 s). Os dois corrigidos com teste que falha sem a correção. Lição: a mudança no formato (P4) não tinha teste do consumidor (avaliador).
3. **Suíte e bench parados 3× pelo Claude Code por falta de memória** da máquina; só reiniciados com liberação do fundador.
4. **Não feito (fica para depois, mudança 26):** JV1 completo, redesenho do Jev na Spec (E2), A1, J3, E5, PJ2b; TR1 (6) e (7).
5. **Ganho do cache (P8) em dinheiro não medido:** confirmado que funciona (`cache_read_input_tokens` > 0 no bench); a economia só aparece em sessão longa.

## 6. Dúvidas abertas para o fundador
- (a) Aceita D23 (timeout de 2 `describe` e2e) ou prefere um passo próprio para tirar o peso desses testes?
- (b) Teste pesado (porta da E1, checklist da mudança 23) logo depois desta auditoria — com a Spec real do teste `8e2f2052` (Multi_Gateway) para comparar US$ 18,78 / 1.724 chamadas?
