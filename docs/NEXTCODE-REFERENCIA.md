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

### 3.3 Adiados pela arquitetura
Laya (D6) · Exa/SearXNG (D2) · cliente MCP e ponte única (D7, D10) · catálogo (D8) · BYOK no OmniRoute ·
checklist por `REQ` na tela · entrega por Git · custo antes de aprovar · proveniência · PostgreSQL.

### 3.4 Incidentes
- Item 10: commits `5fbf4e8`, `0697cc8`, `5e546d1` não compilam isolados; correção embutida por *amend* em `926a5d6` sem declarar.
- Item 10: guarda de segredos enviava a chave ao Jev — corrigido em `c7fb624`.
- Teste intermitente (1 falha em 4 rodadas); `end-to-end-harness-plan` com timeout ampliado e limpeza silenciada.

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

| Papel | Quem escolhe o modelo | Regra |
|---|---|---|
| **Elicitador** (Spec, Macrobrief) | **fixo** | sempre o mais forte disponível ("não pode economizar", 06/10) |
| **Executor** | Jev decide **divisão** e **qual modelo forte**; nunca o gratuito | "não deve economizar" (06/10 e 08/10) |
| **Avaliador** | cadeia `evaluator-models.ts` | forte e de outra família (Gemini → Claude → DeepSeek); "não economizar tokens" (06/10) — **confirmar se continua fora do roteamento do Jev** |
| **Todo o resto** (conversa do chat, analista, reenvio de relatório, diagnósticos, sugestões, resumos) | **Jev escolhe o provedor** pela dificuldade (catálogo item 7) | gratuito para o simples, pago para o complexo; "o restante fica no gerenciamento dele" (08/10) |

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

### 5.3 Pacotes (ordem proposta; cada pacote = 1 prompt ao Antigravity = 1 relatório)

| Pacote | Conteúdo | Usos do Jev | Pronto quando |
|---|---|---|---|
| **P0 — Arrumação** | `McpServer.env` cifrado + migração; causa do teste intermitente; OmniRoute com versão fixa | — | valor em claro some do banco; 10 rodadas verdes |
| **P1 — Núcleo do Jev** | cliente v2: nova tentativa com espera em 429/529, 422 para e alerta; **montador de estado por estrutura** (nunca corta JSON); catálogo versionado de perguntas em `config/jev-perguntas.yaml`; critérios estruturados (R5); **política de confiança por risco** (piso / ação comum / ação cara) e **faixa "incerto"** para noul; helper de **ordem invertida**; evento único `JEV_DECISION` com `usage`, probabilidades, modo e versão do catálogo | base de todos (R4–R8, R20–R22) | testes com servidor falso; nenhuma decisão existente muda de resultado |
| **P2 — Medição** | P1–P4 com testes de aceite escritos à mão; `npm run bench` real (Docker sem rede); remove o benchmark simulado; relatório com custo, tempo, aprovação na 1ª, tokens do Jev | J7 medição | pontuação de partida registrada aqui |
| **P3 — Modelos** | aplicar §5.2: executor sem nível gratuito; Jev roteando "todo o resto" (catálogo 7) com cascata; teto de custo novo | catálogo 3, 7 | P1/P2 do bench com executor sempre forte |
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
| `PLANO-ETAPA-0.md`, `PLANO-DE-ACAO.md` | histórico; pendências trazidas para §5 |
| `PLAN-OMNIRHARDENING.md` | histórico; §3.2 |
| `LLM-GATEWAYS.md` | operação dos gateways (desatualizado sobre o DeepSeek pago) |
| `SPEC-TEMPLATE-NEXTCODE-V5.md` | obsoleto (sem `REQ`) — F2 |

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
