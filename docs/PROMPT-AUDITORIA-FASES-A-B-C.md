# Prompt para auditar Fases A, B e C (2026-10-25)

Você é um auditor independente. **Não confie neste texto.** Leia o código, os testes e os artefatos citados. Onde o texto e o código divergirem, **o código ganha**. Responda em **português**, com **PASS** ou **FAIL** por item, citando **arquivo, função ou trecho** e **uma frase** do que você viu.

**Escopo:** commits `3208061`, `4afd8d2`, `4b80278` na branch `main` do repositório NextCode.

**Fora do escopo (não marque FAIL por ausência):** Fase D (teste real do fundador com prompt complexo / Gateway), replay `scripts/replay-contrato-a1.ts` sem sessão `4d019f00` no banco local, auditorias anteriores em `docs/PROMPT-AUDITORIA-PIPELINE.md` e `docs/PROMPT-AUDITORIA-SKILLS.md` (salvo onde esta entrega toca o mesmo arquivo).

**Contexto arquitetural (só orientação):** NextCode orquestra Spec → Macrobrief → conferência → analista → execução → entrega. Referência ampla: `docs/NEXTCODE-REFERENCIA.md`. Produção usa `config/politicas-orquestracao.yaml` (`conferencia_entrada: sombra`); a suíte Vitest e o bench usam atalhos documentados abaixo.

---

## Fase A — Fechar vs Arquivar projeto

### O que foi prometido

1. **Arquivar** (`isArchived: true`, `isClosed` permanece false): projeto some da lista principal e aparece na seção **Fechados**; worker para de pegar jobs (`isArchived`); pasta no disco **não** é apagada.
2. **Fechar** (`isClosed: true`): também chama a lógica de fechamento operacional (`closeProject` se ainda não arquivado), marca `isArchived` + `isClosed`; projeto **some da sidebar** (filtro `!isClosed`); pasta no disco **permanece**.
3. **Reabrir:** abrir a **mesma pasta local** (`POST /api/projects` com path existente) ou desarquivar zera `isClosed` e retoma fila onde aplicável (`reopenProject`).
4. Schema Prisma: campo `Project.isClosed` com default false e comentário alinhado ao comportamento.
5. UI: menu do projeto distingue **Arquivar** e **Fechar**, com confirmação no Fechar.

### Onde olhar

- `prisma/schema.prisma` — `isClosed`
- `src/app/api/projects/[id]/route.ts` — PATCH `isClosed` / `isArchived`
- `src/app/api/projects/route.ts` — reabrir pasta existente
- `src/core/orchestrator/project-lifecycle.ts` — `closeProject`, `reopenProject`, `whereStopped`
- `src/core/orchestrator/job-queue.ts` — `claimJob` e projeto arquivado
- `src/core/orchestrator/job-worker.ts` — `OPEN_PROJECT_SESSION`
- `src/components/layout/sidebar.tsx`, `src/components/projects/project-actions-menu.tsx`, `src/app/page.tsx`

### Testes obrigatórios (rode na raiz)

```bash
npx vitest run tests/api/projects-open-existing.test.ts tests/orchestrator/pj2b-fechar-projeto.test.ts
```

### Critérios de FAIL típicos

- Fechar apaga pasta ou remove registro do banco sem intenção documentada.
- Projeto com `isClosed: true` ainda aparece na lista principal da sidebar.
- Worker continua executando jobs de projeto fechado/arquivado.
- Reabrir pasta não limpa `isClosed` quando prometido.

---

## Fase B — Analista sem heurística silenciosa em produção

### O que foi prometido

1. Com **`smartRouter` presente** (caminho de produção / `decomposeWithAnalistaSkill`): se o plano do analista falha (skill indisponível, spec sem requisitos, exceção/offline, rodadas esgotadas), o resultado é **`planoReprovado`**, **`nodes: []`**, telemetria `PLANO_REPROVADO` — **sem** retornar o plano heurístico `decomposeSpec` como substituto.
2. Com **`skipModel`** ou **sem `smartRouter`**: continua o caminho de teste/reserva — heurística + trilha `ANALISTA_PLAN_FALLBACK` / `CONTRATO_AUSENTE` (comportamento legado da suíte).
3. **`execution-trigger.ts`**: ao detectar `planoReprovado`, dispara evento de fase `PLANO_REPROVADO`, **não cria etapas**, não inicia execução.
4. Tipo `DecompositionResult` inclui `planoReprovado?: { motivo; dono: "analista" }`.

### Onde olhar

- `src/core/skills/spec-decomposer.ts` — `decomposeWithAnalistaSkill`, função interna `reprovado`, ramos `skipModel || !smartRouter`
- `src/core/orchestrator/execution-trigger.ts` — bloco `if (decompResult.planoReprovado)`
- `tests/orchestrator/analista-plan.test.ts` — motivos `rodadas_esgotadas`, `exception_or_offline`

### Testes obrigatórios

```bash
npx vitest run tests/orchestrator/analista-plan.test.ts tests/orchestrator/execution-trigger.test.ts
```

### Costura a confirmar (não é FAIL se estiver assim)

- Função `fallback` pode existir no arquivo mas **não ser chamada** no ramo com router; confirme com busca no arquivo.
- Em teste, `skipModel` quando `NODE_ENV=test` e `ENABLE_ANALISTA_LLM !== "true"` — planejamento heurístico **intencional** para Vitest.

---

## Fase C — Prova automatizada (bench P1–P4)

### O que foi prometido

1. **`scripts/bench.ts`**: critérios de aceite P1/P2 citam arquivos declarados na Spec (SM1); subprocesso define `NEXTCODE_CONFERENCIA_ENTRADA=desligado` para paridade com Vitest/J4 (bench **não** prova conferência LLM em produção).
2. Execuções registradas (variante `padrao`, 1 repetição):

   | Projeto | Fase esperada | Aceite | Relatório |
   |---------|---------------|--------|-----------|
   | P1 | ENTREGUE | 10/10 | `bench/resultados/2026-10-25-1024.{md,yaml}` |
   | P2 | ENTREGUE | 13/13 | `bench/resultados/2026-10-25-1043.{md,yaml}` |
   | P3 | ENTREGUE (2ª tentativa) | 12/12 | `bench/resultados/2026-10-25-1052.{md,yaml}` |
   | P4 | ENTREGUE | 12/12 | `bench/resultados/2026-10-25-1043.{md,yaml}` |

3. Resumo escrito em `docs/relatorios/FASE-C-BENCH-2026-10-25.md` coerente com os YAML (fase, aceite, custo aproximado).
4. **Replay Gateway** declarado **não executado** (sem sessão histórica no `dev.db` local) — aceitável nesta entrega.

### Onde olhar

- `scripts/bench.ts` — env `NEXTCODE_CONFERENCIA_ENTRADA`, parsing de critérios
- `bench/resultados/2026-10-25-1024.yaml`, `1043.yaml`, `1052.yaml`
- `docs/relatorios/FASE-C-BENCH-2026-10-25.md`
- Specs/fixtures do bench em `bench/` (projetos p1–p4 conforme referenciado nos YAML)

### Verificação opcional (recomendada se tiver API keys e tempo)

Reproduzir **um** projeto apenas, por exemplo:

```bash
npx tsx scripts/bench.ts --projetos p1 --variantes padrao --repeticoes 1
```

Compare fase final e contagem de aceite com o YAML commitado. Divergência sistemática entre código atual e relatório commitado = **FAIL** no item correspondente.

Não é obrigatório gastar ~US$ 1 de novo para aprovar; basta ler YAML + código do runner. Reexecução serve para desconfiança.

---

## Checklist transversal

- [ ] `npx tsc --noEmit` passa.
- [ ] Nenhum dos três commits reintroduz fallback heurístico do analista no caminho `smartRouter` após falha do modelo.
- [ ] Fechar/Arquivar não confundem exclusão de pasta (`checkFolderSafeToDelete` / DELETE de projeto permanece separado).
- [ ] Bench não afirma ter testado conferência **sombra** em produção; documentação deixa claro o atalho `desligado`.

---

## Formato da resposta

```markdown
# Auditoria Fases A–C — [data]

## Resumo
- Status: [APROVADO | APROVADO COM RESSALVAS | REPROVADO]
- Itens FAIL: [lista ou "nenhum"]

## Fase A
| # | PASS/FAIL | Evidência | Observação |
...

## Fase B
...

## Fase C
...

## Costuras confirmadas
- [bullets]

## Lacunas / riscos não cobertos por esta entrega
- [bullets — ex.: Fase D, flakiness P3 1ª run BLOQUEADA com aceite 12/12]

## Veredito final
Uma frase: a entrega cumpre ou não o prometido nas Fases A–C, e o bloqueador principal se houver.
```

**Regra:** não marque PASS em item que você não abriu no código ou nos YAML commitados. Comentários no código não substituem comportamento executável.
