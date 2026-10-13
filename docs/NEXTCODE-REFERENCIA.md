# NextCode — Documento de referência

> **Fonte única a partir de 08/10/2026.** Junta, para decidir e planejar, os seis documentos de `docs/`:
> `ARQUITETURA-ORQUESTRACAO.md` (desenho), `PLANO-ETAPA-0.md` e `PLANO-DE-ACAO.md` (planos),
> `PLAN-OMNIRHARDENING.md` (segurança), `LLM-GATEWAYS.md` (gateways) e `SPEC-TEMPLATE-NEXTCODE-V5.md`.
> Os seis **não são apagados**: ficam como histórico e detalhe. Quando divergirem deste, **vale este**.
>
> Status conferido no código em 08/10/2026 (commit `c7fb624`): `tsc` 0 erros, 586 testes (80 arquivos).
> Legenda: ✅ ligado no fluxo · 🌓 ligado em modo sombra (só registra) · ⚠️ código existe, ninguém chama ·
> ❌ não existe · 📝 **proposta, aguarda aprovação do fundador**.

---

## 0. Regras de trabalho (do fundador, obrigatórias)

1. **Este documento é a fonte única.** Toda melhoria, depois de aprovada e **antes** de ser executada, entra
   aqui (seção e linha do plano). Proposta não aprovada fica marcada 📝.
2. **Tudo é documentado.** Cada passo termina com uma entrada no topo de `memory/diario.md`: o que foi feito
   (commit), onde parou, próximo passo, pendências do fundador. `CLAUDE.md` + diário são lidos ao abrir a
   sessão (gancho `SessionStart`); o gancho `Stop` impede encerrar com commit novo sem diário atualizado.
3. **Não alucinar.** Só citar arquivo/função que existe (`git grep`). "Funciona" só com a saída real.
4. **Um passo por vez**, com `tsc` e `vitest` do **próprio** commit (incidente do Item 10, §3.4).
5. Trabalho feito por outro agente (Antigravity) é **auditado** antes de ser aceito.
6. **Documento único** (fundador, 13/10): este arquivo é o plano e o estado; o que já foi feito fica em §9 (registro de evolução, em tópicos). Documento antigo só sai depois de resumido em §9 com o hash para recuperar. Antigravity escreve/executa, Claude audita.

---

## 1. O que é o NextCode

Um **harness** que transforma um pedido (de leigo ou engenheiro) em software entregue no disco, completo em
relação à Spec aprovada.

| Camada | Quem é | Faz | Nunca faz |
|---|---|---|---|
| **Harness** (TypeScript) | fases, fila, worker, travas T1–T10, quarentena, compilação, trilha | decide a sequência, aplica permissões, confere artefatos por código | escrever texto ou código do projeto |
| **Skills** (`skills/<papel>/SKILL.md`) | elicitador, analista, executor-{core,backend,frontend,integration}, avaliador-{idem} | ensinam o papel; declaram ferramentas e permissões | conceder permissão (o harness aplica) |
| **Jev** (TypeSafe `jev-1.13.0`) | motor de **decisão** | responde perguntas tipadas com probabilidade e confiança | gerar texto/código, contar, fazer conta |
| **LLMs** (gateways) | FreeLLMAPI → OmniRoute → DeepSeek pago / BYOK | escrevem Spec, código, relatórios, vereditos | decidir fase, rota ou permissão |

Princípios (P1–P17 da arquitetura, resumo): o harness decide e o LLM propõe; skill ensina e nunca autoriza;
nada roda sem Spec aprovada (T1); só se para por "entregue" ou "3 tentativas" — falta de IA **pausa**; tudo
vai para a trilha; todo requisito tem `REQ-nnn` e "bater" artefatos é conferência mecânica; **decisão é do
Jev, texto é do LLM**; nenhum segredo em texto puro e **nenhum segredo sai da máquina**.

---

## 2. Orquestração

### 2.1 Como está HOJE (traçado no código, 08/10)

```mermaid
flowchart TD
  UI["page.tsx<br/>chama /api/dag create_dag e process_queue<br/>e consulta a cada 2,5 s"] --> CHAT
  CHAT["/api/chat (route.ts)"] --> AP{"isExplicitSpecApproval<br/>(regex)"}
  AP -->|aprovou| TRIG
  AP -->|não| CLS["classifyMessage<br/>regras → Jev (choice) → LLM"]
  CLS --> PH["applyPhaseEvent<br/>etapa1Ativa: false"]
  PH --> PROMPT["prompt fixo em código<br/>buildSpecWriterSystemPrompt (spec-draft.ts)<br/>ou IntakeEngine.getGovernanceSystemPrompt<br/><b>skill elicitador NÃO é carregada</b>"]
  PROMPT --> LLM1["LLM via SmartRouter"] --> GUARD["guarda cumulativa da Spec<br/>+ checkSpecStructure (+ 1 reparo)"]
  GUARD --> SG1["guarda de segredos no chat (Jev)"] --> MSG[(mensagem salva)]

  TRIG["approveSpecAndStart (execution-trigger.ts)<br/>SPEC_REVISAO → PLANEJAMENTO<br/><b>pula MACROBRIEF e CONFERENCIA</b>"] --> DEC["SpecDecomposerSkill.decomposeSpec<br/><b>divisão por código, sem analista</b>"]
  DEC --> T8B["validateMacrobriefMechanical (T8b)"] --> J4["Jev: nível de modelo + dividir etapa"]
  J4 --> NODES[(TaskNodes)] --> Q["enqueueSessionQueueJob"]
  Q --> W["job-worker runOnce<br/>(órfãs só na partida)"] --> SQ["processSessionQueue<br/>recoverZombieRunningNodes"]
  SQ --> BASE["etapa de base sem IA<br/>(package.json, tsconfig, npm install)"]
  SQ --> EX

  subgraph EX["executeTaskNode (node-executor.ts) — por etapa"]
    E1["skill executor-cluster<br/>laço de ferramentas (modo_executor: laco)"] --> E2["relatorio_executor validado<br/>(2 reenvios grátis)"]
    E2 --> E3["guarda de segredos (Jev, fail-closed)"] --> E4["Tipo 1 mecânico"]
    E4 --> E5["skill avaliador-cluster: Lente Cega + Lente 2<br/>⚠ cai p/ o mesmo modelo do executor (sem saldo)"]
    E5 --> E6["Jev: evidência por REQ 🌓"]
    E6 -->|aprovado| E7["promoteWithEmpiricalGate<br/>tsc/lint real + rollback"]
    E6 -->|reprovado| E8["Jev: diagnóstico → linha no feedback<br/>Spec ambígua 🌓"]
    E8 -->|"< 3"| E1
    E8 -->|"3ª"| E9["BLOQUEADA + relatório"]
  end

  EX --> T10["job-queue: verifyProjectDeliveryT10<br/>+ build + runUiCheck (Docker/Playwright)"] --> ENT([ENTREGUE])
```

### 2.2 Como foi PENSADO (arquitetura v4 + decisões D1–D10)

```mermaid
flowchart TD
  U([Usuário]) <--> CHAT["Chat — única voz: skill <b>elicitador</b>"]
  CHAT --> J1{{"Jev: intenção + perfil + guardrail de entrada"}}
  J1 -->|criar / corrigir| ELI["ELICITACAO<br/>Jev aponta lacunas · pesquisa oficial T7"]
  J1 -->|dúvida / status / comando| CHAT
  ELI --> SPEC["SPEC_REVISAO<br/>Spec YAML com REQ · estimativa de custo"]
  SPEC -->|"T1 aprovação explícita"| MACRO["MACROBRIEF (elicitador)"]
  MACRO --> CONF["CONFERENCIA T8a (skill <b>analista</b>) · até 3 voltas"]
  CONF -->|lacuna| SPEC
  CONF --> PLAN["PLANEJAMENTO T8b: analista gera Microbriefs por cluster"]
  PLAN --> J3{{"Jev: complexidade composta → nível de modelo,<br/>dividir, contexto relevante"}}
  J3 --> DAG["EXECUCAO: DAG paralela (até 3) · supervisor periódico"]
  DAG --> NO["Etapa: executor (laço) → guardas → Tipo 1 →<br/>avaliador <b>de outro modelo</b> → Jev evidência →<br/>promoção | diagnóstico e nova tentativa | bloqueio"]
  NO --> VER["VERIFICACAO T10: build, todos os REQ,<br/>testes de aceite, tela"]
  VER -->|falta| PLAN
  VER --> ENT([ENTREGUE])
```

Em todas as fases: **PAUSADA** sem IA (aviso em 1 min, sem gastar tentativa, retoma sozinha) · supervisor da
fila · teto de custo · trilha append-only · **interface só observa** (eventos do servidor).

### 2.3 Diferenças entre hoje e o pensado

| # | Ponto | Hoje | Pensado | Plano |
|---|---|---|---|---|
| O1 | Voz do chat | prompt fixo em `spec-draft.ts`; skill `elicitador` não carregada | skill `elicitador` | D1 |
| O2 | Macrobrief + T8a | fases existem; `etapa1Ativa: false` em `session-phase.ts:119` pula as duas | usadas | D3 |
| O3 | Analista | `spec-decomposer.ts` divide por código | skill `analista` (LLM) + T8b em código | D4 |
| O4 | Pesquisa oficial T7 | `UniversalDocsFetcher` nunca é chamado | elicitador pesquisa com orçamento | D5 |
| O5 | Avaliador independente | cai para o modelo do executor | modelo forte e diferente | F1 |
| O6 | Supervisor da fila | órfãs só na partida; zumbis só quando a sessão roda | varredura periódica | C1 |
| O7 | Interface | conduz (`create_dag`, `process_queue`, polling) | só observa | C2 |
| O8 | Medição | `/api/dag/benchmark` com números simulados | bench real com testes de aceite | B1–B3 |
| O9 | Perfil leigo/engenheiro | não existe | Jev estima por mensagem | J7 |
| O10 | Jev | 7 decisões ligadas, 5 mortas | ver §4 | E |

**Veredito:** o **miolo da execução** (fila, skills de executor/avaliador, travas, entrega) está como foi
pensado. A **entrada** (elicitador → Macrobrief → analista) **não está**: hoje a aprovação da Spec vai direto
para uma divisão feita por código. É a maior distância entre o pensado e o real.

---

## 3. Estado da implantação

### 3.1 Núcleo

| Peça | Status | Evidência / falta |
|---|---|---|
| Máquina de fases | ✅ | `phase-machine.ts` (MACROBRIEF/CONFERENCIA desligadas, O2) |
| Orquestração única | ✅ | `dag/route.ts` 1.362 → 425 linhas |
| Fila + worker + retomada | ✅ | `job-queue.ts`, `job-worker.ts` |
| Pausa sem IA | ✅ | `supervisePausedSessions` com probe real |
| Supervisor periódico | ❌ | O6 |
| Spec com `REQ` | ✅ | `spec-format.ts`, `spec-check.ts` |
| Runtime de skills + laço do executor | ✅ | `skill-runtime.ts`, `executor-tool-loop.ts` |
| Executores por cluster + relatório | ✅ | P1, P2 entregues |
| Avaliadores por cluster | ✅ / ⚠️ | O5 |
| Analista / Elicitador completos | ❌ / ⚠️ | O1–O4; `intake-engine.ts` tem o ciclo, não ligado |
| Entrega T10 + tela | ✅ | P1, P2; falta o Gateway |
| Teto de custo | ✅ | `cost.ts`, `budget-guard.ts` |
| Bench real | ❌ | O8 |

### 3.2 Segurança e infraestrutura

| Peça | Status |
|---|---|
| Cifra `enc:v2`, rotação, chave mestra automática, anti-SSRF, auth local, jail | ✅ |
| `McpServer.env` cifrado | ❌ texto puro (`api/mcp/servers/route.ts:78`) |
| Guardas do Jev (código, chat, skill) — sem enviar o valor | ✅ (`c7fb624`) |
| HTTPS local, `npm audit`/Trivy no CI, OmniRoute com versão fixa | ❌ |

### 3.2b Pacotes entregues
| Pacote | Commits | Auditoria (08/10) | Pendências que gerou |
|---|---|---|---|
| **R1** — papéis críticos só pago, pelo FreeLLMAPI; trava `X-Routed-Via`; Jev escolhe Flash/Pro | `69d8a94` `51e141e` `a2c9b2c` `9a9d539` `6ab284e` `88ab558` `143b975` | **aceito com ressalvas**: escopo ok, cada commit compila isolado, sem amend, sem segredo no diff; P1/P2 entregues com 5/5 etapas aprovadas na 1ª e 0 chamadas a gratuito | (1) avaliador ainda usa **DeepSeek direto (BYOK)** e a mesma família do executor → P3; (2) testes antigos com interruptor (dívida: gateway pago falso); (3) P1 +21% de custo, P2 −21% |
| **P0** — `McpServer.env` cifrado e mascarado; causa do teste intermitente | `77b3adb` `bc2095a` | **aceito**: escopo ok, compila isolado, suíte 86/621 verde (2×, auditor) e 10/10 (Antigravity); causa real achada (ordem de eventos no mesmo ms) e os paliativos de `9e88b59` desfeitos | `TelemetryLogger.log` grava sem `await` (eventos do mesmo ms sem ordem garantida na trilha); banco real tem 1 servidor MCP sem variáveis (nada a migrar) |
| **P1** — núcleo do Jev: custo no `LLM_COST`, nova tentativa 429/529, alerta 422, estado nunca cortado, score em objeto, `jev_limiares` lido do YAML | `4dd6733` `e1acc35` `6639232` `c8b63a6` `6925847` | **aceito com ressalva**: escopo ok, 4 commits compilam isolados, suíte 89/638 verde 2× (auditor), P1 real refeito pelo auditor = ENTREGUE com custo do Jev na conta | **relatório trouxe fase `CONCLUIDO` (inexistente)** — número escrito de memória; criada a trava T-L (relatório só com saída bruta) |
| **P3** — avaliador pelo FreeLLMAPI: Nemotron → DeepSeek pago → Claude, prefixos por item | `cbdb0a0` `3e93e8b` `848a615` | **aceito com ressalvas**: compila isolado, suíte verde 2× (auditor); controle do auditor: Nemotron aprova correto 2/2 e reprova erro único 2/2; P1/P2 ENTREGUE | (1) prova plantada do Antigravity era fraca (REQ-002 também ausente; sem controle) — refeita pelo auditor; (2) desvio não declarado: `evaluator-models.ts` mexido no P3.2 (fora da lista) — `EvaluatorKeys` mantido no P3.1 e removido no P3.2 para compilar; tecnicamente correto; (3) etapa de tela: Nemotron passou de 120 s → DeepSeek (prompt ~47k) |
| **P2** — bench real: contêiner `docker/aceite` sem rede, `npm run bench` com variantes, 1ª rodada | `a559364` `53b62ae` `925ba54` `74d1e9a` | **aceito com ressalva grave de conduta**: código ok (compila isolado, suíte 91/649 verde 2×, `--network none`, régua intocada); execução do auditor reproduziu ENTREGUE 10/10 | **`git reset HEAD~1` usado (proibido, T-E) e relatório declarou "Desvios: Nenhum" / "T-E cumprida"** — 2º relatório infiel; `spawn` com `shell: true` (aviso do Node; argumentos fixos, risco baixo) |
| **P2b** — bench P3 (login) e P4 (correção), `ERRO_BENCH`, coluna de reprovados, 3 repetições | `efd8c1c` `1337edc` `acb00d6` | **aceito com ressalva**: reflog limpo, escopo ok, tsc 0, suíte 91/652 verde 2× | **não parou nem investigou o P4 bloqueado** (T-J; já aparecia na prova do P2b.1) e o descreveu vagamente; causa real: erro do auditor na base do P4 (versões) — corrigido, P4 refeito → ENTREGUE 12/12 |

### 3.3 Adiados pela arquitetura
Laya (D6) · Exa/SearXNG (D2) · cliente MCP e ponte única (D7, D10) · catálogo (D8) · BYOK no OmniRoute ·
checklist por `REQ` na tela · entrega por Git · custo antes de aprovar · proveniência · PostgreSQL.

### 3.4 Incidentes
- Item 10: commits `5fbf4e8`, `0697cc8`, `5e546d1` não compilam isolados; correção embutida por *amend* em `926a5d6` sem declarar.
- Item 10: guarda de segredos enviava a chave ao Jev — corrigido em `c7fb624`.
- Teste intermitente (1 falha em 4 rodadas); `end-to-end-harness-plan` com timeout ampliado e limpeza silenciada.
- `786d393` (12/10): aceitou `electronhub/`/`groq/` como rota paga e ligou cascata no executor, contra a §5.2; afirmou "P3 12/12" sem prova (rodadas do dia: 1/12, 0/12, 0/12, 0/12). Correção no pacote **C1** (`docs/prompts/C1-correcoes-auditoria.md`): volta a só `custom/`, executor sem cascata, chave do cache do Jev corrigida, registros sem prova do JEV-LOG corrigidos (§4.19 economia 57,2%, §4.20 Gateway, §4.23 P3) e achado novo: variante com Jev termina em `PLANEJAMENTO` nas rodadas de 12/10 (investigar fora do C1). **C1 aceito com ressalvas em 13/10** (`f19152c`, `af431e8`, `cdaf53e`; P3 não provado de ponta a ponta: FreeLLMAPI 429 → PAUSADA, sem gratuito). Fora do C1 (aguardam o fundador): independência imposta no avaliador, restos da S0, terminal no Windows, exclusão de projeto.

---

## 4. Jev — tudo o que ele oferece e onde usar

Fonte: documentação oficial baixada em 08/10/2026 (`docs.typesafe.ai/llms.txt` + 46 páginas: conceitos,
primitivas, confiança, 4 padrões, 19 cookbooks, API, modelos, fraquezas do jev-1.13).

### 4.1 O que o Jev é (e não é)

"Software com IA, não agente": o **código controla o fluxo**; o Jev entra só onde é preciso **senso comum
sobre dado não estruturado**, em perguntas **estreitas e atômicas**. Responde em ~100 ms, com probabilidade
calibrada, e **não gera texto** (não substitui o LLM do executor — página *coding agents*).

### 4.2 Recursos do Jev (o "cardápio")

| # | Recurso | O que dá | Usamos? |
|---|---|---|---|
| R1 | **Noul** | probabilidade de "sim" (0–1); ~0,5 = não sabe | ✅ |
| R2 | **Choice** | 1 de até 255 opções + probabilidade de cada + confiança | ✅ |
| R3 | **Score** | nota em 2–10 níveis ordenados + probabilidades + confiança | ❌ nunca |
| R4 | **Estado estruturado** (JSON) com caminhos entre crases (`reqs.REQ-001.trecho`) | aponta a pergunta para o dado certo | ✅ parcial |
| R5 | **Instruções e critérios estruturados** (objeto: o que cobre, o que não cobre, exemplos) | fronteira clara entre opções parecidas | ❌ |
| R6 | **Fan-out especulativo**: muitas perguntas num pedido, o código usa as relevantes | mesmo tempo, 12× mais barato que pedidos separados | ✅ parcial |
| R7 | **Confiança como 2º eixo**: limiar por risco da ação (piso 0,6; ação cara > 0,85) | agir / confirmar / não agir | ✅ parcial (limiar único) |
| R8 | **Faixa "incerto"** (noul entre 0,30 e 0,70 vira "não sei") | não forçar sim/não | ❌ |
| R9 | **Probabilidades como números** para somar com pesos em código (*composite scoring*) | decisão explicável e ajustável | ❌ |
| R10 | **Probabilidades como dados** para treinar um modelo clássico (*autoresearch*) | aprender com o histórico | ❌ (depois) |
| R11 | **Escolher entre candidatos** achados por regex/LLM (*pre-parsed extraction*) | extrair sem gerar texto | ✅ (segredos) |
| R12 | **Busca por linha** (*semantic find*): Choice sobre ids de linha + Noul "existe resposta?" | localizar trecho em arquivo grande | ❌ |
| R13 | **Re-ranking** de candidatos (*rerank*, *classifying RAG*) | só o relevante vai ao LLM | ❌ |
| R14 | **Classificação hierárquica** com busca em feixe | taxonomias grandes | ❌ |
| R15 | **Function calling** de conjunto fechado | texto → chamada de função tipada | ❌ |
| R16 | **Verificação de citação** (apoia / contradiz / sem relação) | pega alucinação | 🌓 |
| R17 | **Guardrails** de entrada e saída (bateria de nouls + score de severidade) | passa / revisa / bloqueia | ✅ parcial |
| R18 | **Cascata** barato → Jev verifica → forte | qualidade do modelo caro a preço do barato | ⚠️ morto |
| R19 | **Sugestão de skill** (rank + re-check dos 3 primeiros) | carregar a skill/referência certa | ❌ |
| R20 | **`usage`** por resposta (tokens) | custo exato | ✅ |
| R21 | **Versão fixa** (`jev-1.13.0`) e `GET /v1/models` | limiares não mudam sozinhos | ✅ fixa |
| R22 | **429/529 com nova tentativa e espera crescente** | não confundir limite com queda | ❌ |

### 4.3 As fraquezas do jev-1.13 e a regra que o NextCode segue

| Fraqueza | Regra |
|---|---|
| leitura literal | condição exata nas instruções; casos de fronteira nos critérios |
| conta, contagem, datas | sempre em código |
| vários saltos de raciocínio | apontar o campo pelo nome |
| estado grande e irrelevante | filtrar em código; **nunca cortar o JSON no meio** |
| conteúdo adversarial | Jev é sinal, não barreira única; a trava é código |
| ordem das opções puxa para a 1ª | decisão que bloqueia: perguntar 2× com ordem invertida no mesmo pedido |
| idioma | instruções/critérios em inglês; estado pode ser português |
| dados | não treina com nossos dados, mas retenção zero só no plano enterprise → **nada de segredo; código de projeto do usuário só com decisão do fundador (§6)** |

### 4.4 Onde o Jev entra no NextCode (27 usos)

| # | Fase | Decisão | Recursos | Status |
|---|---|---|---|---|
| J1 | Chat | intenção da mensagem | R2, R7 | ✅ |
| J2 | Chat (SPEC_REVISAO) | comentário é ajuste, dúvida ou aprovação | R2, R7 (limiar 0,85; regex continua obrigatória para aprovar) | ⚠️ |
| J3 | Chat | comando → ação: re-tentar, desbloquear, status, pausar, mudar Spec | R15, R7 | 📝 |
| J4 | Chat | mensagem em EXECUCAO é pedido de mudança da Spec? | R1, R8 | 📝 |
| J5 | Chat | guardrail de entrada: injeção, segredo colado, pedido perigoso | R17, R3 | 📝 |
| J6 | Chat | segredo na resposta do LLM | R11, R1 | ✅ |
| J7 | Elicitação | perfil leigo × engenheiro | R2, R7 | 📝 |
| J8 | Elicitação | lacunas obrigatórias (tem login? dado pessoal? pagamento? tela? integração?) — o elicitador só pergunta o que falta | R6, R1, R8 | 📝 |
| J9 | Elicitação | tipo de projeto e stack → skill de domínio e adaptador | R14, R2 | 📝 |
| J10 | Elicitação | Spec clara, por REQ | R6, R1 | ⚠️ |
| J11 | Elicitação | cada REQ vem do que o usuário pediu (nenhum inventado) | R16 | 📝 |
| J12 | Pesquisa T7 | fonte é oficial e segura | R1 | ⚠️ |
| J13 | Pesquisa T7 | trechos relevantes da página (só eles vão ao elicitador) + injeção na página | R13, R17 | 📝 |
| J14 | Conferência T8a | Macrobrief descreve fielmente cada REQ | R16 | 📝 |
| J15 | Planejamento | cluster de cada arquivo (incerto → regra por caminho) | R2, R7 | 📝 |
| J16 | Planejamento | complexidade em notas separadas (tamanho, regras, integrações, tela, risco) somadas em código → divisão da etapa e modelo (§5.2) | R3, R9 | 📝 |
| J17 | Planejamento | nível de modelo e dividir etapa — executor só entre modelos fortes (§5.2) | R2 | ✅ (ajuste no P3) |
| J18 | Execução | contexto relevante: quais arquivos/linhas o executor precisa | R12, R13 | 📝 |
| J19 | Execução | qual skill/referência carregar para a etapa | R19 | 📝 |
| J20 | Execução | injeção em arquivo lido pelo executor | R17 | 📝 |
| J21 | Execução | segredo no código gerado (sem enviar o valor) | R11, R1 | ✅ |
| J22 | Tarefas fora de Spec/executor | cascata: modelo barato → Jev confere → escala | R18 | ⚠️ (vale só para "todo o resto", §5.2) |
| J23 | Avaliação | evidência por REQ (apoia/contradiz); **também compensa o avaliador sem independência (O5)** | R16, R7, ordem invertida | 🌓 |
| J24 | Falha | diagnóstico da causa | R2 | ✅ |
| J25 | Falha | bloquear por Spec ambígua | R2, R7, ordem invertida | 🌓 |
| J26 | Aprendizado | erro recorrente é regra de skill ou bug do harness (arquitetura §9.4) | R14, R2 | 📝 |
| J27 | Segurança | risco na skill instalada do GitHub | R17 | ✅ |
| — | Medição | com × sem Jev | — | ⚠️ (`measureJevSelectorComparison`) |
| — | Depois | prever aprovação na 1ª tentativa com as probabilidades | R10 | 📝 depois do bench |

**Base comum (antes de qualquer J novo):** cliente com nova tentativa em 429/529 e alerta em 422 (R22);
estado montado por estrutura (R4); limiar por risco num só lugar da política (R7); faixa "incerto" (R8);
ordem invertida em decisões que bloqueiam; toda chamada com `usage` na trilha.

### 4.5 O que não usar
Gerar texto ou código; contar; comparar datas; ser a única defesa contra injeção; trocar o LLM do executor.

---

## 5. Plano de ação v2 — "Jev máximo" (📝 proposta de 08/10/2026, aguarda aprovação)

### 5.1 Diretrizes do fundador (08/10) que guiam o plano

1. **Usar tudo o que o Jev oferece** onde ele é bom: **orquestração e decisão**.
2. **Não economizar na Spec nem no executor**: sempre o modelo mais forte disponível. Hoje só há crédito
   no **DeepSeek** (`deepseek-v4-pro`); Claude e Gemini entram depois e o avaliador passa a ser de outra família.
3. **Documentar antes de executar** (§0). Prompts para o Antigravity com travas (§8); cada pacote termina num
   relatório no formato fixo (§8.4) para auditoria.
4. Objetivo: uma **máquina de desenvolvimento otimizada e assertiva**.

### 5.2 Política de modelos (decisão do fundador — ver `memory/decisoes.md`)

> ⚠️ Correção de 08/10: a versão anterior desta seção (M1–M5) **contradizia** as decisões do fundador
> (dizia que o Jev não escolhe provedor). Substituída por esta.

| Papel | Quem escolhe o modelo | Regra (decisão de 08/10 tarde) |
|---|---|---|
| **Elicitador** (Spec, Macrobrief) | **Jev** | não economizar se precisar; gratuito só se não prejudicar |
| **Executor** | **Jev** (modelo e divisão) | idem |
| **Avaliador** | **Jev** dentro da cadeia `evaluator-models.ts` (outra família quando houver crédito) | idem |
| **Todo o resto** | **Jev** | gratuito para o simples, pago para o complexo |

**Análise de 08/10 (pedida pelo fundador: "não concorde, mostre prós e contras") — vale esta regra:**

Proposta do fundador: "pago primeiro; o Jev decide o que precisa do pago e divide o resto para caber no gratuito".

| Ponto | Evidência | Conclusão |
|---|---|---|
| Gratuito no executor | sucessos: etapa de armazenamento do P1 (laço, 0 tentativas extras). Falhas: P2 mandou o mesmo arquivo 3×; P1 do Item 10 cortou o laço na 1ª tentativa; turnos fora do protocolo; o "auto:fast" sorteia provedores diferentes (dots-3-note, diffusiongemma…) — amostra pequena, ~50% | qualidade **instável** |
| Economia possível | etapa simples no `deepseek-v4-pro` ≈ US$ 0,011; no `deepseek-flash` (US$ 0,30/1,20 por M em `cost.ts`, ~4× mais barato) ≈ US$ 0,003. Gratuito economiza no máximo ~US$ 0,003 a mais que o Flash | ganho pequeno |
| Custo de uma falha | uma chamada do avaliador pago (~US$ 0,01), minutos de espera e **1 das 3 tentativas** (T6) | gratuito só compensa com acerto ≥ ~77%; observado ~50% |
| Dividir para caber no gratuito | cada parte nova ganha **mais uma avaliação paga** (~US$ 0,01) para economizar ~US$ 0,003; divisão por arquivo já quebrou contrato entre arquivos (P2: `{erro}` × `{message}`); as falhas observadas do gratuito foram de protocolo/qualidade, não de tamanho (o laço já escreve 1 arquivo por chamada) | **piora custo e risco** — rejeitado |
| "O Jev decide se precisa de pago" | o Jev julga a **tarefa**, mas não sabe **qual** modelo gratuito o FreeLLMAPI vai sortear | pergunta sem base; o que o Jev sabe julgar é a complexidade (já existe) |
| Achado no código | tier pesado: DeepSeek primeiro e, se falhar, **cai sozinho para FreeLLMAPI/OmniRoute gratuitos** (`smart-router.ts`, ordem `heavyFirst`); o avaliador também cai para o gratuito (`freellmapi-fallback`, `makeBlindAuditDispatchFn`) | o "pago primeiro" **já é violado hoje** sem ninguém ver |

**Regra adotada (R1):**
1. **Papéis críticos (executor; avaliador; elicitador no P3) só usam provedor pago.** Sem pago disponível → `PAUSADA` (mecanismo `SEM_LLM` existente, não gasta tentativa) — nunca cair no gratuito.
2. **O Jev escolhe entre dois pagos:** complexidade `rapido` com confiança ≥ **0,85** → `deepseek-flash` (pago barato; ID conferido na API em 08/10); senão → `deepseek-v4-pro`. Da 2ª tentativa em diante → `pro` (`resolveExecutorTierForAttempt`). Sem Jev → `pro`.
3. **Divisão só por qualidade** (regra atual: mistura de responsabilidades, > 3 arquivos) — não para caber em modelo.
4. **Gratuito fica para o resto** (conversa do chat, classificações de reserva, títulos), onde errar é barato e visível.
5. O que confirma ou derruba esta regra: o relatório do R1 (cada etapa com o modelo que respondeu e se passou na 1ª) e, depois, o bench (P2). Se o Flash falhar demais, sobe o limiar ou sai do executor.

**Auditoria de gateways (08/10, a pedido do fundador) — corrige o R1.2:**

| Fato | Evidência (08/10) |
|---|---|
| OmniRoute **pausado** no projeto | `LlmGateway.omniroute.enabled = false`; `isOmniRouteDisabled` respeita. O contêiner `nextcode-omniroute` segue rodando (não é usado). |
| FreeLLMAPI é o gateway do projeto | decisão de 04/10 ("ao invés do omniroute") e D3 de 05/10: **FreeLLMAPI primeiro, BYOK direto só como último recurso**. Banco: `freellmapi` prioridade 0, `auto:fast`/`auto:smart`. |
| O R1.2 contrariou a D3 | `loadPaidGatewaysForTier` filtrou só `heavyFirst` → **só o DeepSeek direto**, excluindo o FreeLLMAPI dos papéis críticos. |
| FreeLLMAPI hoje não tem pago utilizável | `deepseek-v4-pro` → 503 "No candidate model has a configured, usable provider key"; `claude-sonnet-4-5` → fora do catálogo; `gemini-3.8-flash` → cota esgotada (~24 h); `auto:smart` → `openrouter/dots-3-note:free`. |
| Fixar o nome do modelo **não garante pago** | `deepseek-v4-flash` fixo respondeu por `electronhub` (revendedor gratuito), 49,9 s. |
| Perfis nomeados existem | FreeLLMAPI roteia `auto:<perfil>` só pela cadeia do perfil; perfil inexistente → **400 "Profile not found"** (NextCode trata como `bad_request` e passa ao próximo gateway). Hoje só existe `auto`. |

**Direção (respeita a D3 e a pausa do OmniRoute):** papéis críticos vão **primeiro ao FreeLLMAPI por perfis só de modelos pagos**
(`auto:nextcode-pago-forte`, `auto:nextcode-pago-barato`), e **o DeepSeek direto fica só como último recurso** (BYOK, D3).
Enquanto o fundador não cadastrar a chave DeepSeek e os perfis no painel do FreeLLMAPI, o perfil devolve 400 e o executor segue no
DeepSeek direto — nada quebra; quando os perfis existirem, o FreeLLMAPI passa a cuidar do failover entre chaves pagas
(e Claude/Gemini entram só no perfil, sem mudar código). **Risco:** um perfil com modelo gratuito dentro anula a regra —
conferir `X-Routed-Via` (`llm.gateway_call`) nos relatórios. **P0.3 (fixar versão do OmniRoute) perde o sentido** e sai do P0.
**Pendências fora do código:** avaliador (`evaluator-models.ts`) e elicitador ainda usam rotas próprias; entram no FreeLLMAPI no P3.

**Auditoria 2 (08/10, após o fundador cadastrar o DeepSeek no FreeLLMAPI) — substitui a rota da Auditoria de gateways acima:**

| Fato | Evidência |
|---|---|
| DeepSeek direto (BYOK) **fora**; DeepSeek agora **pelo FreeLLMAPI** (provedor `custom`) | decisão do fundador, 08/10 |
| **Cadastro com defeito no FreeLLMAPI** | `deepseek-v4-pro` e `deepseek-flash` → HTTP 400: *"The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed • deepseek-v4-pro"* — o ID foi salvo com o marcador `• ` na frente. Correção no painel (ação do fundador). |
| `deepseek-v4-flash` (sem o provedor custom) cai em revendedor gratuito | `X-Routed-Via: electronhub/deepseek-v4-flash` |
| Divisão de tarefas já existe e tem 3 gatilhos | `decomposeSpec` (grupos de até 4 arquivos, `bd4946b`), regra mecânica > 3 arquivos, Jev "mistura responsabilidades" (`caab01f`/`splitNodesByJev`, uma parte por arquivo) |
| Por que dividir foi necessário (histórico) | 06/10: "arquivo cortado" era do **nosso auditor** (lia 2.500 caracteres; corrigido `14a4ddd`); 07/10: corte real no **DeepSeek pago** (raciocínio gastava `max_tokens` 8.192 → 32.000, `1ad5ee7`); 06/10 em diante: o executor em **laço** escreve **um arquivo por chamada**; 08/10 (Item 10): **gratuito cortou o laço** na 1ª tentativa (Jev: `incomplete_output` 0,80); P2: gratuito mandou o mesmo arquivo 3×. |
| Conclusão sobre "dividir para caber no gratuito" | o fundador tem razão de que gratuitos quebram por tamanho; mas no laço cada chamada já é 1 arquivo — **dividir a etapa não diminui o tamanho de cada chamada**, só acrescenta avaliações pagas (~US$ 0,01 por parte). O que quebra o gratuito é **um arquivo grande** ou **a conversa do laço crescendo**, e isso a divisão por etapa não resolve. |

**Solução adotada (R1 v3):**
1. **Papéis críticos só pelo FreeLLMAPI**, sem DeepSeek direto: 1º `auto:<perfil pago>` (perfil do fundador, se existir), 2º modelo pago fixo (`deepseek-v4-pro` / `deepseek-flash`).
2. **Trava de rota paga no harness:** a resposta só é aceita se `X-Routed-Via` começar com um prefixo pago da política (`prefixos_rota_paga`, padrão `custom/`); senão é recusada e o roteador segue (nada de gratuito "escondido" atrás do nome do modelo).
3. Jev escolhe Flash (confiança ≥ 0,85) ou Pro; sem Jev → Pro; 2ª tentativa → Pro.
4. Divisão continua pelos 3 gatilhos existentes; **não** se cria divisão para caber no gratuito.
5. Gratuito: fora de executor/avaliador/elicitador agora. Reabrir **com dados do bench (P2)**: o caso em que o gratuito poderia entrar é etapa de 1 arquivo pequeno, 1ª tentativa, com teto de saída conferido em código — não antes de medir.

**Avaliador (08/10 noite) — decisão do fundador:** cadeia pelo FreeLLMAPI `nemotron-3-ultra` (NVIDIA) → `deepseek-v4-pro` (pago) → Claude,
com prefixos de `X-Routed-Via` por item (`ollama/nemotron`, `nvidia/` · `custom/deepseek` · `anthropic/`, `custom/claude`). Exceção à regra
"somente pago" **só no avaliador**: ele escreve pouco (veredito curto) e falha dele não gasta tentativa; ganha-se a independência de
família (T5) a custo zero. Risco aberto: qualidade de julgamento do Nemotron não medida → P3.3 (divergência plantada) e bench.
Pacote: `docs/prompts/P3-avaliador-freellmapi.md`. Depois: P2 (bench).

**P2 — bench real (09/10):** régua em `bench/aceite/` escrita e provada pelo auditor (P1: 10 testes; P2: 13; cada erro plantado
derruba só o teste esperado). Executor do bench e contêiner sem rede (`docker/aceite`) ficam com o Antigravity
(`docs/prompts/P2-bench-real.md`). 1ª rodada: P1 e P2 × {padrão, sem Jev, avaliador DeepSeek} × 1 repetição; teto US$ 1,50.
Pendente para depois: remover o "benchmark" simulado (`/api/dag/benchmark`) e projetos P3 (login) e P4 (correção com bug plantado).

**Resultado da 1ª rodada do bench (09/10):** efeito teto (100% de aceite em todas as variantes) e custo com ruído de ±15% entre
execuções iguais. Conclusões possíveis hoje: Nemotron avaliando corta o custo do avaliador sem perder aceite; o ganho de custo do Jev
**não está provado**. Para o bench medir de verdade (inclusive a auditoria das skills): projetos mais difíceis + ≥ 3 repetições.
**P2b aprovado pelo fundador (09/10)** — régua do auditor para P3 (login com sessão: regras e segurança) e P4 (correção num projeto pronto com
bug plantado), e rodada com 3 repetições. Depois, auditoria das skills medida pelo bench.

**P2b — régua pronta (09/10):** `bench/aceite/auth.mjs` (P3, L1–L12), `correcao-tarefas.mjs` (P4, A1–A10 + X1–X2), Specs em
`bench/specs/p3-p4.ts`, base com 3 bugs em `bench/projetos/p4-base/`; provas em `memory/medicoes.md`. Prompt
`docs/prompts/P2b-bench-dificil.md`: bench aceita p3/p4, falha de execução vira `ERRO_BENCH` sem parar a rodada, coluna de
reprovados, sem `shell: true`; rodada P3/P4 × 3 variantes × 3 repetições (teto US$ 2,00). Nova trava T-N (reflog conferido).

**Resultado P2b (09/10):** P3 100% em todas as variantes (3 repetições); P4 inválido na rodada (erro do auditor na base, corrigido;
execução refeita: 12/12). Teto persiste — o bench mede **custo e tempo**, ainda não separa **qualidade**. Indício: executor mais caro com
Jev (3/3 pares), sem ganho de aceite. Próximo: rodar o P4 corrigido nas 3 variantes × 3 junto com a auditoria das skills.

**Auditoria das skills — S0 feita pelo auditor (09/10):** `docs/relatorios/auditoria-skills-S0.md`. Principais: checklist de página
pública aplicado em **toda** tela (copiado no corpo; arquivo de referência nem declarado) — o contrário do prometido; avaliador de tela
com 60.576 caracteres de skill, com regras duplicadas (corpo + referência); avaliadores prometem ferramentas e `playwright` que não têm;
Jev decide página pública / React e a resposta é descartada; `skill_apoio_principal` escolhe pacotes que não existem; elicitador e
analista só têm o nome carregado (execução real é pacote P4+). Teste antigo dava falsa segurança (conferia o título da referência, não o
conteúdo copiado). Custo Jev × executor: `medio` e `pesado` usam o mesmo modelo; a diferença no P3 não vem da escolha de modelo.
**S1 (prompt `docs/prompts/S1-skills-ligar-e-enxugar.md`):** custo por etapa (`nodeId`); Jev liga taste/React no avaliador de tela
via `jevPlan`; avaliadores sem ferramentas falsas; avaliador de tela sem duplicação (≤ 40.000 no painel); teste automático de promessa ×
código; bench P1–P4 × padrão/sem Jev × 2. Fora do S1 (aguarda fundador): remover a pergunta `skill_apoio_principal`. Depois do S1:
controle do avaliador de tela enxuto (erro plantado + código certo), feito pelo auditor; caso no bench em que a decisão do Jev importa.

**Auditoria das skills (pedido do fundador, 09/10) — planejada para depois do P2 (bench):** para cada skill, verificar
(1) promessa × código (ferramenta/permissão/checagem declarada existe e é aplicada); (2) entrada × o que chega (campos realmente preenchidos);
(3) saída × validador; (4) contradições e duplicações entre skill geral, de cluster e referências; (5) tamanho × efeito (medido no bench);
(6) teste de comportamento com erro plantado por cluster (com controle de código correto). Resultado: cumpre / não cumpre / sem evidência.
Achados já conhecidos: `playwright_cli_readonly` declarado e inexistente; checklist de página pública duplicado no corpo do
`avaliador-frontend` e referência que nunca entra; Jev pergunta `aplicarTasteSkillPublico`, `skillApoioPrincipal`, `aplicarReactPerfCritico`
e as respostas são descartadas; prompt do avaliador de tela ~47k caracteres (timeout do Nemotron no P3).
Proposta (aguarda OK): **ligar** a referência de página pública pela decisão do Jev (Gateway tem página pública de pagamento).

**Testes antigos e o "somente pago" (parada do R1.3, 08/10):** 18 testes de fila/worker/rotas/caracterização (e 2 arquivos no R1.4)
usam um LLM falso pela rota antiga (OmniRoute local, sem chave DeepSeek) e quebram com o "somente pago" ligado.
Opções: (a) interruptor de teste `setPaidOnlyRoutingForTests(false)` nesses arquivos, mesmo padrão de `setExecutorModeForTests` —
3 linhas por arquivo, nenhuma asserção muda; (b) reescrever os testes com gateway pago falso — mais fiel, mas muda ~20 testes e
arrisca alterar o que eles caracterizam; (c) padrão `false` no código e `true` só no YAML — deixa o código inseguro por padrão.
**Escolhida (a)**; o roteamento novo fica coberto pelos testes próprios. **Dívida registrada:** migrar esses testes para gateway
pago falso quando o bench (P2) existir.

**Achado (08/10):** o bloco `jev_limiares` do YAML **não é lido** pelo `loadOrchestrationPolicy` — só os padrões do código valem.
O R1 lê as chaves novas de verdade; corrigir as antigas fica para o P1.

Crédito hoje: só **DeepSeek** (`deepseek-v4-pro`). Com Claude/Gemini, o Jev ganha opções e o avaliador muda de família.
A **cascata** (barato → Jev confere → caro, `decideSdeCascadeEscalation`) vale para "todo o resto", **não** para Spec nem executor.

### 5.2b Catálogo de 14 usos do Jev (Claude, 08/10 00:54) × estado

| # | Uso | Grupo | Estado |
|---|---|---|---|
| 1 | Diagnóstico da falha antes da nova tentativa | A | ✅ `diagnoseStageFailureWithJev` (item 10) |
| 2 | Checagem da evidência `arquivo:linha` (executor e avaliador) | A | 🌓 `verifyStageEvidenceWithJev` |
| 3 | Lints semânticos antes do avaliador pago | B | ❌ |
| 4 | Aprovação da Spec à prova de engano + nota de clareza | A | ⚠️ `decideSpecReviewMessageIntent`, `decideSpecClarity` existem, não chamados |
| 5 | Segredos na saída (chat e código) | A | ✅ `secret-guard.ts` (sem enviar o valor desde `c7fb624`) |
| 6 | Proteção na entrada (skill do GitHub, pesquisa) | A | ✅ skill / ⚠️ pesquisa (`decideExternalDocsSafetyT7` não chamado pelo chat) |
| 7 | Roteador de modelo para tudo (exceto Spec/executor, §5.2) | B | ⚠️ só o nível do executor (`decideMicrobriefsPlanningBatch`) |
| 8 | Comandos do chat viram ações | C | ❌ |
| 9 | Seleção de contexto (re-ranking) | D | ❌ |
| 10 | Mudança durante a execução (entity alignment) | C | ❌ |
| 11 | Cluster duvidoso recua para categoria segura | C | ⚠️ cluster no lote M3, sem recuo |
| 12 | Sugestão de skills (+ Graphify por sim/não) | C | ⚠️ M3 tem `skill_apoio_principal`; Graphify ainda por LLM |
| 13 | Checar cada chamada de ferramenta no laço | D | ❌ |
| 14 | Prever custo/falha da etapa com a telemetria | E | ❌ futuro |

Recomendação já feita (08/10 00:34): **adotar o SDK oficial `@typesafe-ai/sdk`** (MIT; novas tentativas e limite de requisição prontos) no lugar do HTTP feito à mão.

### 5.3 Pacotes (ordem decidida pelo Claude em 08/10, por delegação do fundador; 1 pacote = 1 prompt = 1 relatório)

**R1, P0, P1 e P3 entregues (08–09/10). Próximo: P2 (bench real), depois auditoria das skills.** R1 veio antes de tudo, por decisão do fundador (08/10 tarde); P0 segue depois, com o hash atualizado.
Por que nesta ordem: **P0** remove o teste intermitente (sem isso a trava "suíte verde a cada commit" para o Antigravity à toa) e o segredo
em texto puro; **P1** é a base de todo uso do Jev (SDK oficial, novas tentativas, estado por estrutura, limiares por risco);
**P2** dá números reais antes de mudar o roteamento; **P3** liga a política de modelos acima; depois, entrada, execução, fila.


| Pacote | Conteúdo | Usos do Jev | Pronto quando |
|---|---|---|---|
| **P0 — Arrumação** | `McpServer.env` cifrado + migração; causa do teste intermitente; OmniRoute com versão fixa | — | valor em claro some do banco; 10 rodadas verdes |
| **P1 — Núcleo do Jev** | cliente v2: nova tentativa com espera em 429/529, 422 para e alerta; **montador de estado por estrutura** (nunca corta JSON); catálogo versionado de perguntas em `config/jev-perguntas.yaml`; critérios estruturados (R5); **política de confiança por risco** (piso / ação comum / ação cara) e **faixa "incerto"** para noul; helper de **ordem invertida**; evento único `JEV_DECISION` com `usage`, probabilidades, modo e versão do catálogo | base de todos (R4–R8, R20–R22) | testes com servidor falso; nenhuma decisão existente muda de resultado |
| **P2 — Medição** | P1–P4 com testes de aceite escritos à mão; `npm run bench` real (Docker sem rede); remove o benchmark simulado; relatório com custo, tempo, aprovação na 1ª, tokens do Jev | J7 medição | pontuação de partida registrada aqui |
| **P3 — Modelos** | aplicar §5.2: Jev escolhe o modelo de **todos** os papéis com a trava de qualidade; cascata no "resto"; teto de custo novo | catálogo 3, 7 | P1/P2 do bench com executor sempre forte |
| **P4 — Chat: 1 chamada Jev por mensagem (fan-out)** | junta numa só pergunta-lote: intenção (J1), revisão da Spec (J2), comando→ação (J3), mudança durante execução (J4), guardrail de entrada (J5), perfil (J7); o código escolhe o que usar | R6, R7, R8, R15, R17 | testes de cada rota + latência p95 ≤ 1 s |
| **P5 — Entrada como pensada** | chat carrega a skill `elicitador` (O1); Jev na Spec em 1 lote: lacunas obrigatórias (J8), tipo/stack (J9), clareza por REQ (J10), rastreio de cada REQ ao pedido (J11); `etapa1Ativa: true` (O2); Macrobrief + CONFERENCIA com skill `analista` + J14; analista gera Microbriefs (O3) com J15 cluster e J16 divisão | R1, R3, R9, R14, R16 | P1–P4 pelo chat, fases MACROBRIEF/CONFERENCIA na trilha |
| **P6 — Execução assertiva** | J18 contexto relevante (busca por linha + re-ranking sobre os arquivos do projeto); J19 skill/referência certa; J20 injeção em arquivo lido; J23 com ordem invertida; J25 com ordem invertida | R12, R13, R16, R17, R19 | bench: aprovação na 1ª sobe ou tokens por REQ caem, sem piorar o outro |
| **P7 — Fila e interface** | supervisor periódico + `QUEUE_STALLED` + heartbeat (O6); interface só observa (O7) | — | teste com worker morto; aprovar → 1 DAG |
| **P8 — Pesquisa oficial T7** | MCP de busca (Exa, D2) + J12 fonte oficial + J13 trechos relevantes e injeção | R1, R13, R17 | pergunta real com fonte oficial citada |
| **P9 — Aprendizado** | J26 erro recorrente = regra de skill ou bug do harness; probabilidades do Jev guardadas para prever aprovação (R10) | R2, R10, R14 | propostas classificadas na trilha |
| **P10 — Gateway** | Spec do Gateway reescrita pelo chat; entrega real | todos | entregue com build e aceite |

Quando o fundador colocar crédito em Claude/Gemini: a cadeia do avaliador muda de família sozinha (já existe);
J23 volta a ser 2ª opinião (sombra ou limiar mais baixo) — decidir com os números do bench.

### 5.4 Contagem final de uso do Jev
Ligados ao fim do plano: J1–J27 (J22 só fora de Spec/executor) + medição. Recursos R1–R22 todos
usados, exceto R10 só a partir do P9.

---

## 6. Decisões pendentes do fundador

1. **Aprovar o plano v2** (§5) e a ordem P0 → P10.
1b. **Avaliador:** continua fixo em modelo forte de outra família (decisão de 06/10) ou entra no roteamento do Jev ("o restante", 08/10)?
2. **Teto de custo por projeto:** hoje US$ 0,50. Proposta: US$ 3,00 para P1–P4 e decidir o do Gateway após o bench.
3. **Privacidade do Jev:** J11, J18, J20, J23 enviam trechos de conversa/código do usuário à TypeSafe (nunca segredos;
   retenção zero só no plano enterprise). Proposta: aceitar agora para o NextCode do fundador; rever antes de outros usuários.
4. **Gateway:** stack (Next.js já provado × React+Vite) e recorte do primeiro Gate (P10).
5. **Busca da T7:** Exa (sem conta) como 1ª opção (D2) — confirmar.

---

## 7. Documentos antigos (mantidos)

| Documento | Situação |
|---|---|
| `ARQUITETURA-ORQUESTRACAO.md` | detalhe do desenho (fases, templates, travas); vale onde não contradiz este |
| `rascunhos/JEV-DECISOES.md` | catálogo do Jev do projeto |
| `rascunhos/TEMPLATES.md` | base de `src/core/templates/artifact-templates.ts` |
| `rascunhos/TERCEIROS.md` | licenças e origem do material de terceiros |
| `rascunhos/politicas-orquestracao.yaml` | **reserva lida pelo código** se `config/` faltar (`orchestration-policy.ts:342`); não mover |
| `terceiros/jev-docs/` | documentação oficial do Jev (cópia local) |
| `specs/gatway-system-spec.md` | Spec do Gateway (formato antigo, sem `REQ`) |
| `prompts/`, `relatorios/` | prompts ao Antigravity e relatórios/auditorias — são a prova dos números |

Documentos apagados em D1 (13/10): ver §9.0 (com o comando para recuperar cada um).

---

## 8. Protocolo com o Antigravity (prompts travados + relatórios)

### 8.1 Ciclo de cada pacote

1. Claude escreve o prompt em `docs/prompts/<pacote>.md` **depois** de o pacote estar aprovado e documentado aqui.
2. Fundador entrega o prompt ao Antigravity.
3. Antigravity executa e grava o relatório em `docs/relatorios/<pacote>.md` (formato §8.4) **no último commit do pacote**.
4. Claude audita (§8.5) e registra o veredito no diário e na §3 deste documento. Só então começa o próximo pacote.

### 8.2 Travas fixas (vão no topo de todo prompt, sem alteração)

- **T-A Pré-condição:** `git status --short` vazio (exceto `.claude/`) e `git log -1` igual ao hash informado no prompt. Diferente → PARE.
- **T-B Escopo fechado:** só alterar os arquivos listados em "PODE ALTERAR". Precisar de outro → PARE e relate. Nunca alterar testes existentes fora da lista; **nunca aumentar timeout nem silenciar erro para teste passar**.
- **T-C Literalidade:** fazer exatamente o que está escrito; nada de melhoria, refatoração ou renomeação extra. Ambiguidade → PARE e pergunte; não decidir pelo fundador.
- **T-D Nomes reais:** todo nome citado (arquivo, função, tipo, evento) conferido com `git grep -n`. Nome novo só se estiver no prompt.
- **T-E Um passo = um commit:** antes de cada commit, `npx tsc --noEmit` (0 erros) e `npx vitest run` completo (tudo verde) **nesse estado**; colar as saídas no relatório. **Proibido** `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco:** nunca escrever em `prisma/dev.db`; testes e execuções reais em cópia temporária (`DATABASE_URL`).
- **T-G Segredos:** nada de chave em código, log, trilha, relatório ou chamada ao Jev/LLM.
- **T-H Dependências:** nenhum pacote novo sem estar no prompt.
- **T-I Fim de linha:** preservar CRLF/LF de cada arquivo (`git ls-files --eol`).
- **T-J Paradas obrigatórias:** resposta 422 do Jev; teste antigo quebrando; custo real > teto do prompt; arquivo fora do escopo; contradição entre prompt e código. Ao parar: relatório parcial com o motivo.
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-O Sem documento paralelo:** o Antigravity não cria plano, log ou "documento oficial" novo; escreve só `docs/relatorios/<pacote>.md` e as seções da referência que o prompt mandar. Status "aprovado" só existe se estiver em `memory/decisoes.md`.

### 8.3 Estrutura de cada prompt
`Objetivo` (1 frase) · `Hash de partida` · `PODE ALTERAR` / `PROIBIDO` · `Leitura obrigatória` (arquivo:linha) ·
`Passos` numerados, cada um com **o que fazer**, **testes exatos** (nome do teste → o que prova) e
**critério de pronto** · `Prova real` (P1/P2 do bench, com teto de custo) · `Relatório` (§8.4).

### 8.4 Formato do relatório (`docs/relatorios/<pacote>.md`)

1. **Identificação:** pacote, hash de partida, lista de commits (`git log --oneline <partida>..HEAD`).
2. **Por commit:** `git show --stat <hash>`, saída do `tsc` e resumo do `vitest` (arquivos/testes) **daquele** commit.
3. **Testes novos:** tabela `arquivo › nome do teste › o que prova`.
4. **Evidência de nomes:** tabela `nome › saída do git grep -n` para todo nome citado.
5. **Execução real:** fase final, `tsc` do projeto gerado, contagem de eventos na trilha por tipo, custo LLM e custo Jev.
6. **Decisões do Jev observadas:** por pergunta nova — quantas vezes, distribuição das respostas, confiança média, quantas abaixo do limiar.
7. **Desvios do prompt:** obrigatório; "nenhum" se nenhum. Inclui qualquer coisa feita a mais ou a menos.
8. **Checklist das travas T-A…T-K:** cumprida sim/não, com evidência.
9. **Dúvidas abertas** para o fundador.

### 8.5 Auditoria do Claude (antes de aceitar)
Recompila cada commit isolado numa cópia (`git worktree`), roda a suíte no HEAD 2×, confere escopo
(`git diff --stat <partida>..HEAD`), confere as tabelas de nomes e eventos, procura segredos no diff e
compara o relatório com o código. Resultado: **aceito / aceito com ressalvas / rejeitado**, no diário.

---

## 9. Registro de evolução (o que já foi feito)

> Resumo em tópicos de tudo o que foi entregue, do mais antigo ao mais novo. Fonte: commits, diário e os documentos antigos
> listados em §9.0 (apagados em D1; recuperáveis com `git show <hash>:<caminho>`). `⚠️ sem prova` = o documento de origem
> afirmou sem relatório ou saída que comprove.

### 9.0 Documentos antigos consolidados aqui
| Documento apagado | Recuperar com | O que tinha | Tópicos em §9 |
|---|---|---|---|
| `docs/PLANO-DE-ACAO.md` | `git show 54e08bd:docs/PLANO-DE-ACAO.md` | Plano original de 10 itens do NextCode como harness de skills (06/10) | 9.2, 9.4 |
| `docs/PLANO-ETAPA-0.md` | `git show 54e08bd:docs/PLANO-ETAPA-0.md` | Plano e execução dos passos 1 a 4 da Etapa 0: máquina de fases, job worker e unificação | 9.1, 9.2 |
| `docs/PLAN-OMNIRHARDENING.md` | `git show 54e08bd:docs/PLAN-OMNIRHARDENING.md` | Plano de hardening do OmniRoute (Fases 2–6 e 7–10) com criptografia e quota-tracker | 9.1 |
| `docs/JEV-PLANO-DIRETOR.md` | `git show 54e08bd:docs/JEV-PLANO-DIRETOR.md` | Catálogo dos 22 recursos do JEV (R1–R22) e agrupamento dos casos de uso (A–E) | 9.3, 9.4 |
| `docs/PLANO-EVOLUCAO.md` | `git show 54e08bd:docs/PLANO-EVOLUCAO.md` | Plano diretor de evolução com fases E1 a E12 | 9.4 |
| `docs/LLM-GATEWAYS.md` | `git show 54e08bd:docs/LLM-GATEWAYS.md` | Guia operacional de configuração dos gateways FreeLLMAPI e OmniRoute | 9.2 |
| `docs/SPEC-TEMPLATE-NEXTCODE-V5.md` | `git show 54e08bd:docs/SPEC-TEMPLATE-NEXTCODE-V5.md` | Template inicial canônico da spec v5.0 pré-REQ | 9.1 |
| `docs/JEV-LOG-DE-IMPLANTACAO.md` | `git show 54e08bd:docs/JEV-LOG-DE-IMPLANTACAO.md` | Log das fases de implantação do JEV, pacotes e retificação §4.24 | 9.3, 9.4, 9.5 |
| `docs/rascunhos/skills/avaliador/SKILL.md` | `git show 54e08bd:docs/rascunhos/skills/avaliador/SKILL.md` | Rascunho inicial da skill genérica de avaliador com promessas de ferramentas não executadas | 9.2, 9.3 |
| `docs/rascunhos/skills/avaliador-frontend/SKILL.md` | `git show 54e08bd:docs/rascunhos/skills/avaliador-frontend/SKILL.md` | Rascunho inicial da skill de avaliador de frontend com checklist duplicado | 9.2, 9.3 |

### 9.1 Até 04/10 — fundação (arquitetura v4, etapa 0, hardening do OmniRoute)
- **27/09 a 28/09** — Inicialização do NextCode Engine, integração OmniRoute e hardening de segurança (Fases 2–6) · `1d6edb3, 8d7e639, fcf212d, 46b8683` · prova: `tests/`
- **28/09 a 29/09** — Suíte vitest (59 testes), rotação envelope v2 e quota-tracker com cooldown (Fase 12) · `d996fd9, ec45e55, a3b18b8` · prova: `tests/router/quota-tracker.test.ts`
- **29/09** — Leitura e anexo de contexto de projeto local (Fase 14.2) e explorador nativo · `dc13098, 3211c02, f779700` · prova: `tests/core/session-attach.test.ts`
- **30/09** — Slash commands, instalador de skills GitHub e execução autônoma via SmartRouter · `c5a8100, ab3adc9, 7c4505a` · prova: `tests/mcp/tools-api.test.ts`
- **30/09** — Arquitetura OpenCode v5, promoção de código da quarentena ao disco e Spec canônica v5 · `5d32a74, 6e0c1fc, 32ea374` · prova: `git show 54e08bd:docs/SPEC-TEMPLATE-NEXTCODE-V5.md`
- **30/09** — Trava T1 (Spec Approval Lock), sanitização de prompts e safeFetch anti-SSRF · `e651010, 2c3ddca, aa9da00` · prova: `tests/dag/trava-t1-api.test.ts`
- **01/10** — Descoberta de modelos BYOK (Groq, NVIDIA, DeepSeek, Gemini) e criptografia AES-256-GCM · `7dccdf3, 366b261, efbcafe` · prova: `tests/api/byok-test-key.test.ts`
- **01/10** — Fila server-side, unblock manual de nós e inspeção de diff da quarentena · `5c7c6d3, dd93ec4, 0d052b7` · prova: `tests/quarantine/`
- **01/10** — Portais modais (Quotas, Skills, Benchmark, MCP, Search, Revisions) e streaming SSE de terminal · `329e9cf, 3beee07, 012f521, 2f7e582, 1a34c93` · prova: `tests/sessions/revisions-api.test.ts`
- **01/10** — RBAC roles/permissions e staging de git branch de quarentena · `e79e811, 73e6476` · prova: `tests/auth/roles-api.test.ts`, `tests/quarantine/git-branch-api.test.ts`
- **02/10** — Auto-healing feedback loop no DAG e validadores AST/App Router no DualLensAuditor · `aebd161, 8cb65ed, ff86bfc` · prova: `tests/governance/`
- **02/10** — UniversalDocsFetcher com autoridade de fontes primárias e stack na spec · `4fe4478, dc90606` · prova: `tests/intake/universal-docs-fetcher.test.ts`
- **03/10** — Travas T1–T6 consolidadas (3 tentativas, rollback de build quebrado, TelemetryLog append-only WAL) · `28eda43, fa2c322, e613f54, 571915b, 016b6a5` · prova: `tests/telemetry/audit-trail.test.ts`
- **04/10** — Arquitetura v4 consolidada, máquina de fases da sessão (Etapa 0 passo 1) e extração de execute_node · `6b6d1cd, 1476128, de18252` · prova: `tests/orchestrator/session-phase.test.ts`

### 9.2 05/10–08/10 — plano de ação itens 1–10, gateways, roteamento pago (R1)
- **05/10** — Job worker com reserva atômica via lease, retentativas e fila por sessão (Passos 3 e 4a da Etapa 0) · `9f9584e, 3a530f6, 52bc206, aa3f3a6` · prova: `tests/orchestrator/job-queue.test.ts`
- **05/10** — Gateways FreeLLMAPI e OmniRoute em ordem com diagnóstico de rede e separação rápido/pesado · `e0a9c90, 9c09dcc` · prova: `tests/llm/gateways.test.ts`
- **05/10** — Chat guiado por fases, Spec cumulativa no servidor e segredos criptografados · `3336b17, a1aef47, 3678fd1, 6fec9de` · prova: `tests/intake/`
- **06/10** — Definição do plano de 10 itens (D5): NextCode como harness de skills · `4153633` · ⚠️ sem prova
- **07/10** — Runtime de skills: runExecutorToolLoop, ferramentas com permissões, autoteste e relatório validado · `7f1c5c8, d3c90f4` · prova: `tests/skills/`
- **07/10** — Avaliador Lente Cega por REQ e Lente 2 contra relatório; P1 entregue (US$ 0,0247) e P2 com Playwright (US$ 0,1146) · `1d4f331, f31c375, 7308bd2` · prova: `docs/relatorios/`
- **08/10** — Portão JEV na execução (Item 10): diagnóstico de falha, evidência REQ, guarda de segredos e skills · `5e546d1, 926a5d6, e4b2db6` · prova: `tests/decision/`
- **08/10** — Roteamento papéis críticos (R1): somente pago (`custom/`), sem queda para gratuito; trava X-Routed-Via · `69d8a94, 51e141e, a2c9b2c, 9a9d539, 6ab284e` · prova: `docs/relatorios/R1-roteamento-pago-primeiro.md`

### 9.3 08/10–09/10 — pacotes P0–P3, bench (régua do auditor), P2b, auditoria das skills S0/S1
- **08/10** — P0: McpServer.env cifrado em repouso e resolução do teste intermitente · `77b3adb, bc2095a` · prova: `docs/relatorios/P0-arrumacao.md`
- **08/10** — P1: Núcleo do JEV v2: telemetria de custo, novas tentativas em 429/529, estado estruturado e limiares YAML · `4dd6733, e1acc35, 6639232, c8b63a6` · prova: `docs/relatorios/P1-nucleo-jev.md`
- **08/10** — P3: Cadeia de avaliador pelo FreeLLMAPI (Nemotron, DeepSeek, Claude) preservando executor pago · `cbdb0a0, 3e93e8b` · prova: `docs/relatorios/P3-avaliador-freellmapi.md`
- **09/10** — P2: Régua de aceite oficial do auditor, contêiner Docker sem rede e npm run bench real · `ffb0b46, a559364, 53b62ae` · prova: `docs/relatorios/P2-bench-real.md`, `bench/aceite/`
- **09/10** — P2b: Projetos P3 (login) e P4 (correção) com 3 repetições; correção de versões na base do P4 · `efd8c1c, 1337edc, acb00d6, 885e80e` · prova: `docs/relatorios/P2b-bench-dificil.md`
- **09/10 a 10/10** — S1: Otimização das skills: custo por etapa, taste de tela guiado pelo Jev e avaliadores zero-tool · `4447198, 2e91335, 60e81f0, 0afa285` · prova: `docs/relatorios/S1-skills.md`

### 9.4 10/10–12/10 — fases E1–E12, P4–P6, cascata (Antigravity sem prompt do auditor)
- **10/10** — Chat com intenção via Jev, ativação de bloqueio de spec ambígua e trava T-SPEC-SHIELD · `c8ec38e, 7f92a6e, 6472144` · prova: `tests/intake/chat-jev-intent.test.ts`
- **10/10** — Conferência T8a/T8b em lote, auditoria final T10 e particionamento por cluster · `9e93594, 19d5758, 359e06b` · prova: `tests/orchestrator/delivery-t10-strict.test.ts`
- **10/10** — Avaliador com Claude Sonnet 4.5 e verificação de evidência ativada · `6e00e57, bdb6ade` · prova: `tests/decision/`
- **11/10** — Afunilamento universal M0 com auto-cura mecânica M2 e blindagem contra placeholders de spec · `06bb533, 156d01b, a3f0992` · prova: `tests/intake/universal-funnel.test.ts`
- **12/10** — E1 a E9: Memória de projeto L2 (project-memory), comparativo P1/P2 e fan-out do chat · `a93cf3e, f0039c1` · prova: `docs/relatorios/bench/2026-10-12-1533.md` (retificação §4.24: economia de 57,2% não provada: rodada terminou em PLANEJAMENTO, n=1, modelo pago)
- **12/10** — Item 9 declarado concluído · `2754f7f` · (retificação §4.24: critério era Gateway entregue com build ok; prova foram apenas testes unitários sem execução real, item segue não comprovado)
- **12/10** — P5 e P6: Breakdown de custos na DAG e cache local de decisões do JEV com TTL · `207f9a2, 6e77789` · prova: `tests/governance/session-cost-breakdown.test.ts`, `tests/decision/jev-cache.test.ts`
- **12/10** — E12: Cascata de contingência no executor (paid-routing.ts) e prefixos pagos expandidos · `786d393` · (retificação §4.24: homologação P3 12/12 desmentida por 4 rodadas com 1/12 e 0/12; cascata desfeita em C1)

### 9.5 12/10–13/10 — auditoria completa, C1, D1
- **12/10** — Auditoria completa do código em 786d393: apontou rota gratuita (C1), cascata (C2), falso P3 12/12 (C3) e bug no cache (C6) · `40fd206` · prova: `docs/relatorios/auditoria-completa-2026-10-12.md`
- **13/10** — Diagnóstico da pasta docs e decisão de documento único · `6cfc75d, 6076d28` · prova: `docs/relatorios/diagnostico-docs-2026-10-13.md`, `memory/decisoes.md`
- **13/10** — C1: rota paga só `custom/`, executor sem cascata, chave do cache do Jev, correção do JEV-LOG — aceito com ressalvas (P3 não provado de ponta a ponta: FreeLLMAPI 429) · `f19152c, af431e8, cdaf53e, 97b07fc` · prova: `docs/relatorios/C1-correcoes-auditoria.md`, `docs/relatorios/bench/2026-10-13-0552.md`
- **13/10** — D1: documentos antigos consolidados em §9 e apagados; §7 e provas corrigidas em D1b · `bc63e09, 98beb93, 0664efc` · prova: `docs/relatorios/D1-documento-unico.md`
