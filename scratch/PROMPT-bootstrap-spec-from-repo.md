# Prompt de implementação (outra LLM)

Copie tudo entre `---INÍCIO---` e `---FIM---` para o implementador. O auditor (sessão separada) usa a seção **Auditoria** no fim deste arquivo.

---INÍCIO---

## Papel

Você implementa no repositório **NextCode** (`c:\projetos\nextcode`) o **bootstrap mecânico de Spec canônica** a partir de um projeto com código-fonte no disco. Não é engenharia reversa de SaaS no browser (RES). Não é MCP/binário (REA). É harness: inventário tipado → documento que `parseSpecDocument` aceita → publicação em `.nextcode/spec.md`.

## Objetivo do produto

Quando uma sessão está ligada a um projeto (ex.: NextPay em `C:\projetos\nextpay`) **sem** `.nextcode/spec.md` e **sem** `canonicalSpec` útil, o operador precisa **reconstruir o documento central** sem inventar YAML no chat. O bootstrap:

1. Lê evidências no disco (macrobrief, rotas, prisma, package.json).
2. Monta uma **Spec candidata** no formato canônico existente.
3. Grava **lacunas e confiança** em artefato separado (não misturar prosa de dúvida na Spec).
4. Opcionalmente publica `.nextcode/spec.md` e hidrata a sessão (reuso do que já existe).

## Regra macro (inegociável)

- **Não edite o projeto alvo à mão** (NextPay) para “fazer passar”. Só grave em `.nextcode/` do projeto alvo quando o operador disparar o bootstrap.
- **Não afrouxe** `parseSpecDocument`, `checkSpecStructure` nem aprovação T1.
- **Não adicione** dependência npm de RES, REA ou browser automation.
- Diff **mínimo**: reutilize módulos existentes; não refatore o chat inteiro.

## O que já existe (não reimplementar)

| Módulo | Função |
|--------|--------|
| `src/core/intake/spec-format.ts` | `parseSpecDocument`, `renderCanonicalSpecDocument`, tipos `ParsedSpec`, `SpecFrontmatterInput` |
| `src/core/intake/spec-check.ts` | `checkSpecStructure` |
| `src/core/intake/spec-file.ts` | `writeCanonicalSpecFile`, `readCanonicalSpecFile`, `CANONICAL_SPEC_RELATIVE_PATH` = `.nextcode/spec.md` |
| `src/core/intake/spec-sync.ts` | `reconcileProjectSpecDocument`, `assessProjectSpecArtifacts`, `parseElicitadorMacrobrief` **não** está aqui |
| `src/core/intake/macrobrief-elicitador.ts` | `parseElicitadorMacrobrief`, `renderElicitadorMacrobrief` |
| `src/core/project/source-files.ts` | `countSourceFiles`, `hasExistingSourceCode`, `IGNORED_DIRS` |
| `src/app/api/chat/route.ts` | Já chama `reconcileProjectSpecDocument` ao abrir mensagem |
| `tests/intake/spec-file.test.ts`, `spec-sync.test.ts` | Padrão de teste (vitest, `fs.mkdtempSync`) |

## Modelo de dados (implementar em TypeScript)

Crie `src/core/intake/spec-bootstrap.ts` (e tipos exportados) com:

```ts
/** Uma evidência observada no disco, sem interpretação LLM. */
export type BootstrapEvidenceKind =
  | "macrobrief"
  | "package_json"
  | "prisma_schema"
  | "app_router_route"
  | "source_file";

export interface BootstrapGap {
  /** Ex.: arquivo_no_disco_sem_macrobrief, req_sem_criterio, rota_sem_arquivo */
  id: string;
  severidade: "bloqueio_aprovacao" | "revisao_humana" | "informativo";
  mensagem: string;
  paths?: string[];
}

export interface LegacyProjectInventory {
  projectRoot: string;
  titulo: string; // package.json name ou pasta
  stack: string[];
  arquivosAfetados: string[];
  rotas: { caminho: string; descricao: string; arquivo: string; origem: BootstrapEvidenceKind }[];
  modulos: {
    id: string;
    nome: string;
    resumo: string;
    arquivos: string[];
    origem: BootstrapEvidenceKind;
  }[];
  entidades: { nome: string; campos: { nome: string; tipo: string }[]; origem: BootstrapEvidenceKind }[];
  requisitos: {
    id: string;
    titulo: string;
    criterio: string;
    origem: string; // "derivado: macrobrief REQ-00N" | "derivado: rota /api/..." | "inferido: ..."
  }[];
  gaps: BootstrapGap[];
  macrobriefSpecVersao: number | null;
}
```

Funções públicas obrigatórias:

1. `buildLegacyProjectInventory(projectRoot: string): LegacyProjectInventory`
   - Falha fechada se `projectRoot` inválido ou sem código (`hasExistingSourceCode` false).
   - Se existir `.nextcode/macrobrief.md`, usar `parseElicitadorMacrobrief` e **fundir** clusters → `modulos` + `arquivosAfetados` + seeds de `requisitos` (um REQ por id listado no macrobrief; `criterio` mínimo citando arquivo do cluster quando houver).
   - Varredura mecânica: `src/app/**/route.ts` → rotas HTTP (método GET/POST inferido opcional na descrição); caminho público a partir do segmento App Router.
   - Ler `package.json` → `stack` (dependencies: next, react, prisma, tailwind, typescript, etc., nomes legíveis).
   - Ler `prisma/schema.prisma` → `entidades` (modelos `model X { ... }`, campos com tipos Prisma simplificados para string).
   - Listar arquivos `.ts`/`.tsx` sob `src/` (teto razoável, ex. 400 paths, respeitar `IGNORED_DIRS` + `.nextcode`) → comparar com macrobrief; paths extras viram `gaps` (não inventar módulo LLM).

2. `inventoryToCanonicalSpec(inventory: LegacyProjectInventory): string`
   - Usar `renderCanonicalSpecDocument` com `status: "aguardando_aprovacao"`, `data` ISO hoje.
   - `objetivo`: uma frase factual (“Spec reconstruída do código e do macrobrief em disco; requer revisão humana.”).
   - `notas_implementacao`: incluir linha fixa `Bootstrap mecânico NextCode; não aprovada automaticamente.`
   - Garantir que o resultado passe `parseSpecDocument` e `checkSpecStructure` **ou** retornar erro estruturado com lista de gaps de bloqueio (não gravar Spec inválida).

3. `renderBootstrapGapsReport(inventory: LegacyProjectInventory): string`
   - Markdown curto para `.nextcode/spec-gaps.md` (seções: Resumo, Lacunas por severidade, Arquivos órfãos, Próximo passo humano).

4. `bootstrapProjectSpec(projectRoot: string): { ok: true; spec: string; gapsPath: string } | { ok: false; reason: string; gaps?: BootstrapGap[] }`
   - Orquestra inventário → spec → `writeCanonicalSpecFile` + grava `spec-gaps.md`.
   - **Não** chama LLM nesta entrega.

Constante: `BOOTSTRAP_GAPS_RELATIVE_PATH = ".nextcode/spec-gaps.md"`.

## Gatilho de uso (escolha uma opção, prefira A)

**A (recomendado):** API `POST /api/projects/bootstrap-spec` body `{ projectId }` ou `{ path }` (auth igual às outras rotas de projeto). Resposta JSON com `spec`, `gaps`, `wroteSpecFile`, erros `checkSpecStructure`.

**B:** Script `scripts/bootstrap-spec.mjs <caminho-absoluto>` para CI/local, imprime resumo e exit code 1 se gaps de bloqueio.

Implemente **A + B** se couber no mesmo PR sem inflar; senão só **A**.

Se houver sessão ativa com `projectId`, após bootstrap chame `reconcileProjectSpecDocument` (import de `spec-sync.ts`) para hidratar sessão.

## Skill (opcional, só se sobrar tempo)

`skills/bootstrap-spec-from-repo/SKILL.md` mínimo: descrição “Use quando o projeto tem código e não tem `.nextcode/spec.md`”; instrua a chamar a API ou o script; **proibir** browser/clone SaaS. Sem ferramentas externas.

## Testes obrigatórios

Arquivo `tests/intake/spec-bootstrap.test.ts`:

- Projeto temporário com `package.json`, um `route.ts`, macrobrief YAML mínimo válido (copiar shape de `parseElicitadorMacrobrief` tests / NextPay reduzido).
- `buildLegacyProjectInventory` encontra rota e arquivos do macrobrief.
- `inventoryToCanonicalSpec` + `parseSpecDocument` não null.
- Arquivo sob `src/` **fora** do macrobrief gera gap `arquivo_orfao` (ou id equivalente).
- `bootstrapProjectSpec` grava `.nextcode/spec.md` e `spec-gaps.md`.
- Spec rejeitada (projeto vazio) → `ok: false`, sem escrever spec.md.

Rode: `npx vitest run tests/intake/spec-bootstrap.test.ts`

## Fora de escopo neste PR

- Chamada LLM para resumos de módulo.
- Integração RES/REA.
- Alterar fase da máquina de estados além de hidratar `canonicalSpec` via reconcile.
- Graphify obrigatório no bootstrap.

## Estilo

- Comentários só para invariantes não óbvios.
- Mesmo padrão de imports `@/core/...` do repo.
- Português nas strings user-facing; identificadores em inglês ou português consistente com `spec-format.ts`.

## Entrega

1. Lista de arquivos criados/alterados.
2. Saída do vitest.
3. Uma frase: o que o operador faz no UI para bootstrapar NextPay após merge.

---FIM---

---

## Auditoria (para a LLM auditora, não enviar ao implementador)

Verificar:

1. **Premissa macro:** nenhum arquivo em `C:\projetos\nextpay` fora de `.nextcode/` alterado nos testes ou exemplos.
2. **Boundary:** Spec gravada sempre passa `parseSpecDocument`; ensaio nunca vira `spec.md`.
3. **Junção única:** não há segundo pipeline de “merge markdown”; só `inventoryToCanonicalSpec` → `renderCanonicalSpecDocument`.
4. **Macrobrief:** `parseElicitadorMacrobrief` reutilizado, não parser YAML paralelo.
5. **Gaps:** REQ com `origem` explícita; lacunas em `spec-gaps.md`, não espalhadas no chat.
6. **Idempotência:** rodar bootstrap duas vezes não corrompe spec (compare conteúdo ou `wrote: false` do `writeCanonicalSpecFile`).
7. **Testes:** comportamento observável, não mocks internos frágeis.
8. **Escopo:** diff enxuto; sem refatoração colateral em `chat/route.ts` além do wire mínimo da API.

Reproduzir localmente em pasta temp antes de aprovar. NextPay real só como teste manual opcional do operador, não commitado.
