# Prompt S1 — Skills: ligar as decisões do Jev, tirar promessas falsas, enxugar o avaliador de tela, medir custo por etapa

> Pacote S1 da auditoria das skills. Achados do auditor em `docs/relatorios/auditoria-skills-S0.md` (A1–A6) — **leia antes**.
> Régua do bench (`bench/`) não muda. Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa S1 — ligar do jeito certo as respostas do Jev sobre skills, deixar as skills dizendo só a verdade e medir o custo por etapa

## OBJETIVO
A auditoria (`docs/relatorios/auditoria-skills-S0.md`) achou: o checklist de página pública é aplicado em **toda** tela (o contrário do prometido); o avaliador de tela manda ~60 mil caracteres de skill com conteúdo duplicado; avaliadores prometem ferramentas que não têm; o Jev responde se a página é pública e se precisa das regras de desempenho React, e a resposta é jogada fora; e o custo não pode ser ligado a cada etapa. Este pacote corrige isso e mede no bench.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/S1-skills-ligar-e-enxugar.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só os arquivos de PODE ALTERAR de cada passo. Nada em `bench/`. Precisou de outro arquivo para compilar → PARE e pergunte.
- **T-C Literalidade.** Nomes e formatos exatamente como escritos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais** (`git grep -n`). Nomes novos: só os deste prompt.
- **T-E Um passo = um commit**, com `npx tsc --noEmit` (0) e `npx vitest run` **completo** verde **nesse estado**; saídas coladas. Proibido `--amend`, `rebase`, `reset` (qualquer tipo), `push --force`, `--no-verify`. Errou? Novo commit corrigindo, declarado em Desvios.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; testes e bench usam cópia.
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório; nada de segredo vai ao Jev nem a LLM.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Arquivos novos em LF.
- **T-J Paradas obrigatórias.** Custo de uma execução do bench > US$ 0,50 → PARE; acumulado > US$ 1,50 → PARE (relatório parcial). **Qualquer execução do bench em fase diferente de ENTREGUE → PARE, investigue a trilha e cole a causa antes de seguir.** Contradição prompt × código → PARE.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel.** Todo número copiado da saída real, com o trecho bruto abaixo. Fase, custo e resultado de teste nunca resumidos com palavras como "sucesso" sem o número.
- **T-M Código gerado nunca roda no host.** Aceite só no contêiner `nextcode-aceite:1`.
- **T-N Histórico conferido.** O auditor lê `git reflog`. Comando git fora de `status`, `diff`, `add`, `commit`, `show`, `log`, `ls-files`, `rev-parse`, `grep` → declarar em Desvios.

## LEITURA OBRIGATÓRIA
- `docs/relatorios/auditoria-skills-S0.md` (achados A1–A6, tamanhos medidos).
- `src/core/skills/skill-runtime.ts` (`loadRoleSkill`, `buildSkillSystemPrompt`, filtro `taste-skill`).
- `src/core/decision/jev-decisions.ts` (`MicrobriefPlanningDecision`, `decideMicrobriefsPlanningBatch`, ramo de reserva).
- `src/core/orchestrator/execution-trigger.ts` (`withJevPlan`), `src/core/orchestrator/node-executor.ts` (`readPlannedTier`, chamada `DualLensAuditor.validateType2` ~linha 1319, chamadas de `recordLlmCost`).
- `src/core/governance/dual-lens-auditor.ts` (opções `isPublicPage`, montagem do bloco da skill ~linhas 520-533).
- `src/core/llm/cost.ts` (`recordLlmCost`), `scripts/bench.ts`.
- `skills/avaliador/SKILL.md`, `skills/avaliador-*/SKILL.md`, `skills/avaliador-frontend/references/*`.

---

## PASSO S1.1 — Custo por etapa na trilha e no bench

**PODE ALTERAR:** `src/core/llm/cost.ts`, `src/core/orchestrator/node-executor.ts`, `src/core/llm/evaluator-models.ts`, `scripts/bench.ts`, `tests/llm/cost-node.test.ts` (NOVO), `tests/bench/bench-relatorio.test.ts`.

1. `recordLlmCost` ganha o parâmetro opcional `nodeId?: string`, gravado em `details.nodeId` quando presente. Nenhuma outra mudança no formato.
2. Toda chamada de `recordLlmCost` feita durante a execução ou a avaliação de uma etapa passa o `nodeId` da etapa. Liste no relatório cada chamada alterada (`arquivo:linha`).
3. `scripts/bench.ts`: cada execução ganha `etapasDetalhe: [{ nodeId, titulo, cluster, nivelPlanejado, fontePlano ("jev"|"fallback"|"ausente"), executorModelos: string[], executorTokensEntrada, executorTokensSaida, executorUsd, avaliadorModelos: string[], avaliadorUsd }]`, montado das linhas `LLM_COST` (por `nodeId`) e do `payload.jevPlan` da etapa. Vai no `.yaml`; no `.md`, uma seção "Detalhe por etapa" por execução.
4. Testes: `tests/llm/cost-node.test.ts` — `nodeId gravado quando informado` e `ausente quando não informado`; em `tests/bench/bench-relatorio.test.ts` — `detalhe por etapa soma igual ao custo do papel`.

Commit: `feat(custo): S1.1 - custo por etapa (nodeId) na trilha e no bench`.

---

## PASSO S1.2 — Ligar as respostas do Jev sobre referências (página pública e desempenho React)

**PODE ALTERAR:** `src/core/orchestrator/execution-trigger.ts`, `src/core/orchestrator/node-executor.ts`, `src/core/governance/dual-lens-auditor.ts`, `src/core/skills/skill-runtime.ts`, `skills/avaliador-frontend/SKILL.md` (só o frontmatter neste passo), `tests/skills/skill-referencias.test.ts` (NOVO), `tests/orchestrator/jev-plan-referencias.test.ts` (NOVO).

1. `withJevPlan` grava também `aplicarTasteSkillPublico` e `aplicarReactPerfCritico` em `payload.jevPlan` (vindos da decisão; no ramo de reserva valem o que a reserva já calcula hoje).
2. Frontmatter de `skills/avaliador-frontend/SKILL.md`: declarar em `referencias_locais_fixas` também `skills/avaliador-frontend/references/ui-ux-pro-max-checklist.md` e `skills/avaliador-frontend/references/taste-skill-preflight-publico.md` (mesmo formato dos dois que já existem; `origem_*`/`commit_fixado` copiados dos comentários `<!-- Origem -->` de cada arquivo; não há → escreva `origem_repo: local` e relate).
3. `buildSkillSystemPrompt` ganha a opção `includeReactPerf?: boolean` (padrão `true`): referência cujo caminho contém `react-best-practices` só entra se `includeReactPerf` for `true`. O filtro de `taste-skill` continua como está.
4. Na chamada de `DualLensAuditor.validateType2` em `node-executor.ts`, passar `isPublicPage` e `includeReactPerf` lidos de `payload.jevPlan` da etapa (ausente → `isPublicPage: false`, `includeReactPerf: true`). `dual-lens-auditor.ts` repassa os dois a `buildSkillSystemPrompt`.
5. Trilha: ao montar o bloco da skill, gravar `EVALUATOR_SKILL_REFS` com `{ nodeId, skill, referencias: string[] (caminhos incluídos), caracteres }`.
6. Testes: `skill-referencias.test.ts` — `as 4 referências do avaliador-frontend estão declaradas e existem`; `página pública inclui taste-skill; dashboard não`; `includeReactPerf false tira react-best-practices`. `jev-plan-referencias.test.ts` — `jevPlan guarda aplicarTasteSkillPublico e aplicarReactPerfCritico`; `etapa sem jevPlan → isPublicPage false e includeReactPerf true`.

Commit: `feat(skills): S1.2 - respostas do Jev decidem referencias do avaliador de tela`.

---

## PASSO S1.3 — Skills dizem só a verdade e o avaliador de tela perde a duplicação

**PODE ALTERAR:** `skills/avaliador/SKILL.md`, `skills/avaliador-core/SKILL.md`, `skills/avaliador-backend/SKILL.md`, `skills/avaliador-frontend/SKILL.md`, `skills/avaliador-integration/SKILL.md`, `tests/skills/skill-promessas.test.ts` (NOVO), `tests/harness/orchestration-policy-and-skills.test.ts` (só o que o item 1 e o item 2 tornam falso: a exigência `ferramentas.length > 0` passa a valer só para `executor-*`, `analista` e `elicitador`; nenhuma outra asserção muda).

1. Nos 5 avaliadores: `ferramentas:` sem itens (o avaliador é uma chamada só; o código vem no prompt). O teste `tests/harness/orchestration-policy-and-skills.test.ts:439` exige lista não vazia para todas as skills — ajustar como descrito em PODE ALTERAR. Se **outro** código ou teste exigir lista não vazia → PARE e cole o erro. No corpo do `avaliador` (geral), uma frase no início do protocolo: "Você não tem ferramentas: todo o código da etapa está neste prompt. Nunca diga que abriu, rodou ou executou algo."
2. `avaliador-frontend`, corpo:
   - **§3 (playwright)**: apagar a seção e o item `playwright_cli_readonly`/`comandos` do frontmatter; no lugar, 2 linhas: a tela em execução é verificada à parte pelo harness (`ui-check`, contêiner sem rede); o avaliador julga só o código.
   - **§1, §2, §4, §5**: o corpo deixa de copiar as regras. Cada seção fica com no máximo 6 linhas: o que verificar, **quando** a referência entra (§5: "só quando a etapa for página pública; o harness inclui a referência") e como reportar. As regras ficam só nos arquivos de `references/`.
   - Não mudar o formato de saída (`reqVerdicts`, veredito) nem as regras de reprovação.
3. Teste `skill-promessas.test.ts` (promessa × código, automático):
   - `ferramentas de cada executor existem no laço de ferramentas` (lista fixa no teste: `read_file`, `list_files`, `grep`, `write_file`, `edit_file`, `run_check`, `finish`);
   - `avaliadores não declaram ferramentas`;
   - `nenhuma skill cita playwright_cli_readonly`;
   - `toda referência declarada existe e todo arquivo em references/ está declarado`;
   - `texto do avaliador-frontend: dashboard ≤ 40000 caracteres; página pública = dashboard + referência taste-skill`.
4. Cole no relatório a tabela de tamanhos antes/depois (mesma medição de `auditoria-skills-S0.md`: `loadRoleSkill` + `buildSkillSystemPrompt`, para os 4 avaliadores; frontend com e sem página pública e com e sem React).

Commit: `refactor(skills): S1.3 - avaliadores sem promessas falsas e sem regras duplicadas`.

---

## PASSO S1.4 — Rodada do bench
1. `npm run bench -- --projetos p1,p2,p3,p4 --variantes padrao,sem-jev --repeticoes 2` (16 execuções). T-J vale.
2. Commitar o relatório: `docs(bench): rodada S1`.

## RELATÓRIO (`docs/relatorios/S1-skills.md`)
1. Identificação: hash de partida; `git log --oneline <partida>..HEAD`; `git reflog -20` colado.
2. Por commit: `git show --stat`; `npx tsc --noEmit`; linha final do `npx vitest run` **completo** daquele commit.
3. S1.1 item 2: lista `arquivo:linha` das chamadas de `recordLlmCost` alteradas.
4. S1.3 item 4: tabela de tamanhos antes/depois (saída bruta).
5. Tabela das 16 execuções + `RESUMO` bruto de cada aceite + para o P2: as linhas `EVALUATOR_SKILL_REFS` da etapa de tela (brutas).
6. Desvios do prompt (obrigatório; ver T-N).
7. Checklist T-A…T-N.
8. Dúvidas abertas.

===== FIM DO PROMPT =====
