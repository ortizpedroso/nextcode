# Prompt: Integração operacional do levantador-repositorio no harness NextCode

**Audiência:** LLM implementadora. **Repositório único:** `c:\projetos\nextcode`. **Não** pedir confirmação ao operador. Entregar código + testes verdes. Commits atômicos (1 melhoria = 1 commit). Um auditor humano revisa o diff depois.

**Fora de escopo deste prompt:** teste pesado NextPay, projetos reais no disco dos testes (só `mkdtemp`), afrouxar `execution-trigger.ts` / guards de fase, aprovar Spec automaticamente, duplicar `bootstrap-spec` (o motor oficial é `runProjectSpecAudit` + `POST /api/projects/audit-spec`).

---

## 1. Produto (visão macro)

O **levantador-repositorio** já existe (motor em `src/core/intake/project-repository-survey.ts`, skill em `skills/levantador-repositorio/`, API em `src/app/api/projects/audit-spec/route.ts`, ramos determinísticos no chat). Commits recentes `6a3ece4` … `cb8158c` fecharam idempotência, path policy, ghost paths, skill resolver e Cenário 6 E2E.

**Lacuna atual:** o operador ainda não vê o levantador no fluxo natural do produto. O motor roda por chat/API, mas a UI, o inventário de skills e o `spec-sync` não refletem `spec-gaps.md` / `spec-reconcile.md`. Retomar sessão em projeto legado sem Spec não sugere o próximo passo mecânico.

**Objetivo desta entrega:** integrar o levantador ao **harness** (UI mínima, listagem de skills nativas, estado de artefatos, respostas determinísticas, gatilho na abertura de sessão) **sem** novo motor paralelo.

**Posição no fluxo (inalterada):**

Cadastro → levantador → revisão humana → elicitador → aprovação spec → macrobrief → analista → execução

---

## 2. Levantamento de pendências (evidência da conversa / código)

| # | Pendência | Evidência |
|---|-----------|-----------|
| P1 | `/api/skills/list` não lista skills nativas do NextCode em `process.cwd()/skills/` | `skill-resolver.ts` já escaneia `skills/`; `skills/list/route.ts` só `.gemini`/`.claude`/`.cursor` no projeto alvo |
| P2 | `assessProjectSpecArtifacts` / `formatProjectSpecArtifactStatus` ignoram `spec-gaps.md` e `spec-reconcile.md` | `spec-sync.ts` só macrobrief + spec.md |
| P3 | Resposta determinística do levantador no chat não inclui `formatProjectSpecArtifactStatus` | Brief original §8.2; `chat/route.ts` monta markdown manual |
| P4 | Sem ação na UI para auditar repositório | Nenhum `authFetch` para `audit-spec` em `src/components/**` |
| P5 | Abrir sessão com Macrobrief sem Spec não orienta levantador | `formatProjectSpecArtifactStatus` avisa texto genérico; sem CTA `/levantador-repositorio` |
| P6 | Prompts scratch `bootstrap-spec` redundantes | `scratch/PROMPT-impl-spec-bootstrap.md` etc.; marcar superseded por levantador (doc só) |

**Não reimplementar:** itens já fechados em `scratch/PROMPT-fix-levantador-auditoria-gaps.md` (sem_alteracao, 403 API, ghost paths, skill no chat, Cenário 6).

---

## 3. Modelo de domínio (codar tipos antes da lógica)

Estender em `src/core/intake/spec-sync.ts`:

```ts
export type ProjectSpecArtifactState = {
  // campos existentes ...
  gapsFile: boolean;
  reconcileFile: boolean;
  gapsFileMtimeMs: number | null;
  reconcileFileMtimeMs: number | null;
};
```

Funções públicas novas ou estendidas:

- `assessProjectSpecArtifacts(projectPath, sessionSpec)` lê existência (e opcionalmente mtime) de `SPEC_GAPS_RELATIVE_PATH` e `SPEC_RECONCILE_RELATIVE_PATH` importados de `spec-file.ts`.
- `formatProjectSpecArtifactStatus(state)` acrescenta linhas quando gaps/reconcile presentes e sugere leitura antes de elicitar/aprovar.
- `suggestLevantadorWhenNeeded(state): string | null` retorna texto curto em pt-BR quando `(macrobrief && !diskSpec) || (!diskSpec && !sessionChars)` com projeto path válido; **sem** chamar LLM.

---

## 4. Tarefas de implementação

### Tarefa A — Skills nativas no autocomplete (P1)

**Arquivo:** `src/app/api/skills/list/route.ts`

- Escanear `path.join(process.cwd(), "skills")` (mesmo contrato que `findSkillContent`: pasta `nome/SKILL.md`, frontmatter `name` e `description`).
- Tipo sugerido na lista: `"nextcode"` (estender union em `SkillItemInfo` se necessário).
- Deduplicar por `name` se o projeto alvo já tiver skill homônima.
- **Teste:** `tests/api/skills-list.test.ts` ou `tests/skills/skill-list-native.test.ts` assertindo que `levantador-repositorio` aparece quando `cwd` é o repo NextCode (mock `process.cwd` se o repo já tiver padrão para isso; senão teste de função extraída `scanNextcodeNativeSkills`).

**Commit sugerido:** `feat(skills): listar skills nativas do NextCode em /api/skills/list`

### Tarefa B — spec-sync com gaps e reconcile (P2)

**Arquivos:** `spec-sync.ts`, `tests/intake/spec-sync.test.ts`

- Preencher novos campos em `assessProjectSpecArtifacts`.
- Mensagens em `formatProjectSpecArtifactStatus` para gaps/reconcile presentes/ausentes.
- Testes com `mkdtemp` gravando `.nextcode/spec-gaps.md` vazio ou stub.

**Commit:** `feat(intake): spec-sync reconhece spec-gaps e spec-reconcile`

### Tarefa C — Chat levantador + status unificado (P3 + P5 parcial)

**Arquivo:** `src/app/api/chat/route.ts`

- Após `runProjectSpecAudit`, anexar ao `statusLines` o bloco `formatProjectSpecArtifactStatus(assessProjectSpecArtifacts(...))`.
- Se modo `bloqueado`, manter gaps publicados (já ocorre via `publishProjectSpecAuditArtifacts`).
- Opcional no mesmo commit: em `specPresentationReply` ou no ramo de apresentação da Spec, incluir `suggestLevantadorWhenNeeded` quando aplicável.

**Commit:** `feat(chat): resposta do levantador inclui status de artefatos da Spec`

### Tarefa D — UI: auditar repositório (P4)

**Arquivos candidatos (escolha o menor diff coerente):**

- `src/components/session/canonical-spec-modal.tsx` **ou**
- `src/components/layout/workspace.tsx` **ou**
- barra contextual quando `projectId` + `project.path` existem.

**Comportamento:**

- Botão "Levantar repositório" / "Auditar código → Spec" visível só com projeto com `path` válido.
- `authFetch("POST", "/api/projects/audit-spec", { projectId, sessionId })` (sem `force` por padrão).
- Exibir toast ou inline: `mode`, contagem de lacunas, links relativos `.nextcode/spec-gaps.md`.
- Em sucesso com `gravouSpec`, recarregar Spec na UI (re-fetch sessão ou endpoint existente).
- **Não** aprovar Spec nem mudar fase sozinho.

**Teste:** se o repo não tiver RTL E2E, teste mínimo de helper extraído (`buildAuditSpecRequestBody`) ou documentar skip com teste de integração da rota já existente.

**Commit:** `feat(ui): ação para POST audit-spec na sessão com projeto`

### Tarefa E — Gesto na abertura de sessão (P5)

**Arquivo:** `src/app/api/sessions/[id]/route.ts` (GET) ou ponto único já chamado ao montar workspace.

- Após `reconcileProjectSpecDocument`, se `suggestLevantadorWhenNeeded(assess...)` não for null, incluir no JSON da sessão campo opcional `specIntakeHint: string` (nome estável documentado no tipo da resposta).
- UI: mostrar banner discreto uma vez (não modal bloqueante) com o hint e botão que dispara o mesmo fluxo da Tarefa D ou envia `/levantador-repositorio` no chat.

**Commit:** `feat(intake): hint de levantador ao abrir sessão sem Spec canônica`

### Tarefa F — Documentação scratch (P6)

**Arquivos:** topo de `scratch/PROMPT-impl-spec-bootstrap.md` e `scratch/PROMPT-bootstrap-spec-from-repo.md`

- Bloco `> SUPERSEDED: use levantador-repositorio e scratch/PROMPT-impl-levantador-repositorio.md`.

**Commit:** `docs(scratch): marcar bootstrap-spec como substituído pelo levantador`

---

## 5. Regras de ouro

1. Reutilizar `runProjectSpecAudit` / `publishProjectSpecAuditArtifacts`. Não criar `bootstrap-spec` route.
2. `requireAuth` / `requireReadAuth` iguais às rotas existentes.
3. Telemetria existente `PROJECT_SPEC_AUDIT` não remover.
4. `execution-trigger.ts` e máquina de fases intocados salvo import de tipos.
5. Textos operador em pt-BR.

---

## 6. Testes obrigatórios

```bash
cd c:\projetos\nextcode
npx vitest run tests/intake/project-spec-audit.test.ts tests/intake/project-audit-path-policy.test.ts tests/intake/spec-sync.test.ts tests/skills/skill-promessas.test.ts
# + testes novos desta entrega
npx tsc --noEmit
```

Meta: não regredir os 9 testes de `project-spec-audit.test.ts`.

---

## 7. Checklist do auditor (pós-implementação)

- [ ] `levantador-repositorio` aparece no popup `/` da PromptBar com projeto vinculado.
- [ ] `formatProjectSpecArtifactStatus` menciona gaps/reconcile quando arquivos existem.
- [ ] Chat `/levantador-repositorio` inclui seção Documento central.
- [ ] UI dispara audit-spec e mostra modo/lacunas sem aprovar Spec.
- [ ] GET sessão expõe hint quando macrobrief sem spec (comportamento testado ou spec-sync test).
- [ ] Nenhuma rota `bootstrap-spec` nova.
- [ ] Vitest + tsc verdes.

---

## 8. Entrega da implementadora

1. Lista de arquivos criados/alterados por commit.
2. Saída completa dos comandos de teste.
3. Screenshot textual (markdown) de exemplo de resposta do chat pós-levantador com status de artefatos.
4. Duas frases: como a UI recarrega Spec após audit e quando o hint de abertura some.

---

## 9. Depois desta entrega (não implementar agora)

Rodar **teste pesado** (ex. NextPay) apenas para achar brechas no harness, não para “fazer o projeto passar”. Falhas viram commits no NextCode, não patches no cliente.

Fim do prompt.
