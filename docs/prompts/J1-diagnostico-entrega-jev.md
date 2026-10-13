# Prompt J1 — Diagnóstico: a auditoria final do Jev reprova código correto? (só medir, não consertar)

> Origem: rodadas de 12/10 — com Jev a sessão termina em `PLANEJAMENTO` com aceite 10/10 e 13/13; sem Jev, `ENTREGUE`
> (`docs/relatorios/diagnostico-docs-2026-10-13.md`). Hipótese do auditor: `verifyProjectDeliveryWithJev`
> (`src/core/decision/jev-execution-checks.ts:944`) reprova (limiares 0,85/0,80 sobre `noul`) → `VERIFICACAO_COM_LACUNAS`
> (`src/core/orchestrator/job-queue.ts:386`) → `PLANEJAMENTO`; sem chave do Jev a função aprova por reserva.
> Controles escritos pelo auditor (régua): `bench/projetos/p1-referencia/` (correto, régua 10/10) e `bench/projetos/p4-base/`
> (3 bugs, régua 9/12); Spec do P1 em `bench/specs/p1.ts`. Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa J1 — medir a auditoria final do Jev em código correto e em código com bug (diagnóstico; nenhum conserto)

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro e a LEITURA OBRIGATÓRIA antes de criar qualquer arquivo. Na seção 0 do relatório, escreva em 5 linhas o que vai fazer.
2. **Este pacote só mede.** É proibido alterar qualquer arquivo existente (código, testes, config, skills, `bench/`, docs). Você cria só os 2 arquivos novos listados.
3. **Não conserte nada**, nem limiar, nem pergunta, nem fluxo, mesmo que o problema fique evidente. Conserto é decisão do fundador. Ideias → "Sugestões de melhoria".
4. Precisou mexer em algo não descrito → **PARE** e relate. Dúvida → **PARE e pergunte.**

## OBJETIVO
Responder com números: (a) a auditoria final do Jev aprova o projeto de referência **correto** do P1? (b) reprova a base do P4 **com bugs**? (c) quão estável é a resposta em 5 repetições? (d) o que acontece com a sessão depois de `VERIFICACAO_COM_LACUNAS` (alguém retoma, ou ela fica parada)?

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/J1-diagnostico-entrega-jev.md`. Diferente → PARE.
- **T-B** Arquivos novos permitidos: `scripts/diag-entrega-jev.ts` e `docs/relatorios/J1-diagnostico-entrega-jev.md`. Nenhum outro arquivo criado ou alterado.
- **T-C** Literalidade. **T-D** todo nome citado conferido com `git grep -n`.
- **T-E** dois commits (D: script; R: relatório), cada um com `npx tsc --noEmit` (0) e `npx vitest run` completo verde, saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-F** **Nunca** escreva em `prisma/dev.db`: o script copia o banco para uma pasta temporária e aponta `DATABASE_URL` para a cópia **antes** de importar qualquer módulo que use o Prisma (mesmo padrão de `scripts/bench.ts:262-290`).
- **T-G** Nenhuma chave em código, saída ou relatório. Ao Jev só vai o código dos 2 projetos de controle (escritos pelo auditor) — nada do usuário.
- **T-H** Nenhum pacote novo. **T-I** arquivos novos em LF. **T-K** commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-J** Teto: US$ 0,05 de Jev no total (soma de `estimateJevCostUsd`). Passou → PARE. Resposta 422 do Jev → PARE e relate.
- **T-L** Relatório fiel: números copiados da saída, com o trecho bruto. **T-M** o código dos controles **não** é executado (só lido e enviado ao Jev).

## LEITURA OBRIGATÓRIA
- `src/core/decision/jev-execution-checks.ts` (`DELIVERY_AUDIT_QUESTIONS` ~845, `verifyProjectDeliveryWithJev` ~944-1090).
- `src/core/orchestrator/job-queue.ts` ~290-390 (como os parâmetros da auditoria são montados e o que acontece quando reprova).
- `src/core/orchestrator/phase-machine.ts` (fases `VERIFICACAO` e `PLANEJAMENTO`).
- `src/core/decision/jev.ts` (`askJevBatch`, `maxStateChars`, `estimateJevCostUsd`).
- `src/core/orchestrator/node-executor.ts:214` (`readProjectFilesContent`), `src/core/intake/spec-format.ts` (`renderCanonicalSpecDocument`, `parseSpecDocument`).
- `bench/specs/p1.ts` (`P1_SPEC`), `bench/specs/p3-p4.ts` (`P4_SPEC`), `bench/projetos/p1-referencia/`, `bench/projetos/p4-base/`, `bench/aceite/README.md`.
- `docs/NEXTCODE-REFERENCIA.md` §4.3 (fraquezas do Jev e regras).

---

## PASSO J1.1 — Script de medição

**CRIAR:** `scripts/diag-entrega-jev.ts`.

1. Cópia do banco: copiar `prisma/dev.db` para `<tmp>/nc-diag-j1/dev-copy.db`, definir `process.env.DATABASE_URL` para a cópia e carregar o `.env` como em `scripts/bench.ts:280-290`; **só depois** importar (com `await import(...)`) os módulos do projeto.
2. Dois casos, cada um com sua Spec e sua pasta:
   - `p1-referencia`: `P1_SPEC` + `bench/projetos/p1-referencia` (esperado: aprovar).
   - `p4-base`: `P4_SPEC` + `bench/projetos/p4-base` (esperado: reprovar — 3 bugs, régua 9/12).
3. Para cada caso, montar os parâmetros **exatamente como `job-queue.ts` monta** (copie a lógica, sem alterar aquele arquivo): `parsedSpec = parseSpecDocument(renderCanonicalSpecDocument(spec))`; `requisitos` = `{ id, titulo, criterio }` de cada requisito; `stack`; `regras = parsedSpec.notasImplementacao`; `arquivosAfetados`; `codeContentMap = readProjectFilesContent(arquivosAfetados, pasta)`. Em `codeContentMap`, confira que todos os arquivos foram lidos (se faltar algum → PARE).
4. Chamar `verifyProjectDeliveryWithJev` **5 vezes** por caso (10 chamadas), sem cache, uma de cada vez.
5. Imprimir por chamada uma linha JSON: `{ caso, rep, jevDisponivel, aprovado, scores, lacunas: categorias[], tamanhoEstado }`, onde `tamanhoEstado` = tamanho do JSON de estado montado como em `verifyProjectDeliveryWithJev` (calcule no script com a mesma regra, sem alterar a função). E ao fim, o custo estimado total do Jev.

Commit D: `chore(diag): J1 - script de medicao da auditoria final do Jev`.

## PASSO J1.2 — Rodar e responder

1. `npx tsx scripts/diag-entrega-jev.ts` (uma vez). Cole a saída inteira.
2. Tabela por caso: aprovações em 5; média e mínimo de cada um dos 6 scores; quantas vezes cada score ficou abaixo do limiar que o código usa (0,85 nos 3 primeiros, 0,80 nos 3 últimos); `jevDisponivel` em quantas.
3. Responda (d) **só lendo o código**, com `arquivo:linha`: depois de `VERIFICACAO_COM_LACUNAS` → `PLANEJAMENTO`, existe algum ponto que cria trabalho novo (job, Microbrief de reparo, retomada) para esta sessão? Ou a sessão fica parada até ação humana? Cite o caminho completo.
4. Responda: com que tamanho de estado `askJevBatch` desiste (`maxStateChars: 28000`) e o que `verifyProjectDeliveryWithJev` faz nesse caso (cite a linha). Os dois controles ficaram abaixo ou acima?

## RELATÓRIO — `docs/relatorios/J1-diagnostico-entrega-jev.md` (commit R: `docs(relatorio): J1 - diagnostico da auditoria final do Jev`)
0. Leitura feita (5 linhas). 1. Identificação (partida e `git log --oneline <partida>..HEAD`). 2. Por commit: `git show --stat`, `tsc`, `vitest`.
3. Saída bruta do script. 4. Tabela de J1.2 item 2. 5. Resposta (d) com `arquivo:linha`. 6. Resposta do tamanho de estado.
7. Custo do Jev (total). 8. Escopo: `git diff --stat <partida>..HEAD` (só os 2 arquivos novos).
9. Desvios (obrigatório; "nenhum" só se for verdade). 10. Checklist T-A…T-M. 11. Sugestões de melhoria (nada implementado). 12. Dúvidas para o fundador.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
