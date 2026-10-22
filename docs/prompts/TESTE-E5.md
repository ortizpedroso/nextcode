# Teste independente das mudanças 43–45 (outro LLM caça bugs e vulnerabilidades no NextCode)

Copie tudo entre as marcas `=== INÍCIO ===` e `=== FIM ===` para o Antigravity, com o repositório `C:\projetos\nextcode` aberto.

=== INÍCIO ===

**Objetivo:** testar, de forma independente e adversarial, o que o Claude implementou em 22–23/10/2026 (mudanças 43, 44 e 45 da referência): achar **bugs e vulnerabilidades do NextCode**, com prova. O Gateway é só projeto de teste: não é alvo.

**Hash de partida:** `465aa4b^`. **Hash final testado:** o commit mais recente cujo assunto começa com `docs(prompts): TESTE-E5`. Depois dele só pode haver commits `docs(diario)` ou `docs(prompts)`.

## Travas (obrigatórias)
- **T-A:** confira `git log -1 --format=%s` e `git status --short`. Antes do hash final testado, só pode haver commits `docs(diario)`/`docs(prompts)`; arquivos não rastreados de `docs/relatorios/bench/` e `.claude/` são tolerados. Qualquer outra diferença → PARE e relate.
- **R1 — nada fora do prompt.** PODE CRIAR só `docs/relatorios/TESTE-E5-<seu-nome>.md`. **PROIBIDO** alterar qualquer outro arquivo (código, testes, skills, scripts, configuração, referência, diário). Achou um bug? **Descreva com a reprodução**; não corrija.
- **R2 — relatório por item:** veredito (ACEITO, ACEITO COM RESSALVA ou REJEITADO), evidência (`arquivo:linha` e saída de comando **colada**) e o que não conseguiu verificar.
- **R3 — só dado.** "Funciona" só com saída colada. Se não sabe, escreva "não verificado". Não cite função ou arquivo sem conferir com `git grep -n` (T-D).
- **T-E:** um commit só (o seu relatório). Proibido `--amend`, `reset`, `rebase`, `push`, `--no-verify`, `git add -A`, `git add .`.
- **T-F:** nunca escrever em `prisma/dev.db`; cole o horário de modificação dele antes e depois do teste. Uma sessão do Gateway pode estar rodando por outro processo: **não** a toque.
- **T-G:** nenhum segredo (chave, token) no relatório nem em chamada a LLM.
- **Gasto permitido:** até **US$ 1,00** em LLM, só no passo 6. Não rode o `scripts/bench.ts`, o executor nem o `retomar-sessao.ts`. Passou disso → PARE.
- **Memória da máquina (7,7 GB):** rode suíte, `tsc` e scripts **um de cada vez**. Não abra o app (`npm run dev`).
- **Onde mexer:** para os passos 3 e 4, use uma cópia: `git worktree add ../nc-teste-e5 HEAD` e um link do `node_modules` com `cmd /c mklink /J ..\nc-teste-e5\node_modules C:\projetos\nextcode\node_modules`. Na pasta principal, **não** use `git stash` nem edite nada. Ao terminar, remova o link **antes** da cópia: `cmd /c rmdir ..\nc-teste-e5\node_modules`, depois `git worktree remove ../nc-teste-e5`. Nunca apague com `rm -rf` seguindo o link: isso apagaria o `node_modules` principal.
- **T-K:** o commit termina com `Co-Authored-By: <seu modelo>` (uma linha).

## Leitura obrigatória (antes de qualquer comando)
1. `docs/relatorios/AUDITORIA-E5.md` — commits por item, provas, o que não foi verificado.
2. `docs/relatorios/DECISOES-AUTONOMAS-E5.md` — E5-D1…D35 (o que foi decidido sem o fundador).
3. `docs/relatorios/AUDITORIA-43-revisor-bancada.md` — bancada de testes e revisor que reproduz.
4. `docs/NEXTCODE-REFERENCIA.md` §5.0: "Checklist da mudança 43", "Checklist da execução autônoma 5 (mudança 44)" e as linhas 43, 44 e 45 em "Mudanças do cronograma".

## Passos

1. **Escopo e histórico.** Cole `git log --oneline 465aa4b^..HEAD`, `git diff --stat 465aa4b^..HEAD` e `git reflog -60` (procure amend, reset ou rebase). Liste arquivo alterado que não pertença a item das mudanças 43–45.

2. **HEAD 2× seguidas.** `npx tsc --noEmit -p .` e `npx vitest run` duas vezes; cole os totais (esperado 162 arquivos / 1045 testes, tudo verde). Qualquer falha intermitente: cole o nome e a mensagem; ela é um achado.

3. **O teste falha sem a correção** (na cópia `../nc-teste-e5`). Reverta só o trecho de código indicado para o estado de `465aa4b^`, ou neutralize a linha. Rode o teste e cole que **falha**; restaure e cole que **passa**:
   - 44.1 `src/core/orchestrator/delivery-repair.ts` (`escopoExtra` sempre vazio) × `tests/orchestrator/j2b-reparo-entrega.test.ts -t "44"`
   - 44.2 `src/core/orchestrator/delivery-diagnosis.ts` (`splitDefectsByEvidence` devolvendo tudo em `bloqueiam`) × `tests/orchestrator/aviso-diagnostico-rodada.test.ts -t "entrega decidida pela prova"`
   - 44.2c `src/core/governance/final-reviewer.ts` (não chamar `rerunPriorProofs`) × `tests/governance/reproducao-defeitos.test.ts -t "Gateway 22/10"`
   - 44.2d/e `attachRegressionProofs` vazio × `tests/orchestrator/provas-anteriores.test.ts`
   - 44.2f o bloco "revisão final não rodou" em `src/core/orchestrator/job-queue.ts` × `tests/orchestrator/jev-delivery-gate.test.ts -t "não rodou"`
   - F10 `src/core/orchestrator/job-worker.ts` (sem `sessionId: session.id` no `findFirst`) × `tests/orchestrator/pausa-pisca.test.ts -t F10`
   - PJ2b `claimJob` sem a guarda de projeto fechado × `tests/orchestrator/pj2b-fechar-projeto.test.ts`
   - J11 `src/core/intake/req-origin-check.ts` (`checkReqOrigins` → tudo "rastreado") × `tests/intake/j11-origem-req.test.ts`
   - TR1 (7) `src/core/intake/spec-patch.ts` (ignorar `erros`) × `tests/intake/tr1-7-correcao-por-trecho.test.ts`
   - E5 `presumedTechnology` → sempre `null` × `tests/governance/e5-testes-de-aceite.test.ts -t "bench 22/10"`
   - J20 `findInjectionMarkers` → `[]` × `tests/governance/j20-injecao-arquivo.test.ts`
   - 45 sem o bloco de documentação em `buildWriterPrompt` × `tests/governance/reproducao-defeitos.test.ts -t "45"`

4. **Caça a vulnerabilidades** (leitura de código + reprodução quando der; tudo na cópia). Para cada item: o que encontrou, gravidade (crítica/alta/média/baixa) e como reproduzir.
   1. **Código gerado roda no host?** Todo teste escrito por LLM (reprodução, contrato, aceite) roda só no contêiner sem rede? Confira `src/core/execution/test-bench.ts` (flags do `docker run`: `--network none`, projeto `:ro`, `SANDBOX`) e procure (`git grep -n "vitest"` em `src/`) qualquer caminho que rode teste gerado fora dele.
   2. **Escape de caminho:** nomes de arquivo vindos do LLM (`reproTests`, `aceite-*`, `prova-*`, `regressao-*`) podem escrever fora da pasta de trabalho? Teste com `../` e caminho absoluto em `runTestBench` (pode usar `setTestBenchRunnerForTests` ou chamar direto com Docker desligado).
   3. **Testes escondidos ao alcance do executor:** a pasta de trabalho da bancada saiu do projeto (`736b3d0`)? Algum outro lugar grava o conteúdo dos testes escondidos onde o `read_file`/`grep` do executor alcança (`.nextcode/`, payload enviado ao executor, trilha lida por ele)?
   4. **Injeção:** plante um arquivo com instrução para IA (português e inglês) e confira que o `read_file` do laço (`src/core/skills/executor-tool-loop.ts`) marca com `[J20]`. Procure um texto de injeção que escape dos padrões de `src/core/governance/injection-scan.ts` e relate os que passaram (isso é achado, não falha do teste).
   5. **Dados que saem da máquina:** a pesquisa T7 (`src/core/intake/official-docs-research.ts`) manda só o nome do serviço e o tema? Algum trecho da conversa ou da Spec vai para fora (busca, Jev)?
   6. **Rotas novas ou alteradas** (`src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/dag/route.ts`): todas exigem `requireAuth`? Fechar/reabrir projeto pode ser acionado sem token?
   7. **Skills:** `loadRoleSkill` recusa papel desconhecido (`src/core/skills/skill-runtime.ts`)? Alguma skill em `skills/` declara ferramenta ou permissão de escrita que o código não deveria dar?
   8. **Dependências e infraestrutura:** cole `npm audit --omit=dev` e `npm audit` (totais); confira em `docker-compose.yml` que nenhuma porta está em `0.0.0.0` e que as imagens estão fixadas por digest.
   9. **Travas que afrouxaram:** E5-D2 (só reprova com prova) e E5-D21 (discordância na última tentativa segue com ressalva) abrem caminho para entregar código errado? Monte um cenário concreto e diga se a revisão final o pegaria, apontando `arquivo:linha`.

5. **Revisão das decisões.** Para cada decisão E5-D1…D35 de que discordar: o número, por quê e o risco, com evidência. Concordar sem ressalva não precisa justificar.

6. **Controles com LLM real** (gasto até US$ 1,00 no total; cole o custo que cada script imprime):
   - `npx tsx scripts/controles-autoteste-e5.ts` — esperado: P1 referência passa tudo; P4 base falha nos REQ-001/002; REQ-003 como regressão.
   - `npx tsx scripts/controles-avaliador-final-j3.ts 2 claude-sonnet-5-5` — esperado: todos os casos com "acertou: sim".
   - Antes e depois, cole o horário de modificação de `prisma/dev.db` (T-F).

## Relatório (`docs/relatorios/TESTE-E5-<seu-nome>.md`)
1. Identificação: hash final testado, `git log -1`, data.
2. Passo a passo (1–6): veredito por item, evidência colada, o que não verificou.
3. **Tabela de achados:** nº · tipo (bug / vulnerabilidade / teste fraco / desvio do relatório) · gravidade · `arquivo:linha` · como reproduzir · correção sugerida (descrita, **não aplicada**).
4. Desvios do prompt (obrigatório; "nenhum" se nenhum).
5. Checklist das travas acima (cumprida sim/não, com evidência).
6. Dúvidas para o fundador.

=== FIM ===
