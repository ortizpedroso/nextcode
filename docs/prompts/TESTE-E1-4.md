# Teste independente da execução autônoma 4 (outro LLM testa o que o Claude fez)

Copie tudo entre as marcas `=== INÍCIO ===` e `=== FIM ===` para o outro LLM (Cursor, Antigravity ou equivalente), com o repositório `C:\projetos\nextcode` aberto.

=== INÍCIO ===

**Objetivo:** testar, de forma independente, o que o Claude implementou sozinho em 21–22/10/2026 (mudança 39 da referência: mudanças 35 e 36, G1, G2, G3, J2b + J2.7, J3, TS1) e dar veredito **aceito / aceito com ressalvas / rejeitado** por item. **Você não corrige nada:** só confere, roda e relata.

**Hash de partida:** `e5e1b76^` (o pai de `e5e1b76`). **Hash final testado:** o commit mais recente cujo assunto começa com `docs(relatorios): execucao autonoma 4`.

## Travas (obrigatórias)
- **T-A:** `git log -1 --format=%s` começa com `docs(relatorios): execucao autonoma 4`; `git status --short` mostra no máximo ` M .serena/project.yml` e `?? docs/relatorios/PONTO-DE-RETOMADA-POS-REINICIO-2026-10-21.md` (não são seus; não toque). Diferente → PARE e relate.
- **R1 — nada fora do prompt.** PODE CRIAR só `docs/relatorios/TESTE-E1-4-<seu-nome>.md`. **PROIBIDO** alterar qualquer outro arquivo (código, testes, skills, scripts, configuração, referência, diário, relatórios do Claude). Achou defeito → escreva no relatório; não corrija.
- **R2 — relatório por item:** veredito, evidência (`arquivo:linha` e saída de comando **colada**), o que não conseguiu verificar.
- **R3 — só dado.** "Funciona" só com saída colada; não sabe → "não verificado".
- **T-E:** 1 commit só (o seu relatório). Proibido `--amend`, `reset`, `rebase`, `push --force`, `--no-verify`, `git add -A`, `git add .`.
- **T-F:** nunca escrever em `prisma/dev.db`. O script de controles do J3 copia o banco para `%TEMP%`; cole o horário de modificação de `prisma/dev.db` antes e depois.
- **T-G:** nenhum segredo (chave, token) no relatório.
- **Gasto permitido:** até **US$ 0,50** em LLM (passo 6, ≈ US$ 0,12 com o Sonnet). Passou disso → PARE.
- **Memória da máquina (7,7 GB):** rode a suíte, os controles e qualquer `tsc` **um de cada vez**, nunca juntos. Não abra o app (`npm run dev`) durante os testes.
- **T-K:** o commit termina com `Co-Authored-By: <seu modelo>` (uma linha).

## Leitura obrigatória (antes de qualquer comando)
1. `docs/relatorios/AUDITORIA-E1-4.md` — commits com tsc/vitest, o que mudou, testes novos, prova real.
2. `docs/relatorios/DECISOES-AUTONOMAS-E1-4.md` — D1–D33.
3. `docs/NEXTCODE-REFERENCIA.md` §5.0: linha ▶ AGORA, "Checklist da execução autônoma 4", mudanças 35 a 39 (fim da seção), linhas J2b + J2.7, J3, TS1.
4. `docs/relatorios/DECISOES-AUTONOMAS-E1-3.md` seção "J2b + J2.7 — desenho decidido" (J1–J8): o J2b tinha de seguir esse desenho.

## Passos

1. **Escopo e histórico.** `git log --oneline e5e1b76^..HEAD`; `git diff --stat e5e1b76^..HEAD`; `git reflog -40` (procure amend/reset/rebase). Liste qualquer arquivo alterado que não pertença a um item da mudança 39.

2. **Cada commit de código compila e passa sozinho.** Numa cópia (`git worktree add ../nc-teste-<hash> <hash>`, link de `node_modules`, e dentro do worktree `DATABASE_URL=file:./prisma/test.db npx prisma db push --skip-generate`), rode `npx tsc --noEmit` e `npx vitest run`; cole os totais. No mínimo: `b2a6fbe` (35/36), `7987a6b` (G3), `ddefbcd` (G2), `8afebf7` (G1), `f37c08f` (J2b/J2.7), `471ef92` (J3), `dbacd91` (TS1), `57c3d44` (J3 no projeto real). Remova os worktrees no fim.

3. **HEAD 2× com o prazo padrão (porta do TS1).** `npx tsc --noEmit` e `npx vitest run` duas vezes no HEAD; cole os totais. Confirme que `tests/orchestrator/step-4b.test.ts` e `tests/harness/end-to-end-harness-plan.test.ts` **não** têm mais `timeout:` no `describe` (cole o `grep`). Registre qualquer teste que falhe em só uma rodada.

4. **O teste falha sem a correção** (reverta só o arquivo de código com `git stash push <arquivo>` ou cópia, rode o teste, cole que **falha**; restaure e cole que **passa**):
   - 35: `src/core/governance/empirical-gate.ts` × `tests/governance/final-build-recheck.test.ts -t "falha de ambiente"`.
   - G3: `src/core/orchestrator/blocked-culprit.ts` (substitua o corpo por `return blockedTasks[0];`) × `tests/orchestrator/blocked-culprit.test.ts`.
   - G2: `src/core/governance/dual-lens-auditor.ts` × `tests/governance/g2-descarte-avaliador.test.ts`.
   - G1: `src/core/skills/executor-tool-loop.ts` × `tests/skills/g1-leitor-acao.test.ts`.
   - J2b: `src/core/orchestrator/job-queue.ts` × `tests/orchestrator/j2b-reparo-entrega.test.ts -t "lacuna com dono"`.

5. **Conferência dirigida** — leia o código e responda sim/não com `arquivo:linha`:
   - 35: falha de `tsc` **sem** nenhuma linha `error TS` vira `ambiente` em `recheckFinalBuild`; com `error TS` de verdade nunca vira ambiente. A verificação final com ambiente aplica `FALHA_AMBIENTE` e **não** abre reparo nem chama a revisão final.
   - 36: todo efeito `AVISAR_HUMANO` em `phase-machine.ts` tem `acao`; o texto de `retomar` em `human-notice.ts` **não** manda revisar a Spec. `resumeBlockedSession` recusa quando há etapa `blocked` e não zera tentativas de ninguém. A palavra `retomar` no chat só age em `BLOQUEADA` e sem chamar LLM nem Jev (`src/app/api/chat/route.ts`).
   - G1: `parseJsonLenient` só tenta o conserto **depois** que `JSON.parse` falhou; o conserto não muda nada fora das strings do JSON.
   - G2: o motivo do descarte vai **no fim** da mensagem do usuário (depois de `[ARQUIVOS GERADOS]`), sem mudar o que vem antes (cache do Brief).
   - J2b: confira contra o desenho J1–J8: (a) só entra quando todas as etapas terminaram e a verificação final reprova; (b) o reparo é montado por código, sem LLM; (c) fases `VERIFICACAO → PLANEJAMENTO → EXECUCAO`; (d) no máximo 3 rodadas e depois `BLOQUEADA` com relatório; (e) lacuna sem dona → `BLOQUEADA` "Dono: analista"; (f) as etapas de reparo contam no teto normal (P9). Diga também se a T10 ignora mesmo a etapa substituída (`supersededByRepair` em `verifyProjectDeliveryT10`) e se isso pode esconder um REQ que só a etapa antiga cobria.
   - J2.7: `PHASE_EVENT_TYPES_COMPLETE` falha a compilação se faltar um tipo de evento na lista? Prove: acrescente localmente (sem commitar) um tipo novo à união `PhaseEvent`, rode `npx tsc --noEmit`, cole o erro e desfaça.
   - J3: a revisão final é **cega** (a mensagem não leva relatório do executor nem vereditos de etapa) e **fechada** (sem ferramentas); evidência `arquivo:linha` conferida; reprovação vira defeito por arquivo para a etapa dona (J2b); revisão que não roda não reprova sozinha. Ela só roda depois de a T10 aprovar?
   - Skill `skills/avaliador-final/SKILL.md`: cada promessa bate com o código de `src/core/governance/final-reviewer.ts`? Liste qualquer promessa que o código não cumpre.

6. **Prova real do J3 (LLM, ≈ US$ 0,12).** `npx tsx scripts/controles-avaliador-final-j3.ts 5 claude-sonnet-5-5`. Porta: P1 correto aprovado 5/5; casos 2, 3 e 4 reprovados pelo defeito plantado. Cole o `porModelo` e a lista de casos com `obtido`, `acertou` e `usd`. Compare com `docs/relatorios/bench/2026-10-22-j3-controles-sonnet-linhas-numeradas.json`.

7. **Prova real do J2b (só leitura da trilha).** Numa **cópia** de `prisma/dev.db` (copie para `%TEMP%` e aponte `DATABASE_URL` para a cópia), liste em ordem os eventos da sessão que começa com `4d019f00` a partir de 22/10/2026 00:47 UTC: `PHASE_TRANSITION`, `FINAL_BUILD_RECHECK`, `DELIVERY_REPAIR_PLANNED`, `FINAL_REVIEW`, `NODE_EXECUTION_COMPLETED`, `HUMAN_NOTIFIED`. Confira contra o §4 e o §5 de `AUDITORIA-E1-4.md`: os números batem? Confira também 3 dos 15 defeitos da revisão final (`docs/relatorios/bench/2026-10-22-j3-gateway-4d019f00.json`) lendo o código em `C:\projetos\gateway` (só leitura): o defeito existe? Comece pelo REQ-017 (`src/app/api/conta/asaas/route.ts`). As etapas de reparo foram ligadas às donas certas (o arquivo de cada erro do `tsc` está no escopo da etapa dona)?

8. **Decisões D1–D33:** para cada uma, "concordo / discordo (motivo técnico)". Atenção especial a **D1** (porta da E1 trocada), **D14** (lacuna sem dona impede todo o reparo), **D19** (Sonnet no lugar do Opus de partida), **D21** (revisão que não roda não reprova — ela não rodou na retomada e o Gateway foi entregue com 15 REQ parciais), **D32** (citação isolada) e **D28** (`run_check test` desligado). Discordância não é correção — só registro.

## Relatório (`docs/relatorios/TESTE-E1-4-<seu-nome>.md`)
Seções: 1 escopo e histórico · 2 commits isolados (tabela hash › tsc › vitest) · 3 HEAD 2× · 4 testes falham sem a correção · 5 conferência dirigida (sim/não + `arquivo:linha`) · 6 controles do J3 (tabela colada + custo + horário do `dev.db`) · 7 trilha real da `4d019f00` · 8 decisões D1–D33 · 9 veredito por item (35, 36, G1, G2, G3, J2b, J2.7, J3, TS1) e geral · 10 o que não foi verificado.

Commit: `docs(teste): <seu-nome> testa a execucao autonoma 4` + linha T-K. **Pare** e cole na resposta: hash, `git show --stat HEAD`, `git status --short`, veredito geral.

=== FIM ===
