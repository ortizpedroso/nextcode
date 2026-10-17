# A3 — Falha de etapa roteada ao dono (mudança 16, §5.0)

Você vai implementar o item **A3** do cronograma (`docs/NEXTCODE-REFERENCIA.md` §5.0, linha "A3" e mudança 16). O auditor (Claude) confere cada passo antes de aceitar.

## Regras (obrigatórias)
- **R1 — nada fora do prompt.** Só mexa nos arquivos citados aqui. Não mexa no planejamento (`spec-decomposer.ts`, `assignReqsForGroup`), nas skills, no elicitador, no avaliador, na UI nem no YAML além da chave nova do passo A3.3. Se achar que precisa mexer em outra coisa, **pare e relate**, não mexa.
- **R2 — relatório a cada passo.** Ao fim de cada passo, escreva em `docs/relatorios/A3-falha-roteada-ao-dono.md`: o que mudou (arquivo:linha), o hash do commit, a saída real de `npx tsc --noEmit` e de `npx vitest run` (as últimas linhas, com totais). Nada de "funciona" sem saída colada.
- **R3 — conclusão só com dado.** Toda afirmação de resultado vem com número da trilha ou saída de comando.
- Um commit por passo; `tsc` 0 e `vitest` verde **naquele commit**. Proibido `--amend`, `reset`, `rebase`, `push --force`, `--no-verify`.
- **Nunca** escrever em `prisma/dev.db`. Para ler a trilha, copie `prisma/dev.db` e `prisma/dev.db-wal` para uma pasta temporária fora do repositório e aponte `DATABASE_URL` (caminho `C:/...`) para a cópia.
- Regra 7: nenhum segredo vai ao Jev. O estado passa pela máscara que já existe em `askJevBatch`; não crie caminho que a pule.
- Gasto: só chamadas ao Jev (≈ US$ 0,001 no total). Nenhuma chamada a LLM pago.

## Contexto (verificado pelo auditor no HEAD `bc83920`)
- `diagnoseStageFailureWithJev` (`src/core/decision/jev-execution-checks.ts:65-146`) pergunta ao Jev a causa da falha com 5 opções (`FAILURE_CAUSE_CRITERIA`, linhas 19-30). **Não existe a opção "erro do plano".**
- O estado enviado hoje: título, cluster, `reqs_cobertos`, motivo, tentativa, histórico. **Não vai o escopo de arquivos da etapa** — sem ele, o Jev não tem como ver que o REQ pede arquivo fora da etapa.
- Em `node-executor.ts:1572-1610` só a causa `ambiguous_spec` tem efeito (e só a partir da 2ª tentativa). As outras são registradas e ignoradas.
- Teste real `934939fc`, etapa 3: as 3 tentativas foram diagnosticadas `evaluator_error` (0,85–0,98). Causa real (auditoria, diário 93): o plano pôs REQ-032 e REQ-040 numa etapa cujo escopo não tem os arquivos que eles exigem.
- A trilha (`TelemetryLog`, ação `JEV_FAILURE_DIAGNOSIS`) tem 20 diagnósticos, mas **não guarda o motivo**; o motivo está em `TaskNode.failureHistory`.
- Falhas conhecidas do Jev 1.13 (`docs/terceiros/jev-docs/model-jaggedness_jev-1.13.md`): leitura literal, viés para a 1ª opção, estado grande derruba acurácia, conta/comparação deve ficar no código.

## Passos

### A3.0 — Inventário (sem código)
No relatório, responda com `arquivo:linha`:
1. No ponto de `node-executor.ts:1572`, quais destes dados já estão disponíveis: `files_scope` da etapa; critérios de aceite por REQ (`criteriosAceitePorReq` ou equivalente); para cada REQ, os arquivos citados nos critérios?
2. Onde está a contagem de tentativas e onde a etapa vira `BLOQUEADA` (T6)?
3. Como hoje se reavalia sem gastar tentativa (`evaluatorOutageFreeRetry`, `node-executor.ts:1254,1475`)? Dá para reaproveitar para "erro do avaliador"?
4. Onde se gera o relatório de incidente mostrado no chat (`incident-reporter.ts`)?
Commit só do relatório.

### A3.1 — Causa nova + pré-checagem mecânica + estado curto
Em `src/core/decision/jev-execution-checks.ts`:
- Acrescente a causa `plan_error` em `JevFailureCause`, `FAILURE_CAUSE_CRITERIA`, `FAILURE_CAUSE_LABELS_PT` e `FAILURE_CAUSE_GUIDANCE_PT`. Critério (inglês, literal): `"the rejection is about a requirement or file that this stage cannot deliver: the file is outside \`arquivos_escopo\`, or the requirement belongs to another stage"`.
- Ajuste `evaluator_error` para não se confundir com o novo: `"the rejection reason contradicts itself, or is wrong about code that IS inside \`arquivos_escopo\`"`.
- Acrescente ao estado: `arquivos_escopo` (o `files_scope` da etapa) e `reqs_com_arquivos` (por REQ coberto, os arquivos citados nos critérios). Limite o estado a **8.000 caracteres**: corte o motivo e o histórico antes, nunca o escopo.
- **Pré-checagem no código, antes do Jev:** se um REQ coberto pela etapa cita, nos critérios, um arquivo que não está em `arquivos_escopo` **e** o motivo da rejeição cita esse REQ ou esse arquivo → causa `plan_error` com `fonte: "mecanica"` e **sem chamar o Jev**. Isso é comparação de listas; fica no código, não no Jev.
- Registre na trilha `JEV_FAILURE_DIAGNOSIS` com `fonte` (`mecanica` ou `jev`), `causa`, `confianca` e os REQ/arquivos fora do escopo.
- Testes unitários (Jev simulado) para: pré-checagem dispara; pré-checagem não dispara quando o arquivo está no escopo; estado ≤ 8.000 caracteres com motivo enorme; as 6 opções chegam ao Jev.

### A3.2 — Cada causa age (ação atrás de chave, padrão `sombra`)
Em `node-executor.ts`, no ponto do diagnóstico, por causa (só quando a confiança passa `limiarConfiancaDiagnostico`, ou quando `fonte: mecanica`):
- `plan_error` → **não** gasta mais tentativa do executor: etapa `BLOQUEADA`, relatório de incidente com "Dono: analista (erro do plano)", lista dos REQ e arquivos fora do escopo. (Replanejar de verdade é o A2; não implemente.)
- `ambiguous_spec` → mantém o comportamento atual, mas o relatório passa a dizer "Dono: elicitador / fundador".
- `evaluator_error` → reavaliação pelo próximo avaliador da cadeia **sem gastar tentativa** do executor, no máximo 1 vez por etapa, reaproveitando o mecanismo do inventário item 3.
- `wrong_code`, `incomplete_output` → como hoje (volta ao executor com o motivo).
- `environment` → `PAUSADA` com relatório "Dono: ambiente (dependência/ferramenta)".
- Chave nova em `config/politicas-orquestracao.yaml`, dentro de `jev_execucao`: `roteamento_falha: sombra` (valores `sombra` | `ativo` | `desligado`). Em `sombra`: só registra `FAILURE_ROUTE_WOULD_ACT` com a ação que tomaria; nada muda no fluxo. Em `ativo`: age.
- Testes: uma etapa simulada por causa, em `sombra` (nada muda, evento gravado) e em `ativo` (ação certa; tentativa não consumida em `plan_error` e `evaluator_error`).

### A3.3 — Replay com a trilha real (porta)
Crie `scripts/replay-failure-diagnosis.ts`: lê a **cópia** do banco, pega toda `TaskNode` com `failureHistory`, monta a mesma entrada do A3.1 e roda o diagnóstico novo (Jev de verdade + pré-checagem). Saída em tabela no relatório: sessão, etapa, tentativa, motivo (200 caracteres), causa antiga (da trilha), causa nova, fonte, confiança. Também rode cada caso com as opções em **ordem invertida** e marque onde a causa muda (viés da 1ª opção).
**Não troque a chave para `ativo`.** O auditor rotula os casos e decide.

### A3.4 — Relatório final
`docs/relatorios/A3-falha-roteada-ao-dono.md` completo (§8.4 da referência): passos, commits, tsc/vitest de cada um, tabela do replay, custo do Jev do replay (da trilha `LLM_COST`/`JEV_*`), o que ficou de fora.

## Porta (o auditor confere)
- Etapa 3 do `934939fc`: as 3 tentativas saem `plan_error`, de preferência por `fonte: mecanica`.
- Nenhum caso que o auditor rotular "código errado" sai `plan_error`.
- Com opções invertidas, a causa não muda em ≥ 90% dos casos.
- `tsc` 0 e `vitest` verde em cada commit.
