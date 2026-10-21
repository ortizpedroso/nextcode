# Auditoria da execução autônoma 2 (Cursor audita o Claude)

**Objetivo:** auditar os 15 commits de código que o Claude fez sozinho em 19–20/10 (mudança 26, P1–P13 + correções D41 e D42) e dar veredito **aceito / aceito com ressalvas / rejeitado** por passo. **Você não corrige nada:** só confere, roda e relata.

**Hash de partida:** `54b8c19`. **Hash final auditado:** o commit cujo assunto é `docs: prompt do Cursor alinhado ao HEAD (186)`. Os commits `917c364`, `dfe3d70` e esse último são só de documentação (auditoria, revisão da pasta docs, este prompt).

## Travas (obrigatórias)
- **T-A:** `git log -1 --format=%s` = `docs: prompt do Cursor alinhado ao HEAD (186)`; `git status --short` só ` M .claude/.headroom_wrap_marker.json` e ` M .serena/project.yml` (não são seus; não toque). Diferente → PARE.
- **R1 — nada fora do prompt.** PODE CRIAR só `docs/relatorios/AUDITORIA-E1-producao-cursor.md`. **PROIBIDO** alterar qualquer outro arquivo (código, testes, skills, scripts, referência, diário, os relatórios do Claude). Achou defeito → escreva no seu relatório; não corrija.
- **R2 — relatório** por passo: veredito, evidência (`arquivo:linha`, saída de comando colada), o que não conseguiu verificar.
- **R3 — só dado.** "Funciona" só com saída colada; não sabe → "não verificado".
- **T-E:** 1 commit só (o seu relatório). Proibido `--amend`, `reset`, `rebase`, `push --force`, `--no-verify`, `git add -A`, `git add .`.
- **T-F:** nunca escrever em `prisma/dev.db`; o bench já copia o banco para `%TEMP%` — cole o mtime de `prisma/dev.db` antes e depois.
- **T-G:** nenhum segredo no relatório.
- **Gasto permitido:** até **US$ 0,60** em LLM (bench abaixo, ≈ US$ 0,35). Passou disso → PARE.
- **Memória da máquina:** rode a suíte e o bench **um de cada vez**, nunca juntos (a máquina ficou sem memória 3× em 20/10).
- **T-K:** commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Leitura obrigatória
1. `docs/relatorios/AUDITORIA-E1-producao.md` (testes novos, travas, desvios, dúvidas).
2. `docs/relatorios/IMPLEMENTADO-E1-producao.md` (commits com tsc/vitest, o que mudou por passo, bench).
3. `docs/relatorios/DECISOES-AUTONOMAS-E1-2.md` (D1–D42).
4. `docs/NEXTCODE-REFERENCIA.md` §5.0: linha ▶ AGORA, checklist da mudança 26 (P1–P13), linha TR1 (itens 1–14), mudanças 25 e 26.

## Passos
1. **Escopo e histórico:** `git log --oneline 54b8c19..HEAD`; `git diff --stat 54b8c19..HEAD`; `git reflog -60` (procure amend/reset/rebase). Liste qualquer arquivo alterado que não pertença a um passo P1–P13, D41 ou D42.
2. **Cada commit compila e passa sozinho:** numa cópia (`git worktree add ../nc-aud-<hash> <hash>`, depois link de `node_modules` e, dentro do worktree, `DATABASE_URL=file:./prisma/test.db npx prisma db push --skip-generate` — `prisma/test.db` não está no git e sem isso a suíte falha por "tabela não existe", como na auditoria da mudança 23), rode `npx tsc --noEmit` e `npx vitest run`; cole os totais. No mínimo: `fbda610` (P1), `9d9b07a` (P3), `aa808dd` (P5), `c074f1f` (P6), `57f2119` (P7), `70e4b6b` (P9), `d73f945` (P12), `014d816` (D41), `835e98f` (D42). Diga quais ficaram de fora. Remova os worktrees no fim.
3. **HEAD 2×:** `npx tsc --noEmit` e `npx vitest run` duas vezes no HEAD; cole os totais (esperado 136 / 909). Registre teste que falhe em só uma rodada.
4. **Correções com teste que falha sem elas:** para D41 e D42, reverta só o arquivo de código (`git stash push <arquivo>` ou cópia), rode o teste citado no relatório e cole que **falha**; restaure e cole que **passa**.
   - D41: `src/core/governance/dual-lens-auditor.ts` × `tests/governance/lens2-lista-evidencia.test.ts`.
   - D42: `src/core/skills/executor-tool-loop.ts` × `tests/skills/executor-tool-loop.test.ts -t "limite da etapa"`.
5. **Prova real (LLM):** `npm run bench -- --projetos p1,p2,p3,p4 --variantes padrao --repeticoes 1` (≈ US$ 0,35). Porta: P1–P4 ENTREGUE com aceite 10/10, 13/13, 12/12, 12/12; "Chamadas do executor por etapa" ≤ 10 em todos. Se pausar por provedor (`SESSION_PAUSED_NO_LLM`), cole o `llm.gateway_failure` da cópia do banco e diga se é o mesmo caso do D42.
6. **Conferência dirigida (leia o código e diga sim/não com `arquivo:linha`):**
   - P1: `finish` só vale sozinho; teto de 8 ações e 48 mil caracteres por turno (`executor-tool-loop.ts`).
   - P3: o código da tentativa anterior **nunca** é guardado quando a guarda de segredos reprovou (`node-executor.ts`, `codigoTentativa`).
   - P5: pausa SEM_LLM não gasta tentativa e guarda `pausado: true` + código; a retomada não mostra o bloco de "reprovado".
   - P6: só caminho protegido **dentro** do escopo (ou escrita negada) conta para `HARNESS_RULE_BLOCK`; bloqueio não incrementa `attempts`.
   - P7: só `critico` reprova; `importante` vai para `correcoesSugeridas` e aparece no resultado da etapa.
   - P8: só o avaliador Claude usa `cache_control`; o custo cobra escrita no cache a 1,25× (`cost.ts`).
   - P9: teto = max(fixo, etapas × 0,35 × 1,5) + autorizado; sugestão nunca abaixo de US$ 0,50.
   - P11: `SPEC_CLARITY_SHADOW` não escreve no chat; Graphify só com ≥ 5 arquivos-fonte.
   - P12: DELETE com `apagarPasta` e POST respondem 409 **antes** de qualquer escrita (banco ou disco).
   - D42: `gatewayTimeoutMs` chega ao `callGateway` nos dois ramos (pago e BYOK) do `dispatchOneTurn`.
   - Skills `executor-*` e `avaliador`/`avaliador-frontend`: cada frase nova bate com o código? Liste qualquer promessa que o código não cumpre.
7. **Decisões:** para cada D1–D42, "concordo / discordo (motivo técnico)". Atenção especial à **D23** (timeout de testes e2e — a T-B proíbe aumentar timeout para teste passar). Discordância não é correção — só registro.

## Relatório (`docs/relatorios/AUDITORIA-E1-producao-cursor.md`)
Seções: 1 escopo e histórico · 2 commits isolados (tabela hash › tsc › vitest) · 3 HEAD 2× · 4 D41/D42 falham sem a correção · 5 prova real (tabela colada + custo + mtime) · 6 conferência dirigida (sim/não + `arquivo:linha`) · 7 decisões D1–D42 · 8 veredito por passo (P1 … P13, D41, D42) e geral · 9 o que não foi verificado.

Commit: `docs(auditoria): Cursor audita a execucao autonoma 2` + linha T-K. **Pare** e cole na resposta: hash, `git show --stat HEAD`, `git status --short`, veredito geral.
