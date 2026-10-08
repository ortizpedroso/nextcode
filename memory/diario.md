# Diário — onde paramos

> Entrada nova **no topo**. Cada entrada: data, o que foi feito (com commit), onde parou, próximo passo,
> decisões pendentes. Ler a primeira entrada antes de começar qualquer coisa.

---

## 08/10/2026 (17) — auditoria do P1 (aceito com ressalva) e prompt P3

**P1 (Antigravity):** `4dd6733` `e1acc35` `6639232` `c8b63a6` + relatório `6925847`.
**Auditoria:** escopo por commit ok; os 4 commits compilam isolados; código conferido (`postJev` com 3 tentativas e espera, 422 → `JEV_REQUEST_INVALID`, estado grande → `JEV_STATE_TOO_LARGE` sem chamada, custo do Jev em `LLM_COST`). **Ressalva:** relatório diz fase final `CONCLUIDO`, que não existe; refiz o P1 real: `ENTREGUE`, US$ 0,0499 (Jev 0,00026). Nova trava T-L: relatório só com saída bruta.
**Dado novo:** 1ª divergência do `JEV_EVIDENCE_CHECK` em sombra (citação do executor Flash não sustenta REQ-001; avaliador sustenta) — ver `memory/medicoes.md`.
**Decisão do fundador registrada:** avaliador Nemotron → DeepSeek → Claude (`memory/decisoes.md`, referência §5.2). Memória provisória `pending-evaluator-chain-decision` apagada.

**Feito:** `docs/prompts/P3-avaliador-freellmapi.md` (P3.1 cadeia pelo FreeLLMAPI com prefixos por item; P3.2 ligar no executor; P3.3 divergência plantada + P1/P2 reais).
**Próximo passo:** Antigravity executa P3 → auditar (conferir divergência plantada e `servedBy` do avaliador). Depois P2 (bench).
**Pendências do fundador:** configurar Claude no FreeLLMAPI quando houver crédito; stack/recorte do Gateway; teto de custo; privacidade do Jev.

---

## 08/10/2026 (16) — P1 em andamento; Nemotron aprovado como 1º avaliador

**Antigravity (P1, em andamento):** `4dd6733` P1.1 (custo do Jev no LLM_COST) e `e1acc35` P1.2 (nova tentativa 429/529, alerta 422) commitados; P1.3 em edição (jev.ts, jev-execution-checks.ts, secret-guard.ts, tests/decision/jev-estado.test.ts). **Não auditado ainda.**

**Decisão do fundador (08/10 noite):** avaliador pelo FreeLLMAPI na ordem **1º `nemotron-3-ultra` (NVIDIA, gratuito, outra família) → 2º DeepSeek pago → 3º Claude**. Vale só para o avaliador (executor segue só pago). Teste: `nemotron-3-ultra` 200 via `ollama/nemotron-3-ultra` 3,5 s; `nemotron-3-ultra-550b` 200 via `nvidia/...` 20,5 s (função simples correta). Qualidade como juiz não medida.
Também: fundador perguntou se dá para testar tudo com DeepSeek → sim (R1 provou); único limite é a independência do avaliador, agora coberta pelo Nemotron.

**Onde parou:** esperando o relatório do P1. Decisão do avaliador ainda NÃO copiada para `memory/decisoes.md` / referência (repo ocupado pelo Antigravity) — está em `~/.claude/projects/.../memory/pending-evaluator-chain-decision.md`.

**Próximo passo:** auditar P1 → registrar a decisão do avaliador em decisões/medições/referência §5.2 → prompt P3 (avaliador pelo FreeLLMAPI: Nemotron → DeepSeek → Claude, trava `X-Routed-Via` por papel, teste com divergência plantada) → P2 (bench).
**Pontos abertos para o P3:** Claude sem crédito; FreeLLMAPI lista `claude-sonnet-4-5` mas respondeu 404 ao chamar; sugerido Nemotron → Claude → DeepSeek quando houver crédito (DeepSeek perde a independência).

**Pendências do fundador:** crédito Claude/Gemini; stack/recorte do Gateway; teto de custo; privacidade do Jev.

---

## 08/10/2026 (15) — auditoria do P0 (aceito) e prompt P1

**P0 (Antigravity):** `77b3adb` (McpServer.env cifrado/mascarado) e `bc2095a` (causa do teste intermitente + relatório).
**Auditoria:** escopo ok; `77b3adb` compila isolado; sem segredo no diff; suíte 86/621 verde no HEAD (auditor, 2×); código conferido (`mcp-env.ts`, rotas GET/POST/PATCH mascaram, 400 em env inválido). Causa do intermitente: dois `EXECUTOR_REPORT_INVALID` no mesmo ms sem ordem; teste agora ordena por `retryIndex`; timeout 60 s e `try/catch` vazio de `9e88b59` desfeitos. Banco real: 1 servidor MCP sem env (nada a migrar). **Veredito: aceito.**

**Achados para o P1 (lendo `jev.ts`):** custo do Jev fora do `LLM_COST` (teto não vê); sem nova tentativa em 429/529; 422 sem alerta; `askJevBatch` e 4 chamadores cortam o JSON do estado no meio; `score.probabilities` lido como array (API devolve objeto); `jev_limiares` do YAML não é lido.
**Decisão:** não adotar o SDK da TypeSafe agora (`memory/decisoes.md`).

**Feito:** `docs/prompts/P1-nucleo-jev.md`.
**Próximo passo:** Antigravity executa P1 → auditar. Depois: P2 (bench real) ou P3 (avaliador/elicitador pelo FreeLLMAPI) — decidir com o fundador.
**Pendências do fundador:** crédito Claude/Gemini no FreeLLMAPI (avaliador independente); stack/recorte do Gateway; teto de custo; privacidade do Jev.

---

## 08/10/2026 (14) — auditoria do R1: aceito com ressalvas; P0 pronto

**Feito (Antigravity):** R1 completo — `69d8a94` `51e141e` `a2c9b2c` `9a9d539` `6ab284e` `88ab558` + relatório `143b975`.
**Auditoria (Claude):** escopo por commit ok; os 6 commits compilam isolados (0 erros, sem amend); sem segredo no diff; suíte no HEAD 85/613 verde (2 execuções); diff conferido (trava `X-Routed-Via`, rota só FreeLLMAPI, `deepseekKey` fora do executor, avaliador sem queda ao gratuito, reserva do Jev no Pro). P1/P2 entregues, 5/5 etapas aprovadas na 1ª, 0 chamadas a gratuito. Custo: P1 +21%, P2 −21% (`memory/medicoes.md`).
**Veredito:** aceito com ressalvas (referência §3.2b).
**Ressalvas / pendências:** avaliador ainda vai ao DeepSeek **direto** (BYOK) e é da mesma família do executor → P3; testes antigos com interruptor (dívida); suíte instável por empate de `createdAt` (vai no P0.2).

**Onde parou:** P0 regravado (sem 0.3; pista do `createdAt` no 0.2) em `docs/prompts/P0-arrumacao.md`, pronto para enviar.

**Próximo passo:** P0 → P1 (núcleo do Jev) → P3 (avaliador e elicitador pelo FreeLLMAPI, com família diferente quando houver crédito).

**Pendências do fundador:** crédito Claude/Gemini no FreeLLMAPI (avaliador independente); perfis pagos (opcional); stack/recorte do Gateway; teto de custo; privacidade do Jev.

---

## 08/10/2026 (13) — prompt R1 v3 final entregue

**Feito:** `5e3cbaa` esclarece no prompt v3 que perfil vazio no YAML cai no padrão vazio (sem mexer em `extractScalarString`). Prompt final entregue ao fundador (`docs/prompts/R1-continuacao-v3.md`). **Regra aprendida:** todo commit depois de entregar um prompt deve tocar o próprio prompt, senão a T-A do Antigravity falha.

**Onde parou:** aguardando o Antigravity executar R1.3 (conclusão) → R1.3b → R1.4 → R1.5 → R1.6.

**Próximo passo:** auditar o relatório do R1 (compilar cada commit isolado, suíte 2×, `git diff -U0` dos testes antigos, `X-Routed-Via` só `custom/`). Depois: regravar P0 (sem o 0.3) → P1 núcleo do Jev → P3 avaliador/elicitador no FreeLLMAPI.

**Pendências do fundador:** criar perfis pagos no FreeLLMAPI (opcional); crédito Claude/Gemini para avaliador de outra família; stack/recorte do Gateway; teto de custo (proposta US$ 3,00); privacidade do Jev.

---

## 08/10/2026 (12) — DeepSeek pago funcionando pelo FreeLLMAPI

- Fundador corrigiu o ID no painel. Conferido: `deepseek-v4-pro` e `deepseek-flash` → 200, `X-Routed-Via: custom/...`.
- Perfis `nextcode-pago-*` não existem → R1 v3 ajustado: perfis com padrão vazio (não usados); rota = modelo pago fixo no FreeLLMAPI com trava `custom/`.
- Prompt atualizado: `docs/prompts/R1-continuacao-v3.md`.

**Próximo passo:** Antigravity executa o v3 → auditar relatório.

---

## 08/10/2026 (11) — Auditoria 2: DeepSeek pelo FreeLLMAPI; divisão por tamanho; prompt v3

**Fundador:** DeepSeek direto fora; DeepSeek pago agora no FreeLLMAPI; gratuitos quebram em tarefas grandes (motivo da divisão).

**Achados**
- FreeLLMAPI: provedor DeepSeek cadastrado com o ID `• deepseek-v4-pro` / `• deepseek-flash` → a DeepSeek responde 400. **Ação do fundador:** tirar o `• ` no painel.
- `deepseek-v4-flash` sem o provedor custom cai em gratuito (`electronhub`).
- Divisão já existe (grupos ≤ 4 arquivos, > 3 arquivos, Jev "mistura responsabilidades"). Histórico: o primeiro "corte" era do nosso auditor; o corte real foi do DeepSeek pago (max_tokens); o gratuito cortou o laço 1×. No laço cada chamada já é 1 arquivo → dividir etapa não reduz o tamanho por chamada.

**Decisão (referência §5.2 "Auditoria 2"):** papéis críticos só FreeLLMAPI (perfil pago → modelo pago fixo), trava `X-Routed-Via` com prefixo pago (`custom/`), sem DeepSeek direto; gratuito no executor só com dados do bench.

**Feito:** referência, decisões, medições; `docs/prompts/R1-continuacao-v3.md` (substitui v1/v2).

**Próximo passo:** fundador corrige o ID no FreeLLMAPI → Antigravity executa v3 → auditar relatório.

---

## 08/10/2026 (10) — auditoria de gateways (OmniRoute pausado, FreeLLMAPI é o caminho)

**Fundador:** OmniRoute pausado; só o FreeLLMAPI é o direcionamento, com o Jev; auditar a fundo, estamos repetindo decisões.

**Achados (com evidência na referência §5.2 e `memory/medicoes.md`)**
- Banco: `omniroute.enabled=false`; `freellmapi` prioridade 0. Contêiner do OmniRoute segue de pé (não usado).
- **Eu repeti/contrariei decisão:** D3 (05/10) = FreeLLMAPI primeiro, BYOK direto por último. O R1.2 tirou o FreeLLMAPI dos papéis críticos.
- FreeLLMAPI hoje: sem chave DeepSeek (v4-pro 503), Claude fora do catálogo, Gemini sem cota; `deepseek-v4-flash` fixo cai num revendedor gratuito (electronhub). Perfis `auto:<nome>` existem; inexistente → 400.

**Decisão:** papéis críticos → FreeLLMAPI por perfis pagos (`auto:nextcode-pago-forte|barato`) → DeepSeek direto como último recurso. P0.3 descartado.

**Feito:** referência §5.2, decisões, medições; prompt `docs/prompts/R1-continuacao-freellmapi.md` (substitui `R1-continuacao-testes.md`).

**Ação do fundador (fora do código):** no painel do FreeLLMAPI, cadastrar a chave DeepSeek e criar os perfis `nextcode-pago-forte` (deepseek-v4-pro) e `nextcode-pago-barato` (deepseek flash) **só com modelos pagos**; depois incluir Claude/Gemini quando houver crédito.

**Próximo passo:** auditar o relatório do R1; depois P3 leva avaliador e elicitador para o FreeLLMAPI.

---

## 08/10/2026 (9) — R1 parou no R1.3 (18 testes antigos)

- R1.1 (`69d8a94`) e R1.2 (`51e141e`) commitados pelo Antigravity. R1.3 implementado mas **não commitado**: 18 testes antigos (characterization, execution-trigger-routes, job-worker) quebram porque usam LLM falso pela rota antiga; R1.4 afetaria end-to-end-harness-plan e executor-tool-loop.
- Decisão (referência §5.2): interruptor `setPaidOnlyRoutingForTests(false)` só nesses arquivos; nenhuma asserção muda; produção segue "somente pago". Dívida: migrar para gateway pago falso depois do bench.
- Prompt de continuação: `docs/prompts/R1-continuacao-testes.md`.

**Próximo passo:** Antigravity conclui R1.3–R1.6 → auditar relatório (conferir `git diff -U0` dos testes antigos).

---

## 08/10/2026 (8) — R1 parou no R1.0 (parada correta)

- Antigravity parou no R1.0, como o prompt mandava: a API do DeepSeek lista `deepseek-flash` e `deepseek-v4-pro` (não `deepseek-v4-flash`). Nenhum arquivo alterado.
- Claude conferiu de forma independente (mesma lista) e que `cost.ts` já reconhece `deepseek-flash`.
- Prompt R1, referência e `memory/medicoes.md` corrigidos para `deepseek-flash`; novo commit vira a partida do R1.
- O relatório do Item 10 colado junto é o mesmo já auditado (vazamento corrigido em `c7fb624`).

**Próximo passo:** Antigravity retoma o R1 do início (T-A) no commit novo → auditar o relatório.

---

## 08/10/2026 (7) — reanálise crítica do "pago primeiro" e R1 reescrito

**Pedido do fundador:** não concordar por concordar; prós e contras com dados; escolher a melhor direção.

**Análise (detalhe na referência §5.2)**
- Gratuito no executor: ~50% de acerto observado (amostra pequena); economia máx. ~US$ 0,003/etapa sobre o Flash; falha custa avaliação paga (~US$ 0,01) + 1 das 3 tentativas → só compensaria com ≥ ~77% de acerto.
- "Dividir para caber no gratuito": cada parte = mais uma avaliação paga; já quebrou contrato entre arquivos no P2; falhas do gratuito não eram de tamanho → **rejeitado**.
- **Achado:** tier pesado cai sozinho para FreeLLMAPI/OmniRoute se o DeepSeek falhar; avaliador cai para o gratuito (`freellmapi-fallback`).

**Direção adotada (R1):** executor e avaliador só pago (sem pago → PAUSADA via `SEM_LLM`); Jev escolhe `deepseek-v4-flash` (confiança ≥ 0,85 em `rapido`) ou `deepseek-v4-pro`; sem Jev → Pro; divisão só por qualidade; gratuito só no resto.

**Feito:** referência §5.2, `memory/decisoes.md`, `docs/prompts/R1-roteamento-pago-primeiro.md` reescrito (R1.0 conferir Flash na API … R1.6 prova real), com marcadores INÍCIO/FIM.

**Próximo passo:** auditar o relatório do R1 → regravar P0 com novo hash → P1 (núcleo do Jev; inclui ler `jev_limiares` do YAML de verdade) → elicitador no mesmo roteamento (P3).

---

## 08/10/2026 (6) — "pago primeiro" e prompt R1

**Decisão do fundador:** o Jev analisa o que precisa de pago e manda para o pago; o resto ele decide se divide para caber no gratuito. Revisar código antes de decidir.

**Revisão do código (fatos)**
- `decideMicrobriefsPlanningBatch` escolhe `rapido|medio|pesado` só pela complexidade; reserva sem Jev manda 1 arquivo para o gratuito.
- `splitNodesByJev` já divide uma parte por arquivo (só quando REQ cabe em um arquivo); hoje só dispara por "mistura responsabilidades".
- Executor: `rapido` → FreeLLMAPI; `medio`/`pesado` → DeepSeek; 2ª tentativa sobe (`resolveExecutorTierForAttempt`).
- **Achado:** `jev_limiares` do YAML não é lido por `loadOrchestrationPolicy` (só padrões do código).

**Feito**
- Regra "pago primeiro" na referência §5.2 (limiares 0,35 / 0,85 / 0,80, configuráveis); R1 antes do P0 em §5.3.
- `docs/prompts/R1-roteamento-pago-primeiro.md` (R1.1 política, R1.2 decisão do Jev com 2 perguntas novas, R1.3 divisão para o gratuito + `JEV_ROTA_MODELO`, R1.4 P1/P2 reais + relatório).
- P0 marcado "não enviar ainda" (hash será atualizado após o R1).

**Próximo passo**
- Auditar o relatório do R1 → regravar P0 com novo hash → P1 (núcleo do Jev, inclui ler `jev_limiares` de verdade).

---

## 08/10/2026 (5) — política de modelos final e prompt P0

**Decisão do fundador (registrada em `memory/decisoes.md`)**
- Elicitador, executor e avaliador: não economizar se precisar; **o Jev decide** modelo e divisão; gratuito só sem prejuízo (gratuitos deram respostas incompletas/erradas). Ordem: Claude decide.

**Feito**
- Referência §5.2: Jev escolhe o modelo de todos os papéis + trava de qualidade proposta (gratuito só com confiança ≥ 0,85 nos papéis críticos; nunca na 2ª tentativa em diante; calibrar no bench).
- Referência §5.3: ordem P0 → P1 → P2 → P3 → … com justificativa.
- `docs/prompts/P0-arrumacao.md` (0.1 `McpServer.env` cifrado; 0.2 causa do teste intermitente; 0.3 OmniRoute por digest), com travas T-A…T-K e relatório em `docs/relatorios/P0-arrumacao.md`.

**Onde parou**
- Prompt P0 entregue ao fundador; aguardando o relatório do Antigravity.

**Próximo passo**
- Auditar o relatório do P0 (§8.5 da referência) → escrever o prompt P1 (núcleo do Jev com `@typesafe-ai/sdk`).

---

## 08/10/2026 (4) — correção: eu tinha ignorado o histórico

**Erro desta sessão (para não repetir)**
- Planejei sem ler `docs/rascunhos/JEV-DECISOES.md` nem as transcrições. Resultado: plano v2 contradizia decisões do fundador (dizia que o Jev não escolhe provedor), reinventava o catálogo de 14 usos do Jev já feito em 08/10 00:54 e ignorava custos já medidos.

**Feito**
- Extraídas das 6 transcrições as mensagens do fundador → `memory/decisoes.md` (cronológico) e `memory/medicoes.md` (números reais).
- Referência §5.2 corrigida: elicitador fixo forte; executor nunca economiza; resto o Jev roteia (inclusive provedor); cascata só fora de Spec/executor. §5.2b: catálogo de 14 usos com estado real.
- `CLAUDE.md`: ordem de leitura obrigatória (diário → decisões → medições → referência → JEV-DECISOES).

**Pendente de esclarecer com o fundador**
- Avaliador entra no roteamento do Jev ou continua fixo forte (06/10 disse "não economizar")?
- "Skill de memória do Claude": instalado `CLAUDE.md` + `memory/` + ganchos; confirmar se ele quer outro (ex.: plugin específico).

**Próximo passo**
- Com as respostas: escrever prompts P0 e P1 (este inclui adotar `@typesafe-ai/sdk`).

---

## 08/10/2026 (3) — plano v2 "Jev máximo" + protocolo do Antigravity

**Diretrizes do fundador**
- Implementar tudo o que serve do Jev (orquestração/decisão).
- Crédito hoje só no DeepSeek; Claude e Gemini depois. **Não economizar na Spec nem no executor.**
- Documentar antes de executar; prompts ao Antigravity com travas; relatórios para auditoria.

**Feito (só documentação, nada de código)**
- Referência §5 trocada pelo plano v2: pacotes P0–P10; mudanças M1–M5 (executor/elicitador sempre no modelo forte; cascata J22 descartada; J16 passa a decidir divisão; J23 vira trava ativa enquanto só houver DeepSeek; teto de custo precisa de valor novo).
- Referência §8: travas T-A…T-K, estrutura do prompt, formato do relatório, auditoria.
- Pastas `docs/prompts/` e `docs/relatorios/`.

**Onde parou**
- Plano apresentado; aguardando aprovação (§6 da referência).

**Próximo passo**
- Aprovado → escrever `docs/prompts/P0-arrumacao.md` e `docs/prompts/P1-nucleo-jev.md`.

**Pendências do fundador**
- Aprovar plano v2 e ordem · teto de custo (proposta US$ 3,00 em P1–P4) · privacidade do Jev (proposta: aceitar) · stack/recorte do Gateway · Exa como busca.

---

## 08/10/2026 (2) — memória, ganchos, Jev a fundo, fluxo real × pensado

**Feito**
- Memória do projeto: `CLAUDE.md` (lida em toda sessão) + `memory/` (diário, glossário, projeto).
- Ganchos em `.claude/settings.json`: `SessionStart` injeta a última entrada do diário; `Stop` impede encerrar com commit novo sem diário. Testados por pipe (bloqueia/libera). Podem exigir `/hooks` ou reiniciar para valer.
- Recomendador do Claude Code setup rodado (só recomenda; nada mais instalado).
- Documentação do Jev baixada (46 páginas) e analisada: 22 recursos (R1–R22), 27 usos no NextCode (J1–J27): 7 ligados, 2 em sombra, 5 mortos, 13 propostas.
- Fluxo real traçado no código e comparado ao pensado: miolo da execução está como pensado; a **entrada não** (sem skill elicitador no chat, sem Macrobrief/CONFERENCIA por `etapa1Ativa: false`, sem analista LLM, sem pesquisa T7).
- `docs/NEXTCODE-REFERENCIA.md` reescrito: §0 regras, §2 fluxo hoje × pensado (diagramas), §4 Jev, §5 plano A–F.

**Onde parou**
- Aguardando o fundador aprovar o plano (§6 da referência).

**Próximo passo**
- Após aprovação: A2 (`McpServer.env` cifrado) → A3 (base comum do Jev) → A4 → A5 → Fase B.

**Pendências do fundador** (referência §6)
- Ordem A → F e quais propostas 📝 entram · billing Google/crédito Anthropic · stack/recorte do Gateway · privacidade do Jev (trechos de código do usuário) · quando sair do modo sombra.

---

## 08/10/2026 — sessão Claude (auditoria + referência única)

**Feito**
- Revisão do plano: itens 2, 3, 5, Extra concluídos; 1, 4, 6, 7, 8, 9 parciais (ver referência §3).
- Spec do Gateway (`docs/specs/gatway-system-spec.md`) é rejeitada pelo validador atual (formato V5, sem REQ); pasta `c:\projetos\gatway` não existe.
- Auditoria do Item 10 (feito pelo Antigravity, commits `414bee0`…`e4b2db6`):
  - commits `5fbf4e8`, `0697cc8`, `5e546d1` não compilam isolados; corrigido por *amend* não declarado em `926a5d6`.
  - **vazamento:** guarda de segredos mandava a linha com a chave ao Jev. **Corrigido em `c7fb624`** (4 testes; 586 testes verdes, `tsc` 0).
- Documentação do Jev baixada (llms.txt + 33 páginas) e analisada em parte.
- Criado `docs/NEXTCODE-REFERENCIA.md` (fonte única) + aviso no topo dos 6 docs antigos — **ainda não commitado**.
- Instalada a memória do projeto (`CLAUDE.md` + `memory/`).

**Onde parou**
- Fundador pediu: (1) memória ✅; (2) "claude setup"; (3) análise **profunda** do Jev para usar 15+ funcionalidades; (4) explicar o fluxo real × o pensado; (5) toda melhoria aprovada entra na referência antes de executar.

**Próximo passo**
- Rodar o recomendador do Claude Code setup; depois análise profunda do Jev → seção 4 da referência; depois mapa do fluxo real (com arquivo:linha) × pensado.

**Pendências do fundador**
- Billing Google ou crédito Anthropic (avaliador independente).
- Stack e recorte do Gateway.
- Aprovar ordem das fases A → F da referência.
