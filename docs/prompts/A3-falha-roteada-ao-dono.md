# A3 — Falha de etapa roteada ao dono (mudança 16, §5.0)

Você vai implementar o item **A3** do cronograma (`docs/NEXTCODE-REFERENCIA.md` §5.0, linha "A3" e mudança 16). O auditor (Claude) confere cada passo antes de aceitar. Faça **um passo por vez** e pare ao fim de cada um esperando o OK do fundador.

## Regras (obrigatórias)
- **R1 — nada fora do prompt.** Arquivos que você pode alterar ou criar, e nenhum outro:
  1. `src/core/decision/jev-execution-checks.ts`
  2. `src/core/orchestrator/node-executor.ts` — **somente** o bloco do diagnóstico (hoje linhas ≈1564-1640, de `let jevDiagnostico` até o fim do tratamento de `ambiguous_spec`)
  3. `src/core/config/orchestration-policy.ts` — somente o tipo, o padrão e a leitura da chave nova `roteamentoFalha`, copiando o padrão de `bloqueioSpecAmbigua` (linhas 112, 299, 527-530)
  4. `config/politicas-orquestracao.yaml` — somente a linha nova `roteamento_falha: sombra` dentro de `jev_execucao`
  5. `tests/decision/a3-failure-routing.test.ts` (novo)
  6. `scripts/replay-failure-diagnosis.ts` (novo)
  7. `docs/relatorios/A3-falha-roteada-ao-dono.md` (novo)
  8. `src/core/governance/incident-reporter.ts` — **somente no A3.2** (liberado pelo auditor após o A3.0, 17/10): campo opcional `dono?: string` em `IncidentReportOptions` e **uma** linha `**Dono:** <dono>` no relatório quando o campo vier preenchido; sem campo, a saída fica idêntica à de hoje

  Não mexa em `spec-decomposer.ts`, skills, elicitador, avaliador, UI, Prisma, nem em outro trecho de `node-executor.ts`. Não renomeie, não reformate, não "melhore" código vizinho. Se achar que precisa mexer em algo fora desta lista, **pare e escreva no relatório** o que e por quê; não mexa.
- **R2 — relatório a cada passo** em `docs/relatorios/A3-falha-roteada-ao-dono.md`: o que mudou (`arquivo:linha`), hash do commit, saída real de `npx tsc --noEmit` e as últimas linhas de `npx vitest run` com os totais. Nada de "funciona" sem saída colada.
- **R3 — conclusão só com dado.** Toda afirmação de resultado vem com saída de comando ou número da trilha. Se não sabe, escreva "não verificado".
- Um commit por passo; `tsc` 0 e `vitest` verde **naquele commit**. Proibido `--amend`, `reset`, `rebase`, `push --force`, `--no-verify`. Não use `git add -A` nem `git add .`: adicione só os arquivos da lista.
- **Nunca** escrever em `prisma/dev.db`. Para ler a trilha, copie `prisma/dev.db` e `prisma/dev.db-wal` para uma pasta temporária **fora** do repositório e use `DATABASE_URL="file:C:/caminho/da/copia/dev.db"`.
- Regra 7: nenhum segredo vai ao Jev. Use só `askJevBatch` (ele aplica a máscara); não crie outra forma de chamar o Jev.
- Gasto: só Jev (≈ US$ 0,001). **Nenhuma** chamada a LLM.

## Contexto (verificado pelo auditor no HEAD `9193175`)
- `diagnoseStageFailureWithJev` (`jev-execution-checks.ts:65-146`) pergunta a causa com 5 opções (`FAILURE_CAUSE_CRITERIA`, linhas 19-30). Não existe "erro do plano". O critério atual de `evaluator_error` ("blames files outside this stage") empurra para ele justamente o caso de erro do plano.
- O estado de hoje não leva o escopo de arquivos da etapa.
- `node-executor.ts:1446-1452` já monta `criteriosPorReq` (critério por REQ, vindo de `nodeMicrobrief.criteriosAceitePorReq`). `taskDb.filesScope` é o escopo da etapa (JSON de lista).
- `node-executor.ts:1564-1610`: só `ambiguous_spec` tem efeito. Política: `limiarConfiancaDiagnostico: 0.8` (`orchestration-policy.ts:306`).
- Reavaliação sem gastar tentativa já existe para avaliador fora do ar: `evaluatorOutageFreeRetry`, `MAX_FREE_EVALUATOR_RETRIES = 2` (`node-executor.ts:356,1254,1475`).
- Casos reais na trilha (`TaskNode.failureHistory`, sessão `934939fc`), **todos erro do plano** pelo rótulo do auditor:
  - Etapa 1/16, tentativa 1: avaliador diz que `vitest.config.ts` está fora do escopo (REQ-002 exige; escopo tem 4 arquivos). Diagnóstico antigo: `evaluator_error` 0,97.
  - Etapa 3/16, tentativas 1-3: REQ-032 e REQ-040 exigem `src/app/api/v1/links/route.ts` e `tests/cobrancas.test.ts`, fora do escopo. Diagnóstico antigo: `evaluator_error` 0,85-0,87.
- Falhas conhecidas do Jev 1.13 (`docs/terceiros/jev-docs/model-jaggedness_jev-1.13.md`): leitura literal; viés para a 1ª opção; estado grande derruba acurácia; comparação de listas fica no código.

## Passos

### A3.0 — Inventário (sem código)
No relatório, com `arquivo:linha`, só fatos:
1. Linha exata onde `criteriosPorReq` e `taskDb.filesScope` ficam disponíveis antes do diagnóstico.
2. Onde a tentativa é somada (`newAttempts`) e onde a etapa vira `BLOQUEADA`/`failed` definitivo (T6).
3. Como `evaluatorOutageFreeRetry` evita gastar tentativa; dá para reaproveitar o mesmo caminho para `evaluator_error` sem mudar o comportamento de avaliador fora do ar? Sim/não e por quê.
4. Função de `incident-reporter.ts` que monta o relatório mostrado no chat e como receber um campo "Dono".

Commit só do relatório. **Pare.**

### A3.1 — Causa nova, pré-checagem mecânica, estado curto
Em `jev-execution-checks.ts`:
- Acrescente `plan_error` a `JevFailureCause`, `FAILURE_CAUSE_CRITERIA`, `FAILURE_CAUSE_LABELS_PT` ("erro do plano") e `FAILURE_CAUSE_GUIDANCE_PT`. Textos exatos:
  - `plan_error`: `"the rejection says a requirement needs a file that is not in \`arquivos_escopo\`, and that requirement's criteria in \`reqs_com_arquivos\` do name that file"`
  - `evaluator_error` (substitui o atual): `"the rejection is wrong about code inside \`arquivos_escopo\`, contradicts itself, or demands a file that the requirement's criteria do not name"`
  - As outras 4 causas não mudam.
- `diagnoseStageFailureWithJev` passa a receber, além do que já recebe: `arquivosEscopo: string[]` e `criteriosPorReq: Record<string, string>`. No estado, acrescente `arquivos_escopo` e `reqs_com_arquivos` (por REQ coberto: os caminhos de arquivo encontrados no texto do critério, extraídos por regex de caminho com extensão). Estado total ≤ **8.000** caracteres: corte primeiro `historico_motivos`, depois `motivo_rejeicao`; nunca corte `arquivos_escopo` nem `reqs_com_arquivos`. Passe `maxStateChars: 8000`.
- **Pré-checagem no código, antes do Jev** (função exportada `detectPlanErrorMechanically`): para cada REQ coberto, se algum caminho citado no critério **não** está em `arquivos_escopo` (comparação pelo caminho normalizado com `normalizeScopePath` de `dual-lens-auditor.ts`; aceite igualdade do final do caminho, ex. `lib/x.ts` = `src/lib/x.ts`) **e** o motivo da rejeição cita esse REQ ou esse caminho → retorna `{ causa: "plan_error", fonte: "mecanica", confianca: 1, foraDoEscopo: [{ req, arquivo }] }` e o Jev **não é chamado**. Caso contrário, chama o Jev como hoje e devolve `fonte: "jev"`.
- Trilha `JEV_FAILURE_DIAGNOSIS`: acrescente `fonte` e `foraDoEscopo`; mantenha os campos atuais.
- Em `node-executor.ts`, só passe os dois argumentos novos na chamada existente. Nada mais neste passo.
- Testes em `tests/decision/a3-failure-routing.test.ts` (Jev simulado, sem rede):
  1. caso da etapa 3 (escopo de 4 arquivos; REQ-032 cita `src/app/api/v1/links/route.ts`; motivo cita REQ-032) → `plan_error`, `fonte: mecanica`, Jev não chamado;
  2. caso da etapa 1 (`vitest.config.ts`) → idem;
  3. motivo cita arquivo fora do escopo que o critério **não** cita → não é `plan_error` mecânico; Jev chamado;
  4. arquivo do critério dentro do escopo (`lib/x.ts` × `src/lib/x.ts`) → não dispara;
  5. motivo de 50.000 caracteres → estado ≤ 8.000 e `arquivos_escopo` intacto;
  6. as 6 opções chegam ao Jev.

Commit. **Pare.**

### A3.2 — Cada causa age (chave `roteamentoFalha`, padrão `sombra`)
- Chave nova `jevExecucao.roteamentoFalha: "ativo" | "sombra" | "desligado"`, padrão `"sombra"`, lida do YAML `roteamento_falha` como `bloqueioSpecAmbigua`.
- No bloco do diagnóstico, a ação vale quando `fonte === "mecanica"` ou `confianca >= limiarConfiancaDiagnostico`:

| causa | ação em `ativo` | dono no relatório |
|---|---|---|
| `plan_error` | não soma mais tentativa; etapa vai ao estado definitivo de falha que o T6 já usa (o mesmo do inventário item 2); relatório de incidente lista REQ e arquivos fora do escopo | `analista (erro do plano)` |
| `ambiguous_spec` | comportamento atual, sem mudança | `elicitador / fundador` |
| `evaluator_error` | 1 reavaliação **sem** somar tentativa, pelo mesmo caminho de `evaluatorOutageFreeRetry`, no máximo 1 vez por etapa; na 2ª vez, como `wrong_code` | `avaliador` |
| `wrong_code`, `incomplete_output` | comportamento atual | `executor` |
| `environment` | comportamento atual + campo dono | `ambiente` |

  Se o inventário (item 3) disser que o reaproveitamento para `evaluator_error` muda o comportamento de avaliador fora do ar: **não implemente essa linha**, deixe `evaluator_error` como hoje e registre no relatório.
- Em `sombra`: nenhuma mudança de fluxo; só grave `FAILURE_ROUTE_WOULD_ACT` com `{ nodeId, tentativa, causa, fonte, confianca, acao, dono }`. Em `desligado`: nada novo.
- Não crie replanejamento (isso é o A2).
- Testes: para cada causa, `sombra` (fluxo igual ao de hoje + evento gravado) e `ativo` (ação da tabela; em `plan_error` a tentativa não é somada).

Commit. **Pare.**

### A3.3 — Replay (porta do auditor)
`scripts/replay-failure-diagnosis.ts`, lendo só a **cópia** do banco:
- **Casos reais:** toda `TaskNode` com `failureHistory` não vazio (hoje 2 etapas, 4 tentativas). Para cada tentativa: escopo = `filesScope` da etapa; critérios = `payload.microbrief.criteriosAceitePorReq`; motivo = `rejectionReason`.
- **Controles sintéticos** (escreva exatamente estes 5 no script; rótulo do auditor entre parênteses):
  1. escopo `["src/lib/soma.ts"]`; REQ-001 critério "`src/lib/soma.ts` exporta `soma(a,b)` que retorna a+b"; motivo "REQ-001: soma retorna a-b em src/lib/soma.ts:3" (`wrong_code`)
  2. mesmo escopo e critério; motivo "REQ-001: falta o arquivo src/lib/outro.ts" (`evaluator_error`)
  3. mesmo escopo e critério; motivo "Cannot find module 'zod' — dependência não instalada" (`environment`)
  4. mesmo escopo e critério; motivo "resposta do executor cortada: nenhum arquivo gerado" (`incomplete_output`)
  5. escopo `["src/lib/taxa.ts"]`; REQ-002 critério "taxa de 2% e também isenta de taxa"; motivo "REQ-002 contraditório: pede taxa de 2% e isenção ao mesmo tempo" (`ambiguous_spec`)
- Tabela no relatório: caso, motivo (200 caracteres), causa antiga (trilha; "—" para sintético), causa nova, fonte, confiança, rótulo do auditor, acertou (sim/não).
- Rode de novo cada caso que chegou ao Jev com a **ordem das opções invertida**; mostre a causa e marque onde muda.
- Custo: total de tokens e US$ do Jev no replay (da resposta do Jev ou da trilha).
- **Não troque a chave para `ativo`.**

Commit. **Pare.**

### A3.4 — Relatório final
Feche `docs/relatorios/A3-falha-roteada-ao-dono.md` no formato da §8.4 da referência: passos, commits, tsc/vitest de cada um, tabela do replay, custo, o que ficou de fora e por quê.

## Porta (o auditor confere antes de aceitar)
- As 4 tentativas reais saem `plan_error` com `fonte: mecanica`.
- Os 5 controles sintéticos acertam o rótulo, e nenhum sai `plan_error`.
- A ordem invertida não muda a causa em nenhum dos controles.
- `tsc` 0 e `vitest` verde em cada commit; `git status` sem arquivo fora da lista.
