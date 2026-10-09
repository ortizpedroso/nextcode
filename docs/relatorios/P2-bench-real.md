# Relatório P2 — `npm run bench`: Medição real com testes de aceite em contêiner sem rede

## 1. Identificação
- **Hash de partida:** `ffb0b463abfd96ba59d67e2cc425129816b46977`
- **Log dos commits:**
  ```text
  925ba54 docs(bench): primeira rodada
  53b62ae feat(bench): P2.2 - npm run bench com variantes e testes de aceite
  a559364 feat(bench): P2.1 - conteiner de aceite sem rede
  ```

---

## 2. Detalhamento por Commit

### Commit 1: `a559364` — `feat(bench): P2.1 - conteiner de aceite sem rede`
- **Diffstat:**
  ```text
  docker/aceite/Dockerfile | 10 ++++++++++
  docker/aceite/README.md  | 22 ++++++++++++++++++++++
  docker/aceite/run.sh     | 20 ++++++++++++++++++++
  3 files changed, 52 insertions(+)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  90 passed (90)
       Tests  646 passed (646)
    Duration  134.11s
  ```

### Commit 2: `53b62ae` — `feat(bench): P2.2 - npm run bench com variantes e testes de aceite`
- **Diffstat:**
  ```text
  package.json                        |   1 +
  scripts/bench.ts                    | 687 ++++++++++++++++++++++++++++++++++++
  tests/bench/bench-relatorio.test.ts | 131 +++++++
  3 files changed, 819 insertions(+)
  ```
- **Saída do `npx tsc --noEmit`:** 0 erros
- **Linha final do `npx vitest run`:**
  ```text
  Test Files  91 passed (91)
       Tests  649 passed (649)
    Duration  141.35s
  ```

### Commit 3: `925ba54` — `docs(bench): primeira rodada`
- **Diffstat:**
  ```text
  docs/relatorios/bench/2026-10-09-0713.md   |  57 ++++++
  docs/relatorios/bench/2026-10-09-0713.yaml | 292 +++++++++++++++++++++++++++++
  2 files changed, 349 insertions(+)
  ```

---

## 3. Prova do Contêiner (P2.1, item 4)

### A. Prova de bloqueio de rede (`--network none`)
Comando:
```bash
docker run --rm --network none --entrypoint /bin/sh nextcode-aceite:1 -c "getent hosts registry.npmjs.org || echo 'REDE_BLOQUEADA_COM_SUCESSO'"
```
Saída bruta:
```text
REDE_BLOQUEADA_COM_SUCESSO
```

### B. Prova dos testes de aceite executados no contêiner
Comando executado contra projeto P1 gerado:
```bash
docker run --rm --network none --memory=1g --cpus=1 --pids-limit=256 --cap-drop=ALL --security-opt=no-new-privileges -v "<projectDir>:/project:ro" -v "C:/projetos/nextcode/bench/aceite:/aceite:ro" nextcode-aceite:1 p1
```
Saída bruta com 10 linhas JSON e linha `RESUMO`:
```text
{"id":"A1","req":"REQ-001","nome":"src/lib/tarefas.ts exporta listarTarefas, criarTarefa, atualizarTarefa, removerTarefa","ok":true,"detalhe":""}
{"id":"A2","req":"REQ-002","nome":"GET /api/tarefas → 200 com lista","ok":true,"detalhe":""}
{"id":"A3","req":"REQ-002","nome":"POST titulo válido → 201 com a tarefa (id, titulo, concluida=false, criadaEm)","ok":true,"detalhe":""}
{"id":"A4","req":"REQ-002","nome":"POST titulo vazio → 400","ok":true,"detalhe":""}
{"id":"A5","req":"REQ-002","nome":"POST sem titulo → 400","ok":true,"detalhe":""}
{"id":"A6","req":"REQ-002","nome":"GET depois do POST contém a tarefa criada","ok":true,"detalhe":""}
{"id":"A7","req":"REQ-003","nome":"PATCH id existente (concluida=true) → 2xx e a lista reflete","ok":true,"detalhe":""}
{"id":"A8","req":"REQ-003","nome":"PATCH id inexistente → 404","ok":true,"detalhe":""}
{"id":"A9","req":"REQ-003","nome":"DELETE id existente → 2xx e some da lista","ok":true,"detalhe":""}
{"id":"A10","req":"REQ-003","nome":"DELETE id inexistente → 404","ok":true,"detalhe":""}
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
```

---

## 4. Tabela das 6 Execuções Reais (Copiada do Relatório do Bench)

Arquivo de origem: `docs/relatorios/bench/2026-10-09-0713.md`

| Projeto | Variante | Rep | Fase | Tempo (s) | Etapas | 1ª Tent. | Tent. Totais | tsc | UI Check | Aceite | Custo Total (US$) | Exec / Eval / Jev | Jev Calls | Avaliador Models |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | padrao | 1 | ENTREGUE | 162.3 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | 0.0265 | 0.0262 / 0.0000 / 0.0003 | 3 | ollama/nemotron-3-ultra |
| P1 | sem-jev | 1 | ENTREGUE | 176.2 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | 0.0303 | 0.0303 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P1 | avaliador-deepseek | 1 | ENTREGUE | 168.3 | 3 | 3 | 0 | 0 (ok) | ausente | 10/10 | 0.0521 | 0.0344 / 0.0175 / 0.0003 | 3 | custom/deepseek-v4-pro |
| P2 | padrao | 1 | ENTREGUE | 536.5 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | 0.1078 | 0.0994 / 0.0080 / 0.0004 | 4 | ollama/nemotron-3-ultra, custom/deepseek-v4-pro |
| P2 | sem-jev | 1 | ENTREGUE | 471.0 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | 0.0886 | 0.0886 / 0.0000 / 0.0000 | 0 | ollama/nemotron-3-ultra |
| P2 | avaliador-deepseek | 1 | ENTREGUE | 349.8 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | 13/13 | 0.1013 | 0.0646 / 0.0362 / 0.0004 | 4 | custom/deepseek-v4-pro |

### Trecho Bruto de Cada `RESUMO` do Aceite

#### P1 - padrao (Rep 1)
```text
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
```

#### P1 - sem-jev (Rep 1)
```text
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
```

#### P1 - avaliador-deepseek (Rep 1)
```text
RESUMO {"projeto":"p1","total":10,"aprovados":10,"reprovados":0}
```

#### P2 - padrao (Rep 1)
```text
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
```

#### P2 - sem-jev (Rep 1)
```text
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
```

#### P2 - avaliador-deepseek (Rep 1)
```text
RESUMO {"projeto":"p2","total":13,"aprovados":13,"reprovados":0}
```

---

## 5. Desvios do Prompt
Nenhum.

---

## 6. Checklist das Travas (T-A … T-M)
- **T-A Pré-condição:** Cumprida. O `git status` inicial continha apenas `.claude/` e o commit `HEAD` correspondia àquele especificado no prompt (`ffb0b463abfd96ba59d67e2cc425129816b46977`).
- **T-B Escopo fechado:** Cumprida. Nenhum arquivo de `bench/aceite/` foi modificado. Nenhum arquivo em `src/` foi alterado.
- **T-C Literalidade:** Cumprida. Nomes das variantes (`padrao`, `sem-jev`, `avaliador-deepseek`), métricas coletadas e regras de isolamento seguidas com exatidão.
- **T-D Nomes reais:** Cumprida. Validação estrita de todos os identificadores.
- **T-E Um passo = um commit:** Cumprida. Commits incrementais com compilação e suíte de testes 100% verdes em cada estágio.
- **T-F Banco:** Cumprida. Cada uma das 6 execuções utilizou uma cópia nova temporária de `prisma/dev.db`.
- **T-G Segredos:** Cumprida. Nenhuma chave secreta exposta em arquivos ou relatórios.
- **T-H Dependências:** Cumprida. Nenhum pacote novo adicionado em `package.json` (`tsx` instalado globalmente no Dockerfile do contêiner).
- **T-I Fim de linha:** Cumprida. Arquivos novos gravados com terminação LF.
- **T-J Paradas obrigatórias:** Cumprida. Nenhuma execução individual excedeu US$ 0,50 (máximo individual foi US$ 0.1078 no P2 padrão). Custo acumulado total das 6 execuções foi de US$ 0.4065, bem abaixo do teto global de US$ 1,50.
- **T-K Commits:** Cumprida. Todos os commits encerram com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel:** Cumprida. Todos os números e tabelas foram copiados fidedignamente das saídas brutas do benchmark e contêiner.
- **T-M Código gerado nunca roda no host:** Cumprida. A validação de aceite de todos os 6 projetos gerados rodou estritamente dentro do contêiner Docker `nextcode-aceite:1` com `--network none` e `--cap-drop=ALL`.

---

## 7. Dúvidas Abertas
Nenhuma. Todos os 6 testes completaram com 100% de aprovação nos critérios de aceite (P1: 10/10, P2: 13/13), tsc com 0 erros, fase `ENTREGUE` em todas as variantes, e UI Check aprovado no P2.
