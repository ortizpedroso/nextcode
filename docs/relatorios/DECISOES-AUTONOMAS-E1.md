# Decisões tomadas pelo Claude em nome do fundador — execução autônoma da E1 (mudança 23)

Autorização do fundador (17/10): "quando eu tiver de escolher algo, você, repito você vai decidir o que é melhor para o projeto". Cada decisão abaixo tem o motivo e a evidência; o fundador pode reverter qualquer uma.

| # | Passo | Decisão | Alternativa descartada | Motivo / evidência |
|---|---|---|---|---|
| D1 | A2.1 | Regra de escopo do plano: arquivo citado no critério do REQ tem de estar na etapa do REQ **ou numa etapa da qual ela depende** (direta ou indireta) | "todo arquivo citado no escopo da etapa" | o critério cita arquivo **consumido** (REQ-032 cita `src/lib/validacao.ts` porque usa as regras dele); a regra simples reprovaria plano correto |
| D2 | A2.1 | Cada REQ em **uma** etapa só (erro `T8b REQ REPETIDO`) | permitir REQ em várias etapas | REQ repetido faz cada etapa ser julgada pelo REQ inteiro — teste real: 29 REQ repetidos, etapa 3 impossível 3/3 (diário 93) |
| D3 | A2.1 | Arquivo citado que **nenhuma** etapa produz não reprova o plano | reprovar no plano | é defeito da Spec (elicitador), não do plano; fica para o SM1 (b) |
| D4 | A2.1 | Plano reprovado → sessão **BLOQUEADA** (evento novo `PLANO_REPROVADO`), aviso no chat com "Dono: analista" e os erros; **nenhuma etapa criada**; desbloquear volta à **revisão da Spec** | voltar a PLANEJAMENTO; ou devolver erro na aprovação | voltar a PLANEJAMENTO não replaneja nada; a revisão da Spec permite reaprovar e gerar plano novo; a regra "nenhuma parada silenciosa" (J2) exige aviso |
| D5 | A2.1 | Heurística de reserva: REQ vai para a **última etapa (ordem da DAG) que tem arquivo citado por ele**; nome genérico (`route.ts`, `page.tsx`) não conta | 1º arquivo citado | a última etapa tem as anteriores como dependência, então os outros arquivos citados ficam no escopo permitido |
| D6 | A2.1 | A conferência roda **depois** da divisão de etapas pelo Jev (`splitNodesByJev`) | antes | a divisão cria partes novas; conferir antes deixaria passar plano quebrado pela divisão |
