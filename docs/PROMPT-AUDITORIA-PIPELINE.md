# Prompt para auditar a entrega do pipeline por contratos

Você é um auditor independente. Não confie neste texto. Leia o código e os testes. Onde o texto e o código divergirem, o código ganha. Responda em português, com PASS ou FAIL por item, arquivo e função, e uma frase do que você viu.

Data da entrega auditada: 2026-10-25.
Repositório: NextCode, working tree (não houve commit desta entrega).

## O que foi prometido

Pipeline de um sistema novo:

1. O elicitador escreve a Spec. Um humano aprova a Spec antes de qualquer código. O elicitador é a única voz com o usuário.
2. A conferência compara o Macrobrief com a Spec. Erro claro volta ao elicitador, no máximo 3 vezes, depois humano. Incerteza vai ao Jev. Se o Jev não responder, a sessão pergunta ao humano e não gasta tentativa.
3. Sistema novo com domínio na Spec e sem cluster core: a conferência marca `core_ausente` e devolve uma vez ao elicitador. Essa devolução não entra no contador de 3. Se continuar sem dono, a pergunta vai ao humano. O humano pode confirmar uma exceção nomeando o cluster (`core`, `backend`, `frontend`, `integration`). O mesmo vale para `frontend_ausente`, `backend_ausente` e `integracao_ausente`. Landing ou utilitário sem entidades, regras ou invariantes pode deixar o core como `nada_a_fazer`.
4. Só depois do laudo aprovado o analista escreve contratos e microbriefs. Cluster sem requisito correspondente é `nada_a_fazer`: zero arquivo, sem executor e sem teste. Reparo pontual não passa pela checagem de cluster ausente.
5. `validateContract` olha o grafo inteiro das etapas, com `dependeDe` real, não uma etapa só com `dependeDe: []`.
6. O executor termina como `entregue_pelo_executor`. O autoteste completo (`tsc`, ESLint e testes de aceite) roda antes do avaliador cego. Falha de autoteste volta ao executor, conta tentativa e não chama o avaliador. A etapa só fica `aprovada` com o veredito do avaliador. Não existe mais a ressalva da última tentativa em que o avaliador aprova e o teste escondido falha.
7. A revisão final lê Spec, Macrobrief e código. Reparo: o analista escreve o microbrief de correção; só o cluster dono refaz executor, autoteste e avaliador; o contador de reparo é separado do contador da conferência e do contador de tentativas do executor. Se o analista não responder, a rodada não abre e o contador não avança.
8. A sessão não fica presa em MACROBRIEF. `PLANO_PRONTO` só dispara depois de `MACROBRIEF_PRONTO` e `CONFERENCIA_OK`. `CONFERENCIA_OK` com a conferência ligada só ocorre se o laudo veio `aprovado: true`. Com a conferência desligada, a fase avança mesmo assim e a trilha marca `origem: conferencia_desligada`.

## Onde olhar

- `src/core/intake/cluster-gaps.ts` — `detectClusterGaps`, `clusterNamedByHuman`
- `src/core/intake/intake-engine.ts` — `runElicitadorAndAnalistaCycle`, `extractJsonObject`
- `src/core/orchestrator/execution-trigger.ts` — `approveSpecAndStart`, `abrirPlanejamento`, `withNadaAFazer`
- `src/core/orchestrator/phase-machine.ts` e `src/core/orchestrator/session-phase.ts` — `clusterGapDevolvido`, `clusterGapAguardandoHumano`, `excecoesCluster`
- `src/core/orchestrator/project-contract.ts` — `stagesFromContract`, `contractStagesForNode`
- `src/core/skills/spec-decomposer.ts` — `planoStages` e `contrato` no resultado do analista
- `src/core/orchestrator/node-executor.ts` — etapa `nada_a_fazer`, autoteste antes de `validateType2`, fim de `ACCEPTANCE_DISAGREEMENT`, logs `ENTREGUE_PELO_EXECUTOR` e `ETAPA_APROVADA`
- `src/core/orchestrator/delivery-repair.ts` — `diretrizDoAnalista`
- `src/core/governance/final-reviewer.ts` e `src/core/orchestrator/job-queue.ts` — Macrobrief no prompt da revisão final
- `src/core/governance/dual-lens-auditor.ts` — severidade de contrato com acento
- `src/app/api/chat/route.ts` — motivo `PERGUNTA_AO_HUMANO`
- `config/politicas-orquestracao.yaml` — `conferencia_entrada: sombra` (produção bloqueia)
- `vitest.setup.ts` — `NEXTCODE_CONFERENCIA_ENTRADA=desligado` só na suíte

## Costuras que o texto admite. Confirme no código. Se alguma estiver diferente, é FAIL.

- Em `NODE_ENV=test`, sem `ENABLE_CONFERENTE_LLM=true`, o modelo do conferente não é chamado. O laudo mecânico (estrutura da Spec, lacuna de cluster, Jev de cobertura) continua. Em produção a chamada é obrigatória e falha fechada: laudo vazio, JSON inválido ou exceção reprovam.
- A suíte força `NEXTCODE_CONFERENCIA_ENTRADA=desligado` para Specs antigas. Sem essa variável, o YAML manda. Sombra bloqueia laudo reprovado. O teste `(b)` em `tests/orchestrator/conferencia-na-aprovacao.test.ts` cobre isso.
- `verifyMacrobriefCoverageWithJev` ainda roda depois que o conferente aprova. O comportamento novo do Jev é só nos `incertos`: sem resposta, `pausaSemTentativa` e motivo `PERGUNTA_AO_HUMANO`, sem incrementar `voltasConferencia`.
- `nada_a_fazer` só é acrescentado quando `origemPlano === "analista"`, depois da T8b. Plano heurístico de teste não ganha os quatro clusters vazios.
- Em teste, sem `ENABLE_ANALISTA_REPARO=true`, o microbrief de reparo usa o texto fixo. Em produção, resposta vazia do analista impede a rodada e não incrementa o contador.
- O autoteste de aceite promove, roda a bancada e desfaz a promoção antes do avaliador. Se a bancada está fora (`contract.ok === false`), a etapa não trava só por isso.
- A revisão final só recebe o Macrobrief se `.nextcode/macrobrief.json` existir na pasta do projeto.

## Como verificar

1. Leia as funções citadas. Não aceite comentário no lugar de comportamento.
2. Confirme que `ACCEPTANCE_DISAGREEMENT` não decide mais a etapa. O teste E5 c em `tests/skills/executor-tool-loop.test.ts` espera reprovação na última tentativa.
3. Confirme que um contrato com dois donos não cai em `DONO INEXISTENTE` / `CONSUMIDOR INEXISTENTE` quando o grafo está em `planoStages` ou em `stagesFromContract`. O teste está em `tests/intake/cluster-gaps.test.ts`.
4. Rode, na raiz do repositório:

```
npx tsc --noEmit
npx vitest run tests/intake/cluster-gaps.test.ts tests/orchestrator/conferencia-na-aprovacao.test.ts tests/orchestrator/execution-trigger.test.ts tests/intake/jev-intake-conference.test.ts tests/skills/executor-tool-loop.test.ts
```

5. Não marque PASS num item que você não abriu no código.

## Formato da resposta

Para cada item 1–8: PASS ou FAIL, caminho do arquivo, o que o código faz de fato.
Depois: lista do que o texto admitiu e você confirmou, e lista do que o texto omitiu.
Feche com uma frase: a entrega cumpre o pipeline prometido, ou não cumpre, e por qual item.
