# Prompt de implementação — Bootstrap da Spec canônica a partir do repositório

Você implementa no repositório **NextCode** (`c:\projetos\nextcode`). Outro engenheiro audita o diff contra este documento. Não peça confirmação. Entregue código + testes verdes.

---

## Por que

Projetos de manutenção (ex.: **NextPay** em `C:\projetos\nextpay`) têm código e às vezes `.nextcode/macrobrief.md`, mas **não** têm `.nextcode/spec.md`. A Spec ficava só em `Session.canonicalSpec` no SQLite. O harness precisa de **documento central no disco** no formato canônico (parseável por `parseSpecDocument`) para retomar sessão, revisar e aprovar DAG.

Inspiração de processo (não dependência): RES usa KB em disco + script `check-*` + evidência por afirmação. REA separa observação, inferência e desconhecido. Aqui a junção é **TypeScript puro**, não LLM costurando markdown.

**Não** integrar os repositórios [alextnetto/res](https://github.com/alextnetto/res) nem [morluto/rea](https://github.com/morluto/rea). **Não** editar o projeto alvo NextPay à mão para “passar” teste.

---

## O que já existe (não reimplementar)

Leia antes de codar:

| Módulo | Função |
|--------|--------|
| `src/core/intake/spec-file.ts` | `CANONICAL_SPEC_RELATIVE_PATH`, `readCanonicalSpecFile`, `writeCanonicalSpecFile` |
| `src/core/intake/spec-sync.ts` | `reconcileProjectSpecDocument`, `assessProjectSpecArtifacts`, `readMacrobriefSpecVersion` |
| `src/core/intake/spec-format.ts` | `parseSpecDocument`, `renderCanonicalSpecDocument`, tipos `ParsedSpec`, `SpecFrontmatterInput` |
| `src/core/intake/spec-check.ts` | `checkSpecStructure` |
| `src/core/intake/macrobrief-elicitador.ts` | `parseElicitadorMacrobrief` |
| `src/app/api/chat/route.ts` | chama `reconcileProjectSpecDocument`; status lista artefatos |

Testes existentes: `tests/intake/spec-file.test.ts`, `spec-sync.test.ts`, `spec-presentation.test.ts`.

---

## Forma de dados (obrigatória)

Modele o domínio em `src/core/intake/spec-bootstrap.ts` (nome pode variar se justificar, mas um módulo só).

```ts
/** Confiança epistemológica (inspirado em REA, não copiar REA). */
export type SpecBootstrapProvenance = "observado" | "derivado_macrobrief" | "inferido";

export interface LegacyProjectInventory {
  projectRoot: string;
  titulo: string; // package.json name ou pasta
  stack: string[];
  arquivosFonte: string[]; // relativos, / no path
  rotasApi: Array<{ caminho: string; arquivo: string }>;
  entidades: Array<{ nome: string; campos: Array<{ nome: string; tipo: string }> }>;
  modulos: Array<{
    id: string;
    nome: string;
    resumo: string;
    arquivos: string[];
    proveniencia: SpecBootstrapProvenance;
  }>;
  requisitos: Array<{
    id: string;
    titulo: string;
    criterio: string;
    origem: string; // literal para frontmatter: derivado: ... | premissa: ...
    proveniencia: SpecBootstrapProvenance;
  }>;
  macrobrief: {
    presente: boolean;
    specVersao: number | null;
    arquivosMacrobrief: string[];
    reqsMacrobrief: string[];
  };
  lacunas: Array<{
    tipo: "arquivo_sem_modulo" | "arquivo_sem_req" | "req_sem_criterio" | "rota_sem_arquivo" | "entidade_vazia";
    detalhe: string;
  }>;
}
```

Funções públicas mínimas:

1. `buildLegacyProjectInventory(projectRoot: string): LegacyProjectInventory`
2. `inventoryToCanonicalSpec(inventory: LegacyProjectInventory): string` → usa `renderCanonicalSpecDocument`
3. `renderSpecGapsReport(inventory: LegacyProjectInventory): string` → markdown curto para humano
4. `runSpecBootstrap(projectRoot: string): { inventory, spec, gaps, checkErrors: string[] }`
   - `checkErrors` = `checkSpecStructure` após parse; se falhar, **não** gravar spec como válida

**Status da Spec gerada:** sempre `status: aguardando_aprovacao` no YAML.

**origem nos REQs:** use prefixos já aceitos pelo harness (`derivado:`, `premissa:`). Arquivo visto no disco → `origem: "derivado: inventário mecânico do repositório"`. REQ vindo só de lista no macrobrief sem critério no código → `origem: "derivado: macrobrief REQ-xxx"` + `proveniencia: derivado_macrobrief`. Resumo de módulo inventado → `inferido` + premissa explícita.

---

## Extratores mecânicos (sem LLM)

Implemente em `src/core/intake/spec-bootstrap-extract.ts` (ou subpasta `spec-bootstrap/` se preferir, mas mantenha reader load baixo).

1. **Stack** — ler `package.json` dependencies/devDependencies; incluir Next.js, React, TypeScript, Prisma, Tailwind se presentes (strings literais do JSON).
2. **Arquivos** — caminhar `src/` e raiz do projeto; ignorar os mesmos dirs que `src/core/project/source-files.ts` (`node_modules`, `.git`, `.next`, `.nextcode`, etc.). Coletar `.ts`, `.tsx`, rotas `route.ts`, `page.tsx`, `prisma/schema.prisma`, Dockerfiles nomeados na spec-writer.
3. **Rotas API** — heurística App Router: `src/app/api/**/route.ts` → caminho `/api/...` (tratar `[id]` como `:id` ou `[id]` de forma consistente e documentar no comentário do teste).
4. **Entidades** — parse leve de `prisma/schema.prisma` (`model X { ... }`, campos primitivos e `?`); não precisa suportar todos os tipos Prisma, só os comuns.
5. **Macrobrief** — se existir `.nextcode/macrobrief.md`, usar `parseElicitadorMacrobrief`; fundir clusters → `modulos` (id do cluster, arquivos e reqs do YAML); **não** apagar arquivos do inventário que não estão no macrobrief (vão para `lacunas`).

**Módulos:** um por cluster do macrobrief quando existir; senão agrupar por prefixo (`src/lib/asaas` → módulo `integration`, etc.) com resumo genérico marcado `inferido`.

**Requisitos:** para cada `REQ-xxx` no macrobrief, criar entrada com `titulo` = id, `criterio` = `Implementar conforme arquivos do cluster` + caminhos reais se houver; se macrobrief lista REQ sem arquivo no disco, registrar lacuna `req_sem_criterio`.

---

## Artefatos no disco

Constante: `SPEC_GAPS_RELATIVE_PATH = ".nextcode/spec-gaps.md"`.

Nova função em `spec-file.ts` ou `spec-bootstrap-publish.ts`:

- `writeSpecBootstrapArtifacts(projectRoot, spec, gapsReport)`:
  - chama `writeCanonicalSpecFile` (só grava se parsear)
  - grava `spec-gaps.md` sempre que houver inventário (mesmo se spec falhar check)
  - retorna `{ specWrite, gapsPath }`

**Não** sobrescrever `spec.md` válido existente sem opt-in. Se `readCanonicalSpecFile` já devolver texto, `runSpecBootstrap` retorna `{ skipped: true, reason: "SPEC_JA_EXISTE" }` sem gravar.

---

## Integração mínima no harness

Escolha **uma** superfície (a mais simples que compile):

**Opção A (preferida):** rota `POST /api/projects/bootstrap-spec` body `{ projectId }` ou `{ path }` com auth local (`requireAuth`). Lê projeto do Prisma, roda `runSpecBootstrap`, se ok e projeto vinculado a sessão opcional não for escopo deste PR, só devolve JSON `{ spec, gaps, lacunasCount, checkErrors }`.

**Opção B:** comando npm `npm run bootstrap-spec -- <caminho>` script em `scripts/bootstrap-spec.mjs` que importa/builda o módulo (se ESM chato, use `tsx`/`ts-node` só se já existir no repo; senão Opção A).

**Telemetria:** `TelemetryLogger.log({ action: "SPEC_BOOTSTRAP", details: { arquivos, reqs, lacunas, gravou } })`.

**Não** chamar LLM neste PR.

---

## Skill (opcional neste PR)

Se sobrar tempo, esboço `skills/bootstrap-spec-from-repo/SKILL.md` curto:

- Gatilho: projeto legado, sem spec, com pasta cadastrada.
- Instrução: executar bootstrap via API/script, mostrar `spec-gaps.md`, pedir revisão humana antes de aprovar.
- `ferramentas: []` (harness faz o trabalho).

Skill sozinha sem código não conta como entrega.

---

## Testes (obrigatório)

Arquivo `tests/intake/spec-bootstrap.test.ts` com `fs.mkdtempSync` (padrão dos outros testes intake).

Cenários:

1. Mini projeto fake com `package.json`, um `route.ts`, `prisma/schema.prisma` com um model → `parseSpecDocument(spec) !== null`, `checkSpecStructure` vazio ou só avisos aceitáveis documentados.
2. Com macrobrief YAML mínimo (copiar estrutura de `renderElicitadorMacrobrief`) → módulos e REQ derivados.
3. Macrobrief + arquivo extra no disco não listado → lacuna `arquivo_sem_req` ou equivalente.
4. Se `spec.md` válido já existe → skip sem sobrescrever.
5. Projeto vazio → spec não parseia ou recusa gravar; gaps explicam.

Rodar: `npx vitest run tests/intake/spec-bootstrap.test.ts`

---

## Fora de escopo

- Browser, RES, REA, MCP externo.
- Elicitação conversacional, aprovação automática, criar DAG.
- Alterar `C:\projetos\nextpay` ou qualquer pasta fora do repo NextCode nos testes (só fixtures temp).
- Commit ou PR (o auditor cuida depois).

---

## Critérios de aceite (checklist do auditor)

- [ ] Tipos `LegacyProjectInventory` e funções públicas conforme acima.
- [ ] Spec gerada passa `parseSpecDocument` em fixture representativa.
- [ ] `writeCanonicalSpecFile` usado para publicar; gaps em arquivo separado.
- [ ] Macrobrief reutiliza `parseElicitadorMacrobrief`, não parser ad hoc divergente.
- [ ] Não sobrescreve spec válida existente.
- [ ] Testes intake passam; sem `any` desnecessário; imports `@/core/...`.
- [ ] Comentários só para não óbvios; sem narrativa de fase no código.

---

## Comandos de verificação

```bash
cd c:\projetos\nextcode
npx vitest run tests/intake/spec-bootstrap.test.ts tests/intake/spec-file.test.ts tests/intake/spec-sync.test.ts
npx tsc --noEmit
```

Opcional após implementar API: curl autenticado contra dev local (documentar no comentário do PR, não neste arquivo).

---

## Entrega esperada

1. Lista de arquivos criados/alterados.
2. Resumo de decisões (heurística de rotas, agrupamento de módulos).
3. Saída dos testes.
4. Exemplo de trecho do YAML gerado (fixture), não dump do NextPay real.

Fim do prompt.
