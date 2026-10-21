# Ponto de retomada — 21/10/2026, antes de reiniciar a máquina

> Foto de "onde estamos" para voltar depois do reinício. Não é plano novo: a ordem continua só na `docs/NEXTCODE-REFERENCIA.md` §5.0 e o histórico no `memory/diario.md`. Ao retomar, leia este arquivo, depois a entrada mais nova do diário.

## 1. Onde estamos

- **Fase:** E1 (produção confiável), execução autônoma 3: o fundador delegou as decisões em 21/10. Todas as decisões estão em `docs/relatorios/DECISOES-AUTONOMAS-E1-3.md` (E1–E13, J1–J8) e na mudança 27 da referência.
- **Item atual da §5.0:** teste pesado, a porta da E1.
  - Spec real da sessão `8e2f2052` (Multi_Gateway).
  - Roda pelo `scripts/teste-pesado.ts`, com cópia do banco em `%TEMP%\nc-teste-pesado`. O `prisma/dev.db` nunca é escrito.
  - Para ser aprovado precisa de três coisas: ENTREGUE, no máximo 10 chamadas do executor em **cada** etapa e custo abaixo de US$ 18,78 (o da 1ª execução).
- **Depois do teste:** J2b + J2.7 (reparo automático da entrega reprovada, com desenho já decidido, J1–J8), depois TS1, depois o resto da E1 na §5.0 (PJ2, JV1, S3, AV1, J3, J4).

## 2. O que aconteceu com o teste pesado (nenhuma tentativa terminou)

| Tentativa | Sessão (cópia do banco) | Resultado | Causa |
|---|---|---|---|
| 1ª (20–21/10) | `d527f2bc` | parada por falta de memória: 3/53 etapas, US$ 0,60, 24 pausas sem LLM | máquina com 0,4 GB livres; FreeLLMAPI (Docker) sem responder |
| 2ª (21/10 06:13–06:49) | `314176ef` | parada à mão: 1/57 etapas (só a base, sem IA), 132 pausas sem LLM, ~US$ 0 | **Docker fechado → FreeLLMAPI fora do ar.** O executor só sai pelo FreeLLMAPI (`src/core/llm/paid-routing.ts`); o analista vai direto ao DeepSeek, por isso o planejamento funcionou |

Erro meu: eu disse que fechar o Docker não atrapalhava. O FreeLLMAPI é o contêiner `nextcode-freellmapi` do `docker-compose.yml` (porta 3100). Correção já feita no script: antes de começar, ele confere FreeLLMAPI e DeepSeek e para com uma mensagem clara se algum estiver fora do ar.

## 3. Como retomar depois do reinício (passo a passo)

1. Abrir o **Docker Desktop** e esperar subir.
2. Subir o FreeLLMAPI: `docker compose up -d freellmapi` (na pasta do projeto). Conferir que `http://localhost:3100/api/ping` responde.
3. Fechar o que não for usado (o VS Code ocupa ~300 MB). A máquina tem 7,7 GB e o teste dura horas.
4. Pedir ao Claude: "rode o teste pesado". Ele roda `npx tsx scripts/teste-pesado.ts`, que apaga a cópia anterior, começa do zero e gera `docs/relatorios/TESTE-PESADO-E1.md` no fim.
5. Com o relatório: conferir a porta (E4), ajustar J2b se o teste mostrar lacuna de outro tipo (J8), implementar J2b + J2.7.

## 4. Estado do git

- Último commit antes desta pausa: `19d3bcd` (PJ1.5).
- Este passo (192) faz um commit com as decisões, a mudança 27, o `scripts/teste-pesado.ts` com a checagem prévia, o diário 190–192 e este arquivo, se `tsc` e a suíte passarem (resultado no diário 192).
- Fora do commit: `.claude/.headroom_wrap_marker.json` e `.serena/project.yml` são das ferramentas e não são do projeto.
- Sobra para o fundador apagar: a pasta vazia `C:\projetos\nc-tr1-6` (junction) com `cmd /c rmdir C:\projetos\nc-tr1-6\node_modules && cmd /c rmdir C:\projetos\nc-tr1-6`.

## 5. Revisão da pasta `docs` (21/10) — o que achei

O que foi lido:
- a §5.0 inteira da referência;
- as decisões da execução autônoma 3;
- a lista de `relatorios/`, `prompts/`, `rascunhos/` e `specs/`;
- os pontos do código que o teste tocou.

`docs/terceiros/jev-docs` (114 arquivos, 2 MB) é material de terceiros e não foi relido.

| # | Achado | Gravidade | O que fazer |
|---|---|---|---|
| R1 | O executor depende do FreeLLMAPI (Docker), e nada no app avisa isso antes de executar: a sessão só vai acumulando `SESSION_PAUSED_NO_LLM` | alta | feito no script. No app, a aprovação da Spec deveria conferir a rota do executor antes de começar. Proposta para a §5.0 (junto do P7 "supervisor" ou como item próprio), **aguarda o fundador** |
| R2 | Na 2ª tentativa o analista gravou `LLM_COST` com `usd: 0` e `usage: null` (2 chamadas pagas ao DeepSeek) | média: a porta "custo < US$ 18,78" pode subcontar | investigar antes de dar a porta como aprovada; é uma linha do JV1/AV1 ou correção própria |
| R3 | `JEV_STATE_TOO_LARGE` no `m3_planejamento_microbriefs_lote` (29.260 > 24.000 caracteres) com 57 etapas | média | é o achado do JV1 (M2/M3 cortados); entra no JV1 |
| R4 | A linha B1b/AV1 da §5.0 diz que a porta do teste pesado é a **Spec sintética da Fase 8** (`c0377632`); a decisão E2 escolheu a **Spec real** `8e2f2052` | baixa (texto) | E2 vale para a porta da E1. A Spec sintética fica para medir o AV1, quando ele for feito |
| R5 | A linha AGORA dizia "D23 aguarda o fundador", mas a D23 foi decidida (E1 → TS1) | baixa | corrigido |
| R6 | O plano da 2ª tentativa teve 57 etapas (56 do analista + base); a 1ª teve 53 (54 na execução original) | informação | o tamanho do plano varia entre execuções; comparar o custo **por etapa**, não só o total |

## 6. Regras que valem ao retomar (do `CLAUDE.md`)

- A fonte única é a referência; toda melhoria entra nela antes de ser feita.
- Diário no topo a cada passo; um commit por passo com `tsc` + `vitest`.
- Não alucinar; nenhum segredo sai da máquina; o `prisma/dev.db` não é escrito.
- Teste parado por falta de memória **não** é reiniciado sem o fundador pedir.
