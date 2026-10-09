# Prompt P2b — Bench com projetos difíceis (P3 login, P4 correção) e 3 repetições

> Pacote P2b de `docs/NEXTCODE-REFERENCIA.md` §5.2/§5.3. Régua, Specs e base com bugs escritas e provadas pelo auditor
> (`bench/aceite/`, `bench/specs/`, `bench/projetos/`) — **não alterar**.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa P2b — o bench passa a rodar P3 (login com sessão) e P4 (correção num projeto pronto), registra falhas sem parar e roda 3 repetições

## OBJETIVO
Na 1ª rodada, P1 e P2 tiraram 100% em todas as variantes: o bench não separa o que é melhor. Acrescentar dois projetos mais difíceis, já com régua, Spec e base prontas:
- **P3** — login com sessão (12 testes: hash, token, 401, logout). Spec: `P3_SPEC` em `bench/specs/p3-p4.ts`.
- **P4** — correção num projeto que **já existe** com 3 bugs (12 testes, inclusive 2 que conferem que o que funcionava não quebrou). Spec: `P4_SPEC`; base: `bench/projetos/p4-base/`.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/P2b-bench-dificil.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só os arquivos de PODE ALTERAR. **Proibido alterar qualquer arquivo em `bench/`** (régua, Specs e base com bugs). Nada em `src/`.
- **T-C Literalidade.** Nomes, argumentos e formato exatamente como escritos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**, com `npx tsc --noEmit` (0) e `npx vitest run` completo verde **nesse estado**; saídas coladas. **Proibido `--amend`, `rebase`, `reset` (de qualquer tipo), `push --force`, `--no-verify`.** Errou um commit? Faça **outro commit** corrigindo e declare em Desvios.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; cada execução usa cópia nova em pasta temporária.
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas obrigatórias.** Custo de uma execução > US$ 0,50 → PARE; custo acumulado da rodada > US$ 2,00 → PARE (grave o relatório parcial); contradição prompt × código → PARE. Se o NextCode se recusar a trabalhar num projeto com arquivos já existentes (P4) → PARE e cole o erro.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel.** Todo número copiado da saída real, com o trecho bruto abaixo.
- **T-M Código gerado nunca roda no host.** Aceite só no contêiner `nextcode-aceite:1` com `--network none`.
- **T-N Histórico conferido.** O auditor lê `git reflog`. Qualquer comando git além de `status`, `diff`, `add`, `commit`, `show`, `log`, `ls-files`, `rev-parse`, `grep` tem de aparecer em **Desvios**. "Desvios: Nenhum" com reflog diferente = relatório reprovado.

## LEITURA OBRIGATÓRIA
- `bench/aceite/README.md` (régua, provas, **rodar de dentro da pasta do projeto**), `bench/aceite/rodar.mjs` (aceita `p1|p2|p3|p4`).
- `bench/specs/p3-p4.ts` (`P3_SPEC`, `P4_SPEC`, tipo `SpecFrontmatterInput`).
- `bench/projetos/p4-base/` (projeto com bugs; `package.json`, `tsconfig.json`, `src/`).
- `scripts/bench.ts` (todo), `docker/aceite/run.sh`, `tests/bench/bench-relatorio.test.ts`.

---

## PASSO P2b.1 — `scripts/bench.ts` e `run.sh` com P3 e P4; falha registrada sem parar a rodada

**PODE ALTERAR:** `scripts/bench.ts`, `docker/aceite/run.sh`, `docker/aceite/README.md`, `tests/bench/bench-relatorio.test.ts`.

1. `ProjetoBench = "p1" | "p2" | "p3" | "p4"`. `--projetos` **valida** cada valor (fora da lista → mensagem e `process.exit(2)`); o padrão continua `p1,p2`.
2. Spec por projeto: P1/P2 como estão; P3 = `renderCanonicalSpecDocument(P3_SPEC)`; P4 = `renderCanonicalSpecDocument(P4_SPEC)`, importando de `../bench/specs/p3-p4`. Não copie nem edite o conteúdo das Specs.
3. P4: **antes** de criar o `project` no banco, copiar `bench/projetos/p4-base/` inteiro para `projectDir` (`fs.cpSync(..., { recursive: true })`).
4. Processo filho sem `shell: true`: `spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/bench.ts", "--uma", proj, vari, String(rep)], {...})`.
5. **Falha de uma execução não para a rodada:** se o filho sair com status ≠ 0 ou sem o bloco `===RESULTADO_JSON_START===`, registrar a execução com `faseFinal: "ERRO_BENCH"`, `erroBench` (últimas 20 linhas de stderr, **sem segredos**), aceite `0/<total do projeto>` (P1 10, P2 13, P3 12, P4 12) e custo lido da cópia do banco se existir (senão 0), e seguir para a próxima. A tabela Markdown marca essas linhas.
6. Tabela por execução do Markdown ganha a coluna **Reprovados** (ids dos testes de aceite que caíram, ex.: `L8, L12`; `—` se nenhum).
7. `run.sh`: aceitar `p1|p2|p3|p4` (mensagem de uso e validação). Não muda a imagem; **não** precisa reconstruir (`/aceite` é montado).
8. Testes em `tests/bench/bench-relatorio.test.ts` (só funções puras, sem banco/Docker): `coluna Reprovados lista os ids`, `execução ERRO_BENCH aparece marcada e conta 0 no aceite`, `médias separam p3 e p4`.
9. Prova (cole a saída): `npm run bench -- --projetos p4 --variantes padrao --repeticoes 1` — uma execução real do P4 até o aceite no contêiner.

Commit: `feat(bench): P2b.1 - projetos P3 e P4, falha registrada sem parar, coluna de reprovados`.

---

## PASSO P2b.2 — Rodada com 3 repetições
1. `npm run bench -- --projetos p3,p4 --repeticoes 3` (18 execuções: 2 projetos × 3 variantes × 3). Respeite a T-J.
2. Commitar o relatório gerado: `docs(bench): rodada P3/P4 com 3 repeticoes`.

## RELATÓRIO (`docs/relatorios/P2b-bench-dificil.md`)
1. Identificação: hash de partida; `git log --oneline <partida>..HEAD`; **`git reflog -20` colado**.
2. Por commit: `git show --stat`; `npx tsc --noEmit`; linha final do `npx vitest run` daquele commit.
3. Prova do P2b.1 item 9 (saída bruta).
4. Tabela das 18 execuções (copiada do relatório do bench) + `RESUMO` bruto de cada aceite.
5. Desvios do prompt (obrigatório; ver T-N).
6. Checklist T-A…T-N.
7. Dúvidas abertas.

===== FIM DO PROMPT =====
