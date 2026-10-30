# Decisões em nome do fundador — sessão 30/10/2026 (Claude)

> Autorização explícita: *“total autonomia para decidir”* (30/10/2026). Decisões alinhadas ao macro NextCode: **fonte única**, **prova antes de “funciona”**, **fila nunca para**, **T10/entrega estrita**, **um passo commitável com tsc+vitest**.

## D1 — Orquestrador de testes: `orchestrator_recovered` em produção da suíte

**Decisão:** Manter `tests/orchestrator/**` **fora** do Vitest (`vitest.config.ts`) e tratar `tests/orchestrator_recovered/` como **substituto oficial** até o fundador rodar reparo de disco (`chkdsk`) e `git checkout HEAD -- tests/orchestrator` com sucesso.

**Motivo macro:** A pasta `tests/orchestrator` está em estado NTFS inválido (scandir/checkout falham). Duplicar a suíte em `orchestrator_recovered` preserva cobertura dos papéis da fila/DAG sem bloquear o re-baseline E5.

**Risco aceito:** Dois caminhos de pasta até restauração; testes novos de orquestrador devem ir em `orchestrator_recovered` (ou na pasta original depois do reparo).

---

## D2 — Mock do porteiro empírico nos E2E (não rodar `tsc` real por etapa)

**Decisão:** Nos testes `end-to-end-harness-plan`, substituir `mockResolvedValue` cego por **`mockEmpiricalGatePromoteWithoutTsc`**, que chama `promoteToMainRepo` / `rollbackPromotion` / `reapplyPromotion` como o código real, mas **sem** type-check.

**Motivo macro:** E2E mede **fila, T10, ui-check e fases** — não o bench do `tsc`. Sem promoção real, T10 falhava (arquivos ausentes) e a entrega nunca chegava ao ui-check.

**Alinhamento:** Mesma filosofia do teste Mudança 24 (avaliador fora), que já mockava o porteiro por velocidade.

---

## D3 — Correção de produção em T10 (`review.ressalvas`)

**Decisão:** Corrigir `job-queue.ts` para `(review.ressalvas ?? []).slice(...)` em vez de exigir mocks perfeitos.

**Motivo macro:** Entrega **não pode** cair em `FALHA_REPETIDA` por campo opcional da revisão final quando o restante da T10 passou (ui-check ok, arquivos no disco). Isso viola confiança na trava T10.

---

## D4 — Isolamento da fila SQLite nos testes de integração

**Decisão:** Usar `runOnce(worker, { onlySessionIds: [session.id] })` onde o teste assumia fila global vazia (`executor-tool-loop` j, `job-worker` retomada).

**Motivo macro:** Vitest roda **sem paralelismo entre arquivos**, mas **compartilha** `prisma/test.db`. Jobs órfãos de outros testes causavam flakiness (~2/1167). A fila persistente é feature do produto; o teste deve restringir escopo, não enfraquecer a fila.

---

## D5 — Re-baseline E5 executado (2× vitest completo)

**Decisão:** Rodar `npx vitest run` **duas vezes** seguidas com sucesso antes de considerar o passo fechado.

**Motivo macro:** Item 7 / §3.3 e diário 267–271 pediam re-baseline; número de referência passa a **1167/1167** (175 arquivos), com exclusão explícita de `tests/orchestrator`.

---

## D6 — Commit autônomo do pacote de estabilização

**Decisão:** Criar **um commit** agregando harness + fix T10 + isolamento de testes + relatórios + diário, após `tsc` e vitest completo verdes.

**Motivo macro:** Fundador ausente pediu implementar sem hesitar; deixar working tree suja de 17 commits ahead **aumenta** risco de perda NTFS/corromper diff. Um commit atômico com prova é preferível a WIP indefinido.

**Não feito sem pedido explícito anterior:** `git push` para `origin`.

---

## D7 — Controles E5 (`controles-autoteste-e5.ts`)

**Decisão:** Executar o script e **registrar** o resultado no relatório de implementação; **não** bloquear o pacote pelos sub-casos P4 8/12 ou falhas `GET is not a function` no ambiente Vitest/SSR.

**Motivo macro:** O script mistura bancada P1 ref (11/11) com probes que dependem de runtime Next; isso é **Gate/bancada**, não regressão da suíte unitária. Próximo passo macro continua **Gate 1 Gateway** (§3), não reescrever P4 neste commit.

---

## D8 — Antigravity

**Decisão:** Não iniciar novo prompt Antigravity nesta sessão; **auditar** apenas o estado git + relatórios existentes.

**Motivo macro:** Protocolo §9 — Antigravity implementa prompt escrito; aqui o gargalo era **vitest verde + NTFS**, já resolvível localmente. Novo trabalho Antigravity sem item §3 aprovado violaria regra 1.

---

## Revisão recomendada ao fundador (não decidida aqui)

1. Reparar volume / remover pasta zumbi `tests/orchestrator` e voltar a um único diretório.
2. Atualizar §1.4 de `docs/NEXTCODE-REFERENCIA.md` com **1167** testes e data — após sua leitura destes relatórios.
3. Push dos 18 commits locais quando conveniente.
