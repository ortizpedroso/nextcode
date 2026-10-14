# Prompt I1 — Inventário: o que foi construído de 10/10 a 12/10 está ligado, desligado ou morto? (só diagnóstico)

> Origem: diagnóstico global de 14/10 (diário entradas 37–38). De 10/10 a 12/10 o Antigravity construiu peças sem prompt
> do auditor (referência §9.4). Algumas estão ativas (peneira M0 do Jev, `src/app/api/chat/route.ts:581`), outras existem
> só nos testes (conferência Macrobrief × Spec, `src/core/intake/intake-engine.ts:308`; Microbrief de reparo,
> `src/core/templates/artifact-templates.ts:1331,1386`), outras são calculadas e descartadas (M2, `route.ts:796`).
> Ordem decidida pelo fundador em 14/10: **I1 (este) → P5 (entrada como pensada, reusando o que existe) → J2b → J3 → J4**.
> Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa I1 — inventário do que está ligado, desligado ou morto (diagnóstico; nenhum conserto)

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro e a LEITURA OBRIGATÓRIA antes de criar qualquer arquivo. Na seção 0 do relatório, escreva em 5 linhas o que vai fazer.
2. **Este pacote só investiga.** É proibido alterar qualquer arquivo existente (código, testes, config, skills, `bench/`, docs, `memory/`). Você cria só os 2 arquivos novos listados.
3. **Não conserte nada**, mesmo que o problema fique evidente. Ideias → "Sugestões de melhoria".
4. Precisou mexer em algo não descrito, ou não conseguiu classificar uma peça com certeza → **não chute**: marque `INCERTO` com o motivo. Dúvida sobre o pedido → **PARE e pergunte.**
5. **Toda afirmação tem prova colada**: a saída do `git grep -n` (ou do comando) que mostra quem chama quem. Afirmação sem saída colada = relatório reprovado.

## OBJETIVO
Para cada peça construída de 10/10 a 12/10 e para cada decisão do Jev no código, responder com prova:
1. **Está no fluxo real?** Isto é: existe um caminho de chamadas, fora de `tests/`, que começa num ponto de entrada de produção e chega nela?
2. **O resultado é usado?** (muda fase, muda texto enviado a um modelo, bloqueia, grava algo que outro código lê) ou só é calculado/registrado?
3. **Está ligada na configuração?** (interruptor em `config/politicas-orquestracao.yaml`, `etapa1Ativa`, variável de ambiente)
4. **Houve uso real?** (registros na trilha do banco — cópia, nunca o original — e nos relatórios de bench)

**Pontos de entrada de produção** (os únicos válidos para dizer "ligado"): rotas em `src/app/api/**/route.ts`, `src/core/orchestrator/job-worker.ts` (`runOnce` e o laço do worker), `src/core/orchestrator/execution-trigger.ts` (`approveSpecAndStart`), e scripts em `package.json` → `scripts`. Chamada só a partir de `tests/` **não** conta.

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/I1-inventario-ligado-desligado.md`. Diferente → PARE.
- **T-B** Arquivos novos permitidos: `scripts/diag-inventario-trilha.ts` e `docs/relatorios/I1-inventario-ligado-desligado.md`. Nenhum outro arquivo criado ou alterado.
- **T-C** Literalidade. **T-D** todo nome citado conferido com `git grep -n` (saída colada).
- **T-E** dois commits (D: script; R: relatório), cada um com `npx tsc --noEmit` (0) e `npx vitest run` completo verde, saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-F** **Nunca** abra nem escreva em `prisma/dev.db`: o script copia o banco para `<tmp>/nc-diag-i1/dev-copy.db` e aponta `DATABASE_URL` para a cópia **antes** de importar qualquer módulo que use o Prisma (mesmo padrão de `scripts/diag-entrega-jev.ts:5-32`). O script só **lê** a cópia.
- **T-G** Nenhum segredo em código, saída ou relatório. O script não imprime `details` da trilha, só contagens e datas. **T-H** Nenhum pacote novo. **T-I** arquivos novos em LF.
- **T-J** Nenhuma chamada a LLM, ao Jev ou à rede. Não suba o NextCode, não rode o bench.
- **T-K** commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L** Relatório fiel: saídas brutas coladas (inclusive `git diff --stat` real); "Desvios" obrigatório e verdadeiro; checklist com o nome certo de cada trava **deste** prompt. **T-O** nenhum plano ou log paralelo.

## LEITURA OBRIGATÓRIA
- `docs/NEXTCODE-REFERENCIA.md` §2 (fluxo pensado e diferenças O1–O10), §4 (catálogo do Jev J1–J27), §5.3 (plano P0–P10), §5.5 (Plano J), §9.4.
- `docs/rascunhos/JEV-DECISOES.md` (catálogo do Jev do projeto; §7 peneira M0).
- `src/app/api/chat/route.ts` (fluxo do chat), `src/core/orchestrator/execution-trigger.ts`, `src/core/orchestrator/job-queue.ts`, `src/core/orchestrator/job-worker.ts`, `src/core/orchestrator/session-phase.ts` (`etapa1Ativa`).
- `config/politicas-orquestracao.yaml` e `src/core/config/orchestration-policy.ts`.
- Atenção: o commit `207f9a2` chama-se "Pacote P5", mas é telemetria de custo — **não** é o P5 do plano (§5.3, "Entrada como pensada").

---

## PASSO I1.1 — Script de contagem da trilha (só leitura da cópia)
**CRIAR:** `scripts/diag-inventario-trilha.ts`.
1. Cópia do banco igual a `scripts/diag-entrega-jev.ts:5-32`, pasta `<tmp>/nc-diag-i1/`.
2. Imprimir, em JSON por linha:
   - por `action` de `TelemetryLog`: `{ tipo: "acao", action, total, primeira, ultima }` (datas ISO);
   - para `action = "JEV_DECISION"` e `"JEV_FAILURE"`: agrupar pelo campo `purpose` de `details` (fazer `JSON.parse`, ler só `purpose`): `{ tipo: "jev", action, purpose, total, primeira, ultima }`;
   - por `phase` de `Session`: `{ tipo: "fase", phase, total }`.
3. Nada mais (não imprimir conteúdo de mensagens nem `details`).
Commit D: `chore(diag): I1 - contagem da trilha para o inventario`.

## PASSO I1.2 — Inventário
Rode `npx tsx scripts/diag-inventario-trilha.ts` uma vez e cole a saída inteira. Depois preencha as 3 tabelas abaixo.

**Tabela A — peças dos 20 commits de código de 10/10 a 12/10.** Para cada commit, rode `git show --stat <hash>` (cole) e liste **cada função, classe, rota, interruptor de configuração, fase ou template novo** que ele criou (use `git show <hash>` para achar os `export` novos). Uma linha por peça:

| Commit | Peça (`arquivo:linha`) | Quem chama fora de `tests/` (saída do `git grep -n` colada abaixo da tabela, numerada) | Caminho até o ponto de entrada | Resultado usado? | Interruptor e valor atual | Uso real na trilha | Classificação |

Classificação (uma só): `LIGADO` (caminho completo até um ponto de entrada **e** resultado usado) · `CALCULADO_DESCARTADO` (chega ao ponto de entrada, mas o resultado não muda nada) · `DESLIGADO_CONFIG` (código chamado, mas um interruptor o desliga) · `SO_TESTES` (só `tests/` chama) · `MORTO` (ninguém chama) · `INCERTO` (com motivo).

Commits (todos obrigatórios, nesta ordem): `60e81f0`, `c8ec38e`, `7f92a6e`, `6472144`, `a3474af`, `9e93594`, `19d5758`, `359e06b`, `6e00e57`, `bdb6ade`, `06bb533`, `24b4596`, `156d01b`, `494b73b`, `4321027`, `a3f0992`, `a93cf3e`, `207f9a2`, `6e77789`, `786d393`. Para `786d393`, diga também o que o C1 (`f19152c`, `af431e8`) desfez ou mudou dele.

**Tabela B — as 16 decisões do Jev no código** (`git grep -n 'purpose: "' -- src`, cole a saída). Uma linha por `purpose`:

| `purpose` | Função (`arquivo:linha`) | Caminho até o ponto de entrada | O que o código faz com a resposta (`arquivo:linha`) | Interruptor/modo atual | Chamadas reais na trilha (do I1.1) | Classificação (mesma escala) | Item do catálogo da referência §4 (J1–J27) ou "fora do catálogo" |

**Tabela C — fases e etapas do fluxo pensado (referência §2.2)**: `ELICITACAO`, `SPEC_REVISAO`, `MACROBRIEF`, `CONFERENCIA`, `PLANEJAMENTO`, `EXECUCAO`, `VERIFICACAO`, `ENTREGUE`, e os papéis: skill `elicitador` no chat (O1), skill `analista` (O3), pesquisa oficial T7 (O4), avaliador de outro modelo (O5). Uma linha por item:

| Item | O pensado (referência, com linha) | O real (`arquivo:linha` com saída colada) | Sessões reais que passaram pela fase (do I1.1) | Classificação |

## PASSO I1.3 — Conflitos com o que já foi decidido
Liste cada peça das Tabelas A/B que contradiz uma linha de `memory/decisoes.md` ou da referência (§5.2 modelos, §5.5 Plano J, Regra 7 de segurança do `CLAUDE.md`), citando as duas linhas lado a lado. Liste também cada peça com **dois caminhos para a mesma coisa** (ex.: duas formas de classificar intenção, duas de dividir a Spec), com `arquivo:linha` dos dois.

## RELATÓRIO — `docs/relatorios/I1-inventario-ligado-desligado.md` (commit R: `docs(relatorio): I1 - inventario ligado desligado morto`)
0. Leitura feita (5 linhas). 1. Identificação (partida e `git log --oneline <partida>..HEAD`). 2. Por commit: `git show --stat`, `tsc`, `vitest`.
3. Saída bruta do script. 4. Tabela A + saídas numeradas. 5. Tabela B + saídas. 6. Tabela C + saídas. 7. Conflitos e caminhos duplicados (I1.3).
8. Resumo: quantas peças em cada classificação, por tabela. 9. Escopo: `git diff --stat <partida>..HEAD` real, colado (só os 2 arquivos novos).
10. Desvios (obrigatório). 11. Checklist T-A…T-O. 12. Sugestões de melhoria (nada implementado). 13. Dúvidas para o fundador.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
