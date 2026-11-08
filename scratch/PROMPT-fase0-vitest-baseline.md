# Prompt: Fase 0 — vitest verde no HEAD (harness antes de produção)

**Fonte única:** `docs/NEXTCODE-REFERENCIA.md` §1.7, §3.0.2 Fase 0, §3.3 item 7.

**Repositório:** `c:\projetos\nextcode` apenas. **Não** afrouxar asserções só para passar. **Não** editar projeto alvo NextPay. **Um commit por arquivo de teste ou por causa raiz compartilhada** quando a mesma raiz explica vários testes.

## Objetivo

Fechar a porta: `npx vitest run` **verde 2× consecutivas** no HEAD, para o CI (`.github/workflows/ci.yml`) voltar a ser verdade no doc §3.3 item 7.

## Baseline de entrada (medida 08/11/2026)

- **1236** pass / **55** fail / **1291** testes, **12** arquivos falhando, exit 1.
- Subconjunto intake levantador: **verde** (não regredir).

## Ordem sugerida de ataque

1. `tests/orchestrator_recovered/characterization.test.ts` e `a1-contrato-travado.test.ts` (executor/fila).
2. `tests/harness/end-to-end-harness-plan.test.ts` (E2E harness).
3. `tests/skills/executor-tool-loop.test.ts` (J20).
4. `tests/intake/mega-stress-e1-e5.test.ts`, `tests/decision/a3-failure-routing.test.ts`, `tests/memory/project-memory.test.ts`.

Para cada arquivo: rodar isolado, corrigir **código ou teste** conforme a causa (fix root em `src/` preferido; atualizar expectativa só se comportamento atual é o contrato aprovado na referência).

## Regras

- Sem `describe.skip` em massa.
- Sem mudar `execution-trigger` guards para “passar”.
- Registrar número final em `memory/medicoes.md` (uma linha com data) e atualizar §1.7 / §3.3 item 7 se fechar.

## Verificação

```bash
cd c:\projetos\nextcode
npx vitest run
npx tsc --noEmit
```

Rodar vitest **duas vezes** antes de declarar fechado.

## Entrega

Lista de commits, saída completa das 2× vitest, e uma frase sobre a causa raiz do maior cluster (`orchestrator_recovered` vs E2E).
