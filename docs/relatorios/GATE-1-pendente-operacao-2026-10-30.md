# Gate 1 Gateway — pendente de operação (30/10/2026)

> Item **8** da §3.3 (`docs/NEXTCODE-REFERENCIA.md`). **Não é implementação de código** — exige sessão real, cota LLM e tempo de bancada.

## Pré-requisitos

- [ ] Cota DeepSeek / FreeLLMAPI disponível (sem “All models exhausted”).
- [ ] OmniRoute ou gateways configurados (`Setting` default + chaves no cofre).
- [ ] Docker Desktop (ui-check / bancada T10) se a Spec tiver páginas.
- [ ] Projeto Gateway no disco (`C:\projetos\gateway_multiplataforma` ou path registrado na memória do projeto).

## Passos (fundador ou agente com APIs)

1. Criar **sessão nova** no NextCode com a **mesma Spec canônica** da sessão de referência `4d019f00` (65 REQ — ver §7.2 da referência).
2. Aprovar Spec e deixar a fila executar até **VERIFICACAO** / **ENTREGUE**.
3. **Porta de sucesso:** fase **ENTREGUE** com **0 defeito provado** na revisão final / trilha J3.
4. **Parar** se, em **2 rodadas** consecutivas de reparo, o número de defeitos provados **não cair**.
5. Registrar no `memory/diario.md`: id da sessão, fase final, contagem de provados, veredito ACEITO/RESSALVAS.

## O que já está pronto no harness (não repetir)

- Vitest **1167/1167** (item 7 fechado — `TESTE-E5-fechamento-vitest-2026-10-30.md`).
- Motor T10, J2b, triagem, `orchestrator_recovered` — commits até `d8c2bac` no `main`.

## Bloqueio atual

Sem execução automática nesta sessão: **credencial e cota são locais**; o agente não iniciou sessão Gateway longa para não gastar verba nem bloquear em `BLOQUEADA` por cota (histórico 23/10, referência §7.2).
