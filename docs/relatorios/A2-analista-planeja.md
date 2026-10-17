# A2 — Planejamento pela skill analista (mudança 21)

Relatório do pacote A2. Este passo (**A2.0**) é inventário somente leitura; A2.1+ aguarda OK do desenho.

---

## A2.0 — Inventário

### 1. Quem chama o planejamento

Saída de `git grep -n "decomposeSpec\|decomposeWithAnalistaSkill" -- "*.ts" "*.tsx"` (produção e testes):

| Chamada | Arquivo:linha | Fase / contexto |
|---------|---------------|-----------------|
| `SpecDecomposerSkill.decomposeSpec` | `src/app/api/chat/route.ts:924` | **Chat / elicitação** — após guard da Spec; gera Macrobrief e telemetria T8a/T8b; **não** cria `TaskNode` |
| `SpecDecomposerSkill.decomposeSpec` | `src/core/intake/intake-engine.ts:297` | **Intake / conferência** (harness de fases); bloqueia transição se `validateMacrobriefMechanical` falhar (`intake-engine.ts:303-305`, `333-335`) |
| `SpecDecomposerSkill.decomposeWithAnalistaSkill` | `src/core/orchestrator/execution-trigger.ts:384` | **Aprovação → execução** — dentro de `approveSpecAndStart`; decompõe a `canonicalSpec` e grava `TaskNode` (`execution-trigger.ts:425-447`) |
| `SpecDecomposerSkill.decompose` (sem `decomposeSpec`) | `execution-trigger.ts:396` | **Aprovação → execução** — quando `arquivosAfetados` está vazio; heurística de domínio (`spec-decomposer.ts:527-540`) |
| `SpecDecomposerSkill.decomposeSpec` | `tests/harness/end-to-end-harness-plan.test.ts:375`, `:536` | Testes |
| `SpecDecomposerSkill.decomposeSpec` | `tests/intake/jev-macrobrief-stress.test.ts:112` | Testes |
| `SpecDecomposerSkill.decomposeSpec` | `tests/intake/spec-check.test.ts:194`, `:209` | Testes |
| `SpecDecomposerSkill.decomposeSpec` | `tests/orchestrator/spec-decompose.test.ts:21` | Testes |

Definições: `spec-decomposer.ts:52` (`decomposeSpec`), `spec-decomposer.ts:317` (`decomposeWithAnalistaSkill`).

---

### 2. Caminho LLM (`decomposeWithAnalistaSkill`)

| Etapa | Arquivo:linha | Fato |
|-------|---------------|------|
| Heurística base sempre roda primeiro | `spec-decomposer.ts:331-337` | `decomposeSpec(...)` → `baseDecomp` |
| `skipModel` ou sem router | `spec-decomposer.ts:339-340` | Retorna `baseDecomp`; **sem** trilha `ANALISTA_PLAN_*` |
| Carrega skill | `spec-decomposer.ts:344-345` | `loadRoleSkill("analista")`, `buildSkillSystemPrompt(analistaSkill)` |
| Dispatch LLM | `spec-decomposer.ts:370-381` | `smartRouter.dispatchWithFallback({ tier: "heavy", maxTokens: 4096, signal: AbortSignal.timeout(5000), ... })` |
| Ordem gateways tier `heavy` | `smart-router.ts:1124-1128` | `heavyFirst` primeiro; filtra gateways com `modelForTier(g, tier) !== null` |
| Modelo por gateway (tier `heavy`) | `gateways.ts:142-143` | `gw.modelHeavy \|\| gw.modelFast` |
| Defaults tier pesado (YAML espelhado) | `config/politicas-orquestracao.yaml:87-90` | `niveis_modelo.pesado.modelo: "deepseek-v4-pro"` |
| Default código DeepSeek heavy | `gateways.ts:59` | `modelHeavy: "deepseek-v4-pro"`, `heavyFirst: true` |
| Papel analista na política | `config/politicas-orquestracao.yaml:16-18` | `papeis.analista.nivel_modelo_padrao: "forte"` (não é lido neste dispatch; o tier passado é `"heavy"` fixo) |
| JSON válido + T8b ok | `spec-decomposer.ts:416-450` | Retorna nós analista; trilha `ANALISTA_PLAN_APPROVED` (`434-441`) |
| JSON válido + T8b inválido | `spec-decomposer.ts:451-459` | Trilha `ANALISTA_PLAN_FALLBACK` (`reason: t8b_validation_failed`); cai em `return baseDecomp` (`474`) |
| Exceção / timeout / parse | `spec-decomposer.ts:463-471` | Trilha `ANALISTA_PLAN_FALLBACK` (`reason: exception_or_offline`) |
| Sem JSON / microbriefs vazios / parse falhou | `spec-decomposer.ts:386-462` (sem match) → `474` | Retorna `baseDecomp`; **sem** trilha (salvo exceção ou T8b reprovado acima) |

**`skipModel` nos testes:** `execution-trigger.ts:394` — `skipModel: process.env.NODE_ENV === "test" && process.env.ENABLE_ANALISTA_LLM !== "true"`. Com isso, `decomposeWithAnalistaSkill` para em `spec-decomposer.ts:339-340` e só a heurística roda.

---

### 3. Uso do resultado da T8b (`t8bCheck`)

Saída de `git grep -n "t8bCheck"`:

| Leitura | Arquivo:linha | Efeito |
|---------|---------------|--------|
| Telemetria chat | `src/app/api/chat/route.ts:940`, `:945-947` | Registra `t8bValid` / erros; **não** impede chat |
| Produção em `decomposeSpec` | `spec-decomposer.ts:295-306` | Campo `t8bCheck` no retorno |
| Ramo analista LLM | `spec-decomposer.ts:410-457` | Só decide aprovar plano LLM vs fallback |
| Testes | `tests/harness/end-to-end-harness-plan.test.ts:386-387`, `:542` | Asserções |

**`execution-trigger.ts`:** não referencia `t8bCheck`. Fluxo após decomposição: `decompResult.nodes` → `planNodeTiers` (`401`) → `splitNodesByJev` (`402-410`) → `prisma.taskNode.create` (`425-447`). Plano com `t8bCheck.valid === false` **pode** virar `TaskNode` se a heurística retornar assim (hoje `validateMacrobriefMechanical` não inclui arquivo-alvo × escopo do REQ; ver `artifact-templates.ts:298-377`).

Intake harness **bloqueia** em T8b inválido (`intake-engine.ts:303-305`); caminho de aprovação real (`approveSpecAndStart`) **não** replica esse bloqueio.

---

### 4. Diferença de payload (heurística × analista LLM × consumidor)

Campos do payload do nó heurístico (`spec-decomposer.ts:208-217` scaffold `233`; implementação `208-217`). Campos do nó analista LLM (`425-431`). Consumo principal: `node-executor.ts` (`readNodePayload` `392-427`, `readNodeMicrobrief` `381-387`).

| Campo | Heurística (linha) | Analista LLM (linha) | Quem consome (arquivo:linha) |
|-------|-------------------|----------------------|------------------------------|
| `goal` (Spec inteira) | `210` | ausente | `node-executor.ts:461`, `:729`, `:979`, `:987`, `:1453` |
| `titulo` | `211` | ausente | não lido em `readNodePayload` |
| `step` | `212` / scaffold `233` | `426` (`analista_step_N`) | não lido em `readNodePayload` |
| `nodeFiles` | `213` | ausente (usa `files`) | `node-executor.ts:415-417`, `:461` |
| `files` | ausente | `429` | **não** lido por `readNodePayload` |
| `cluster` | `214` | `427` | `node-executor.ts:408-418`, `:435`, `:1432` |
| `reqsCobertos` | `215` | ausente (usa `reqs`) | `node-executor.ts:419-421`, `:305`, `:1433`, `:1448`, `:1584` |
| `reqs` | ausente | `428` | **não** lido por `readNodePayload` |
| `microbrief` (documento completo) | `216` | ausente | `readNodeMicrobrief` → `node-executor.ts:914`, `:974-979`, `:1048-1054`, `:1296-1339`, `:1455` |
| `stack` | scaffold `233` | ausente | scaffold: não verificado em `node-executor` |
| `macrobriefId` | ausente | `430` | não verificado em `node-executor` |
| `intent` | adicionado no trigger | idem | injetado `execution-trigger.ts:437-444`; uso downstream não verificado neste inventário |
| `jevPlan` | adicionado no trigger | idem | `execution-trigger.ts:437-444`; `node-executor.ts:373`, `:1434-1435` |

**Campos de `MicrobriefAndReportDocument` usados pelo executor** (via `microbrief` no payload ou `renderMicrobriefMarkdown` `artifact-templates.ts:1114-1146`):

| Campo Microbrief | Heurística preenche (`167-197`) | Analista LLM | Consumidor |
|------------------|--------------------------------|--------------|------------|
| `documento`, `reqsCobertos`, `arquivosPermitidos` | sim | não (sem microbrief) | `node-executor.ts:384`, `:1118-1128`, `:1296` |
| `criteriosAceitePorReq` | sim (`190`) | não | `node-executor.ts:1455-1457`, `artifact-templates.ts:1138-1140` |
| `registroCumprimento` | sim (`191-196`) | não | validação relatório executor (`node-executor.ts:1297`) |
| `nivelModeloSugerido` | sim (`173`) | não | `readPlannedTier` `node-executor.ts:373` |
| `dependeDe` | sim (`174`) | não (só no JSON macrobrief analista) | `renderMicrobriefMarkdown` `artifact-templates.ts:1130-1131` |
| `idMicrobrief`, `idMacrobrief`, `idProjeto`, `interfacesConsome`, `interfacesProduz`, `statusExecucao`, `medidoPeloHarness`, `tentativaAtual` | sim | não | não verificado leitura direta em `node-executor.ts` além do template |

---

### 5. Prova com teste real (`934939fc`)

**Script:** `scripts/inventario-plano-a2.ts` (cópia `prisma/dev.db` → `%TEMP%/nc-a2-inventario-plano`; `TelemetryLogger.log` no-op).

**Spec aprovada:** `Session.canonicalSpec` — schema `prisma/schema.prisma:91`. Sessão encontrada: `934939fc-0c85-47ec-a9b9-ffd6e3778279` (`specApproved: true`, `specVersion: 1`).

**TaskNode:** `17` registros (`16` etapas de implementação + `1` scaffold), consulta `sessionId` + `specVersion: 1`.

**Dimensionamento Spec (sem colar texto):**

| Métrica | Valor |
|---------|-------|
| Caracteres da Spec | 38624 |
| REQ declarados | 43 |
| Arquivos em `arquivos_afetados` | 58 |

**Métricas do plano gravado vs reexecução `decomposeSpec` (mesma Spec + `parseSpecDocument(...).arquivosAfetados`):**

| Métrica | Plano gravado | Heurística `decomposeSpec` |
|---------|---------------|----------------------------|
| Etapas (sem scaffold) | 16 | 16 |
| REQ em mais de 1 etapa | 29 | 29 |
| Pares (REQ, arquivo no critério) com arquivo fora do `filesScope` da etapa | 186 | 186 |
| `t8bCheck.valid` | — | `true` |
| `t8bCheck.errors` (contagem) | — | `0` |
| Nós totais (`decomposeSpec`, incl. scaffold) | 17 | 17 |

**Batimento:** script reporta `numbersMatch: true` (mesmos três números entre gravado e heurística).

**Pares fora do escopo — etapa 1 (plano gravado = heurística):**

| REQ | Arquivo citado no critério | Fora do escopo da etapa 1 |
|-----|----------------------------|---------------------------|
| REQ-002 | `vitest.config.ts` | sim |

**Pares fora do escopo — etapa 3:**

| REQ | Arquivo citado no critério | Fora do escopo da etapa 3 |
|-----|----------------------------|---------------------------|
| REQ-016 | `src/app/api/cobrancas/route.ts` | sim |
| REQ-016 | `src/app/api/v1/cobrancas/route.ts` | sim |
| REQ-032 | `src/app/api/v1/links/route.ts` | sim |
| REQ-040 | `tests/cobrancas.test.ts` | sim |

Extrator: `extractFilePathsFromCriteriaText` + `pathInStageScope` (`jev-execution-checks.ts:76-92`). Atribuição de REQ por etapa: `assignReqsForGroup` (`spec-decomposer.ts:122-148`).

**Saída completa do script (reprodução):**

```bash
npx tsx scripts/inventario-plano-a2.ts
```

(Totais acima; JSON completo inclui listas `paresDetalhe` com 186 entradas.)

---

### 6. Skill `analista` — promessa × código

Fonte promessa: `skills/analista/SKILL.md` (frontmatter `1-27`, corpo `29-39`).

| Promessa (SKILL.md) | Usado em `decomposeWithAnalistaSkill`? | Observação (arquivo:linha) |
|---------------------|----------------------------------------|----------------------------|
| `papel: analista` | indireto | Skill carregada por nome `analista` (`spec-decomposer.ts:344`) |
| `nivel_modelo: forte` | não | Dispatch usa `tier: "heavy"` fixo (`370-376`), não lê `nivelModelo` da skill |
| `ferramentas: read_file, list_files, grep, finish` | não | Nenhum loop de ferramentas; uma chamada chat completion |
| `permissoes.escrever: nunca` | alinhado | Código não escreve arquivos neste caminho |
| `passos_max: 20` | não | Sem agente multi-passo |
| `entrada: spec_aprovada, macrobrief` | parcial | Prompt inclui só Spec (`367`); **macrobrief não** é passado |
| `saida: microbriefs_plano` | parcial | Espera JSON `microbriefs` no texto (`386-392`); não gera documento Microbrief completo |
| Corpo: conferência T8a Spec × Macrobrief | não | Não implementado nesta função |
| Corpo: T8b (cobertura REQ, arquivo único, DAG, contratos) | parcial | `validateMacrobriefMechanical` (`410-414`); sem checagem arquivo-alvo × escopo do REQ |
| `checagens:` frontmatter (4 itens) | parcial | Só o subconjunto coberto por `validateMacrobriefMechanical` (`artifact-templates.ts:298-377`) |
| Texto do corpo no prompt | sim | `buildSkillSystemPrompt` → system message (`345`, `skill-runtime.ts:350-378`) |

---

### `npx tsc --noEmit`

```
(saída vazia — exit 0)
```

### `npx vitest run` (totais)

```
 Test Files  125 passed (125)
      Tests  832 passed (832)
   Start at  16:57:28
   Duration  276.41s
```

### Desvios

Nenhum.

### O que não foi feito

- A2.1 em diante (código de planejamento real pela analista).
- Alteração de `src/`, `tests/`, skills, config, prisma, referência ou diário (fora do escopo A2.0).
- Proposta de solução (inventário só fatos, R3).

---
