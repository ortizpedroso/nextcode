# Prompt C1 — Correções da auditoria de 12/10 (só o que está quebrado)

> Origem: `docs/relatorios/auditoria-completa-2026-10-12.md` (achados C1, C2, C3, C6, C7).
> Máxima do fundador: **não se mexe no que está funcionando.** Se for preciso mexer em algo fora deste prompt, **pare e reporte ao fundador antes.**
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa C1 — desfazer a rota gratuita e a cascata no executor, corrigir a chave do cache do Jev e o registro do P3

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. **Leia este prompt inteiro e todos os arquivos de LEITURA OBRIGATÓRIA antes de alterar qualquer coisa.** Na seção 0 do relatório, escreva em 5 linhas, com suas palavras, o que cada passo vai mudar. Sem essa seção o pacote é rejeitado.
2. **Faça exatamente o que está escrito, nada além.** É proibido melhorar, refatorar, renomear, reformatar, mover, apagar código "morto", atualizar comentários, corrigir outro bug que você encontrar, ajustar tipos, mudar mensagens ou "aproveitar para arrumar". Mesmo que pareça óbvio e pequeno.
3. **Achou algo errado fora do escopo? Não conserte.** Anote na seção "Sugestões de melhoria" do relatório. Quem decide é o fundador.
4. **Precisou mexer em algo não descrito para cumprir um passo** (outro arquivo, outra linha, outro teste) → **PARE**, não faça, e escreva o relatório parcial explicando o que precisaria mudar e por quê. O fundador decide antes.
5. Dúvida de interpretação → **PARE e pergunte.** Nunca escolha sozinho.

## OBJETIVO
Voltar o executor ao comportamento que funcionava antes de `786d393` (só rota paga `custom/`, sem cascata), corrigir o bug da chave do cache do Jev, e corrigir no registro a afirmação "P3 12/12" sem prova.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. `git rev-parse HEAD` = `git log -1 --format=%H -- docs/prompts/C1-correcoes-auditoria.md`. Diferente → PARE.
- **T-B Escopo fechado.** Só os arquivos de PODE ALTERAR de cada passo, e só as linhas descritas. Nada em `bench/`, `skills/`, `prisma/`. **Proibido alterar `src/core/llm/paid-routing.ts`, `src/core/llm/cost.ts`, `src/core/skills/executor-tool-loop.ts`, `scripts/bench.ts`, `src/core/llm/evaluator-models.ts`** e os testes existentes (só **acrescentar** `it` novos onde o passo manda). Precisou de outro arquivo → PARE.
- **T-C Literalidade.** Nomes, valores e textos exatamente como escritos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais.** Todo nome citado conferido com `git grep -n`; saídas no relatório. Nome novo só os deste prompt.
- **T-E Um passo = um commit**, com `npx tsc --noEmit` (0 erros) e `npx vitest run` **completo** verde **nesse estado**; saídas coladas. Proibido `--amend`, `rebase`, `reset` (qualquer tipo), `revert`, `checkout -- <arquivo>`, `restore`, `stash`, `push --force`, `--no-verify`. Errou? Novo commit corrigindo, declarado em Desvios.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`; testes e bench usam cópia.
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório; nada de segredo vai ao Jev nem a LLM.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Todos os arquivos deste pacote estão em LF (`git ls-files --eol`); manter LF.
- **T-J Paradas obrigatórias.** Teste antigo quebrando; contradição prompt × código; arquivo fora do escopo; custo do bench > US$ 0,50 numa execução ou > US$ 0,60 no total; **execução do bench em fase diferente de ENTREGUE → PARE, cole a causa da trilha e NÃO tente consertar.** Nunca aumente timeout nem silencie erro para teste passar.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel.** Todo número copiado da saída real, com o trecho bruto abaixo. Nunca "sucesso", "100%", "homologado" sem o número e o nome do arquivo que prova. Afirmação sem prova = pacote rejeitado.
- **T-M Código gerado nunca roda no host.** Aceite só no contêiner `nextcode-aceite:1`.
- **T-N Histórico conferido.** O auditor lê `git reflog`. Comando git fora de `status`, `diff`, `add`, `commit`, `show`, `log`, `ls-files`, `rev-parse`, `grep` → declarar em Desvios.

## LEITURA OBRIGATÓRIA
- `docs/relatorios/auditoria-completa-2026-10-12.md` (achados C1, C2, C3, C6, C7).
- `git show 786d393` (o commit que este pacote corrige em parte).
- `config/politicas-orquestracao.yaml` (bloco `roteamento_papeis_criticos`, linha `prefixos_rota_paga`).
- `src/core/orchestrator/node-executor.ts` (~linhas 1020-1025, chamada de `loadPaidGatewaysForTier`).
- `src/core/decision/jev-cache.ts` (`computeKey`, ~linha 38-42) e `tests/decision/jev-cache.test.ts`.
- `tests/orchestrator/executor-somente-pago.test.ts` (função `setupTask`, teste "chamadas pagas levam allowedRoutedViaPrefixes…").
- `docs/JEV-LOG-DE-IMPLANTACAO.md` §4.23 e `docs/relatorios/bench/2026-10-12-1634.md`, `-2101.md`, `-2103.md`, `-2116.md`.

## O QUE NÃO MUDA (está funcionando — não tocar)
Rastreio `actualExecutorFamily` e `lastModelUsed`; preços novos em `cost.ts`; preservação da pasta no `bench.ts`; o código de contingência em `paid-routing.ts` e seus 2 testes (ficam, só deixam de ser ligados pelo executor); `makeBlindAuditDispatchFn`; cadeia do avaliador. Qualquer vontade de mexer nisso → Sugestões de melhoria.

---

## PASSO C1.1 — Só rota paga `custom/` e executor sem cascata

**PODE ALTERAR:** `config/politicas-orquestracao.yaml` (só a linha `prefixos_rota_paga`), `src/core/orchestrator/node-executor.ts` (só a chamada de `loadPaidGatewaysForTier`), `tests/orchestrator/executor-somente-pago.test.ts` (só acrescentar 1 `it`), `tests/config/politica-rota-paga.test.ts` (NOVO).

1. Em `config/politicas-orquestracao.yaml`, a linha `prefixos_rota_paga` volta a ser **idêntica** à de `786d393^` (confira com `git show 786d393^:config/politicas-orquestracao.yaml | grep prefixos_rota_paga`):
   `  prefixos_rota_paga: "custom/"                         # X-Routed-Via aceito para papéis críticos (lista separada por vírgula)`
2. Em `src/core/orchestrator/node-executor.ts`, a chamada volta a ser **idêntica** à de `786d393^`:
   `? await loadPaidGatewaysForTier(executorTier, policy.roteamentoPapeisCriticos)`
   (remover só o 3º e o 4º argumento e o comentário da linha `evaluatorFamily`). Nenhuma outra linha do arquivo muda. Confira com `git diff 786d393^ -- src/core/orchestrator/node-executor.ts`: o único bloco que deve sumir do diff é o de `loadPaidGatewaysForTier`; cole essa saída.
3. Novo `tests/config/politica-rota-paga.test.ts` (um `describe` "C1.1 — rota paga da política real"):
   - `it("política real aceita só custom/")` → `loadOrchestrationPolicy()` (raiz do repositório) → `roteamentoPapeisCriticos.prefixosRotaPaga` igual a `["custom/"]`.
   - `it("nenhum prefixo de revendedor gratuito ou contingência")` → nenhum item começa com `electronhub/`, `groq/` ou `mistral/`.
4. Em `tests/orchestrator/executor-somente-pago.test.ts`, acrescentar **um** `it` logo após o teste "chamadas pagas levam allowedRoutedViaPrefixes…", usando o mesmo `setupTask("pesado", true)`:
   `it("C1.1: executor sem cascata — gateways só com o modelo pago e prefixos só custom/")` → `capturedCalls[0].allowedRoutedViaPrefixes` igual a `["custom/"]`; nenhum `capturedCalls[0].gateways[i].modelHeavy` é `codestral-latest`, `deepseek-v4-flash`, `qwen3-coder-30-a3b-instruct` ou `qwen-2.5-coder-32b-instruct`.
   Se `capturedCalls[0].gateways` não existir nesse teste → PARE e relate (não altere `setupTask`).
5. Prova de que os testes pegam o erro: antes do commit, com os itens 1–2 ainda **não** aplicados, rode só os dois arquivos de teste e cole a falha; depois aplique 1–2 e cole o verde. (Ordem: escreva os testes primeiro.)

**Pronto quando:** os 3 testes novos falham no código de `786d393` e passam após o passo; suíte completa verde.
Commit: `fix(rota): C1.1 - papeis criticos so em custom/ e executor sem cascata (desfaz parte de 786d393)`.

---

## PASSO C1.2 — Chave do cache do Jev considera o conteúdo das perguntas

**PODE ALTERAR:** `src/core/decision/jev-cache.ts` (só o corpo de `computeKey`), `tests/decision/jev-cache.test.ts` (só acrescentar 2 `it`).

1. Bug: `JSON.stringify(questions, Object.keys(questions).sort())` usa a lista de chaves do 1º nível como filtro em **todos** os níveis, apagando `type`, `instructions` e `criteria`. Prova: `node -e 'const q={a:{type:"choice",instructions:"X"}};console.log(JSON.stringify(q,Object.keys(q).sort()))'` → `{"a":{}}`. Cole essa saída no relatório.
2. Em `computeKey`, trocar só a linha `serializedQuestions` por uma serialização com **ordenação recursiva das chaves** (função local `stableStringify` no mesmo arquivo, não exportada; arrays mantêm a ordem; sem dependência nova). Assinatura de `computeKey`, `payload` e o hash SHA-256 ficam como estão.
3. Acrescentar em `tests/decision/jev-cache.test.ts`:
   - `it("C1.2: perguntas com conteúdo diferente geram chaves diferentes")` → mesmo `purpose`, mesmo `state`, mesma chave de pergunta `a`, `instructions` diferentes → chaves diferentes.
   - `it("C1.2: ordem das chaves aninhadas não muda a chave")` → `criteria` com as mesmas chaves em ordem diferente → chaves iguais.
4. O teste existente "1. computeKey é determinística e imune à ordem das propriedades em questions" deve continuar passando **sem alteração**. Se quebrar → PARE.
5. Cole a falha do 1º teste novo antes da correção e o verde depois.

**Pronto quando:** 2 testes novos verdes, testes antigos do cache intactos e verdes, suíte completa verde.
Commit: `fix(jev): C1.2 - chave do cache considera o conteudo das perguntas`.

---

## PASSO C1.3 — Corrigir o registro do "P3 12/12"

**PODE ALTERAR:** `docs/JEV-LOG-DE-IMPLANTACAO.md` (só **acrescentar** uma seção no fim; a §4.23 não é editada nem apagada — regra 4 do fundador).

1. Acrescentar ao fim do arquivo a seção `### 4.24 Correção do registro da §4.23 (13/10/2026)` com:
   - frase: "A §4.23 afirmou homologação do P3 com 12/12. Nenhum relatório de bench de 12/10 com o código de `786d393` mostra esse resultado."
   - tabela copiada dos relatórios (Projeto, Fase, Aceite, Custo, arquivo) das rodadas `2026-10-12-1634`, `-2101`, `-2103`, `-2116`, com os números **exatamente** como estão nos `.md`.
   - frase: "A cascata no executor e os prefixos `electronhub/`, `groq/`, `mistral/` foram desligados em C1.1 (commit `<hash do C1.1>`)."
2. Nada mais no arquivo muda.

Commit: `docs(jev-log): C1.3 - corrige registro do P3 da secao 4.23`.

---

## PROVA REAL (depois dos 3 commits; sem commit de código)
- `npm run bench -- --projetos p3 --variantes padrao --repeticoes 1`. Teto: US$ 0,50 a execução; US$ 0,60 no total do pacote.
- Cole do relatório gerado: fase, aceite (`RESUMO {...}` bruto), `tsc`, custo total e a tabela "Detalhe por etapa" inteira.
- Confirme que **toda** linha "Exec. Modelos" começa com `custom/`. Qualquer `electronhub/`, `mistral/`, `groq/` → PARE e relate.
- Fase ≠ ENTREGUE → **PARE, não conserte**: cole o motivo da trilha (eventos `llm.gateway_failure`, `EXECUTOR_ROTA_PAGA`, último erro da etapa) e se a sessão pausou sem gastar tentativa. PAUSADA por falta de crédito/rota paga é resultado legítimo — relate como está.
- Commit só dos arquivos gerados pelo bench: `docs(bench): C1 - rodada P3 apos correcoes`.

## RELATÓRIO — `docs/relatorios/C1-correcoes-auditoria.md` (no último commit)
0. **Leitura feita:** 5 linhas com o que cada passo muda (Regra Zero).
1. **Identificação:** hash de partida e `git log --oneline <partida>..HEAD`.
2. **Por commit:** `git show --stat`, saída do `tsc`, resumo do `vitest` (arquivos/testes) daquele commit.
3. **Testes novos:** tabela `arquivo › nome › o que prova` + saída da falha antes e do verde depois.
4. **Evidência de nomes:** `nome › git grep -n` para todo nome citado.
5. **Prova real:** itens da seção acima, com trechos brutos.
6. **Escopo:** `git diff --stat <partida>..HEAD` colado — deve listar só os arquivos deste prompt.
7. **Desvios do prompt:** obrigatório; "nenhum" se nenhum. Inclui tudo o que foi feito a mais ou a menos.
8. **Checklist T-A…T-N:** cumprida sim/não, com evidência.
9. **Sugestões de melhoria (opcional):** o que você viu e **não** fez, com `arquivo:linha`, por que acha que é problema e o risco de mexer. Nenhuma delas pode ter sido implementada.
10. **Dúvidas abertas** para o fundador.

===== FIM DO PROMPT =====
