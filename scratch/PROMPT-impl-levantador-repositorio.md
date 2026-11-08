# Nova habilidade NextCode: `levantador-repositorio` (skill + motor de auditoria reversa)

Você implementa **somente** no repositório NextCode (`c:\projetos\nextcode`). Um auditor humano revisa o diff contra este brief. Não peça confirmação ao operador. Entregue código, skill e testes verdes.

---

## 1. Produto (visão macro)

O NextCode é um harness de desenvolvimento assistido por IA. Ele orquestra fases (conversa, elicitação, planejamento, execução) usando **Spec canônica** (`.nextcode/spec.md`), Macrobrief e DAG.

**Lacuna no catálogo de habilidades:** não existe papel para **adotar qualquer repositório cadastrado** quando falta documento central ou quando o código divergiu da Spec. Hoje o agente tende a improvisar Spec em prosa ou depender só do SQLite da sessão.

**Esta entrega adiciona uma habilidade nativa** ao catálogo em `skills/levantador-repositorio/`, apoiada por **motor determinístico** em `src/core/intake/`. Escopo é **genérico**: todo `Project` com `path` no Prisma. Nenhum cliente ou projeto real entra no desenho nem nos testes (apenas `mkdtemp`).

**Promessa da habilidade (uma frase):** o NextCode levanta evidência mecânica do repositório alvo e publica ou reconcilia a Spec canônica como documento central do software auditado, com relatórios de lacunas e de delta, sem aprovar Spec nem criar DAG.

**Posição no fluxo:**

```
Cadastro do projeto → [levantador-repositorio] → revisão humana → elicitador → aprovação spec → macrobrief → analista → execução
```

O levantador é **pré-elicitação** ou **retomada** quando artefatos em `.nextcode/` estão ausentes ou desatualizados.

---

## 2. Arquitetura em duas camadas

| Camada | Responsabilidade | Artefato |
|--------|------------------|----------|
| **Skill** | Quando acionar, o que o agente conversacional faz e evita, como interpretar o laudo | `skills/levantador-repositorio/SKILL.md` |
| **Motor** | Walk do disco, inventário tipado, render YAML canônico, fusão com Spec existente, gravação | `src/core/intake/project-*` + rota API + ramo determinístico no chat |

O agente **não** autor o YAML da Spec. O motor TypeScript sim, passando `parseSpecDocument` e `checkSpecStructure`.

**Proibido neste PR:** integrar RES/REA/MCP externos; editar pastas de projetos reais fora de fixtures; aprovar Spec ou disparar `execution-trigger` / DAG; afrouxar guards de fase; usar LLM para montar o corpo da Spec.

---

## 3. Código existente (estender, não reescrever)

Leia antes de implementar:

| Caminho | Uso |
|---------|-----|
| `src/core/intake/spec-file.ts` | `CANONICAL_SPEC_RELATIVE_PATH`, `readCanonicalSpecFile`, `writeCanonicalSpecFile` |
| `src/core/intake/spec-sync.ts` | `assessProjectSpecArtifacts`, `reconcileProjectSpecDocument`, `formatProjectSpecArtifactStatus` |
| `src/core/intake/spec-format.ts` | `parseSpecDocument`, `renderCanonicalSpecDocument`, `ParsedSpec`, `SpecFrontmatterInput` |
| `src/core/intake/spec-check.ts` | `checkSpecStructure` |
| `src/core/intake/macrobrief-elicitador.ts` | `parseElicitadorMacrobrief` |
| `src/core/project/source-files.ts` | extensões-fonte, dirs ignorados (exporte constantes se estiverem privadas) |
| `src/core/orchestrator/message-intent.ts` | padrão para intenções determinísticas no chat |
| `src/core/skills/skill-resolver.ts` | `/comando` no prompt |
| `src/core/skills/skill-runtime.ts` | `loadRoleSkill`, enum `SkillRoleKind` |
| `src/app/api/chat/route.ts` | POST chat, reconcile de spec |

Testes de referência: `tests/intake/spec-file.test.ts`, `tests/intake/spec-sync.test.ts`, `tests/intake/spec-presentation.test.ts`, `tests/skills/skill-promessas.test.ts`.

---

## 4. Modelo de domínio (codar tipos antes da lógica)

**Arquivos sugeridos**

- `src/core/intake/project-repository-survey.ts` (tipos + orquestração)
- `src/core/intake/project-repository-survey-extract.ts` (walk, parse prisma, rotas)
- `src/core/intake/spec-reconcile-with-survey.ts` (fusão spec + inventário)
- `src/core/intake/project-spec-audit-publish.ts` (grava `.nextcode/*`)
- `src/app/api/projects/audit-spec/route.ts` (HTTP)

### Tipos exportados

```ts
export type SurveyProvenance = "observado" | "derivado_macrobrief" | "inferido";

export type SpecAuditMode = "criar" | "reconciliar" | "sem_alteracao" | "bloqueado";

export interface ProjectRepositorySurvey {
  projectRoot: string;
  levantadoEm: string;
  titulo: string;
  stack: string[];
  arquivosFonte: string[];
  rotasApi: Array<{ caminho: string; arquivo: string }>;
  entidades: Array<{ nome: string; campos: Array<{ nome: string; tipo: string }> }>;
  modulos: Array<{
    id: string;
    nome: string;
    resumo: string;
    arquivos: string[];
    proveniencia: SurveyProvenance;
  }>;
  requisitosSugeridos: Array<{
    id: string;
    titulo: string;
    criterio: string;
    origem: string;
    proveniencia: SurveyProvenance;
  }>;
  macrobrief: {
    presente: boolean;
    specVersao: number | null;
    arquivosMacrobrief: string[];
    reqsMacrobrief: string[];
  };
  lacunas: Array<{
    codigo:
      | "arquivo_sem_modulo"
      | "arquivo_sem_req"
      | "req_sem_criterio"
      | "rota_sem_arquivo"
      | "entidade_vazia"
      | "spec_arquivo_inexistente_no_disco"
      | "modulo_sem_arquivo";
    detalhe: string;
  }>;
}

export interface SpecReconcileDelta {
  arquivosAdicionados: string[];
  arquivosRemovidosNaSpec: string[];
  rotasAdicionadas: string[];
  stackAlterada: { antes: string[]; depois: string[] } | null;
  modulosAjustados: string[];
  requisitosPreservados: string[];
  requisitosNovos: string[];
  avisos: string[];
}

export interface ProjectSpecAuditResult {
  mode: SpecAuditMode;
  survey: ProjectRepositorySurvey;
  specText: string | null;
  delta: SpecReconcileDelta | null;
  gapsMarkdown: string;
  reconcileMarkdown: string | null;
  checkErrors: string[];
  gravouSpec: boolean;
  gravouGaps: boolean;
  gravouReconcile: boolean;
  motivoBloqueio?: string;
}
```

### API pública

1. `buildProjectRepositorySurvey(projectRoot: string): ProjectRepositorySurvey`
2. `surveyToNewCanonicalSpec(survey: ProjectRepositorySurvey): string`
3. `reconcileParsedSpecWithSurvey(parsed: ParsedSpec, survey: ProjectRepositorySurvey): { merged: SpecFrontmatterInput; delta: SpecReconcileDelta }`
4. `renderSurveyGapsMarkdown(survey: ProjectRepositorySurvey): string`
5. `renderReconcileMarkdown(survey: ProjectRepositorySurvey, delta: SpecReconcileDelta | null): string`
6. `publishProjectSpecAuditArtifacts(projectRoot: string, result: ProjectSpecAuditResult): { specPath?: string; gapsPath: string; reconcilePath?: string }`
7. `runProjectSpecAudit(projectRoot: string, opts?: { force?: boolean }): ProjectSpecAuditResult`

**Constantes novas** (exportar junto de `spec-file` ou `project-spec-audit-publish`):

- `SPEC_GAPS_RELATIVE_PATH = ".nextcode/spec-gaps.md"`
- `SPEC_RECONCILE_RELATIVE_PATH = ".nextcode/spec-reconcile.md"`

**Idempotência:** se o texto merged é byte-a-byte igual ao `spec.md` atual, `mode: "sem_alteracao"`, `gravouSpec: false`. Gaps pode atualizar se o inventário mudou.

---

## 5. Extratores (fronteira, sem LLM)

1. **Título:** `package.json` `name` ou basename de `projectRoot`.
2. **Stack:** dependencies + devDependencies do `package.json` (strings literais). Opcional no mesmo PR: sinais mínimos em `pyproject.toml` / `go.mod` se existirem (não obrigatório).
3. **Arquivos-fonte:** walk recursivo com mesmas extensões e ignore dirs que `source-files.ts` usa (`node_modules`, `.git`, `.next`, `.nextcode`, `dist`, etc.). Paths relativos com `/`.
4. **Rotas API:** glob `src/app/api/**/route.ts` → caminho HTTP `/api/...` (tratar segmentos dinâmicos de forma consistente; documente no teste).
5. **Entidades:** parse leve de `prisma/schema.prisma` (`model Name { campo Tipo ... }`). Tipos comuns bastam.
6. **Macrobrief:** se `.nextcode/macrobrief.md` existe, `parseElicitadorMacrobrief`. Clusters → `modulos`. REQs listados → `requisitosSugeridos` com `origem: "derivado: macrobrief REQ-xxx"`.

**Sem macrobrief:** agrupar arquivos por prefixo de diretório (`src/app/api`, `src/lib`, etc.) como módulos com `proveniencia: inferido` e resumo explícito de que é agrupamento mecânico.

**Lacunas:** qualquer arquivo-fonte relevante fora de `arquivosAfetados` efetivos ou sem módulo deve gerar entrada em `survey.lacunas`.

**Proveniência interna** não vai inteira para o YAML da Spec pública. O YAML usa `origem` nos REQs conforme regras já aceitas pelo harness (`derivado: ...`, `premissa: ...`).

---

## 6. Modos: criar, reconciliar, bloquear

Lógica em `runProjectSpecAudit(projectRoot, opts)`:

| Situação | `SpecAuditMode` | Comportamento |
|----------|-----------------|---------------|
| Sem `.nextcode/spec.md` ou parse falha | `criar` | `surveyToNewCanonicalSpec` → `status: aguardando_aprovacao` |
| Spec válida no disco | `reconciliar` | fusão com inventário |
| Spec válida e merge idêntico ao arquivo | `sem_alteracao` | não regravar spec |
| Spec com `status: aprovada` no YAML e `force !== true` | `bloqueado` | não gravar spec; `motivoBloqueio` orienta operador |

### Regras de fusão (`reconciliar`)

- **Preservar** todos os REQs existentes (id, titulo, criterio, origem). Não apagar REQ porque o modelo errou.
- Se o critério cita caminho que não existe mais no disco: `lacunas` + `avisos` no delta, REQ mantido.
- **Unir** `stack`, `arquivosAfetados`, `rotas`, `entidades` (observado atualiza stack/rotas; arquivos ausentes no repo saem de `arquivosAfetados` e vão para `arquivosRemovidosNaSpec` no relatório).
- **Merge de módulos** por `id` ou nome normalizado. Módulos só humanos não são removidos sem entrada no delta.
- Se houve mudança material (listas do delta com conteúdo além de só `requisitosPreservados`): `status` → `aguardando_aprovacao`, nota ISO em `notasImplementacao`: reconciliado com levantamento de repositório.
- **Nunca** emitir `status: aprovada` neste fluxo.

### Validação antes de gravar spec

`parseSpecDocument(specText)` não nulo e `checkSpecStructure`. Se houver erros bloqueantes, `gravouSpec: false`, modo efetivo `bloqueado`, ainda gravar `spec-gaps.md` (e reconcile se existir delta parcial).

### Spec nova (`criar`)

- `objetivo` honesto (ex.: documentar sistema a partir de inventário mecânico).
- `requisitos` a partir de `requisitosSugeridos` quando houver macrobrief; senão lista mínima ou vazia com lacunas explicando ausência.
- Sempre `aguardando_aprovacao`.

---

## 7. Artefatos no repositório auditado

Gravados sob `projectRoot/.nextcode/`:

| Arquivo | Conteúdo |
|---------|----------|
| `spec.md` | Documento central canônico (quando permitido) |
| `spec-gaps.md` | Lacunas do inventário + resumo (sempre após auditoria) |
| `spec-reconcile.md` | Delta humano-legível (modos `reconciliar` ou `criar` com comparação vazia omitir seção) |

`writeCanonicalSpecFile` já valida parse. Não sobrescrever spec válida em modo `bloqueado`.

---

## 8. Integração harness

### 8.1 `POST /api/projects/audit-spec`

- Auth: mesmo padrão de `requireAuth` / leitura de projeto das rotas existentes em `src/app/api/projects/`.
- Body: `{ "projectId": string }` **ou** `{ "path": string }`, opcional `{ "force": boolean }`.
- Validar que `path` está sob política do NextCode (reutilize validação de path se já houver em `/api/fs/validate-path` ou equivalente).
- Executar `runProjectSpecAudit` + `publishProjectSpecAuditArtifacts`.
- Opcional: se body incluir `sessionId` ou sessão ativa do projeto, após gravar spec chamar `reconcileProjectSpecDocument` e `prisma.session.update` com `specApproved: false` quando spec foi criada ou reconciliada.
- Telemetria: `TelemetryLogger.log({ action: "PROJECT_SPEC_AUDIT", details: { mode, gravouSpec, lacunas: survey.lacunas.length } })`.
- JSON: `mode`, `gravouSpec`, `checkErrors`, contagens, paths relativos.

### 8.2 Chat determinístico

Adicionar em `message-intent.ts` (ou módulo vizinho) algo como `isProjectSpecAuditRequest(message: string): boolean`.

Frases e comandos (case insensitive, português):

- `/levantador-repositorio`
- `levantar repositório`, `levantar repositorio`
- `auditar repositório`, `auditoria do código`
- `atualizar spec com o código`, `reconciliar spec`
- `inventário do projeto`, `inventario do projeto`

Em `chat/route.ts`, **antes** do despacho LLM, se a intenção bater e `session.project.path` existir:

1. `runProjectSpecAudit(projectPath)` sem force.
2. Resposta markdown fixa com modo, `# lacunas`, caminhos `.nextcode/`, trecho de `formatProjectSpecArtifactStatus` se fizer sentido.
3. Não chamar modelo para gerar Spec.

Se `/levantador-repositorio` vier via `resolveSkillOrCommand`, mesma execução do motor. A SKILL é contexto operacional (`untrustedSource`), não autora da Spec.

### 8.3 Listagem de skills

Skills do NextCode vivem em `skills/<nome>/SKILL.md` e são carregadas por `loadRoleSkill`. Garantir que `loadRoleSkill("levantador-repositorio")` funciona após criar a pasta.

---

## 9. Conteúdo completo da skill (obrigatório)

Criar `skills/levantador-repositorio/SKILL.md` **exatamente** neste espírito (pode ajustar redação se o comportamento implementado exigir, mas manter contratos).

```markdown
---
name: levantador-repositorio
description: >
  Habilidade de intake do NextCode para qualquer projeto cadastrado. Executa
  levantamento mecânico do repositório (path do Project), cria .nextcode/spec.md
  se ausente ou reconcilia com o código se já existir Spec. Gera spec-gaps.md e
  spec-reconcile.md. Não aprova Spec, não gera Macrobrief, não cria DAG.
papel: conferente
nivel_modelo: rapido
ferramentas: []
permissoes:
  escrever: nunca
  comandos: []
passos_max: 1
entrada:
  - projeto_cadastrado_com_path_valido
  - sessao_com_project_path_ou_project_id
saida: resumo_modo_e_artefatos_nextcode
checagens:
  - motor_typescript_gera_spec
  - spec_parseavel
  - nao_aprovar_spec_automaticamente
  - nao_criar_tasknode
---
# Papel: Levantador de repositório (`levantador-repositorio`)

Você conduz a **auditoria inicial ou de realinhamento** de um software já existente no disco. O documento central do sistema auditado é a Spec canônica em `.nextcode/spec.md`.

## O que você faz

1. Garantir que o harness executou o levantamento (`POST /api/projects/audit-spec` ou atalho no chat / intenção reconhecida pelo servidor).
2. Explicar ao operador o **modo** retornado: `criar`, `reconciliar`, `sem_alteracao`, `bloqueado`.
3. Indicar leitura de `spec-gaps.md` (lacunas) e, se houver, `spec-reconcile.md` (o que mudou na Spec).
4. Orientar revisão humana antes de elicitação ou aprovação.

## O que você NÃO faz

- Não redige nem “melhora” o YAML da Spec no chat.
- Não marca Spec como aprovada.
- Não dispara planejamento, Macrobrief ou executores.
- Não trata Macrobrief como substituto da Spec.

## Modo bloqueado

Se a Spec no disco tem `status: aprovada` e o motor retornou `bloqueado`, explique que é preciso revisão humana ou nova auditoria com `force: true` (reabre aprovação via harness, não via texto no chat).

## Quando usar (gatilhos)

- Projeto legado sem `.nextcode/spec.md`.
- Retomada de sessão com Macrobrief mas sem Spec.
- Suspeita de divergência entre código e Spec.
- Pedido explícito de inventário ou reconciliação.

## Saída esperada para o operador

Resumo em português: modo, quantidade de lacunas, se gravou spec, próximos passos (abrir spec.md, corrigir lacunas, seguir elicitador).
```

`papel: conferente` usa o enum existente. Opcional em PR separado: adicionar `levantador` a `SkillRoleKind` se o time quiser papel dedicado.

---

## 10. Testes

Arquivo: `tests/intake/project-spec-audit.test.ts` (somente diretórios temp).

| # | Cenário | Assert principal |
|---|---------|------------------|
| 1 | Mini monorepo fake Next-like | `criar`, parse OK, gaps presente |
| 2 | Spec fixture + arquivo novo | `reconciliar`, `arquivosAdicionados`, status `aguardando_aprovacao` |
| 3 | REQ aponta arquivo removido | REQ preservado, aviso/lacuna |
| 4 | Segunda execução sem mudanças | `sem_alteracao` |
| 5 | Spec `status: aprovada` sem force | `bloqueado` |
| 6 | Macrobrief fixture + arquivo extra | lacuna de cobertura |

Funções auxiliares de fixture no próprio arquivo de teste (não commitar projetos reais).

```bash
cd c:\projetos\nextcode
npx vitest run tests/intake/project-spec-audit.test.ts
npx vitest run tests/intake/spec-file.test.ts tests/intake/spec-sync.test.ts
npx tsc --noEmit
```

Se `tests/skills/skill-promessas.test.ts` exigir campos para toda skill nova, atualize conforme padrão do repo.

---

## 11. Fora de escopo

- Graphify, Spec decomposer LLM, elicitador, analista, conferente de macrobrief automatizado.
- Aprovação de Spec, `execution-trigger`, criação de `TaskNode`.
- Commits, PR, README longo.
- Dependência de RES, REA ou MCP para ler repositório.

---

## 12. Checklist do auditor externo

- [ ] Habilidade listável via `loadRoleSkill("levantador-repositorio")`.
- [ ] Motor genérico: entrada é `projectRoot`, não hardcode de cliente.
- [ ] Criar + reconciliar + bloqueio de spec aprovada + idempotência.
- [ ] Três artefatos `.nextcode/` com constantes exportadas.
- [ ] Rota `POST /api/projects/audit-spec` autenticada e validação de path.
- [ ] Chat/intent chama motor sem LLM na Spec.
- [ ] `execution-trigger.ts` e guards de fase intocados.
- [ ] Testes intake verdes.

---

## 13. Entrega da implementadora

1. Lista de arquivos criados ou alterados.
2. Exemplo de frontmatter YAML gerado (fixture, 30 linhas no máximo).
3. Saída completa dos comandos de teste.
4. Duas frases: heurística de rotas API e política de merge de módulos.

Fim do brief.
