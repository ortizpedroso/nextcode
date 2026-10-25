# Prompt para auditar skills e orquestração do Macrobrief

Você é um auditor independente. Não confie neste texto. Leia o código, as skills e os testes. Onde o texto e o código divergirem, o código ganha. Responda em português, com PASS ou FAIL por item, arquivo e função, e uma frase do que você viu.

Data da entrega: 2026-10-25.
Repositório: NextCode, working tree (não houve commit desta entrega).
A entrega anterior do pipeline (itens 1 a 8 de `docs/PROMPT-AUDITORIA-PIPELINE.md`) continua valendo. Esta auditoria cobre só a fase seguinte.

## Decisão de formato

Spec, Macrobrief e microbrief são um documento só, em Markdown com frontmatter YAML, da escrita até quem lê. O conferente lê esse Macrobrief e devolve só o JSON do laudo (`aprovado`, `falhas`, `incertos`). Esse JSON não entra no microbrief e o avaliador não julga por ele.

## O que foi prometido

1. O elicitador escreve a Spec na conversa e, depois da aprovação humana, o Macrobrief. A skill não entrega mais o Macrobrief a outro papel. O Macrobrief lista clusters (`core`, `backend`, `integration`, `frontend`), arquivos que já estão na Spec, o REQ de cada um e `depende_de` entre clusters. Sem contrato TypeScript e sem corte de etapas.
2. `runElicitadorAndAnalistaCycle` confere esse texto. Não usa `decomposeSpec` como documento da conferência. Lacuna de cluster continua fora do contador de 3. Laudo com falha volta ao elicitador, no máximo 3, e a quarta bloqueia. Incerto vai ao Jev. Modelo calado, Macrobrief ilegível, laudo ilegível ou Jev calado pausa com `pausaSemTentativa` e não incrementa `voltasConferencia`. A varredura `verifyMacrobriefCoverageWithJev` não roda neste portão.
3. O conferente audita cobertura REQ→arquivo, stack e dependência entre clusters. Não audita contrato nem erro de rota. A mensagem que ele recebe é a Spec e o Markdown do Macrobrief.
4. Só com laudo `aprovado: true` o analista recebe o Macrobrief e parte em etapas de até 4 arquivos, no mesmo cluster e com os mesmos arquivos. A skill pede Markdown com YAML, não JSON. O critério de cada REQ é copiado da Spec pelo id. `src/contracts/index.ts` e a fatia do microbrief saem do mesmo objeto de contrato. Executor e avaliador leem o microbrief renderizado por `renderMicrobriefMarkdown`.
5. `.nextcode/macrobrief.md` guarda o texto do elicitador. A revisão final lê esse arquivo. Se só existir `macrobrief.json` de uma sessão antiga, ainda lê.
6. A regra 8 do testador manda escrever testes do contrato. Quem reprova a etapa é a bancada. A entrada do avaliador final lista o Macrobrief. Severidade `crítico`, `importante` e `menor` conta com ou sem acento.
7. Os quatro executores continuam chamados no `node-executor`, com o microbrief da etapa. Não houve mudança de orquestração neles.

## Onde olhar

- `skills/elicitador/SKILL.md`
- `skills/conferente-macrobrief/SKILL.md`
- `skills/analista/SKILL.md`
- `skills/testador/SKILL.md` — regra 8
- `skills/avaliador-final/SKILL.md` — entrada
- `skills/executor-core/SKILL.md`, `executor-backend`, `executor-frontend`, `executor-integration` — só conferir se o texto ainda manda implementar o microbrief
- `src/core/intake/macrobrief-elicitador.ts` — `renderElicitadorMacrobrief`, `parseElicitadorMacrobrief`, `validarElicitadorMacrobrief`, `classificarTextoDeMacrobrief`, `macrobriefFixoDaSpec`, `errosDePlanoContraMacrobrief`, `textoParaOConferente`
- `src/core/intake/spec-format.ts` — `parseYamlFrontmatter`
- `src/core/intake/intake-engine.ts` — `runElicitadorAndAnalistaCycle`, `escreverMacrobriefDoElicitador`
- `src/core/skills/spec-decomposer.ts` — `parseAnalystPlan`, `parseAnalystYaml`, `decomposeWithAnalistaSkill`
- `src/core/orchestrator/execution-trigger.ts` — repasse de `macrobriefAprovado` e gravação de `macrobrief.md`
- `src/core/orchestrator/job-queue.ts` — leitura do Macrobrief na revisão final
- `src/core/governance/dual-lens-auditor.ts` — `semAcento` na severidade
- `src/core/skills/spec-decomposer.ts` — `buildDecompositionFromAnalystPlan` copia `criterio` da Spec
- `src/core/orchestrator/node-executor.ts` — executor e avaliador recebem `renderMicrobriefMarkdown`

## Testes

`npx tsc --noEmit` passou.

Passaram, nesta sessão: `tests/intake/macrobrief-elicitador.test.ts`, `tests/intake/jev-intake-conference.test.ts`, `tests/intake/jev-macrobrief-stress.test.ts`, `tests/intake/cluster-gaps.test.ts`, `tests/orchestrator/conferencia-na-aprovacao.test.ts`, `tests/orchestrator/analista-plan.test.ts`, `tests/orchestrator/execution-trigger.test.ts`, `tests/governance/av13-problemas-evidencia.test.ts`.

O item 7 de `tests/harness/end-to-end-harness-plan.test.ts` (ciclo da Spec incompleta) passou. O teste de verificação de tela que espera `ENTREGUE` estourou 15 s e falhou ao apagar o diretório temporário (`EPERM`). Não foi alterado nesta entrega. Rode de novo isolado antes de tratá-lo como regressão.

## O que este texto admite

- Em `NODE_ENV=test`, sem `ENABLE_ELICITADOR_MACROBRIEF=true`, o ciclo não chama o modelo do elicitador. Usa `macrobriefFixoDaSpec`, agrupado pelo caminho do arquivo. Produção chama Claude e, se ele não responder, o roteador.
- Em teste, sem `ENABLE_CONFERENTE_LLM=true`, o modelo do conferente não é chamado. O laudo mecânico fica aprovado. `laudoInjetado` existe para o teste forçar falha.
- `vitest.setup.ts` continua com `NEXTCODE_CONFERENCIA_ENTRADA=desligado`. Com a conferência desligada, `approveSpecAndStart` não pede o Macrobrief do elicitador. O YAML de produção segue `sombra`.
- `parseAnalystPlan` ainda aceita o JSON antigo, para plano já gravado em teste. A skill pede YAML.
- `verifyMacrobriefCoverageWithJev` continua no código e nos testes da função. Saiu do portão da conferência.
- Laudo vazio, JSON inválido ou modelo do conferente calado agora pausa sem gastar `voltasConferencia`. Antes isso contava como reprovação.
- O analista não devolve o microbrief pronto. Devolve o plano em YAML. O harness monta cada microbrief uma vez, com o critério copiado da Spec e a fatia do mesmo contrato gravado em `src/contracts/index.ts`.
- Cluster sem arquivo de backend numa Spec que cita "API" volta como `backend_ausente`. O teste de estresse cobre esse caso.

## Fora desta entrega

Skills de método (`writing-plans`, `systematic-debugging` e as outras da pasta que não são papéis do pipeline). O prazo de 5 s do teste 6 de `execution-trigger`.
