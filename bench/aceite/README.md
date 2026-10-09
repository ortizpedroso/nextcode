# Testes de aceite do bench (régua)

Escritos pelo **auditor (Claude)**, não pelo implementador nem pelo executor do NextCode (arquitetura §14.1: a régua não pode
ser gerada por quem é medido). Alterar só com registro em `docs/NEXTCODE-REFERENCIA.md` e no `memory/diario.md`.

- `rodar.mjs <pasta-do-projeto-gerado> <p1|p2>` — roda os testes e imprime **uma linha JSON por teste** e uma linha `RESUMO {...}`.
- `api-tarefas.mjs` — REQ-001..003 (P1 e P2); `tela-tarefas.mjs` — REQ-004 estático (P2). A tela em execução é coberta pelo `ui-check`.
- `stub-next/` — substituto mínimo de `next/server` (`NextResponse.json`, `NextRequest`) para rodar as rotas **sem rede e sem
  `npm install`**. Limite: não reproduz recursos avançados do Next (cookies, headers mutáveis, `nextUrl`).
- Execução prevista: contêiner `docker/aceite` com `--network none` (código gerado por IA nunca roda no host).

Tolerâncias (para não punir formato aceitável): GET pode devolver o array ou `{ tarefas: [...] }` / `{ data: [...] }`; POST pode
devolver a tarefa ou `{ tarefa: {...} }` / `{ data: {...} }`; sucesso de PATCH/DELETE = qualquer 2xx (a Spec só fixa o 404).

Prova da régua (09/10, auditor): implementação de referência correta → 10/10 (P1) e 13/13 (P2); versões com um erro plantado
→ cada erro derruba exatamente o teste esperado (ver `memory/medicoes.md`).
