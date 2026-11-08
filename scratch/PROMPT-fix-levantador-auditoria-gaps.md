# Prompt (copiar e colar): fechar gaps restantes do levantador-repositorio

Repositório: `c:\projetos\nextcode` apenas. Não pedir confirmação. Um commit por melhoria. Rode os testes no fim.

## Contexto

A auditoria pós-implantação do **levantador-repositorio** aprovou o pacote com ressalvas. Parte já foi corrigida em `fix(intake): política de path e dedupe na auditoria de spec` (path cadastrado na API, `autoPublish` na rota, telemetria no chat, constantes deduplicadas). O que falta está abaixo.

## Tarefas (ordem sugerida)

### 1. Idempotência byte-a-byte em `sem_alteracao`

**Problema medido:** O Cenário 4 passa com `normMerged === normDisk || !hasMaterialDelta`, mas o brief pede `sem_alteracao` só quando o merge é byte-a-byte igual ao `spec.md`. Hoje `renderCanonicalSpecDocument` pode divergir cosmeticamente na 2ª execução sem delta material (drift de YAML).

**Faça:**
- Tornar `renderCanonicalSpecDocument` determinístico (ordem de chaves, listas ordenadas, datas estáveis em reconcile) **ou**
- Comparar forma canônica parseada (hash ou serialização estável) em vez de texto cru, documentando o critério no comentário ao lado de `isIdentical`.
- Ajustar teste Cenário 4 para exigir byte-a-byte **depois** que o render for estável.
- Não reintroduzir reconciliação só por reordenar YAML.

**Arquivos:** `src/core/intake/spec-format.ts`, `src/core/intake/project-repository-survey.ts`, `tests/intake/project-spec-audit.test.ts`.

### 2. Teste de API `POST /api/projects/audit-spec` para path não cadastrado

**Comportamento atual (medido):** `path` no body sem `projectId` exige pasta em `Project.path` (`assertRegisteredProjectDirectory` → 403).

**Faça:**
- Teste Vitest (mock Prisma ou fixture leve) que chama o handler ou extrai validação e prova 403 para temp dir não cadastrado.
- Caminho cadastrado continua OK com `projectId` ou `path` registrado.

**Arquivos:** `tests/intake/project-audit-path-policy.test.ts` ou `tests/api/projects-audit-spec.test.ts` novo.

### 3. `checkSpecStructure` e paths fantasma no reconcile

**Problema:** `reqCriteriaPathsAbsentFromArquivos` existe em `spec-check.ts`, mas o reconcile filtra erros manualmente em `project-repository-survey.ts`. Opção morta ou duplicação.

**Faça (escolha uma):**
- Passar `reqCriteriaPathsAbsentFromArquivos: delta.arquivosRemovidosNaSpec` em `checkSpecStructure(parsedMerged, { ... })` e remover o filtro ad hoc de erros, **ou**
- Remover a opção não usada e manter só o filtro no motor com teste que documenta o contrato do Cenário 3.

**Não** afrouxar `checkSpecStructure` globalmente fora do fluxo de auditoria.

### 4. Chat: skill sem frase de gatilho

**Problema (inferência):** `resolveSkillOrCommand` só injeta SKILL; o motor roda se `isProjectSpecAuditRequest` casar. Frase fora da regex não dispara auditoria.

**Faça (se quiser paridade total com o brief §8.2):**
- Se `resolveSkillOrCommand` resolver `levantador-repositorio`, executar o mesmo ramo que `isProjectSpecAuditRequest` **antes** do dispatch LLM, sem carregar o modelo para Spec.
- Teste: prompt que carrega a skill por nome mas não bate na regex ainda aciona o motor (ou documentar limitação na SKILL).

**Arquivos:** `src/app/api/chat/route.ts`, `src/core/skills/skill-resolver.ts`, teste em `tests/intake/project-spec-audit.test.ts` ou `tests/core/skill-resolver.test.ts`.

### 5. Cenário 6 end-to-end

Ampliar teste Macrobrief + arquivo extra para chamar `runProjectSpecAudit(root)` e assertir `spec-gaps.md` menciona lacuna de cobertura, não só `buildProjectRepositorySurvey`.

## Verificação obrigatória

```bash
cd c:\projetos\nextcode
npx vitest run tests/intake/project-spec-audit.test.ts tests/intake/project-audit-path-policy.test.ts tests/intake/spec-file.test.ts tests/intake/spec-sync.test.ts
npx tsc --noEmit
```

## Fora de escopo

NextPay, afrouxar `execution-trigger`, aprovar Spec automaticamente, LLM no corpo da Spec.

## Entrega

Lista de arquivos alterados, saída completa dos comandos de teste, e uma frase sobre como o critério `sem_alteracao` ficou definido.
