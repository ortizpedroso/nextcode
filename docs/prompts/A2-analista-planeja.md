# A2 — O planejamento passa a ser feito pela skill `analista` (mudança 21, §5.0)

Você vai fazer **só o passo A2.0 (inventário, sem código)** do item **A2** do cronograma (`docs/NEXTCODE-REFERENCIA.md` §5.0, linha "A2" e mudança 21). Os passos de código (A2.1 em diante) vêm em outro prompt, depois de o fundador aprovar o desenho com base neste inventário. O auditor (Claude) confere antes de aceitar.

**Hash de partida:** o commit de auditoria do A3.5. Pré-condição: `git log -1 --format=%s` começa com `docs(diario): A3.5 auditado`. Se o A3.5 ainda não foi auditado → PARE.

## Travas (obrigatórias)
- **T-A:** além da pré-condição acima, `git status --short` só pode ter estas linhas, que **não são suas** (não toque, não adicione, não apague): ` M .claude/.headroom_wrap_marker.json`, ` M .serena/project.yml`, `?? .agents/`, `?? .claude/skills/`, `?? skills-lock.json`. Qualquer outra diferença → PARE e relate.
- **R1 / T-B — nada fora do prompt.** PODE CRIAR, e nenhum outro:
  1. `docs/relatorios/A2-analista-planeja.md` (novo)
  2. `scripts/inventario-plano-a2.ts` (novo, só leitura)

  PROIBIDO alterar qualquer arquivo existente (`src/`, `tests/`, `skills/`, `config/`, `prisma/`, referência, diário). Precisar de outra coisa → PARE e escreva no relatório o que e por quê.
- **R2 — relatório** com a seção `## A2.0 — Inventário`: cada item abaixo com `arquivo:linha` e a saída real dos comandos; ao final, a saída real de `npx tsc --noEmit` e as últimas linhas de `npx vitest run` com os totais; desvios ("nenhum" se nenhum); o que não foi feito. O hash do commit **não** vai no relatório (vai na resposta).
- **R3 / T-C — só fato.** Este passo **não propõe solução**. Não sabe → "não verificado".
- **T-D:** todo nome citado conferido com `git grep -n`.
- **T-E:** um commit; `tsc` 0 e `vitest` verde neste estado. Proibido `--amend`, `reset`, `rebase`, `push --force`, `--no-verify`, `git add -A`, `git add .`. Adicione só os 2 arquivos novos.
- **T-F Banco:** **nunca** escrever em `prisma/dev.db`. O script copia `prisma/dev.db` e `prisma/dev.db-wal` para uma pasta em `%TEMP%` **fora** do repositório e usa `DATABASE_URL="file:<cópia>"` — copie o jeito de `scripts/replay-failure-diagnosis.ts` (linhas 10-30). `TelemetryLogger.log` trocado por função vazia no script. Cole o mtime de `prisma/dev.db` antes e depois.
- **T-G / regra 7:** não cole texto de Spec nem segredo no relatório; só contagens, IDs de REQ e caminhos de arquivo.
- **T-H:** nenhum pacote novo. **T-I:** arquivos novos em LF.
- **T-J Paradas:** teste quebrando; contradição entre prompt e código → PARE e relate.
- **T-K:** commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Gasto: zero.** Nenhuma chamada a LLM nem ao Jev. O script chama só funções mecânicas.

## Contexto (verificado pelo auditor, 17/10)
- O decompositor já se chama skill: `SpecDecomposerSkill` (`src/core/skills/spec-decomposer.ts`). Tem 2 caminhos:
  - **heurística** `decomposeSpec` (≈52), que atribui REQ por menção de arquivo (`assignReqsForGroup` ≈122). Essa é a causa do teste real `934939fc` bloqueado (diário 93);
  - **LLM** `decomposeWithAnalistaSkill` (≈317), que usa `skills/analista/SKILL.md` e é chamado em `execution-trigger.ts:384`. Ele roda com `maxTokens: 4096` (≈376) e `AbortSignal.timeout(5000)` (≈381). Quando a resposta não traz JSON, volta para a heurística **sem registrar nada**: nenhum `ANALISTA_PLAN_*`, `return baseDecomp` ≈474. O diário 94 achou 0 `ANALISTA_PLAN_APPROVED`/`FALLBACK` no banco.
- `validateMacrobriefMechanical` (`src/core/templates/artifact-templates.ts`) confere: REQ inventado, REQ sem etapa, arquivo em 2 etapas, máximo de arquivos por etapa (`FILES_PER_NODE = 4`, `spec-decomposer.ts:31`), dependência inexistente e ciclo. **Não confere** se o arquivo que o critério do REQ cita está no escopo da etapa do REQ.
- O nó vindo do analista LLM (≈420-430) leva só `step, cluster, reqs, files, macrobriefId` no `payload`. O nó vindo da heurística leva o Microbrief completo (≈167-209, com `criteriosAceitePorReq`), que o `node-executor.ts:1455` usa.
- Extrator de caminhos já existente e testado: `extractFilePathsFromCriteriaText` e `pathInStageScope` (`src/core/decision/jev-execution-checks.ts`).

## Passo A2.0 — Inventário (no relatório, só fatos)
1. **Quem chama o planejamento:** todos os pontos que chamam `decomposeSpec` ou `decomposeWithAnalistaSkill` (`git grep -n`), e em qual fase cada um roda (chat, aprovação, execução).
2. **Caminho LLM, linha por linha:** qual papel e nível o `dispatchWithFallback` usa (`tier: "heavy"`) e qual modelo isso resolve hoje pela política (`config/politicas-orquestracao.yaml` + código, com `arquivo:linha`); cada saída de `decomposeWithAnalistaSkill` que volta para a heurística, dizendo se registra trilha ou não; o que a condição `skipModel` faz nos testes.
3. **Uso do resultado da T8b:** onde `t8bCheck` é lido (`git grep -n "t8bCheck"`) e se um plano com `valid: false` é executado mesmo assim (siga o fluxo de `execution-trigger.ts` e diga a linha onde o plano vira `TaskNode`).
4. **Diferença de payload:** tabela `campo › heurística (linha) › analista LLM (linha) › quem consome (arquivo:linha)`, para todo campo de `payload` e de `MicrobriefAndReportDocument` que `node-executor.ts` lê.
5. **Prova com o teste real (script `scripts/inventario-plano-a2.ts`, cópia do banco):**
   - Ache a Spec aprovada da sessão `934939fc` (campo `canonicalSpec`, `prisma/schema.prisma:91`, ou onde estiver; diga a linha) e os `TaskNode` dessa sessão.
   - Plano **gravado** (os `TaskNode`): nº de etapas; nº de REQ em mais de 1 etapa; e nº de pares (REQ, arquivo citado no critério) em que o arquivo está **fora** do `filesScope` da etapa (use `extractFilePathsFromCriteriaText` + `pathInStageScope`). Liste os pares das etapas 1 e 3.
   - **Re-execute só a heurística** (`SpecDecomposerSkill.decomposeSpec`, sem LLM) com a mesma Spec e os mesmos arquivos (`parseSpecDocument(...).arquivosAfetados`) e mostre os mesmos 3 números. Também mostre `t8bCheck.valid` e o nº de `errors`. Os números têm de bater com o plano gravado; se não baterem, diga onde diferem.
   - Mostre o tamanho da Spec em caracteres e o nº de REQ e de arquivos (para dimensionar `maxTokens`/timeout do A2.1). **Não** cole o texto da Spec.
6. **Skill `analista`:** o que `skills/analista/SKILL.md` promete (frontmatter + passos) × o que `decomposeWithAnalistaSkill` realmente usa dela (ferramentas, `passos_max`, checagens). Tabela `promessa › usado no código? (arquivo:linha) › observação`.

Commit: `docs(relatorio): A2.0 inventario do planejamento` + linha T-K. **Pare.**

## Ao terminar (resposta ao fundador)
Cole: hash; `git show --stat HEAD`; `git reflog -3`; `git status --short` (só as 5 linhas da T-A); mtime de `prisma/dev.db` antes/depois. **Pare** e aguarde a auditoria.

## Porta do A2.0 (o auditor confere)
- 1 commit, 2 arquivos novos, nenhum arquivo existente alterado, sem amend.
- Os 6 itens com `arquivo:linha` que batem com o código; números do item 5 reproduzíveis pelo auditor com o mesmo script.
- `tsc` 0 e `vitest` verde; `prisma/dev.db` com o mesmo mtime.
