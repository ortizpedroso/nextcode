# Auditoria consolidada — Mudança 43: revisor com bancada de testes

- **Data:** 22/10/2026
- **Aprovação:** fundador, 22/10: "por que a skill revisor não pode fazer isso… melhorar o avaliador para ser mais cirúrgico… eu aprovo, só não quero que se perca na sequência da nossa implantação".
- **Commits:** `465aa4b` (referência) … `054ddb1`; junta ao `main` em `9f19dec`. Trabalho feito na worktree `../nextcode-43` enquanto o Antigravity testava a execução 4 na pasta principal.
- **Teste independente anterior:** `docs/relatorios/TESTE-E1-4-antigravity.md` — execução 4 **aceita com ressalvas** (10 aceitos, 2 com ressalva, 0 rejeitados); ressalvas conferidas no §5.

## Veredito

As 4 fases foram feitas, cada uma com teste e com o tsc e o vitest do seu commit (suíte final **152/999**, 2× verde). A peça principal funciona no projeto real:

- **Antes:** o revisor final só lia o código.
- **Agora:** ele **prova** cada defeito com um teste que roda num contêiner sem rede e sem acesso ao projeto para escrita. Prova o que a leitura achou, descarta o que não se confirma e transforma a Spec ambígua numa pergunta objetiva.
- **O aviso de bloqueio deixou de ser genérico:** lista os defeitos com o teste que falha, diz se a Spec está certa e oferece **Autorizar mais uma rodada** quando o que sobrou é código.

Resultado da rodada extra no Gateway: §4.

## 1. Commits

| Commit | Fase | tsc | vitest |
|---|---|---|---|
| `465aa4b` | referência: mudança 43 + checklist (só docs) | — | — |
| `1403b39` | **43.1** bancada de testes | 0 | 150 / 977 |
| `636244e` | teste `skill-miner`: janela `since` no mesmo milissegundo (instabilidade antiga, causa corrigida) | 0 | 150 / 977 |
| `8f4771f` | **43.2** revisor prova cada defeito | 0 | 151 / 986 (2×) |
| `c132d3b` | teste `executor-tool-loop`: espera a quantidade de registros da trilha (TR1 (1) falhava sob carga) | 0 | 151 / 986 |
| `ffe5ce9` | **43.3** reparo recebe o teste como contrato | 0 | 151 / 989 |
| `7b29278` | **43.4** aviso pelo diagnóstico + Autorizar mais uma rodada | 0 | 152 / 997 |
| `9f19dec` | junção ao `main` | 0 | 152 / 997 |
| `7366533` | 43.4: pergunta de Spec não trava a rodada do código | 0 | 152 / 998 |
| `054ddb1` | 43.2: erro do próprio teste (ex.: `React is not defined`) não é prova | 0 | 152 / 999 |

Diferença (`e2cc665..054ddb1`, código, testes, docker, scripts, skills): 35 arquivos, +1786 −58.

## 2. O que mudou (onde está)

| Fase | Peças | Testes |
|---|---|---|
| 43.1 Bancada | `docker/test-bench/` (Dockerfile, `install.sh` com rede → cache por projeto, `run.sh` **sem rede**, `vitest.config.mjs`), `src/core/execution/test-bench.ts`, `scripts/bancada-testes.ts` | `tests/execution/test-bench.test.ts` |
| 43.2 Revisor prova | `src/core/governance/defect-reproducer.ts` (escritor do teste, bancada, classificação), `final-reviewer.ts` (reprodução, testes do projeto sempre, `critico` sem citação vira suspeita), skill `avaliador-final` §4–§5 | `tests/governance/reproducao-defeitos.test.ts` (10) |
| 43.3 Contrato do reparo | `repair-payload.ts` (`testesReproducao`, `contractBenchRequest`), `delivery-repair.ts` (o teste vai à etapa dona), `node-executor.ts` (prompt com o teste e a saída; portão roda o contrato e desfaz a promoção se falhar), `executor-tool-loop.ts` (`run_check test`, máx. 4) | `executor-tool-loop` 43.3 a/b, `j2b-reparo-entrega` 43.3 |
| 43.4 Aviso e rodada extra | `delivery-diagnosis.ts`, evento `REPARO_ESGOTADO` (ação `autorizar_rodada`), `authorizeRepairRound` (`session-resume.ts`), rota `authorize_repair_round`, botão **Autorizar mais uma rodada**, "autorizar rodada" no chat, `retomar-sessao.ts --rodada-extra`, limite = 3 + autorizadas | `aviso-diagnostico-rodada` (8), `j2b-reparo-entrega` 43.4 |

## 3. Provas medidas (saída real)

| Prova | Resultado |
|---|---|
| Bancada no Gateway (11 testes que o executor escreveu e nunca rodaram) | 9 passam, **2 falham** — os mesmos REQ-026/052 e REQ-055 que a revisão achou só lendo; 5 s com cache |
| Isolamento | teste malicioso: `fetch` sem rede e escrita em `/project` recusada; nenhum arquivo criado |
| Revisão com reprodução no Gateway (`docs/relatorios/bench/2026-10-22-43-2-reproducao-gateway.json`) | 10 suspeitas → **8 provadas** com teste que falha, 1 sem prova (só tela), 1 **pergunta objetiva** de Spec (REQ-035); ~US$ 0,9 |
| Controles do J3 (Sonnet) depois da skill nova | **8/8** (US$ 0,085) |
| Aviso real depois das 3 rodadas (22/10 10:41 UTC) | `REPARO_ESGOTADO`: 8 defeitos com o teste que falha, 1 só de tela, progresso, "**a Spec está certa**", **Autorizar mais uma rodada** |

## 4. Rodada extra no Gateway `4d019f00` (autorizada pelo fundador na aprovação)

RESULTADO_RODADA_EXTRA

## 5. Ressalvas do teste do Antigravity (conferidas no código)

| Ressalva | Procede? | O que foi feito |
|---|---|---|
| D32 (1): REQ `parcial`/`ausente` com citação inválida deixa de reprovar | **Não** — o código só confere citação de `implementado`; o relatório citou `numberLines` e uma linha `continue` que não existem | — |
| D32 (2): `critico` com citação inválida some e deixa de reprovar | Sim | 43.2: vira suspeita sem citação, e a bancada decide |
| `SKILL.md` §4 desatualizada | Sim | skill reescrita (§4–§5) |
| F10: o último erro do gateway não é filtrado por sessão | Sim (o registro não tem sessão) | **não corrigido** (baixo risco: uma sessão por vez hoje); está no checklist |
| D17: o reparo que substitui a etapa pode esconder REQ secundário | Não — a etapa de reparo leva o Microbrief inteiro da dona e o avaliador julga todos os REQ dela | — |

## 6. Decisões tomadas pelo Claude nesta fase (o fundador disse "siga os passos que você definiu")

| # | Decisão | Por quê |
|---|---|---|
| H1 | Worktree separada enquanto o Antigravity testava | o passo 4 dele usa `git stash` na pasta principal; editar ali misturaria as mudanças |
| H2 | Bancada com a mesma base da verificação de tela; `npm install --ignore-scripts` com rede só na instalação; execução `--network none` com o projeto só leitura | reaproveita a imagem já baixada; o código gerado nunca roda com rede nem na máquina |
| H3 | Defeito num teste do próprio projeto é provado rodando esse teste (sem escrever teste novo) | um teste novo não prova um teste errado |
| H4 | **Os testes do projeto rodam sempre** na verificação final (sem LLM) | a leitura varia (o REQ-055 sumiu de uma revisão), o teste não |
| H5 | Onde corrigir = código citado no defeito → código no rastro da falha → o arquivo citado | evita repetir o roteamento errado do REQ-052 |
| H6 | Erro do próprio teste (`ReferenceError`, sintaxe) não é prova; vira nova tentativa | caso real `React is not defined` no Gateway |
| H7 | Pergunta de Spec não trava a rodada do código; só vira o caminho principal quando não há código a corrigir | uma dúvida não deve parar 8 correções provadas |
| H8 | Autorizar rodada só quando o bloqueio foi `REPARO_ESGOTADO`; cada autorização soma 1 ao limite | a regra das 3 tentativas continua; a exceção é sempre do fundador e fica na trilha |
| H9 | O Jev não entra nesta decisão | com teste rodando, a causa é mecânica |
| H10 | Corrigi a causa de 2 testes instáveis (`skill-miner`, TR1 (1)) em vez de rodar de novo até passar | regra "corrigir a causa, não o sintoma" |

## 7. O que não foi verificado
- O botão **Autorizar mais uma rodada** não foi clicado no navegador (o app ficou parado para haver um worker só no banco); a rota e a função têm teste, e a rodada real foi pela linha de comando.
- A bancada não testa tela (React precisa de navegador): o REQ-033 segue "sem prova" — fica para o autoteste (E5) com navegador.
