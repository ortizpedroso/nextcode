# Relatório da Tarefa A1 — Macrobrief com Contratos de Verdade

## Registro de Execução por Passo

---

### Passo A1.0 — Um documento só: tirar a reserva antiga da política (§3.1 item 4)

#### 1. O que mudou e arquivos afetados
- `src/core/config/orchestration-policy.ts:365-375`: removido `fallbackPath` apontando para `docs/rascunhos/politicas-orquestracao.yaml`. Quando `config/politicas-orquestracao.yaml` não existir em `rootDir`, a função registra o motivo via `console.info` e retorna `DEFAULT_ORCHESTRATION_POLICY` do código.
- `docs/rascunhos/politicas-orquestracao.yaml`: arquivo removido do repositório (diretório `docs/rascunhos/` limpo).
- `tests/harness/orchestration-policy-and-skills.test.ts:3-12,46-67`: adicionado teste `A1.0: sem config/politicas-orquestracao.yaml, usa o padrão do código (DEFAULT_ORCHESTRATION_POLICY) e não lê docs/rascunhos/`, garantindo que diretórios sem `config/` usam os padrões do código e ignoram qualquer conteúdo residual em `docs/rascunhos/`.

#### 2. Saída real dos comandos

##### `npx tsc --noEmit`
```
(saída vazia, código de retorno 0)
```

##### `npx vitest run tests/harness/orchestration-policy-and-skills.test.ts`
```
 RUN  v2.1.9 C:/projetos/nextcode

stdout | tests/harness/orchestration-policy-and-skills.test.ts > Políticas de Orquestração (config/politicas-orquestracao.yaml) e Runtime de Skills > A1.0: sem config/politicas-orquestracao.yaml, usa o padrão do código (DEFAULT_ORCHESTRATION_POLICY) e não lê docs/rascunhos/
[orchestration-policy] config/politicas-orquestracao.yaml não encontrado em "C:\Users\ortiz\AppData\Local\Temp\nc-policy-empty-TlrNgB". Usando DEFAULT_ORCHESTRATION_POLICY do código.

 ✓ tests/harness/orchestration-policy-and-skills.test.ts (13 tests) 124ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  05:53:18
   Duration  1.59s (transform 118ms, setup 35ms, collect 105ms, tests 124ms, environment 0ms, prepare 180ms)
```

##### `npx vitest run` (suíte completa)
```
 Test Files  162 passed (162)
      Tests  1046 passed (1046)
   Start at  05:53:25
   Duration  213.15s (transform 6.37s, setup 1.98s, collect 28.84s, tests 134.78s, environment 32ms, prepare 14.98s)
```

#### 3. Desvios
- Nenhum.

#### 4. O que não foi feito
- Nada do passo A1.0 ficou pendente. Próximo passo é A1.1.

---

### Passo A1.1 — Template do contrato e conferência mecânica (sem LLM)

#### 1. O que mudou e arquivos afetados
- `src/core/orchestrator/project-contract.ts` (CRIADO): implementação das interfaces do `ContratoProjeto` (`entidades`, `enums`, `funcoes`, `rotas`), `validateContract`, `renderContractTs` e `renderConformance`.
  - `validateContract`: validação mecânica sem LLM (dono inexistente, arquivo fora da etapa dona, `usadoPor` sem dependência da etapa dona, nomes repetidos, tipos desconhecidos com TypeScript AST, arquivo de rota fora de `route.ts`).
  - `renderContractTs`: geração de arquivo TS canônico em `src/contracts/index.ts` contendo apenas declarações de tipos (interfaces, types de enums, types de assinaturas de função e tipos de rotas).
  - `renderConformance`: geração do arquivo `src/contracts/conformidade/<etapaId>.ts` que importa os símbolos reais do projeto e os tipa contra as definições do contrato para checagem estrita de compilação pelo `tsc`.
- `src/core/templates/artifact-templates.ts:56-65`: reexportação dos tipos do contrato (`ContratoProjeto`, `ContratoEntidade`, `ContratoEnum`, etc.) sem alterar contratos existentes.
- `tests/orchestrator/a1-contrato.test.ts` (CRIADO): suíte de testes com 9 testes cobrindo:
  - (a) contrato válido devolve 0 erros;
  - (b) erros individuais de validação mecânica (dono inexistente, arquivo fora do dono, consumidor sem dependência, nome duplicado, tipo desconhecido, rota com nome de arquivo inválido);
  - (c) `renderContractTs` compila sozinho em memória usando `ts.createProgram`;
  - (d) controle do Gateway em `os.tmpdir()`: reprodução mecânica no `tsc` com o código defeituoso real (`sessao.papel === "admin"` e chamada sem argumento obrigatório `criarSessao(usuario.id)`), confirmando reprovação estrita pelo compilador, e aprovação limpa quando corrigido (`sessao.papel === "ADMIN"` e `criarSessao(usuario.id, "ADMIN")`).

#### 2. Saída real dos comandos

##### `npx tsc --noEmit`
```
(saída vazia, código de retorno 0)
```

##### `npx vitest run tests/orchestrator/a1-contrato.test.ts`
```
 RUN  v2.1.9 C:/projetos/nextcode

 ✓ tests/orchestrator/a1-contrato.test.ts (9 tests) 6131ms
   ✓ A1.1 — Contrato do Projeto e Conferência Mecânica > (c) renderContractTs compila sozinho em memória usando createProgram 2042ms
   ✓ A1.1 — Contrato do Projeto e Conferência Mecânica > (d) controle do Gateway: tsc reprova o defeito real e passa quando corrigido 4079ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  06:06:50
   Duration  6.80s (transform 49ms, setup 19ms, collect 310ms, tests 6.13s, environment 0ms, prepare 74ms)
```

##### `npx vitest run` (suíte completa)
```
 Test Files  163 passed (163)
      Tests  1055 passed (1055)
   Start at  06:07:24
   Duration  245.23s (transform 7.52s, setup 2.21s, collect 34.23s, tests 156.19s, environment 35ms, prepare 16.42s)
```

#### 3. Desvios
- Nenhum.

#### 4. O que não foi feito
- Nada do passo A1.1 ficou pendente. Próximo passo é A1.2.

---

### Passo A1.2 — O analista escreve o contrato do Macrobrief

#### 1. O que mudou e arquivos afetados
- `skills/analista/SKILL.md:53-95`: adicionada a seção "Regras de Contrato do Projeto (obrigatório)" e o exemplo do JSON contendo o bloco `"contrato"` com entidades, enums, funções (assinatura TS completa) e rotas (arquivo terminando em `route.ts`).
- `src/core/orchestrator/project-contract.ts`: adicionada a função `renderContractSliceTs(contrato, etapaId)` que devolve as fatias `interfacesProduz` e `interfacesConsome` como código TS tipado.
- `src/core/skills/spec-decomposer.ts`:
  - `parseAnalystPlan`: agora extrai e normaliza o bloco `contrato` junto aos `microbriefs`.
  - `decomposeWithAnalistaSkill`: valida o contrato contra as etapas usando `validateContract` no loop do analista. Caso haja erros no contrato ou contrato ausente, os erros retornam para o analista nas rodadas subsequentes (`ANALISTA_MAX_RODADAS = 3`).
  - Se após as 3 rodadas o plano/contrato não for válido, registra `PLANO_REPROVADO` com `dono: "analista"`. Em modo de teste com `skipModel: true`, continua funcionando e emite o evento `CONTRATO_AUSENTE`.
  - `buildDecompositionFromAnalystPlan`: aceita `contrato?: ContratoProjeto`, preenche `macrobrief.contratosTypescript` com `renderContractTs` e popula `interfacesProduz` e `interfacesConsome` dos Microbriefs com as fatias TypeScript de cada etapa.
  - O evento `ANALISTA_PLAN_APPROVED` na telemetria passa a registrar as contagens de `entidades`, `enums`, `funcoes` e `rotas`.
- `tests/orchestrator/analista-plan.test.ts`: adicionados 4 novos testes cobrindo:
  - Plano com contrato válido aprovado, com `ANALISTA_PLAN_APPROVED` contendo as contagens e Microbriefs recebendo as fatias de contrato produzidas e consumidas;
  - Contrato com erro retornando erro na 2ª rodada para correção;
  - 3 rodadas com contrato inválido culminando em `PLANO_REPROVADO` com dono `analista`;
  - `skipModel` em testes emitindo `CONTRATO_AUSENTE` na trilha de telemetria.

#### 2. Saída real dos comandos

##### `npx tsc --noEmit`
```
(saída vazia, código de retorno 0)
```

##### `npx vitest run tests/orchestrator/analista-plan.test.ts`
```
 RUN  v2.1.9 C:/projetos/nextcode

 ✓ tests/orchestrator/analista-plan.test.ts (14 tests) 62ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  06:21:37
   Duration  2.04s (transform 331ms, setup 27ms, collect 893ms, tests 62ms, environment 0ms, prepare 125ms)
```

##### `npx vitest run` (suíte completa)
```
 Test Files  163 passed (163)
      Tests  1059 passed (1059)
   Start at  06:22:08
   Duration  209.79s (transform 5.61s, setup 1.62s, collect 29.88s, tests 138.78s, environment 26ms, prepare 12.30s)
```

#### 3. Desvios
- Nenhum.

#### 4. O que não foi feito
- Nada do passo A1.2 ficou pendente. Próximo passo é A1.3.

---

### Passo A1.3 — Gravar o contrato, travar para o executor e conferir na promoção

#### 1. O que mudou (arquivo:linha) e hash de partida
- **Hash de partida:** `aca39bd`
- **`src/core/skills/skill-runtime.ts:312-314`**:
  - Adicionado `src/contracts` e `src/contracts/**` à lista de caminhos protegidos do executor com a mensagem de violação `[SKILL PROTECTED PATH] Escrita bloqueada em caminho protegido: "${targetFile}"`.
- **`src/core/orchestrator/execution-trigger.ts:3, 467-468, 476-522`**:
  - Quando o plano é aprovado, grava `src/contracts/index.ts` no projeto antes de disparar o grafo.
  - Confere e garante que o `tsconfig.json` do projeto tenha o alias `@/*` apontando para `./src/*` (adiciona caso falte).
  - Emite telemetria `CONTRATO_GRAVADO` contendo `projectRoot`, `arquivo: "src/contracts/index.ts"`, `hash` SHA-256 do conteúdo e contagens de entidades, enums, funções e rotas.
  - Propaga `contrato` e `etapaId` para o payload da `TaskNode`.
- **`src/core/orchestrator/node-executor.ts:60, 416-424, 446-447, 1555-1576, 1888-1889`**:
  - Exportada função `readNodeContract(payload)` e adicionados campos `etapaId` e `contrato` ao tipo de retorno de `readNodePayload`.
  - Antes de chamar o porteiro com `promoteWithEmpiricalGate(..., { checkOnly: true })`, gera em quarentena o arquivo de conformidade `src/contracts/conformidade/<etapaId>.ts` usando `renderConformance(contrato, etapaId)`.
  - Adiciona `src/contracts/conformidade/<etapaId>.ts` ao `effectiveScope` passado para o porteiro empírico. Se o `tsc` falhar devido à não-conformidade com a assinatura do contrato, a etapa reprova antes de tocar o projeto e sem gastar o avaliador.
  - Na promoção real (`verdict === "APPROVED"`), o arquivo de conformidade é promovido junto (`effectiveScope`), ficando permanentemente no projeto para resguardar as etapas subsequentes.
- **`tests/orchestrator/a1-contrato-travado.test.ts`**:
  - Teste 1: Executor tenta escrever em `src/contracts/index.ts`, `src/contracts/conformidade/etapa_1.ts` e `src/contracts/outro.ts` via `write_file`/`edit_file` e recebe negação `[SKILL PROTECTED PATH]`.
  - Teste 2: Etapa implementa função com assinatura divergente do contrato (`criarSessao(userId)` sem o papel) e toma reprovação mecânica do porteiro pelo `tsc` do arquivo de conformidade, com rollback dos arquivos.
  - Teste 3: Etapa implementa a assinatura canônica e passa pelo porteiro `checkOnly: true` e pela promoção real, promovendo tanto a implementação quanto o arquivo de conformidade em `src/contracts/conformidade/etapa_1.ts`.

#### 2. Saída real dos comandos

##### `npx tsc --noEmit`
```
FullName                           LastWriteTime
--------                           -------------
C:\projetos\nextcode\prisma\dev.db 22/10/2026 18:54:59

(saída vazia, código de retorno 0)
```

##### `npx vitest run tests/orchestrator/a1-contrato-travado.test.ts`
```
 RUN  v2.1.9 C:/projetos/nextcode

 ✓ tests/orchestrator/a1-contrato-travado.test.ts (3 tests) 2512ms
   ✓ A1.3 — Contrato travado, protegido e conferido mecanicamente pelo porteiro > 2. Uma etapa que implementa função com assinatura diferente do contrato toma reprovação mecânica do porteiro pelo tsc do arquivo de conformidade 1293ms
   ✓ A1.3 — Contrato travado, protegido e conferido mecanicamente pelo porteiro > 3. Uma etapa válida passa pelo porteiro e tem o arquivo de conformidade promovido 1215ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  06:41:08
   Duration  3.33s (transform 168ms, setup 22ms, collect 536ms, tests 2.51s, environment 0ms, prepare 73ms)

FullName                           LastWriteTime
--------                           -------------
C:\projetos\nextcode\prisma\dev.db 22/10/2026 18:54:59
```

##### `npx vitest run` (suíte completa)
```
 Test Files  164 passed (164)
      Tests  1062 passed (1062)
   Start at  06:41:34
   Duration  203.53s (transform 4.58s, setup 1.60s, collect 34.21s, tests 128.68s, environment 26ms, prepare 12.09s)

FullName                           LastWriteTime
--------                           -------------
C:\projetos\nextcode\prisma\dev.db 22/10/2026 18:54:59
```

#### 3. Desvios
- Nenhum.

#### 4. O que não foi feito
- Nada do passo A1.3 ficou pendente. Próximo passo é A1.4.

---

### Passo A1.4 — Testador, executor e avaliador usam o contrato

#### 1. O que mudou (arquivo:linha) e hash de partida
- **Hash de partida:** `9eeff21`
- **`skills/testador/SKILL.md:32`**:
  - Documentada a regra inegociável: "8. Contratos do Macrobrief (src/contracts/index.ts): qualquer divergência com o contrato do Macrobrief (src/contracts/index.ts) é defeito crítico — reprove a etapa. Escreva testes que cobram e validam estritamente as interfaces e assinaturas declaradas no contrato."
- **`skills/avaliador/SKILL.md:63, 67`**:
  - Documentada a regra inegociável na classificação de severidade: "qualquer divergência com o contrato do Macrobrief (src/contracts/index.ts) é defeito crítico — reprove a etapa (função com parâmetro a mais/menos, tipo trocado, retorno diferente ou rota divergente)."
- **`src/core/governance/acceptance-tests.ts:46-47, 65-80`**:
  - Em `AcceptanceInput`, adicionados `contratosProduz?: string` e `contratosConsome?: string[]`.
  - Em `buildTesterPrompt`: inclui a seção `[CONTRATOS DO PROJETO (src/contracts/index.ts)]` detalhando as interfaces que a etapa produz e consome; se faltar contrato, emite aviso explícito no prompt do testador.
- **`src/core/governance/dual-lens-auditor.ts:21, 131-133, 618-631, 642`**:
  - Em `ValidateType2Options`, adicionados `contrato?: ContratoProjeto | null`, `contratosProduz?: string` e `contratosConsome?: string[]`.
  - Em `runBlindLens`: inclui a seção `[CONTRATOS DO PROJETO (src/contracts/index.ts)]` no conteúdo enviado ao avaliador e adiciona no prompt de sistema a regra inegociável de que qualquer divergência de contrato (função com parâmetro a mais/menos, tipo trocado) é obrigatoriamente um defeito `critico` e reprova a etapa (`implemented: false`).
- **`src/core/orchestrator/node-executor.ts:1132-1147, 1229-1230, 1763-1765`**:
  - Passa a fatia do contrato (`interfacesProduz` e `interfacesConsome`) nas mensagens do executor (`dispatchMessages`), alimentando tanto execução em chamada única quanto em laço de ferramentas (`useToolLoop`).
  - Passa a fatia do contrato para `generateAcceptanceTests` no autoteste E5.
  - Passa a fatia do contrato e o objeto de contrato para `DualLensAuditor.validateType2` na lente cega do avaliador.

#### 2. Saída real dos comandos

##### `npx tsc --noEmit`
```
FullName                           LastWriteTime
--------                           -------------
C:\projetos\nextcode\prisma\dev.db 22/10/2026 18:54:59

(saída vazia, código de retorno 0)
```

##### `npx vitest run tests/governance/e5-testes-de-aceite.test.ts`
```
 RUN  v2.1.9 C:/projetos/nextcode

 ✓ tests/governance/e5-testes-de-aceite.test.ts (5 tests) 9ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  06:51:23
   Duration  493ms (transform 132ms, setup 21ms, collect 230ms, tests 9ms, environment 0ms, prepare 72ms)

FullName                           LastWriteTime
--------                           -------------
C:\projetos\nextcode\prisma\dev.db 22/10/2026 18:54:59
```

##### `npx vitest run` (suíte completa)
```
 Test Files  164 passed (164)
      Tests  1062 passed (1062)
   Start at  06:51:44
   Duration  206.61s (transform 6.42s, setup 1.63s, collect 36.01s, tests 129.64s, environment 26ms, prepare 12.23s)

FullName                           LastWriteTime
--------                           -------------
C:\projetos\nextcode\prisma\dev.db 22/10/2026 18:54:59
```

#### 3. Desvios
- Nenhum.

#### 4. O que não foi feito
- Nada do passo A1.4 ficou pendente. Próximo passo é A1.5.




