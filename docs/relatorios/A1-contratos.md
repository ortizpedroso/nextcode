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

