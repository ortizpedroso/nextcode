# Auditoria da execução autônoma da E1 (Cursor audita o Claude)

**Objetivo:** auditar os 12 commits de código que o Claude fez sozinho em 17/10 (mudança 23) e dar veredito **aceito / aceito com ressalvas / rejeitado** por passo. **Você não corrige nada:** só confere, roda e relata.

**Hash de partida:** `7067106`. **Hash final auditado:** o commit cujo assunto é `docs: relatorios da execucao autonoma e prompt de auditoria do Cursor (149)`.

## Travas (obrigatórias)
- **T-A:** `git log -1 --format=%s` = `docs: relatorios da execucao autonoma e prompt de auditoria do Cursor (149)`; `git status --short` só ` M .claude/.headroom_wrap_marker.json` e ` M .serena/project.yml` (não são seus; não toque). Diferente → PARE.
- **R1 — nada fora do prompt.** PODE CRIAR só `docs/relatorios/AUDITORIA-E1-autonoma-cursor.md`. **PROIBIDO** alterar qualquer outro arquivo (código, testes, skills, scripts, referência, diário, os relatórios do Claude). Achou defeito → escreva no seu relatório; não corrija.
- **R2 — relatório** por passo: veredito, evidência (`arquivo:linha`, saída de comando colada), o que não conseguiu verificar.
- **R3 — só dado.** "Funciona" só com saída colada; não sabe → "não verificado".
- **T-E:** 1 commit só (o seu relatório). Proibido `--amend`, `reset`, `rebase`, `push --force`, `--no-verify`, `git add -A`, `git add .`.
- **T-F:** nunca escrever em `prisma/dev.db`; os scripts já copiam o banco para `%TEMP%` — cole o mtime de `prisma/dev.db` antes e depois.
- **T-G:** nenhum segredo no relatório.
- **Gasto permitido:** até **US$ 0,50** em LLM (2 scripts abaixo, ≈ US$ 0,23). Passou disso → PARE.
- **T-K:** commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Leitura obrigatória
1. `docs/relatorios/AUDITORIA-E1-autonoma.md` (o que o Claude diz que fez, passo a passo).
2. `docs/relatorios/DECISOES-AUTONOMAS-E1.md` (D1–D39).
3. `docs/NEXTCODE-REFERENCIA.md` §5.0: linha ▶ AGORA, checklist da mudança 23, linhas A2 e AV1, mudanças 21–23.

## Passos
1. **Escopo e histórico:** `git log --oneline 7067106..HEAD`; `git diff --stat 7067106..HEAD`; `git reflog -30` (procure amend/reset/rebase). Confirme que nenhum arquivo fora da lista da seção 1 do relatório do Claude foi alterado.
2. **Cada commit compila e passa sozinho:** para cada um dos 12 commits de código da tabela da seção 1, numa cópia (`git worktree add ../nc-aud-<hash> <hash>`, depois `npm ci` ou link de `node_modules`), rode `npx tsc --noEmit` e `npx vitest run`; cole os totais. Se o tempo não der para os 12, faça no mínimo `3ea5ef9`, `a06fa8d`, `522f7f8`, `3ad117b` e `c10d3b7`, e diga quais ficaram de fora. Remova os worktrees no fim.
3. **HEAD 2×:** `npx tsc --noEmit` e `npx vitest run` duas vezes no HEAD; cole os totais. Registre qualquer teste que falhe em só uma das rodadas (o Claude já relatou o "Item 1 (Fila nunca para)" como instável).
4. **Prova real (LLM):**
   - `npx tsx scripts/replay-analista-a23.ts` (≈ US$ 0,10): porta = `t8bFinal.valid: true`, `reqEmMaisDeUmaEtapa: 0`, `reqSemEtapa: []`. Pode variar o nº de etapas.
   - `npx tsx scripts/controles-avaliador-av15.ts 1` (≈ US$ 0,11): porta = caso 1 `APPROVED`, casos 2–7 `REJECTED`, cada um pelo motivo da tabela AV1.5 do relatório.
5. **Conferência dirigida (leia o código e diga sim/não com `arquivo:linha`):**
   - A2.1: `PLANO_REPROVADO` não cria `TaskNode` e o aviso ao humano sai 1 vez (`execution-trigger.ts`, `phase-machine.ts`).
   - A2.2: todo caminho de `decomposeWithAnalistaSkill` grava `ANALISTA_PLAN_APPROVED`, `ANALISTA_PLAN_RETRY` ou `ANALISTA_PLAN_FALLBACK`.
   - AV1.1: nenhum caminho de **produção** do avaliador chama `smartRouter.dispatchWithFallback` (o ramo existe só com `NODE_ENV=test` — D21); a família do executor é recusada em `dispatchStrongEvaluator`.
   - AV1.2: nenhum trecho de arquivo é cortado antes de ir ao avaliador.
   - AV1.3: citação inventada do avaliador → resposta descartada; `problemas` decidem o veredito como na D24.
   - AV1.4/AV1.4b: porteiro roda só com pasta de projeto; no modo `checkOnly` o projeto volta ao estado anterior; a promoção real reaplica e confere de novo.
   - M20: aprovação não grava `.nextcode/MEMORY.md`; prompts não injetam.
   - SM1: os 5 itens com o teste que prova cada um.
   - Skills `analista` e `avaliador`: cada afirmação bate com o código? Liste qualquer frase que prometa algo que o código não faz.
6. **Decisões:** para cada D1–D39, "concordo / discordo (motivo técnico)". Discordância não é correção — só registro.

## Relatório (`docs/relatorios/AUDITORIA-E1-autonoma-cursor.md`)
Seções: 1 escopo e histórico · 2 commits isolados (tabela hash › tsc › vitest) · 3 HEAD 2× · 4 prova real (tabelas coladas + custo + mtime) · 5 conferência dirigida (sim/não + `arquivo:linha`) · 6 decisões D1–D39 · 7 veredito por passo (A2.1 … SM1) e geral · 8 o que não foi verificado.

Commit: `docs(auditoria): Cursor audita a execucao autonoma da E1` + linha T-K. **Pare** e cole na resposta: hash, `git show --stat HEAD`, `git status --short`, veredito geral.
