# Decisões autônomas — execução autônoma 3 (fim da E1: teste pesado e J2b)

> Fundador, 21/10: "continue de forma automática, decida por mim para que o projeto fique da melhor forma; depois monte um relatório do que decidiu por mim". Cada linha: o que foi decidido, a alternativa descartada e o motivo com a evidência. Ordem: a fila da referência §5.0.

## Decisões pendentes que o fundador delegou

| # | Assunto | Decisão | Alternativa descartada | Motivo / evidência |
|---|---|---|---|---|
| E1 | **D23** (timeout de 2 `describe` e2e, ressalva do Cursor) | **Aceitar como está** e registrar um passo próprio (**TS1** na §5.0) para tirar o peso desses 2 testes | reverter o timeout agora | os 2 testes passam isolados e só estouravam 15 s com a máquina carregada (`AUDITORIA-E1-producao.md` desvio 1); reverter faria a suíte falhar por carga, não por defeito. O Cursor está certo na letra da T-B — por isso o passo próprio, e não "fica assim para sempre" |
| E2 | Spec do teste pesado | **Spec real do `8e2f2052`** (Multi_Gateway, 54 etapas na 1ª vez) | Spec sintética da Fase 8 | é a única comparação válida com a 1ª execução (US$ 18,78; 1.724 chamadas do executor; 548 pausas). Spec diferente mede outra coisa |
| E3 | Teto de gasto | **O do próprio sistema (P9)**: maior entre US$ 0,50 e etapas × 0,35 × 1,5 (54 etapas ≈ US$ 28,35); **sem autorização extra** — bateu o teto, o teste para | autorizar mais verba automaticamente | o teto é parte do que se mede (TR1 4). Não há como prometer o custo antes de medir |
| E4 | Porta do teste pesado | ENTREGUE + **≤ 10 chamadas do executor em cada etapa com IA** (não a média) + custo abaixo de US$ 18,78 | média ≤ 10 | o bench do Cursor teve média 5,0 com uma etapa de 11 chamadas — a média esconde |
| E5 | Como rodar | Script novo `scripts/teste-pesado.ts`: cópia do banco em `%TEMP%\nc-teste-pesado`, projeto em pasta nova, **worker real** (`startJobWorker`, com as retomadas de SEM_LLM e do avaliador), para em ENTREGUE/BLOQUEADA, PAUSADA > 45 min ou 10 h | rodar pelo app no navegador | o script é repetível, não escreve em `prisma/dev.db` (T-F) e gera o relatório sozinho; o app exigiria alguém olhando |
| E6 | O que fazer durante o teste | **Não editar `src/`** enquanto ele roda; só documentação | implementar o J2b em paralelo | o processo do teste carrega módulos sob demanda (`await import`); editar código no meio mudaria o que está sendo medido. Também evita disputar memória (3 travamentos em 20/10) |
| E12 | 2ª tentativa do teste pesado (21/10, sessão `314176ef`) | **Parada à mão às 06:49** e não deixada correr até o limite de pausa | deixar o script esperar os 45 min | o fundador fechou o Docker a meu conselho (erro meu: eu disse que o teste não usava Docker); o executor só sai pelo FreeLLMAPI (`paid-routing.ts`, contêiner `nextcode-freellmapi` do `docker-compose.yml`) → 132 pausas sem LLM, 1 etapa (sem IA) feita, ~US$ 0 gasto. Correção: o script confere FreeLLMAPI e DeepSeek antes de começar |
| E13 | Causa da 1ª tentativa | Reatribuída: os "nenhum provedor respondeu" vêm do FreeLLMAPI (Docker) sob falta de memória, não do DeepSeek | "provedor fora do ar" | sonda de 21/10 mostrou DeepSeek ok (603 ms); o executor nem chama o DeepSeek direto |

## Decisões da auditoria do Cursor e do PJ1.5 (20/10, já executadas)

| # | Assunto | Decisão | Motivo |
|---|---|---|---|
| E7 | Veredito do Cursor (`2d5f18b`) | **Aceito com ressalvas**, mas a seção de opiniões sobre D1–D42 fica **não auditada**; não pedir nova auditoria | a parte mecânica confere (HEAD 2×, D41/D42, bench); as opiniões descrevem decisões que não são as do relatório (ex.: D15, D29, D33). Nova rodada custaria tempo sem mudar o código; o teste pesado é a prova real |
| E8 | Skill do avaliador prometia "rodada de polimento" | Ajustar o texto ao código (`dc1d583`) | a rodada não existe; é o J2b |
| E9 | TESTE PESADO 3 dependia do banco local | Chave sintética no teste (`dc1d583`) | falhava num worktree limpo; prova: falha sem / passa com |
| E10 | PJ1.5 sem Spec real | Testar a trava do vínculo sem gerar Spec (US$ 0,00) | gerar Spec custa ~US$ 0,50 e o início da execução vinculada já é coberto pelo bench |
| E11 | Painel dizia "cadastrado!" ao reabrir pasta | Corrigir junto com o smoke (`19d3bcd`) | defeito achado na tela, 1 linha, sem risco |

## J2b + J2.7 — desenho decidido (mudança 27 na referência)

| # | Assunto | Decisão | Alternativa descartada | Motivo |
|---|---|---|---|---|
| J1 | Quando entra | Só quando **todas as etapas terminaram** e a verificação final reprova (`VERIFICACAO_COM_LACUNAS`) | também em etapa bloqueada | etapa bloqueada já tem dono e caminho (A3, P6); o J2b é o que falta: hoje entrega reprovada vai direto para `BLOQUEADA` (`phase-machine.ts` ≈614) |
| J2 | Quem gera o reparo | **Código, sem LLM**: cada lacuna é ligada ao REQ e à etapa dona dos arquivos; uma etapa de reparo por etapa dona, com as lacunas como defeitos e o código atual como ponto de partida (o mesmo mecanismo do P3) | analista LLM replaneja | a ligação lacuna → REQ → etapa já existe no plano; LLM aqui seria custo e mais um ponto de erro. Lacuna que não liga a nenhuma etapa → `BLOQUEADA` com "Dono: analista" |
| J3 | Fases | `VERIFICACAO → PLANEJAMENTO` (cria as etapas de reparo) `→ EXECUCAO` pelo caminho que já existe | voltar direto para `EXECUCAO` | é o que a §5.5 e a linha J2b da §5.0 dizem; mantém uma porta só para criar etapas |
| J4 | Limite | **3 rodadas** de reparo por sessão; na 4ª reprovação, `BLOQUEADA` + relatório com as lacunas e o que cada rodada tentou | sem limite | regra do fundador (máx. 3 tentativas automáticas, memória `retry-cycle-report-to-human`) |
| J5 | Custo | as etapas de reparo contam no teto normal (P9); o teto recalcula com as etapas novas | verba separada | uma regra de custo só |
| J6 | J2.7 junto | teste estrutural usa as listas do próprio código (`PHASES` etc.) e confere que todo evento aceito por alguma fase está na lista | separar | decisão de 15/10: os dois mexem em `phase-machine.ts`; separados, um desfaz o outro |
| J7 | Porta | teste com etapa entregue com defeito → reparo → ENTREGUE; teste com defeito que não some → `BLOQUEADA` com relatório depois de 3 rodadas; bench P1–P4 sem piorar | só teste unitário | a §5.0 pede "P4 com bug plantado → reparado e ENTREGUE, ou BLOQUEADA com relatório, em ≤ 3 rodadas" |
| J8 | Ordem | **Depois do teste pesado**: os números dele (quantas entregas reprovam e por quê) podem mudar J2; se o teste pesado mostrar lacuna de outro tipo, a linha é ajustada antes de codar | codar agora | fila da §5.0 e decisão E6 |
