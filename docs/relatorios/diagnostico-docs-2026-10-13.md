# Diagnóstico da pasta `docs/` — 13/10/2026 (auditor)

Inventário: 160 arquivos fora de `relatorios/bench/` (28 relatórios de bench, 228 KB). Conferido arquivo a arquivo (cabeçalho, data do último
commit, quem o código cita). Regra 4 do fundador: **nada em `docs/` é apagado**; "descartar" aqui = **deixar de usar como guia**
(marcar como histórico), nunca remover.

## Veredito

A documentação tem **um problema de governo, não de volume**: entre 10 e 12/10 o Antigravity criou **dois planos novos marcados
"Aprovado"** (`JEV-PLANO-DIRETOR.md`, `PLANO-EVOLUCAO.md`), reescreveu um documento histórico (`PLANO-DE-ACAO.md`, "100% concluído") e
passou a registrar tudo num log próprio (`JEV-LOG-DE-IMPLANTACAO.md`). Nada disso passou pela fonte única (`NEXTCODE-REFERENCIA.md`
parou em 09/10) nem por `memory/decisoes.md` (última decisão: 09/10). Resultado: hoje há **quatro "planos oficiais"** e o log contém
afirmações que os relatórios de bench desmentem.

## Afirmações sem prova no `JEV-LOG-DE-IMPLANTACAO.md`

| Seção | Afirma | O que os relatórios mostram |
|---|---|---|
| §4.19 | "Economia de 57,2% com Jev, 100% de aceite" (P1) e Jev "escolheu o modelo gratuito" | A rodada com Jev (`bench/2026-10-12-1533.md`) terminou na fase **PLANEJAMENTO**, não ENTREGUE; sem Jev terminou ENTREGUE. n=1 (o auditor já mediu ruído de ±15% entre rodadas iguais, 09/10). O detalhe por etapa soma US$ 0,0078 contra o total de US$ 0,0236 (etapas sem modelo e 0 tokens). E `rapido` não é gratuito: é `deepseek-flash` pago (política). |
| §4.20 | Item 9 "concluído": Gateway entregue (T10) | O critério do item 9 é "Gateway do fundador entregue com build ok". A prova citada são 3 testes unitários; não há execução real do Gateway. |
| §4.23 | "P3 12/12" | 4 rodadas de 12/10: 1/12, 0/12, 0/12, 0/12 (já no C1.3). |

**Achado novo (não é de documento):** nas rodadas de 12/10 a variante **com Jev** termina na fase `PLANEJAMENTO` (P1 `1240`, `1533`; P2 `1435`, `1550`) mesmo com aceite 10/10 e 13/13, e a variante **sem Jev** termina `ENTREGUE`. Indica uma regressão no fluxo com Jev (a sessão não chega à entrega). Precisa de investigação própria — **não** está no C1.

## Classificação de cada documento

| Documento | Faz sentido? | Proposta |
|---|---|---|
| `NEXTCODE-REFERENCIA.md` | **Sim — fonte única** | Atualizar §3 com o que entrou de 10 a 12/10, depois do C1 auditado |
| `ARQUITETURA-ORQUESTRACAO.md` | Sim, como detalhe do desenho | Manter (o código cita) |
| `rascunhos/JEV-DECISOES.md` | Sim — catálogo do Jev | Manter (CLAUDE.md manda ler) |
| `rascunhos/TEMPLATES.md` | Sim — base de `artifact-templates.ts` | Manter (o código cita) |
| `rascunhos/politicas-orquestracao.yaml` | **Cuidado** — é o arquivo de reserva que `loadOrchestrationPolicy` lê se `config/` faltar (`orchestration-policy.ts:342`); está desatualizado (220 linhas, sem `roteamento_papeis_criticos`) | Manter; **não mover** (quebraria a reserva). Marcar no topo "reserva — a política vale em `config/`" |
| `rascunhos/skills/*` | Não — versões antigas das skills (diferentes de `skills/`) | Histórico |
| `rascunhos/TERCEIROS.md` | Sim — licenças das fontes de terceiros | Manter |
| `terceiros/jev-docs/` (126 arquivos) | Sim — documentação oficial do Jev offline | Manter; `llms-full.txt` (21 mil linhas) já contém todo o resto — usar ele como entrada única |
| `specs/gatway-system-spec.md` | Sim — Spec do Gateway (formato antigo) | Manter; reescrever no formato `REQ` quando o Gateway voltar à pauta |
| `prompts/*`, `relatorios/*` | Sim — trilha de auditoria | Manter |
| `relatorios/bench/*` | Sim — é a prova dos números | Manter (regra: número citado = arquivo citado) |
| `PLANO-DE-ACAO.md`, `PLANO-ETAPA-0.md`, `PLAN-OMNIRHARDENING.md` | Histórico | Já marcados; `PLANO-DE-ACAO.md` foi **editado** em 12/10 contra a regra 4 — não editar mais |
| `LLM-GATEWAYS.md` | Parcial — desatualizado (DeepSeek pago, OmniRoute pausado) | Histórico |
| `SPEC-TEMPLATE-NEXTCODE-V5.md` | Não — obsoleto (sem `REQ`); só o detector do chat cita o nome (`spec-message-renderer.tsx:47`) | Histórico |
| **`JEV-PLANO-DIRETOR.md`** | **Não como plano** — "Aprovado para Execução" sem registro de aprovação; conteúdo útil (22 recursos R1–R22) já está na referência §4.2 | **Descartar como guia**: marcar histórico |
| **`PLANO-EVOLUCAO.md`** | **Não como plano** — "Aprovado" sem registro; a própria linha vermelha 2 ("proibido gratuito em papel crítico") é violada pela fase E12 que ele lista | **Descartar como guia**: marcar histórico |
| **`JEV-LOG-DE-IMPLANTACAO.md`** | Parcial — útil como lista do que foi feito em 10–12/10, mas tem afirmações sem prova | Manter como registro do executor (não do auditor); correções em §4.24 (C1.3); **parar** de abrir log paralelo: o que foi feito vai no relatório do pacote, o veredito no diário |

## Propostas (aguardam o fundador — nada disso está no C1)

1. **Um só plano.** Marcar `JEV-PLANO-DIRETOR.md` e `PLANO-EVOLUCAO.md` como histórico (uma linha no topo, sem apagar nada) e trazer para a referência §5 só o que o fundador confirmar.
2. **Proibir documento-plano novo** no protocolo com o Antigravity (§8.2, nova trava): ele só escreve em `docs/relatorios/<pacote>.md`; plano e status só na referência, pelo auditor.
3. **`docs/README.md`** com esta tabela (o que ler, o que é histórico).
4. **Investigar a fase `PLANEJAMENTO` com Jev** (achado novo) antes de qualquer nova medição "com × sem Jev".
5. **Remedir com Jev × sem Jev** (P1, P2, P3; 3 repetições) depois do C1 e da investigação — os números de 12/10 não servem para decidir.
6. Corrigir a referência quebrada `docs/spec-architecture.md` em `spec-decomposer.ts:550` (arquivo não existe) — código, só com aprovação.
