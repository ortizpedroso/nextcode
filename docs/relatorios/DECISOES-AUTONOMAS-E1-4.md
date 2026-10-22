# Decisões tomadas pelo Claude por você — Execução autônoma 4 (mudança 39)

- **Data:** 21–22/10/2026
- **Pedido do fundador:** "o teste já foi rodado, vou ter que sair agora, faça a implementação e só pare quando estiver terminado, ao final monte um relatório do que foi implementado, um relatório do que decidiu por mim e um prompt para outro llm testar".
- **Regra:** cada decisão abaixo foi tomada porque você não estava para responder. Todas podem ser revertidas; a coluna "como desfazer" diz onde.

## 1. Escopo e ordem

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D1 | Li "o teste já foi rodado" como: **o teste real do Gateway (`4d019f00`) substitui o teste pesado sintético como porta da E1** (mudança 37) | rodar o teste pesado sintético de novo | ele parou 3× por ambiente (máx. 6/56 etapas); o Gateway rodou 41/41 e é mais pesado e real; era a decisão em aberto da sua lista ("se este teste real substitui o teste pesado") | mudança 37 na §5.0; rodar `scripts/teste-pesado.ts` como regressão |
| D2 | Escopo da execução = fechar a E1: 35, 36, G1–G3, J2b + J2.7, retomada da `4d019f00`, teto 0,50, J3, TS1 (ordem registrada na mudança 39 **antes** de codar) | incluir J4, PJ2b, JV1, S3 | J4 depende do J3 provado e de remedição com × sem Jev (3× P1–P3, precisa de Docker e verba); PJ2b é tela; JV1/S3 são revisões grandes que pedem a sua leitura | — |
| D3 | 35 e 36 num commit só (`b2a6fbe`) | dois commits | o campo `acao` do aviso (36) é o que faz a falha de ambiente (35) mandar Retomar; separados, o primeiro commit ficaria com aviso errado | — |

## 2. Mudanças 35 e 36

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D4 | **Falha de ambiente = `tsc` com falha e nenhuma linha `error TS`** (`describeEnvironmentFailure`) | lista de códigos de saída (0xC0000142 etc.) | qualquer causa (memória, compilador ausente, processo morto) cai na mesma regra; com erro de TS de verdade nunca é ambiente | `empirical-gate.ts` |
| D5 | No portão de **cada etapa**, falha de ambiente só muda o nome na trilha (`EMPIRICAL_BUILD_ENV_FAILURE`) e **não bloqueia** a etapa | bloquear a etapa | bloquear etapa por memória pararia 41 etapas por uma causa passageira; quem julga é a verificação final (mudança 34), que agora bloqueia com Retomar | `node-executor.ts` (EMPIRICAL_BUILD_*) |
| D6 | Aviso com 4 ações: `retomar` / `autorizar_verba` / `retentar_etapa` / `ajustar_spec`; campo obrigatório no tipo (o compilador obriga todo bloqueio a dizer o que fazer) | texto livre por bloqueio | o tipo impede voltar a ter frase fixa errada | `phase-machine.ts` (`HumanAction`) |
| D7 | **Retomar** existe em 3 lugares: botão no Monitor da DAG (só com a sessão BLOQUEADA), a palavra `retomar` sozinha no chat, e `resume_session` em `/api/dag` | só o botão | o chat é o seu caminho natural; a palavra exata evita retomar por engano numa frase | `session-resume.ts` |
| D8 | Retomar **recusa** quando há etapa bloqueada ("use Re-tentar") | retomar mesmo assim | retomar sem zerar as tentativas da etapa voltaria a bloquear na hora | `session-resume.ts` |

## 3. Defeitos do teste real (G1–G3)

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D9 | G1: o leitor aceita rótulo `acao` na linha de baixo, ``` dentro do `conteudo`, quebra de linha/tab/barra invertida crua dentro das strings e sobra `}]`/crase depois do JSON — **nada além disso** | aceitar qualquer JSON "parecido" | são exatamente as variações da trilha real (9/9 aceitas); afrouxar mais esconderia resposta errada | `executor-tool-loop.ts` (`parseJsonLenient`) |
| D10 | G2: a 2ª chamada do avaliador recebe o motivo do descarte **no fim** da mensagem | no começo | no fim o cache do Brief (P8) continua valendo | `dual-lens-auditor.ts` |
| D11 | G3: culpada = a bloqueada com tentativas próprias; só da versão atual da Spec | a mais antiga | a cascata marca as dependentes depois, sem histórico | `blocked-culprit.ts` |
| D12 | G4 (executor > 10 chamadas) **não mexido** | baixar o limite | parte das chamadas eram turnos recusados pelo leitor (G1); medir de novo antes de mexer | — |

## 4. J2b + J2.7 (reparo da entrega)

Seguiu o desenho já decidido em `DECISOES-AUTONOMAS-E1-3.md` (J1–J8). Decisões novas, de detalhe:

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D13 | Dona da lacuna = a etapa **mais recente** que tem o arquivo no escopo (ou o REQ); nunca a base sem IA (`scaffold`) | a primeira etapa | na 2ª rodada a dona certa é o reparo anterior, que tem o código mais novo | `delivery-repair.ts` |
| D14 | Se **qualquer** lacuna não tem dona, **não abre reparo nenhum** (BLOQUEADA "Dono: analista") | reparar o que tem dono e deixar o resto | a entrega não passaria de qualquer jeito; gastar rodada sabendo disso é desperdício | `planDeliveryRepair` |
| D15 | Lacuna de build **sem a lista de erros** é ignorada quando há outra coisa a reparar | bloquear | a verificação seguinte mostra os erros reais | idem |
| D16 | Etapa de reparo sem dependências, com o **código atual dos arquivos colado** no prompt (até 60 mil caracteres) | o executor lê com `read_file` | economiza chamadas (G4) e é o mesmo mecanismo do P3 | `node-executor.ts` |
| D17 | A T10 **ignora a etapa substituída** por um reparo concluído | somar os vereditos | o veredito antigo (reprovado) prevaleceria para sempre | `supersededByRepair` |
| D18 | Reparo por **código, sem LLM** (J2 do desenho) mantido; o analista só entra quando não há dona | analista replaneja | a ligação lacuna → arquivo → etapa já existe no plano | — |

## 5. J3 (avaliador-final)

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D19 | **Sonnet 5.5 de padrão, Opus 5.5 de reserva** | Opus de partida (texto da linha J3) | a própria linha J3 manda ficar com "o mais barato que passar": nos controles reais os dois acertaram 8/8; Sonnet US$ 0,12 × Opus US$ 0,26 | `FINAL_REVIEW_MODEL` / `finalReviewChain` |
| D20 | `revisao_final: ativo` logo depois dos controles | ficar em sombra | porta da linha J3 cumprida (P1 correto 5/5 aprovado; cada controle reprovado pelo seu defeito) e a reprovação não para a sessão: vira reparo (J2b) | `config/politicas-orquestracao.yaml` |
| D21 | Revisão que **não roda** (não coube, sem modelo, 2 respostas descartadas) **não reprova** — só registra `FINAL_REVIEW` | bloquear | a T10 já aprovou arquivos, REQ e build; bloquear por falta de modelo seria parada por ambiente | `final-reviewer.ts` |
| D22 | Limite de 1,2 milhão de caracteres (~350 mil tokens) | 450 mil | janela de 1 milhão de tokens do Sonnet/Opus 5.5 (skill oficial `claude-api`); o Gateway tem 484 mil | `FINAL_REVIEW_MAX_TOTAL_CHARS` |
| D23 | A 2ª checagem do Jev (perguntas atômicas por REQ) **fica para o J4** | fazer junto | é a parte que precisa da remedição com × sem Jev; o J3 com LLM já cobre a revisão de integração | linha J4 |
| D24 | Arquivos lidos = os da Spec (`arquivos_afetados`) | todos os arquivos da pasta | é o que a T10 confere e o que a Spec pede; a pasta tem `node_modules`, `.next` etc. | `job-queue.ts` |

## 6. TS1, ambiente e segurança

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D25 | TS1 resolvido **tirando os prazos aumentados** (sem refatorar os testes) | reescrever o setup | medido: o teste mais lento leva 5,6 s (padrão 15 s); a suíte passou 2× com o padrão — a porta do TS1 | `step-4b`, `end-to-end-harness-plan` |
| D26 | Teto temporário de US$ 80 desfeito **antes** da retomada | manter até o fim | com o P9 o teto da sessão é max(0,50; 41 × 0,35 × 1,5 = US$ 21,5), acima do gasto (US$ 12,33): a retomada não precisa do 80 | `config/politicas-orquestracao.yaml` |
| D27 | Docker: fechei e reabri o Docker Desktop e fiz `wsl --shutdown` (nada mais usava o WSL) | esperar você | o motor ficou parado por mais de 10 min; sem ele o executor não tem rota; `nextcode-app` (contêiner) continua parado de propósito (o banco é usado pelo host) | — |
| D28 | **`run_check test` continua desligado** | ligar agora | rodar teste gerado pela IA executa código fora de sandbox com as suas permissões (`empirical-gate.ts`, cabeçalho); é a E5, com as decisões §6 itens 6–7 pendentes | — |
| D29 | Não mexi em `docs/relatorios/PONTO-DE-RETOMADA-POS-REINICIO-2026-10-21.md` (não rastreado, desatualizado, documento paralelo) nem em `.serena/project.yml` | apagar ou commitar | apagar documento é seu (regra 4) | — |

## 7. Retomada da `4d019f00` (porta da E1) e ajustes do J3 no projeto real

Resultado medido: `AUDITORIA-E1-4.md` §4 e §5.

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| D30 | Retomei a `4d019f00` pelo `scripts/retomar-sessao.ts` (com `prisma generate` e `npm install` que você já tinha autorizado, checklist do diário 197) | esperar você | é a porta da E1 (mudança 37) e o próprio teste do J2b | — |
| D31 | Revisão final: teto de resposta **32 mil tokens** e prazo de 10 min (antes 8 mil / 5 min) | baixar o esforço do raciocínio | no Gateway (~150 mil tokens) o Sonnet gastou os 8 mil só pensando; baixar o esforço piora o julgamento | `FINAL_REVIEW_MAX_TOKENS` |
| D32 | Revisão final: **linhas numeradas**, fim de intervalo cortado no fim do arquivo, e citação inválida **isolada** só tira o item (descarta tudo só com > 20% inválidas) | regra tudo-ou-nada do avaliador de etapa | no Gateway, 1 citação que passava 1 linha do fim jogava fora a revisão de 65 REQ; a trava contra invenção continua (arquivo e linha inicial têm de existir) | `final-reviewer.ts` (`finalRefExists`, `FINAL_REVIEW_MAX_INVALID_FRACTION`) |
| D33 | **Não reabri** a entrega do Gateway com os 15 defeitos da revisão final | criar a volta ENTREGUE → reparo e rodar | mexe no seu projeto real e cria uma transição nova na máquina de fases; fica como recomendação em `AUDITORIA-E1-4.md` §6 | — |

## 8. Rodada final (22/10) — "atualize e organize a implementação pela última vez… quando tiver que decidir decida por mim"

| # | Decisão | Alternativa descartada | Motivo | Como desfazer |
|---|---|---|---|---|
| F1 | **Fiz a mudança 40** (reabrir entrega) e **usei no Gateway** | deixar só como proposta | era a sua decisão em aberto (D33); a delegação nova cobre; o Gateway entregue tinha 15 REQ parciais e um defeito que impede cobrar | `8a8b52a`; reverter o evento `REABRIR_ENTREGA` em `phase-machine.ts` |
| F2 | Reabrir **não zera** as rodadas de reparo: o Gateway tinha usado 1, sobraram 2 | dar 3 rodadas novas | regra das 3 tentativas automáticas por versão da Spec (memória `retry-cycle-report-to-human`); zerar viraria laço sem fim | `currentRepairRound` em `repair-payload.ts` |
| F3 | Reabrir **sem botão** no painel: só `reopen_delivery` (rota) e `retomar-sessao.ts --reabrir` | botão ao lado de Retomar | cada reabertura custa a revisão final (~US$ 0,67) e pode abrir reparos; clique por engano sai caro | acrescentar o botão no `dag-sidebar.tsx` chamando `reopen_delivery` |
| F4 | Apaguei `docs/relatorios/PONTO-DE-RETOMADA-POS-REINICIO-2026-10-21.md` **depois** de guardar no histórico (`ce20bf3`) e registrar na §9.0 | deixar solto | documento paralelo e desatualizado (regra 4); a regra exige hash para recuperar — feito antes de apagar | `git show ce20bf3:docs/relatorios/PONTO-DE-RETOMADA-POS-REINICIO-2026-10-21.md` |
| F5 | Commitei `.serena/project.yml` | restaurar | é a própria ferramenta Serena regravando a lista de linguagens depois de se atualizar; restaurar voltaria a mudar sozinho; o `git status` fica limpo | `git revert` do commit `chore(serena)` |
| F6 | Reorganizei os índices `docs/relatorios/README.md` (parado em 16/10) e `docs/prompts/README.md` (vazio); o prompt `J2.7-teste-estrutural-completo.md` marcado como **não usado** | apagar o prompt | o J2.7 foi feito na execução 4; apagar documento só com o seu OK e com resumo — ele é pequeno e fica como histórico | — |
| F7 | **J4 não foi feito** | fazer agora | a sua decisão de 14/10 (§5.5) exige remedição com × sem Jev (P1–P3, 3×) antes de a auditoria do Jev voltar a `ativo` — é implementação nova + medição, não organização; fica como o próximo item da fila | — |
| F8 | Prompt `TESTE-E1-4.md` passou a cobrir a mudança 40 e a esperar `git status` limpo | prompt novo | um teste só para tudo o que foi feito sozinho | — |
