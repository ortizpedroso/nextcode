# Prompt PJ1.6 — correções da auditoria do PJ1 + smoke PJ1.5

> Item **PJ1** da referência §5.0 (auditoria 16/10, diário 77). **Não executar** sem 「aprovado PJ1.6」 do fundador.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa PJ1.6 — 3 correções do PJ1 e o smoke PJ1.5

## OBJETIVO
A auditoria do PJ1 (diário 77) achou:
1. **Teste suja o repositório:** `tests/intake/aprovacao-sem-projeto.test.ts` (≈98–102) cria projeto com `path: process.cwd()` e aprova a Spec → a execução grava `.nextcode/MEMORY.md` na pasta do próprio NextCode a cada `npx vitest run` (reproduzido pelo auditor). É o mesmo risco que o PJ1.4 fecha na tela.
2. **Reabrir renomeia o projeto:** o PJ1.2 (`src/app/api/projects/route.ts` ≈80–90), ao reabrir, sobrescreve `name`, `description` e `isPinned`. O prompt pedia só `isArchived: false`.
3. **Reabrir falha quando o nome difere da pasta:** a busca por projeto existente roda **depois** do bloco que acrescenta a subpasta `slugName` ao caminho escolhido (≈55–64). Abrir `C:\projetos\gateway` com nome "Gateway Pagamentos" vira `C:\projetos\gateway\gateway-pagamentos` → não acha o projeto → duplica.
4. **PJ1.5 (smoke na tela)** não foi feito.

## REGRAS DE TRABALHO (fundador, obrigatórias)
- **R1 — Nada fora do prompt.** Só os arquivos de "PODE ALTERAR". Fora do escopo → PARE e escreva no relatório.
- **R2 — Relatório sempre.** Seção por passo em `docs/relatorios/B1c-PJ1.md` (acrescentar "PJ1.6", formato §8.4): o que foi feito; `git show --stat`; saída real de `npx tsc --noEmit` e resumo do `npx vitest run`; desvios; o que não foi feito; no fim `git diff --stat <HEAD inicial>..HEAD`.
- **R3 — Conclusão só com dado** (saída real, o que apareceu na tela).

## TRAVAS
- **T-A** `git status --short` só `.claude/` e `.serena/`; `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/PJ1-correcao-e-smoke.md`. Diferente → PARE.
- **T-B** Proibido alterar `config/`, `bench/`, `skills/`, `scripts/`, `prisma/schema.prisma`, `src/core/`, `docs/NEXTCODE-REFERENCIA.md`, `memory/`.
- **T-C/T-D** Literalidade; nomes reais (`git grep -n`).
- **T-E** Um passo = um commit; `tsc` 0 e `vitest` verde no repositório principal. Proibido `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F** Nunca escrever em `prisma/dev.db`. **T-G** Nenhum segredo. **T-H** Nenhum pacote novo. **T-I** LF.
- **T-K** Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## PASSO PJ1.6a — Teste em pasta temporária
**PODE ALTERAR:** `tests/intake/aprovacao-sem-projeto.test.ts`.
O projeto do teste usa uma pasta criada com `fs.mkdtempSync(path.join(os.tmpdir(), "nc-pj1-"))` e removida no `afterEach`/`afterAll` (`fs.rmSync(..., { recursive: true, force: true })`). Nenhuma referência a `process.cwd()` como pasta de projeto.
**Prova no relatório:** apagar `.nextcode/` se existir, rodar `npx vitest run`, e colar `git status --short` mostrando que `.nextcode/` **não** reaparece.
Commit: `test(pj1): projeto do teste em pasta temporaria (PJ1.6a)`.

## PASSO PJ1.6b — Reabrir: só desarquiva e acha a pasta escolhida
**PODE ALTERAR:** `src/app/api/projects/route.ts`, `tests/api/projects-open-existing.test.ts`.
1. Ao reabrir, `update` só com `{ isArchived: false }` (nome, descrição e fixado ficam como estão).
2. A busca por projeto existente compara com **o caminho pedido** (`path.resolve(requestedPath)`, quando informado) **e** com o `targetPath` final; a busca roda **antes** de acrescentar `slugName`. Achou qualquer um → reabre. Não achou → comportamento atual (inclusive o acréscimo do `slugName`).
3. Testes novos: (a) reabrir com nome diferente mantém o nome antigo; (b) projeto existente em `X`; POST com `path: X` e nome que não bate com a pasta → mesmo `id`, `reopened: true`, sem criar `X/<slug>`; (c) testes atuais verdes.
Commit: `fix(projetos): reabrir so desarquiva e acha a pasta escolhida (PJ1.6b)`.

## PASSO PJ1.5 — Smoke na tela (sem commit de código)
Servidor local (`npm run dev`) e navegador. Usar só projetos de teste em pasta temporária (nunca projeto real do fundador). Registrar, para cada item, o que apareceu na tela:
1. Criar projeto de teste → Arquivar → some da lista → aparece em "Arquivados (n)" → Desarquivar → volta.
2. "Abrir projeto" na mesma pasta → não duplica (mesmo projeto, histórico presente).
3. Apagar → escolher "Remover só do NextCode" → some da tela e a pasta **continua** no disco (`Test-Path`).
4. Sessão ad-hoc → pedir aprovação da Spec → mensagem "⚠️ Para executar, vincule esta sessão…" e fase não muda → vincular ao projeto de teste → aprovar → execução começa.
Commit só do relatório: `docs(relatorio): PJ1.6 e smoke PJ1.5`.

===== FIM DO PROMPT =====
