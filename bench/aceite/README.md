# Testes de aceite do bench (régua)

Escritos pelo **auditor (Claude)**, não pelo implementador nem pelo executor do NextCode (arquitetura §14.1: a régua não pode
ser gerada por quem é medido). Alterar só com registro em `docs/NEXTCODE-REFERENCIA.md` e no `memory/diario.md`.

- `rodar.mjs <pasta-do-projeto-gerado> <p1|p2|p3|p4>` — roda os testes e imprime **uma linha JSON por teste** e uma linha `RESUMO {...}`.
- `api-tarefas.mjs` — REQ-001..003 (P1 e P2); `tela-tarefas.mjs` — REQ-004 estático (P2). A tela em execução é coberta pelo `ui-check`.
- `auth.mjs` — P3, login com sessão (L1–L12: hash com sal, 400/409, token aleatório e novo a cada login, 401 igual para senha
  errada e e-mail inexistente, sessão por `Authorization: Bearer`, logout invalida o token, nada de senha/hash nas respostas).
- `correcao-tarefas.mjs` — P4, correção num projeto pronto (`bench/projetos/p4-base/`, com 3 bugs): A1–A10 + X1–X2 (o
  `GET /api/tarefas/[id]`, que já funcionava, não pode sumir nem quebrar).
- Specs do P3 e P4: `bench/specs/p3-p4.ts` (fazem parte da régua: mudou a Spec, prove a régua de novo).
- **Rodar de dentro da pasta do projeto** (o `tsx` lê o `tsconfig` da pasta atual para resolver `@/`); o contêiner já faz isso.
- `stub-next/` — substituto mínimo de `next/server` (`NextResponse.json`, `NextRequest`) para rodar as rotas **sem rede e sem
  `npm install`**. Limite: não reproduz recursos avançados do Next (cookies, headers mutáveis, `nextUrl`).
- Execução prevista: contêiner `docker/aceite` com `--network none` (código gerado por IA nunca roda no host).

Tolerâncias (para não punir formato aceitável): GET pode devolver o array ou `{ tarefas: [...] }` / `{ data: [...] }`; POST pode
devolver a tarefa ou `{ tarefa: {...} }` / `{ data: {...} }`; sucesso de PATCH/DELETE = qualquer 2xx (a Spec só fixa o 404).

Prova da régua (09/10, auditor): implementação de referência correta → 10/10 (P1) e 13/13 (P2); versões com um erro plantado
→ cada erro derruba exatamente o teste esperado (ver `memory/medicoes.md`).
Prova do P3/P4 (09/10, auditor): referência do P3 → 12/12; senha em texto → só L2; mensagens diferentes no login → só L8;
logout que não invalida → só L12; token fixo → só L9; registro devolvendo o hash → só L3. Base do P4 com bugs → 9/12 (caem A4,
A5, A8); correção certa → 12/12; correção que apaga o GET por id → 10/12 (caem X1, X2). P1/P2 sem mudança (ref 10/10, 13/13).
