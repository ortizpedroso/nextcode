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
