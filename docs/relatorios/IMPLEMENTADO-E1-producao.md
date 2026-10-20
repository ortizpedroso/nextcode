# Implementado — execução autônoma 2 (mudança 26, subir para produção)

Implementador: Claude. Hash de partida: `54b8c19`. Decisões tomadas em nome do fundador: `docs/relatorios/DECISOES-AUTONOMAS-E1-2.md` (D1–D41).
Base: teste real `8e2f2052` — 1.724 chamadas do executor, 548 pausas `SEM_LLM`, 52 relatórios recusados, 35 autorizações de teto, US$ 18,78.

## 1. Identificação (§8.4)
`git log --oneline 54b8c19..014d816` — 1 commit por passo, cada um com tsc e vitest daquele commit e entrada no diário. `git diff --stat`: 41 arquivos, +2.200 / −250. `git reflog`: 0 amend/reset/rebase.

| hash | passo | tsc | vitest (arquivos/testes) |
|---|---|---|---|
| `fbda610` | P1 várias ações por turno (TR1 12) | 0 | 131 / 871 de 878 — 7 estouros de 15 s, falham igual sem a mudança |
| `c77196f` | P2 contexto fixo no 1º prompt (TR1 13) | 0 | 131 / 868 de 880 — 12 estouros de tempo; passam isolados |
| `9d9b07a` | P3 retentativa parte do código anterior (TR1 14) | 0 | 131 / 882 |
| `e5fcda7` | P4 relatório aceita lista de referências (TR1 3) | 0 | 131 / 884 |
| `aa808dd` | P5 oscilação repete o turno; pausa guarda progresso (TR1 1) | 0 | 131 / 887 |
| `c074f1f` + `d050322` | P6 regra do harness = dono harness (TR1 2); timeout dos e2e | 0 | 131 / 887 de 889 — 2 estouros, passam isolados (motivo do D23) |
| `57f2119` | P7 só `critico` reprova (TR1 11) | 0 | 131 / 889 |
| `ff316e7` | P8 cache de prompt no avaliador (TR1 9) | 0 | 132 / 893 |
| `70e4b6b` | P9 teto pelo plano, 1 autorização (TR1 4) | 0 | 132 / 896 |
| `5ce95d0` | P10 placar nas mensagens (TR1 5) | 0 | 133 / 899 |
| `e677318` | P11 M2 fora do chat; Graphify só com código (mudança 25) | 0 | 134 / 901 |
| `d73f945` | P12 trava de pasta-mãe (PJ2) | 0 | 135 / 906 |
| `49598bc` | P13 bench mede chamadas/ações por etapa | 0 | 135 / 906 |
| `014d816` | correção do P4 na Lente 2 (achada no bench) | 0 | 136 / 908 |
| `835e98f` | limite de tempo do gateway no turno do executor (achado no bench) | 0 | 136 / 909 |

## 2. O que mudou, por passo

- **P1** `executor-tool-loop.ts`: `parseExecutorToolActions` (lista de até 8 ações num bloco `json acao`, ou vários blocos); laço executa na ordem, devolve tudo numa mensagem; teto de 48 mil caracteres por turno; `finish` só sozinho; `acoesNoTurno` na trilha; prompt e 4 skills de executor.
- **P2** `node-executor.ts`: `buildExecutorFixedContext` (tsconfig, `prisma/schema.prisma`, `lerContratos` que faltavam); bloco das dependências pula arquivo grande em vez de parar.
- **P3** `codigoTentativa` no resultado da etapa reprovada (nunca se a guarda de segredos reprovou); retentativa recebe o código no prompt e já gravado na quarentena (`seedFiles`).
- **P4** `artifact-templates.ts`: `parseFileLineRefList`; lista YAML no campo não vira REQ vazio; REQ repetido é juntado; cada referência conferida. **Correção `014d816`:** a Lente 2 também passou a ler a lista.
- **P5** `dispatchOneTurn` + repetição do mesmo turno (5 s, 20 s; `EXECUTOR_TURN_RETRY`); pausa grava `pausado: true` + código, a retomada parte dele.
- **P6** `harnessDenials`: caminho protegido dentro do escopo (ou executor sem escrita) negado ≥ 2× → BLOQUEADA sem gastar tentativa, "Dono: harness" (`HARNESS_RULE_BLOCK`).
- **P7** `dual-lens-auditor.ts`: só `critico` reprova; `importante` → ressalva + `correcoesSugeridas`; `fatoQueGarante` / `nivelProva` registrados; skills `avaliador` e `avaliador-frontend`.
- **P8** `evaluator-models.ts`: `buildAnthropicCachedBody` (system + Brief com `cache_control`, 5 min); `cost.ts` cobra escrita no cache a 1,25×.
- **P9** `budget-guard.ts`: teto = max(US$ 0,50; etapas × 0,35 × 1,5) + autorizado; sugestão = etapas restantes, de uma vez (mensagem e botão).
- **P10** `session-scoreboard.ts`: placar no relatório de incidente, na pausa e no teto; painel com `#n` na ordem do plano e "rodando agora".
- **P11** `chat/route.ts`: aviso M2 → `SPEC_CLARITY_SHADOW`; Graphify e `temCodigoExistente` só com ≥ 5 arquivos-fonte (`source-files.ts`).
- **P12** `folder-safety.ts`: DELETE com `apagarPasta` e POST de projeto recusam (409) pasta-mãe, sem diferenciar maiúsculas no Windows.
- **P13** `nodeId` no `LLM_COST` do executor (antes o bench mostrava US$ 0 do executor por etapa); `scripts/bench.ts` com chamadas, ações e tentativas por etapa e média contra a meta ≤ 10.

## 3. Prova real (bench) — meta do TR1 atingida
Rodada `npm run bench -- --projetos p1,p2,p3,p4 --variantes padrao --repeticoes 1`, 20/10 (`docs/relatorios/bench/2026-10-20-1244.md`), e P2 de novo depois da correção `835e98f` (`2026-10-20-1314.md`):

| Projeto | Fase | Aceite | Custo | Chamadas do executor por etapa (média / máx.) | Aprovadas na 1ª |
|---|---|---|---|---|---|
| P1 | ENTREGUE | 10/10 | US$ 0,0675 | 2,5 / 3 | todas |
| P2 | ENTREGUE | 13/13 | US$ 0,2134 | 2,8 / 4 | todas |
| P3 | ENTREGUE | 12/12 | US$ 0,1243 | 2,5 / 3 | todas |
| P4 | ENTREGUE | 12/12 | US$ 0,0612 | 4 / 4 | todas |

Comparação: teste real `8e2f2052` — 1.724 chamadas do executor, US$ 18,78. Meta TR1 ≤ 10 por etapa: **máximo medido 4**. Cache do avaliador (P8) ativo: ex. 3.236 tokens lidos do cache e 1.713 gravados numa avaliação do P2.

**Defeitos achados pelo bench e corrigidos:**
- `014d816` (D41): Lente 2 lia uma referência só → P2 BLOQUEADA 0/13 na 1ª rodada.
- `835e98f` (D42): o turno do executor cortava no gateway em 120 s (padrão do `callGateway`) mesmo com 300 s por etapa. A tela do P2 (`deepseek-v4-pro`) passou de 120 s, o FreeLLMAPI pôs a rota em espera (~85 s, HTTP 429) e as repetições do turno pausaram a sessão (SEM_LLM) — igual em 2 rodadas. Agora o executor passa `gatewayTimeoutMs: stepTimeoutMs`, como o analista. Teste falha sem a correção; suíte 136/909 verde.

## 4. O que não foi feito / continua aberto
- Ganho do cache (P8) em dinheiro: confirmado que funciona; o tamanho da economia só aparece em sessão longa (5 min de validade), não num bench de 1 rodada.
- Ficam para depois, sem mudança (mudança 26): JV1 completo, redesenho do Jev na Spec (E2), A1, J3, E5, fechar-com-retomada na tela (PJ2b); TR1 (6) e (7).
