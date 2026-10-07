# Catálogo de Templates de Artefatos do NextCode (`TEMPLATES.md`)

Este documento define os **5 templates canônicos** trocados entre os papéis do NextCode durante o ciclo de vida de um projeto, todos com **YAML frontmatter estruturado + corpo Markdown**, acompanhados de:
1. Um **exemplo completo preenchido** para o **Projeto P1 (API de Tarefas)** envolvendo exatamente os três arquivos:
   - `src/lib/tarefas-store.ts`
   - `src/app/api/tarefas/route.ts`
   - `src/app/api/tarefas/[id]/route.ts`
2. A lista exata de **Conferências Mecânicas (Código Puro / Sem LLM — Princípio P12)** que o harness executa antes de aceitar o documento ou passar à fase seguinte.

---

## 1. Especificação do Projeto (`Spec` com `REQ-001…`)

> **Ponto de partida no código atual:** Evolui a estrutura hoje definida em [`src/core/intake/spec-format.ts`](../../src/core/intake/spec-format.ts) (`SpecFrontmatter` + seções numeradas `## 1. O que o sistema faz`, `## 2. Quem usa`, `## 3. Telas e fluxos principais`, `## 4. Dados que o sistema guarda`, `## 5. Integrações externas`, `## 6. O que fica de fora da primeira versão`, `## 7. Dúvidas em aberto`), acrescentando a **tabela e lista rastreável de requisitos (`REQ-001…`)** exigida pela Arquitetura (§3.1, §5.2 e Princípio P12).

### 1.1. Exemplo Preenchido (Projeto P1 — API de Tarefas)

```markdown
---
documento: spec
projeto: "API REST de Tarefas (P1)"
versao: 1
status: aprovada
criado_em: "2026-10-06T12:00:00.000Z"
atualizado_em: "2026-10-06T12:15:00.000Z"
aprovado_em: "2026-10-06T12:20:00.000Z"
aprovado_por: "Fundador (Aprovação Explícita T2)"
tipo_interface: "nenhuma_somente_api"
requisitos_ids:
  - REQ-001
  - REQ-002
  - REQ-003
  - REQ-004
  - REQ-005
---

# Especificação do Projeto: API REST de Tarefas (P1)

## 1. O que o sistema faz
Fornece uma API REST em Next.js (App Router) para gerenciamento de uma lista de tarefas em memória (CRUD completo: listar, criar, atualizar parcialmente e remover tarefas por identificador único).

## 2. Quem usa
Consumidores HTTP internos, testes automatizados de integração e futuro frontend do painel de tarefas.

## 3. Telas e fluxos principais (Rotas e Comportamento)
- `GET /api/tarefas`: retorna a lista completa de tarefas cadastradas em ordem de criação.
- `POST /api/tarefas`: recebe `{ titulo: string }`, valida que não está vazio, cria a tarefa com `concluida: false` e retorna `201 Created`.
- `PATCH /api/tarefas/[id]`: recebe `{ titulo?: string, concluida?: boolean }`, atualiza a tarefa correspondente ou retorna `404 Not Found`.
- `DELETE /api/tarefas/[id]`: remove a tarefa correspondente (`204 No Content`) ou retorna `404 Not Found`.

## 4. Dados que o sistema guarda
Armazenamento em memória no módulo `src/lib/tarefas-store.ts` contendo objetos `Tarefa`:
- `id`: `string` (UUID ou identificador sequencial único)
- `titulo`: `string` (obrigatório, sem espaços vazios nas pontas)
- `concluida`: `boolean` (padrão `false`)
- `criadaEm`: `string` (ISO 8601)

## 5. Integrações externas
Nenhuma integração externa nesta versão.

## 6. O que fica de fora da primeira versão
- Persistência em banco SQLite/PostgreSQL;
- Autenticação de usuários;
- Interface visual (páginas React).

## 7. Dúvidas em aberto
Nenhuma dúvida em aberto.

## 8. Requisitos Rastreáveis (`REQ-001` a `REQ-005`)

| ID | Título Curto | Descrição Verificável e Critério de Aceite |
| :--- | :--- | :--- |
| `REQ-001` | Store em memória de tarefas | O módulo `src/lib/tarefas-store.ts` deve exportar o tipo `Tarefa` e as funções puras/síncronas `listarTarefas()`, `criarTarefa(input)`, `atualizarTarefa(id, input)` e `removerTarefa(id)` operando sobre um store em memória isolado. |
| `REQ-002` | Listagem (`GET /api/tarefas`) | `GET /api/tarefas` em `src/app/api/tarefas/route.ts` deve retornar status `200` e um array JSON com todas as tarefas atuais do store. |
| `REQ-003` | Criação com validação (`POST /api/tarefas`) | `POST /api/tarefas` em `src/app/api/tarefas/route.ts` deve validar que `titulo` é string não vazia após `.trim()`. Se inválido ou JSON malformado, retornar `400` com `{ erro: string }`; se válido, retornar `201` com o objeto `Tarefa` criado. |
| `REQ-004` | Atualização parcial (`PATCH /api/tarefas/[id]`) | `PATCH /api/tarefas/[id]` em `src/app/api/tarefas/[id]/route.ts` deve permitir atualizar `titulo` (validando que não é string vazia se enviado) e/ou `concluida` (`boolean`). Se o `id` não existir, retornar `404` com `{ erro: string }`; se existir, retornar `200` com a `Tarefa` atualizada. |
| `REQ-005` | Remoção (`DELETE /api/tarefas/[id]`) | `DELETE /api/tarefas/[id]` em `src/app/api/tarefas/[id]/route.ts` deve remover a tarefa pelo `id` e retornar `204` (sem corpo) quando existir, ou `404` com `{ erro: string }` quando não existir. |
```

### 1.2. Conferências Mecânicas da `Spec` (Aplicadas pelo Harness)
1. **Frontmatter válido:** `documento === "spec"`, `versao` inteiro `>= 1`, `status` em `["rascunho", "aguardando_aprovacao", "aprovada"]`.
2. **Trava de Aprovação Humana (T2):** A transição para a Fase 2 (Planejamento) só é permitida se `status === "aprovada"`, `aprovado_em` for timestamp ISO 8601 válido e a seção `## 7. Dúvidas em aberto` não contiver itens pendentes.
3. **Unicidade e Formato de `REQ-xxx`:** Todos os IDs em `requisitos_ids` seguem a regex `^REQ-\d{3}$`, são únicos, sequenciais sem buracos e aparecem exatamente uma vez na tabela da seção `## 8. Requisitos Rastreáveis`.
4. **Sem `REQ` vazio:** Toda linha da tabela `## 8` possui descrição e critério de aceite não vazios (`length >= 20` caracteres).

---

## 2. Macrobrief do Projeto (`Macrobrief`)

Documento gerado pelo **Analista** na Fase 2 que traduz a `Spec` aprovada na arquitetura da mudança: contratos compartilhados entre arquivos, divisão em Microbriefs, atribuição de clusters e grafo acíclico de dependências (DAG).

### 2.1. Exemplo Preenchido (Projeto P1 — API de Tarefas)

```markdown
---
documento: macrobrief
id_macrobrief: MACRO-P1-001
id_projeto: proj-p1-tarefas
spec_versao: 1
requisitos_totais:
  - REQ-001
  - REQ-002
  - REQ-003
  - REQ-004
  - REQ-005
clusters_ativos:
  - core
  - backend
microbriefs:
  - id: MB-001
    cluster: core
    depende_de: []
    arquivos:
      - src/lib/tarefas-store.ts
    reqs:
      - REQ-001
  - id: MB-002
    cluster: backend
    depende_de:
      - MB-001
    arquivos:
      - src/app/api/tarefas/route.ts
    reqs:
      - REQ-002
      - REQ-003
  - id: MB-003
    cluster: backend
    depende_de:
      - MB-001
    arquivos:
      - src/app/api/tarefas/[id]/route.ts
    reqs:
      - REQ-004
      - REQ-005
---

# Macrobrief: API REST de Tarefas (P1)

## 1. Visão Arquitetural e Fluxo de Execução
A implementação divide-se em 2 ondas de execução:
- **Onda 1 (`MB-001`, cluster `core`):** Cria o store em memória e exporta os tipos e funções de domínio em `src/lib/tarefas-store.ts`.
- **Onda 2 (`MB-002` e `MB-003` em paralelo, cluster `backend`):** Cria os Route Handlers da coleção (`/api/tarefas`) e do recurso individual (`/api/tarefas/[id]`), ambos consumindo exclusivamente o contrato exportado por `MB-001`.

## 2. Contratos Globais Compartilhados (`Contratos`)

```typescript
// Contrato exportado por src/lib/tarefas-store.ts (MB-001)
export interface Tarefa {
  id: string;
  titulo: string;
  concluida: boolean;
  criadaEm: string; // ISO 8601
}

export interface CriarTarefaInput {
  titulo: string;
}

export interface AtualizarTarefaInput {
  titulo?: string;
  concluida?: boolean;
}

export interface ErroApi {
  erro: string;
}

export function listarTarefas(): Tarefa[];
export function criarTarefa(input: CriarTarefaInput): Tarefa;
export function atualizarTarefa(id: string, input: AtualizarTarefaInput): Tarefa | null;
export function removerTarefa(id: string): boolean;
export function limparTarefasParaTeste(): void;
```

## 3. Matriz de Rastreabilidade (`REQ` → `Microbrief` → `Arquivo`)

| REQ ID | Microbrief | Cluster | Arquivo Responsável |
| :--- | :--- | :--- | :--- |
| `REQ-001` | `MB-001` | `core` | `src/lib/tarefas-store.ts` |
| `REQ-002` | `MB-002` | `backend` | `src/app/api/tarefas/route.ts` |
| `REQ-003` | `MB-002` | `backend` | `src/app/api/tarefas/route.ts` |
| `REQ-004` | `MB-003` | `backend` | `src/app/api/tarefas/[id]/route.ts` |
| `REQ-005` | `MB-003` | `backend` | `src/app/api/tarefas/[id]/route.ts` |
```

### 2.2. Conferências Mecânicas do `Macrobrief` (Aplicadas pelo Harness)
1. **Cobertura Total de `REQ` (100% da Spec):** A união dos arrays `reqs` de todos os `microbriefs` listados no Macrobrief é **exatamente igual** ao conjunto `requisitos_ids` da `Spec` aprovada (nenhum `REQ` esquecido, nenhum `REQ` inventado).
2. **Partição Estrita de Arquivos (Propriedade Exclusiva — T3):** Cada caminho de arquivo listado em `microbriefs[*].arquivos` aparece em **exatamente um** Microbrief na mesma onda (ou em todo o plano quando possível). Dois Executores paralelos **nunca** recebem permissão de escrita sobre o mesmo arquivo.
3. **Grafo Acíclico (DAG sem ciclo):** O algoritmo de ordenação topológica (Kahn / DFS) valida que `microbriefs[*].depende_de` só referencia IDs existentes e **não possui ciclos** (`A -> B -> A`).
4. **Limites de Granularidade:** Cada Microbrief referencia no máximo 3 arquivos de implementação + seus testes diretos.

---

## 3. Microbrief Enxuto (`Microbrief`)

<!-- Origem: https://github.com/obra/superpowers | Arquivo: skills/writing-plans/SKILL.md & skills/subagent-driven-development/implementer-prompt.md | Commit: 8ca22dba9a94f28898bbce59f2537ff4d87c747d | Licença: MIT -->

Baseado no conceito de *Task Brief autocontido* do Superpowers e na §5.5 da Arquitetura do NextCode: o Executor **não lê a Spec inteira nem o histórico de chat**; ele recebe apenas seu Microbrief enxuto com arquivos exatos, interfaces que consome e produz, `REQ` cobertos, cluster, critérios de aceite e dependências.

> **Propriedade de Design Crítica (§5.7):** O template do **Microbrief** e o template do **Relatório do Executor** possuem a **mesma estrutura de frontmatter e seções**, onde os campos de resultado começam como `PENDENTE` no Microbrief e são preenchidos ao final da execução.

### 3.1. Exemplos Preenchidos dos 3 Microbriefs do Projeto P1 (`MB-001`, `MB-002`, `MB-003`)

#### Exemplo A — `MB-001` (`src/lib/tarefas-store.ts`)

```markdown
---
documento: microbrief
id_microbrief: MB-001
id_macrobrief: MACRO-P1-001
id_projeto: proj-p1-tarefas
cluster: core
nivel_modelo_sugerido: rapido
depende_de: []
reqs_cobertos:
  - REQ-001
arquivos_permitidos:
  criar:
    - src/lib/tarefas-store.ts
  modificar: []
  ler_contratos: []
# --- BLOCO DE EXECUÇÃO (Preenchido apenas na saída como Relatório do Executor) ---
status_execucao: PENDENTE
tentativa_atual: 0
medido_pelo_harness: # preenchido pelo harness, nunca pelo modelo
  compilou: null
  testes: null
  arquivos_alterados: []
---

# Microbrief `MB-001`: Store em Memória de Tarefas (`src/lib/tarefas-store.ts`)

## 1. Arquivos Exatos do Escopo
- **Criar:** `src/lib/tarefas-store.ts`
- **Modificar:** Nenhum.

## 2. Interfaces que Consome e Produz
- **Consome:** Nenhuma dependência externa (apenas `crypto.randomUUID()` nativo do Node.js).
- **Produz (deve exportar exatamente estas assinaturas):**
  ```typescript
  export interface Tarefa {
    id: string;
    titulo: string;
    concluida: boolean;
    criadaEm: string;
  }
  export interface CriarTarefaInput {
    titulo: string;
  }
  export interface AtualizarTarefaInput {
    titulo?: string;
    concluida?: boolean;
  }
  export interface ErroApi {
    erro: string;
  }
  export function listarTarefas(): Tarefa[];
  export function criarTarefa(input: CriarTarefaInput): Tarefa;
  export function atualizarTarefa(id: string, input: AtualizarTarefaInput): Tarefa | null;
  export function removerTarefa(id: string): boolean;
  export function limparTarefasParaTeste(): void;
  ```

## 3. Requisitos Cobertos e Critérios de Aceite
- **`REQ-001` — Store em memória de tarefas:**
  - [ ] `listarTarefas()` retorna cópia rasa (`[...tarefas]`) das tarefas atuais.
  - [ ] `criarTarefa({ titulo })` aplica `.trim()` no título, gera `id` único via `crypto.randomUUID()`, define `concluida: false` e `criadaEm: new Date().toISOString()`, insere no array interno e retorna a `Tarefa`.
  - [ ] `atualizarTarefa(id, input)` localiza a tarefa pelo `id`; se não existir, retorna `null`. Se existir, atualiza `titulo` (com `.trim()`, se fornecido) e/ou `concluida` (se booleano fornecido) e retorna a `Tarefa` atualizada.
  - [ ] `removerTarefa(id)` remove a tarefa com o `id` informado e retorna `true` se removeu ou `false` se não encontrou.

## 4. Registro de Cumprimento por Requisito (Para o Relatório do Executor)
| REQ ID | Status Declarado | Arquivo:Linha | Como foi implementado |
| :--- | :--- | :--- | :--- |
| `REQ-001` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
```

#### Exemplo B — `MB-002` (`src/app/api/tarefas/route.ts`)

```markdown
---
documento: microbrief
id_microbrief: MB-002
id_macrobrief: MACRO-P1-001
id_projeto: proj-p1-tarefas
cluster: backend
nivel_modelo_sugerido: rapido
depende_de:
  - MB-001
reqs_cobertos:
  - REQ-002
  - REQ-003
arquivos_permitidos:
  criar:
    - src/app/api/tarefas/route.ts
  modificar: []
  ler_contratos:
    - src/lib/tarefas-store.ts
# --- BLOCO DE EXECUÇÃO (Preenchido apenas na saída como Relatório do Executor) ---
status_execucao: PENDENTE
tentativa_atual: 0
medido_pelo_harness: # preenchido pelo harness, nunca pelo modelo
  compilou: null
  testes: null
  arquivos_alterados: []
---

# Microbrief `MB-002`: Rotas de Coleção `GET` e `POST` (`src/app/api/tarefas/route.ts`)

## 1. Arquivos Exatos do Escopo
- **Criar:** `src/app/api/tarefas/route.ts`
- **Ler (Contrato):** `src/lib/tarefas-store.ts`

## 2. Interfaces que Consome e Produz
- **Consome de `src/lib/tarefas-store.ts`:** `listarTarefas`, `criarTarefa`, `Tarefa`, `ErroApi`.
- **Produz (Next.js App Router Handlers):**
  - `export async function GET(): Promise<NextResponse<Tarefa[]>>`
  - `export async function POST(request: NextRequest): Promise<NextResponse<Tarefa | ErroApi>>`

## 3. Requisitos Cobertos e Critérios de Aceite
- **`REQ-002` — Listagem (`GET /api/tarefas`):**
  - [ ] Retorna status HTTP `200` com o array JSON retornado por `listarTarefas()`.
- **`REQ-003` — Criação com validação (`POST /api/tarefas`):**
  - [ ] Captura erro de JSON inválido no `await request.json()` retornando HTTP `400` com `{ erro: "Corpo JSON inválido" }`.
  - [ ] Verifica se `typeof body?.titulo === "string"` e `body.titulo.trim().length > 0`. Caso contrário, retorna HTTP `400` com `{ erro: "O campo titulo é obrigatório" }`.
  - [ ] Cria a tarefa via `criarTarefa({ titulo: body.titulo.trim() })` e retorna HTTP `201` com o objeto `Tarefa`.

## 4. Registro de Cumprimento por Requisito (Para o Relatório do Executor)
| REQ ID | Status Declarado | Arquivo:Linha | Como foi implementado |
| :--- | :--- | :--- | :--- |
| `REQ-002` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| `REQ-003` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
```

#### Exemplo C — `MB-003` (`src/app/api/tarefas/[id]/route.ts`)

```markdown
---
documento: microbrief
id_microbrief: MB-003
id_macrobrief: MACRO-P1-001
id_projeto: proj-p1-tarefas
cluster: backend
nivel_modelo_sugerido: rapido
depende_de:
  - MB-001
reqs_cobertos:
  - REQ-004
  - REQ-005
arquivos_permitidos:
  criar:
    - src/app/api/tarefas/[id]/route.ts
  modificar: []
  ler_contratos:
    - src/lib/tarefas-store.ts
# --- BLOCO DE EXECUÇÃO (Preenchido apenas na saída como Relatório do Executor) ---
status_execucao: PENDENTE
tentativa_atual: 0
medido_pelo_harness: # preenchido pelo harness, nunca pelo modelo
  compilou: null
  testes: null
  arquivos_alterados: []
---

# Microbrief `MB-003`: Rotas de Recurso `PATCH` e `DELETE` (`src/app/api/tarefas/[id]/route.ts`)

## 1. Arquivos Exatos do Escopo
- **Criar:** `src/app/api/tarefas/[id]/route.ts`
- **Ler (Contrato):** `src/lib/tarefas-store.ts`

## 2. Interfaces que Consome e Produz
- **Consome de `src/lib/tarefas-store.ts`:** `atualizarTarefa`, `removerTarefa`, `Tarefa`, `ErroApi`.
- **Produz (Next.js App Router Handlers):**
  - `export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse<Tarefa | ErroApi>>`
  - `export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse<ErroApi | null>>`

## 3. Requisitos Cobertos e Critérios de Aceite
- **`REQ-004` — Atualização parcial (`PATCH /api/tarefas/[id]`):**
  - [ ] Trata body JSON malformado retornando HTTP `400` com `{ erro: "Corpo JSON inválido" }`.
  - [ ] Se `titulo` for enviado, valida que é `string` e `titulo.trim().length > 0` (senão HTTP `400`).
  - [ ] Se `concluida` for enviado, valida que é `boolean` (senão HTTP `400`).
  - [ ] Chama `atualizarTarefa(id, { titulo, concluida })`. Se retornar `null`, responde HTTP `404` com `{ erro: "Tarefa não encontrada" }`. Se encontrar, responde HTTP `200` com a `Tarefa` atualizada.
- **`REQ-005` — Remoção (`DELETE /api/tarefas/[id]`):**
  - [ ] Chama `removerTarefa(id)`. Se retornar `false`, responde HTTP `404` com `{ erro: "Tarefa não encontrada" }`.
  - [ ] Se retornar `true`, responde HTTP `204` (`new NextResponse(null, { status: 204 })`).

## 4. Registro de Cumprimento por Requisito (Para o Relatório do Executor)
| REQ ID | Status Declarado | Arquivo:Linha | Como foi implementado |
| :--- | :--- | :--- | :--- |
| `REQ-004` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| `REQ-005` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
```

### 3.2. Conferências Mecânicas do `Microbrief` (Aplicadas pelo Harness)
1. **Isolamento de Escopo:** `arquivos_permitidos.criar` e `arquivos_permitidos.modificar` contêm apenas caminhos relativos seguros dentro do workspace (sem `..`, sem `.env`, sem `prisma/dev.db`).
2. **Consistência com o Macrobrief:** `reqs_cobertos` e `depende_de` batem exatamente com a entrada daquele `id_microbrief` no `Macrobrief`.
3. **Dependências Prontas:** O harness só despacha o Microbrief para a fila de execução quando todos os Microbriefs listados em `depende_de` já estão com status `PROMOVIDO` (ou com contratos já materializados na árvore base).
4. **Tabela de Requisitos Inicializada:** A seção `## 4. Registro de Cumprimento por Requisito` possui exatamente uma linha para cada item de `reqs_cobertos`.

---

## 4. Relatório do Executor (`Relatório do Executor`)

Conforme especificado na Arquitetura (§5.7), o **Relatório do Executor** usa **exatamente o mesmo template do Microbrief**, porém preenchido ao término da execução.
- **Campos preenchidos pelo modelo (Executor):** `status_execucao`, os checkboxes de critérios de aceite (`[x]`) e a tabela `## 4. Registro de Cumprimento por Requisito` (`atendido | parcial | nao_atendido`, `Arquivo:Linha` e descrição).
- **Campos preenchidos pelo harness, NUNCA pelo modelo:** todo o bloco `medido_pelo_harness` (`compilou`, `testes`, `arquivos_alterados`). Se o modelo tentar preencher ou alterar `medido_pelo_harness`, o parser do harness ignora e sobrescreve com a medição real do sistema operacional e do `git status`/`tsc`.

### 4.1. Exemplo Preenchido (`MB-002` concluído pelo Executor)

```markdown
---
documento: relatorio_executor
id_microbrief: MB-002
id_macrobrief: MACRO-P1-001
id_projeto: proj-p1-tarefas
cluster: backend
nivel_modelo_sugerido: rapido
modelo_utilizado: deepseek/deepseek-v4-pro
depende_de:
  - MB-001
reqs_cobertos:
  - REQ-002
  - REQ-003
arquivos_permitidos:
  criar:
    - src/app/api/tarefas/route.ts
  modificar: []
  ler_contratos:
    - src/lib/tarefas-store.ts
# --- BLOCO DE EXECUÇÃO ---
status_execucao: CONCLUIDO
tentativa_atual: 1
medido_pelo_harness: # preenchido pelo harness, nunca pelo modelo
  compilou: true # preenchido pelo harness, nunca pelo modelo
  testes: # preenchido pelo harness, nunca pelo modelo
    executados: 4
    passaram: 4
    falharam: 0
    comando: "npx vitest run tests/api/tarefas.test.ts"
  arquivos_alterados: # preenchido pelo harness, nunca pelo modelo
    - caminho: src/app/api/tarefas/route.ts
      operacao: criado
      linhas_adicionadas: 42
      linhas_removidas: 0
---

# Relatório do Executor — Microbrief `MB-002`: Rotas de Coleção `GET` e `POST` (`src/app/api/tarefas/route.ts`)

## 1. Arquivos Exatos do Escopo
- **Criar:** `src/app/api/tarefas/route.ts`
- **Ler (Contrato):** `src/lib/tarefas-store.ts`

## 2. Interfaces que Consome e Produz
- **Consome de `src/lib/tarefas-store.ts`:** `listarTarefas`, `criarTarefa`, `Tarefa`, `ErroApi`.
- **Produz (Next.js App Router Handlers):**
  - `export async function GET(): Promise<NextResponse<Tarefa[]>>`
  - `export async function POST(request: NextRequest): Promise<NextResponse<Tarefa | ErroApi>>`

## 3. Requisitos Cobertos e Critérios de Aceite
- **`REQ-002` — Listagem (`GET /api/tarefas`):**
  - [x] Retorna status HTTP `200` com o array JSON retornado por `listarTarefas()`.
- **`REQ-003` — Criação com validação (`POST /api/tarefas`):**
  - [x] Captura erro de JSON inválido no `await request.json()` retornando HTTP `400` com `{ erro: "Corpo JSON inválido" }`.
  - [x] Verifica se `typeof body?.titulo === "string"` e `body.titulo.trim().length > 0`. Caso contrário, retorna HTTP `400` com `{ erro: "O campo titulo é obrigatório" }`.
  - [x] Cria a tarefa via `criarTarefa({ titulo: body.titulo.trim() })` e retorna HTTP `201` com o objeto `Tarefa`.

## 4. Registro de Cumprimento por Requisito (Preenchido pelo Executor)
| REQ ID | Status Declarado | Arquivo:Linha | Como foi implementado |
| :--- | :--- | :--- | :--- |
| `REQ-002` | `atendido` | `src/app/api/tarefas/route.ts:6-9` | Handler `GET` invoca `listarTarefas()` e retorna `NextResponse.json(tarefas, { status: 200 })`. |
| `REQ-003` | `atendido` | `src/app/api/tarefas/route.ts:11-42` | Handler `POST` faz parse seguro com `try/catch` (`route.ts:13-20`), valida `titulo` não vazio (`route.ts:22-31`), chama `criarTarefa` e retorna status `201` (`route.ts:33-41`). |
```

### 4.2. Conferências Mecânicas do `Relatório do Executor` (Aplicadas pelo Harness — Princípio P12)
1. **Sobrescrita Forçada dos Campos do Harness:** Os campos `medido_pelo_harness.compilou`, `medido_pelo_harness.testes` e `medido_pelo_harness.arquivos_alterados` são injetados diretamente pelo código TypeScript do harness a partir da execução real na quarentena, **descartando qualquer valor que o LLM tenha escrito nesses campos**.
2. **Bijeção de `REQ` (Microbrief ↔ Relatório):** Todo `REQ-xxx` presente em `reqs_cobertos` do Microbrief **deve** aparecer na tabela `## 4. Registro de Cumprimento por Requisito` do Relatório, e **nenhum `REQ` inventado** (fora de `reqs_cobertos`) pode aparecer.
3. **Sem Valores `PENDENTE`:** Nenhuma célula da tabela `## 4` pode conter a string `"PENDENTE"` ou estar vazia; `Status Declarado` deve pertencer a `["atendido", "parcial", "nao_atendido"]`.
4. **Existência Física de `Arquivo:Linha`:** O harness faz o parse de cada referência `caminho:linha_inicio-linha_fim` citada na coluna `Arquivo:Linha`:
   - O arquivo citado deve existir na quarentena e pertencer a `arquivos_permitidos`;
   - Os números de linha devem ser inteiros positivos `1 <= linha_inicio <= linha_fim <= total_linhas_do_arquivo`.
5. **Política de Reenvio do Relatório (Não conta como tentativa):** Se qualquer conferência mecânica de formato (itens 2, 3 ou 4) falhar, mas o código tiver compilado (`compilou === true`), o harness solicita ao Executor apenas a correção do relatório (máximo de **2 reenvios**), sem consumir uma das 3 tentativas de código.

---

## 5. Veredito do Avaliador (`Veredito`)

Documento produzido pelo **Avaliador** do cluster após executar a **Lente 1 (Cega)** e a **Lente 2 (Verificação Cruzada)**. Abaixo está o exemplo de aprovação do cluster `backend` do Projeto P1 na **Tentativa 2** (após a correção dos apontamentos mostrados no exemplo de reprovação de `skills/avaliador/SKILL.md`).

### 5.1. Exemplo Preenchido (Projeto P1 — Cluster `backend` Aprovado na Tentativa 2)

```markdown
---
documento: veredito_avaliador
id_veredito: VER-P1-BACKEND-T2
id_projeto: proj-p1-tarefas
cluster: backend
tentativa_avaliada: 2
microbriefs_avaliados:
  - MB-002
  - MB-003
modelo_executor: deepseek/deepseek-v4-pro
modelo_avaliador: anthropic/claude-sonnet-4-20250514
modelo_diferente_do_executor: true
status_tipo_1_harness: aprovado
decisao: APROVADO
contagem_severidade:
  critico: 0
  importante: 0
  menor: 0
---

# Veredito do Avaliador — Cluster `backend` (Tentativa 2)

## 1. Lente 1 — Avaliação Cega por Requisito (`REQ`)

| REQ ID | Microbrief | Status Lente 1 | Evidência no Código (`arquivo:linha`) | Análise Objetiva |
| :--- | :--- | :--- | :--- | :--- |
| `REQ-002` | `MB-002` | `implementado` | `src/app/api/tarefas/route.ts:6-9` | `GET /api/tarefas` retorna HTTP 200 com o array de `listarTarefas()`. |
| `REQ-003` | `MB-002` | `implementado` | `src/app/api/tarefas/route.ts:11-42` | `POST /api/tarefas` captura JSON malformado com HTTP 400 (`route.ts:13-20`), valida `titulo.trim()` não vazio com HTTP 400 (`route.ts:22-31`) e retorna HTTP 201 com a tarefa criada (`route.ts:33-41`). |
| `REQ-004` | `MB-003` | `implementado` | `src/app/api/tarefas/[id]/route.ts:10-54` | `PATCH /api/tarefas/[id]` trata JSON inválido com HTTP 400 (`[id]/route.ts:14-21`), valida `titulo` e `concluida` (`[id]/route.ts:23-39`), retorna HTTP 404 quando `atualizarTarefa` retorna `null` (`[id]/route.ts:43-48`) e HTTP 200 com a tarefa atualizada (`[id]/route.ts:50-53`). |
| `REQ-005` | `MB-003` | `implementado` | `src/app/api/tarefas/[id]/route.ts:56-70` | `DELETE /api/tarefas/[id]` retorna HTTP 404 quando `removerTarefa(id)` é `false` (`[id]/route.ts:60-65`) e HTTP 204 sem corpo quando `true` (`[id]/route.ts:67-69`). |

## 2. Lente 2 — Verificação Cruzada (Lente 1 × Relatório do Executor)

| REQ ID | Status Lente 1 | Declarado pelo Executor | Tipo de Divergência | Evidência da Divergência |
| :--- | :--- | :--- | :--- | :--- |
| `REQ-002` | `implementado` | `atendido` | `convergente` | Convergente com `src/app/api/tarefas/route.ts:6-9`. |
| `REQ-003` | `implementado` | `atendido` | `convergente` | Convergente com `src/app/api/tarefas/route.ts:11-42`. |
| `REQ-004` | `implementado` | `atendido` | `convergente` | Correções da Tentativa 1 aplicadas e convergentes com `src/app/api/tarefas/[id]/route.ts:10-54`. |
| `REQ-005` | `implementado` | `atendido` | `convergente` | Convergente com `src/app/api/tarefas/[id]/route.ts:56-70`. |

## 3. Problemas Encontrados (Qualidade e Conformidade)
Nenhum problema `critico`, `importante` ou `menor` pendente. Os itens `[CRIT-01]`, `[CRIT-02]` e `[IMP-01]` da Tentativa 1 foram integralmente resolvidos sem regressões.

## 4. Resumo da Decisão
Cluster `backend` **APROVADO** na Tentativa 2. Autorizada a promoção dos arquivos `src/app/api/tarefas/route.ts` e `src/app/api/tarefas/[id]/route.ts` da quarentena para o workspace principal.
```

### 5.2. Conferências Mecânicas do `Veredito` (Aplicadas pelo Harness)
1. **Independência de Modelo (T4):** O harness verifica em código que `provedor_familia(modelo_avaliador) !== provedor_familia(modelo_executor)` e que `modelo_diferente_do_executor === true`.
2. **Cobertura Total dos `REQ` do Cluster:** Todos os `REQ-xxx` atribuídos aos `microbriefs_avaliados` aparecem tanto na tabela da **Lente 1** quanto na tabela da **Lente 2**.
3. **Validação Física das Evidências:** Todo `arquivo:linha-linha` citado na coluna `Evidência no Código` da Lente 1 existe no disco na quarentena e está dentro do limite real de linhas do arquivo.
4. **Coerência Matemática da Decisão:**
   - Se existir qualquer `REQ` com `Status Lente 1 !== "implementado"`, ou qualquer divergência `alucinacao_grave`/`divergencia_otimista` na Lente 2, ou `contagem_severidade.critico > 0`, a chave `decisao` **obrigatoriamente** deve ser `"REPROVADO"` (se o LLM escreveu `APROVADO` por engano tendo listado item crítico ou REQ parcial, o harness força `REPROVADO`).
   - Se `decisao === "APROVADO"`, então `contagem_severidade.critico === 0` e `contagem_severidade.importante === 0`.
