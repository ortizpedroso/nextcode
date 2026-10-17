# Auditoria do uso do Jev — 17/10/2026

> Pedido do fundador (diário 109): "analisar de forma profunda a documentação do Jev… a principal função dele é escolher o modelo certo… quero que a gente use o Jev de forma correta e extraia dele o máximo".
> Fontes: docs locais `docs/terceiros/jev-docs/` (baixadas 09/10) + índice atual `docs.typesafe.ai/llms.txt` (17/10) + OpenRouter (Jev Router), LiteLLM (JEV Auto Router e benchmark), blog OpenRouter "What is Jev". Código no HEAD `accf5cb`. Nada alterado.

## 1. Veredito

**A premissa está meio certa.** Escolher modelo é, sim, um uso oficial do Jev: o mapa de casos de uso da TypeSafe lista "Model routing" e "Harness Engineering", e há dois roteadores prontos (Jev Router no OpenRouter; JEV Auto Router no LiteLLM). **Mas "uma vez instalado no Claude ele trabalha sozinho" é falso pela documentação oficial:** a página "Jev with coding agents" diz que o Jev "is **not** a drop-in replacement for the LLM behind Claude Code… There is no `model: "jev-latest"` setting that turns your coding agent into a Jev-powered agent". A "agent skill" da TypeSafe só ensina o agente de código a **escrever código que chama o Jev**. Nenhuma fonte mede ganho de qualidade final: o benchmark do LiteLLM diz literalmente que não avaliou as respostas.

**No NextCode, o Jev está em 14 pontos de decisão; 4 são bons usos, 4 são usos errados ou quebrados, 1 está morto, e os 3 que mais economizariam token não existem.**

## 2. O que o Jev é (documentação oficial)

- Modelo "System One": recebe `state` + perguntas tipadas e devolve resposta tipada com probabilidade. **Não gera texto, não escreve código, não explica.**
- Primitivas: `choice` (escolher opção), `score` (nota numa régua), `noul` (verdadeiro/falso, 0–1) e, desde a 1.14 (14/10, alias `jev-preview`), `box` (imagens). `jev-latest` continua apontando para 1.13.
- Preço: US$ 0,042 por milhão de tokens de entrada; saída grátis. Limite: 64k tokens por chamada, 32k por pergunta.
- Perguntas na mesma chamada são avaliadas em paralelo e isoladas; acrescentar perguntas quase não muda o tempo.
- **Falhas conhecidas (jaggedness 1.13):** leitura literal; não faz conta nem contagem; datas; indireção; **estado grande com detalhe irrelevante derruba a acurácia**; conteúdo adversarial; instrução × critério contraditórios; viés para a 1ª opção; não gera texto. Recomendação oficial: "avoid… Hiding several judgments inside one question… System Two tasks… Giving it more context in `state` than the question needs".

## 3. O "mais de 22 habilidades": o que existe e o que serve ao NextCode

São 4 primitivas + 4 padrões + 21 receitas (cookbooks) no índice atual.

| Recurso oficial | Serve? | Onde no NextCode |
|---|---|---|
| Padrão **intent routing** | ✅ já usado | intenção da mensagem (aprovar/ajustar/dúvida) |
| Padrão **confidence routing** | ✅ | toda decisão: agir só acima do limiar, abaixo escala |
| Padrão **speculative fan-out** | ✅ já usado | `JEV_CHAT_FANOUT` (várias perguntas numa chamada) |
| Padrão **composite scoring** | ✅ | clareza da Spec (M2) em fatores separados, peso no código |
| **Model routing** (mapa de casos; LiteLLM) | ✅ com condições (§5) | nível do executor/avaliador dentro da cascata fixa (mudança 14) |
| **SDE cascade** (modelo barato → Jev verifica → só escala se falhar) | ✅ **alto valor, não existe** | executor/avaliador: tentar barato, conferir com bateria de `noul`, escalar |
| **Classifying RAG passages** / **Re-ranking** / **Line-by-line search** | ✅ **alto valor, não existe** | pesquisador (P8): só os trechos relevantes da doc vão ao Opus |
| **Guardrails for LLMs** | ✅ | conteúdo baixado da internet (pesquisador): injeção/instrução escondida |
| **Double-checking citations** | ✅ já usado (parcial) | `JEV_EVIDENCE_CHECK`: a linha citada sustenta o REQ? |
| **Skill suggestion** | ✅ | escolher quais referências da skill carregar (avaliador-frontend leva 36 mil caracteres sempre) |
| **Classification using confidence** / **Hierarchical** | ⚠️ talvez | classificar o pedido (tipo de projeto) no M0 |
| **Self-consistency (choice/noul)** | ⚠️ | decisões que bloqueiam: repetir com opções reordenadas (viés da 1ª opção) |
| **Parallel questions** | ✅ regra de custo | sempre juntar perguntas na mesma chamada |
| **Simple memory system** (novo) | ⚠️ ler antes do project-memory | o que guardar na memória do projeto |
| Function calling, date/value extraction, entity alignment, autoformat, autoresearch, Twitch filter, Box/imagens | ❌ | sem uso no fluxo atual |

## 4. Como o NextCode usa o Jev hoje (código + trilha do teste real `934939fc`)

| Decisão | Onde | Veredito | Prova |
|---|---|---|---|
| Intenção da mensagem / fan-out do chat | `message-intent.ts`, `evaluateChatFanOutWithJev` | ✅ uso certo | confiança 1,0 no teste real |
| Guarda de segredo (descrição sem valor) | `secret-guard.ts` | ✅ uso certo | regra 7 respeitada |
| Peneira M0 e clareza M2 | `universal-funnel.ts`, `decideSpecClarity` | ✅ portão | 7 + 7 decisões no teste real |
| Segurança de doc externa T7 | `universal-docs-fetcher.ts:312` | ✅ desenho certo | só roda quando o pesquisador rodar (hoje desligado) |
| Evidência REQ × código | `verifyStageEvidenceWithJev` | ⚠️ só sinal | J1: não separa stub (0,45×0,46) nem segurança (0,38×0,37) |
| **Diagnóstico de falha** | `diagnoseStageFailureWithJev`, `node-executor.ts:1572` | ❌ quebrado por nós | etapa 3: `evaluator_error` 0,85–0,98 nas 3 vezes; causa real era o plano. Não há opção "erro do plano"; só `ambiguous_spec` age |
| **Escolha de nível do modelo (M3)** | `decideMicrobriefsPlanningBatch` | ❌ quebrado por nós | teste real: 62.553 caracteres de estado × nosso teto de 24.000 → 16/16 em fallback; fere a falha conhecida nº 5. Bench P3: executor mais caro com Jev nas 3 repetições (indício, n=3) |
| **Juiz final da entrega (J1)** | `verifyProjectDeliveryWithJev` | ❌ uso errado | reprovou o projeto correto 5/5 — é tarefa "System Two" |
| Conferência do Macrobrief | `verifyMacrobriefCoverageWithJev` | ⚠️ em sombra, ignorado | `CONFERENCIA_ENTRADA ok:false` não parou nada |
| Escalada SDE | `decideSdeCascadeEscalation` | ❌ **código morto** | definida em `jev-decisions.ts:421`, nenhuma chamada |
| Graphify / instalação de skill | rotas do chat e de skills | ✅ portões pequenos | — |

## 5. Escolha de modelo pelo Jev: como fazer certo

O que a documentação e o benchmark do LiteLLM mostram (80 casos, 3 repetições): **1 pergunta `choice` de nível** (SIMPLE/MEDIUM/COMPLEX/REASONING), estado = pedido atual + até 8.000 caracteres de contexto → Jev acertou o nível 95% (Haiku 73,75%), 5× mais rápido, 96% mais barato **como classificador**. Erros sempre para nível mais baixo. Qualidade da resposta final **não medida**.

**Jev Router do OpenRouter: não serve ao NextCode.** O pedido inteiro (Spec, código) passa pelo OpenRouter e pela TypeSafe; a lista de modelos permitidos é "preferência", não regra (só a exclusão é dura); o grupo de modelos não é o nosso (DeepSeek pela nossa chave, Claude direto). Fere a regra 7 e a mudança 15.

**O certo para nós:** o padrão do LiteLLM dentro da cascata fixa da mudança 14 — por etapa, um `choice` de nível com **estado curto** (título, REQs com critério, arquivos, cluster; ≤ 8 mil caracteres, nunca o microbrief inteiro) → o código mapeia nível → modelo da lista fixa. Medir no bench antes de ligar.

**Limite honesto do ganho:** o executor DeepSeek custou US$ 1,24 no teste real; a Spec no Opus, US$ 4,38. O elicitador é Opus por decisão do fundador. Escolher modelo do executor economiza pouco. **Onde o Jev economiza token de verdade é no que entra no Opus** (pesquisador com filtro de trechos) e nas tentativas evitadas (falha mandada ao dono certo, cascata SDE).

## 6. Recomendação, em ordem

1. **A3 — diagnóstico de falha certo:** acrescentar a causa "erro do plano" (REQ ou arquivo fora do escopo da etapa) e fazer cada causa agir: plano → analista; Spec → elicitador; código → executor; avaliação → outro avaliador. Estado curto: motivo + REQ + escopo da etapa.
2. **P8 — pesquisador para o elicitador (dica do fundador, concordo):** `UniversalDocsFetcher` já existe com a guarda T7 do Jev; falta ligar. Jev escolhe os trechos relevantes (`noul` por trecho, receita RAG) e checa injeção (guardrails) → o Opus recebe só o que importa, com fonte citada. É onde o Jev economiza mais (o token caro é o do Opus).
3. **Formato garantido por papel** (diário 108).
4. **M3 refeito no padrão do LiteLLM** (estado curto, 1 `choice`, cascata fixa), medido no bench.
5. **SDE cascade** no avaliador: modelo barato primeiro, bateria de `noul` do Jev, escala só se reprovar ou se a confiança for baixa. Ligar a função hoje morta ou apagá-la.
6. **Tirar o Jev de juiz final (J1)** — no J3 ele dá só sinais por item; o veredito é do avaliador-final.
7. Ficar na 1.13 fixa (limiares calibrados nela); a 1.14 só depois de bench.
