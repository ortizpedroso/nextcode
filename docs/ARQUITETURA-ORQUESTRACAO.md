# NextCode — Arquitetura de Orquestração (v4)

> **Status:** papéis aprovados em 04/10/2026; execução, tokens, roteamento, chaves, roadmap de escala, catálogo, segredos e ponte única aprovados em 04/10/2026. Decisões tomadas e em aberto na §15.
> **Objetivo do NextCode:** transformar um pedido de desenvolvimento — de um leigo ou de um engenheiro — em software entregue no disco, completo em relação à Spec aprovada, sem a orquestração se perder.

---

## 0. Princípios

| # | Princípio | Consequência prática |
|---|---|---|
| P1 | **O harness decide, o LLM propõe.** | Sequência, fases, permissões e travas são código determinístico. Toda saída de LLM é validada antes de virar estado. |
| P2 | **Skill ensina, nunca autoriza.** | Uma skill (`SKILL.md`) descreve *como* um papel trabalha. Permissões vêm só do harness. |
| P3 | **Contexto por artefato, não por histórico de chat.** | Cada papel recebe só os artefatos da sua etapa. O chat pode ser "inundado" sem contaminar o trabalho. |
| P4 | **Menor privilégio por papel e fase.** | Pesquisa externa, leitura e escrita são liberadas conforme a §4.1. |
| P5 | **Só há desenvolvimento com Spec aprovada E Macrobrief validado.** | Vale para criação e para correção (Spec de Correção). Sem os dois, nenhum executor é acionado. |
| P6 | **Parar só por dois motivos.** | (a) Spec completa no disco, ou (b) um executor esgotou 3 tentativas → bloqueio + relatório ao humano. Falta de LLM **pausa**, não consome tentativa. |
| P7 | **Tudo é rastreável.** | Toda decisão, chamada de agente, veredito e bloqueio vira evento na trilha append-only (T3). |
| P8 | **Um único fluxo, duas profundidades.** | Leigo e engenheiro passam pelas mesmas etapas e travas; muda a profundidade da elicitação e o que é exibido. |
| P9 | **Jev decide, LLM escreve.** | Toda *decisão* (rota, perfil, complexidade, modelo, "fonte é oficial?") é uma pergunta tipada ao Jev, com confiança medida. Todo *texto* é escrito por LLM. |
| P10 | **Tudo que entra no chat vira Markdown + YAML.** | Toda mensagem é normalizada num envelope (§5.1) antes de qualquer agente ler. |
| P11 | **Uma única voz com o usuário.** | Só o Elicitador conversa com o usuário. Os demais papéis nunca falam com ele; o harness só exibe relatórios. |
| P12 | **Rastreabilidade por requisito.** | Todo requisito da Spec tem um código (`REQ-001`…). Macrobrief, Contratos, Microbriefs, relatório do executor e veredito usam os mesmos códigos. "Bater" um artefato com outro é conferência mecânica, não opinião de LLM. |
| P13 | **Automatizar tudo o que as travas permitem.** | O humano só é acionado nas situações da lista fechada da §10.2. Todo o resto é resolvido pelas skills e travas. |
| P14 | **Menor consumo de token possível.** | Decisão pelo Jev, contexto por artefato, Tipo 1 antes de qualquer LLM, correção por `REQ` (§11). Medido em tokens por `REQ` entregue. |
| P15 | **Um único roteador de provedores.** | O NextCode decide a *faixa* de modelo; o gateway escolhido no catálogo escolhe provedor, faz failover e controla cota (§12, D3). |
| P16 | **Tudo que é substituível vive no catálogo.** | MCP, skill, plugin, motor de decisão e gateway são itens do catálogo (§14b), trocados pela tela, sem alterar código, desde que cumpram o contrato da sua função. |
| P17 | **Nenhum segredo em texto puro.** | Toda chave gravada no banco é criptografada, sempre (§13b). |

---

## 1. Camadas

| Camada | O que é | Exemplos |
|---|---|---|
| **Harness (NextCode)** | Máquina de fases, travas, permissões, conferência de códigos REQ, quarentena, única escrita em disco, telemetria | `phase-machine`, `DualLensAuditor` Tipo 1, `empirical-gate`, `QuarantineManager`, `SmartRouter` |
| **Motor de decisão (Laya → Jev)** | Modelos "System One": recebem `state` + perguntas tipadas (`choice`, `score`, `noul`) e devolvem escolha + probabilidades + confiança. Não geram texto. **Cascata (D6):** Laya local primeiro; Jev (TypeSafe AI, nuvem) quando a confiança do Laya é baixa. Chamados **pelo harness** | classificação de mensagem, perfil, complexidade, seleção de modelo, "fonte é oficial?", filtro de injeção |
| **Skills** | Conhecimento de cada papel (prompt versionado, commit fixo) | `elicitor`, `analyst`, `executor-*`, `blind-auditor` |
| **MCP** | Ferramentas liberadas pelo harness por papel | busca na web, leitura de página |

> **Jev:** a definição vem de um artigo de terceiros (Hora de Codar, 27/09/2026). Antes de implementar, conferir na documentação oficial da TypeSafe o formato exato das perguntas, os limites de contexto (64k state+perguntas / 32k state+maior pergunta), o preço e a versão estável. Fixar a versão (`jev-1.13.0`), nunca o alias `jev-latest`.

---

## 2. Perfis de usuário: leigo e engenheiro

O Jev estima o perfil a cada mensagem (o usuário pode trocar quando quiser).

| Aspecto | Leigo | Engenheiro |
|---|---|---|
| Elicitação | Perguntas guiadas em linguagem de negócio, com **padrões sugeridos** | Perguntas técnicas diretas; aceita Spec/arquitetura pronta e só normaliza para o formato |
| Spec exibida | Resumo de negócio + detalhes técnicos recolhidos | Spec completa |
| Microbriefs | Não exibidos (podem ser abertos) | Opção de revisar antes da execução |
| Relatórios de incidente | Ação recomendada em linguagem simples | Erro exato + arquivo + regra |

Nenhuma trava muda entre perfis.

---

## 3. Fases da sessão

A fase fica gravada na sessão. **Só a fase atual decide qual papel age.** Implementação: `src/core/orchestrator/phase-machine.ts` (módulo puro; regras revisadas na auditoria do passo 1 da etapa 0).

```mermaid
stateDiagram-v2
  [*] --> ENTRADA
  ENTRADA --> ELICITACAO: criar algo novo
  ENTRADA --> ELICITACAO_CORRECAO: corrigir algo existente
  ENTRADA --> CONVERSA: intenção incerta
  CONVERSA --> ELICITACAO: intenção clara (criar)
  CONVERSA --> ELICITACAO_CORRECAO: intenção clara (corrigir)
  CONVERSA --> INTERVENCAO: 3ª rodada sem clareza
  INTERVENCAO --> ELICITACAO: "Criar algo novo" (botão ou texto)
  INTERVENCAO --> ELICITACAO_CORRECAO: "Corrigir algo existente" (botão ou texto)
  INTERVENCAO --> CONVERSA: "Continuar conversando" ou resposta evasiva (contador zera)
  ELICITACAO --> ELICITACAO: resposta do usuário ao Elicitador
  ELICITACAO --> SPEC_REVISAO: Spec pronta
  ELICITACAO_CORRECAO --> SPEC_REVISAO: Spec de Correção pronta
  SPEC_REVISAO --> ELICITACAO: comentário/pedido de ajuste do usuário
  SPEC_REVISAO --> MACROBRIEF: Spec APROVADA (T1) — etapa 1
  SPEC_REVISAO --> PLANEJAMENTO: Spec APROVADA (T1) — etapa 0
  MACROBRIEF --> CONFERENCIA: Elicitador entrega o Macrobrief
  CONFERENCIA --> MACROBRIEF: Macrobrief incompleto/infiel (Spec correta)
  CONFERENCIA --> SPEC_REVISAO: lacuna na Spec (usuário reaprova)
  CONFERENCIA --> PLANEJAMENTO: Spec x Macrobrief conferem (T8a)
  CONFERENCIA --> BLOQUEADA: 4ª falha de conferência
  PLANEJAMENTO --> EXECUCAO: plano válido (T8b)
  EXECUCAO --> SPEC_REVISAO: pedido de mudança (pendentes suspensos)
  EXECUCAO --> BLOQUEADA: executor esgotou 3 tentativas (T6)
  BLOQUEADA --> SPEC_REVISAO: usuário pede ajuste da Spec
  BLOQUEADA --> EXECUCAO: humano desbloqueia (volta à fase anterior)
  EXECUCAO --> VERIFICACAO: sem executores pendentes
  VERIFICACAO --> PLANEJAMENTO: falta requisito/arquivo no disco (T10)
  VERIFICACAO --> ENTREGUE: Spec completa no disco + build ok
  ENTREGUE --> ELICITACAO: novo pedido (criar)
  ENTREGUE --> ELICITACAO_CORRECAO: novo pedido (corrigir)
  ENTREGUE --> CONVERSA: novo pedido incerto
  note right of PAUSADA
    Sem LLM em qualquer fase que dependa de LLM
    → PAUSADA; LLM voltou → retorna à mesma fase.
  end note
```

**Regras de transição:**

1. **Dúvida avulsa em qualquer fase** é respondida pelo Elicitador, **não muda a fase** e **não entra no contexto dos outros papéis**.
2. **Pedido de status em qualquer fase** mostra o progresso e não muda a fase.
3. **Resposta ao Elicitador:** em `ELICITACAO`/`ELICITACAO_CORRECAO`, toda mensagem que não for dúvida avulsa nem status é resposta às perguntas do Elicitador — a fase continua (efeito "continuar elicitação"). Em `SPEC_REVISAO`, um comentário do usuário é pedido de ajuste e volta para `ELICITACAO`. **A aprovação da Spec é sempre explícita** (botão ou confirmação de aprovação), nunca inferida de um comentário.
4. **Regra da 3ª rodada:** três mensagens seguidas com intenção incerta (contando a primeira, vinda de `ENTRADA`) levam a `INTERVENCAO`, que oferece três caminhos. A escolha vale por **botão ou texto**. **Resposta evasiva** na intervenção volta para `CONVERSA` com o contador **zerado**; a intervenção reaparece após mais três rodadas sem clareza.
5. **Pedido de mudança durante EXECUCAO** → nova versão da Spec em `SPEC_REVISAO`, com os executores pendentes suspensos; nunca cria uma execução paralela.
6. **Idas e voltas CONFERENCIA → MACROBRIEF/SPEC_REVISAO:** máximo 3; na 4ª falha, `BLOQUEADA` com relatório ao humano. A 3ª falha **não** bloqueia.
7. **Desbloqueio humano** volta à fase anterior ao bloqueio **com o contador daquele bloqueio zerado** (nova rodada de chances) e efeito "retomar fase" — não necessariamente execução.
8. **Bloqueio + pedido de ajuste da Spec** (o que o relatório de incidente recomenda) → `SPEC_REVISAO`, com os pendentes suspensos.
9. **Sem LLM:** qualquer fase que dependa de LLM (`CONVERSA`, `INTERVENCAO`, `ELICITACAO`, `ELICITACAO_CORRECAO`, `SPEC_REVISAO`, `MACROBRIEF`, `CONFERENCIA`, `PLANEJAMENTO`, `EXECUCAO`, `VERIFICACAO`) vai para `PAUSADA` e volta **à mesma fase** quando o LLM voltar (D4: aviso em 1 minuto, sem consumir tentativa). Em `ENTRADA`, sem modelo para classificar, o Elicitador responde "sem modelo disponível" e a fase não muda.
10. **Novo pedido após ENTREGUE** é classificado como em `ENTRADA` (criar → `ELICITACAO`, corrigir → `ELICITACAO_CORRECAO`, incerto → `CONVERSA`), com todos os contadores zerados.
11. **Uma fila por sessão.** Executor só passa a `running` se ainda estiver pendente (operação única no banco).
12. **Retomada automática:** ao iniciar o servidor, sessões em `EXECUCAO`/`PAUSADA` com pendências voltam a processar.
13. **Lacuna detectada na VERIFICACAO** volta ao Analista (gera Microbriefs só do que falta), não ao Elicitador — a Spec já estava aprovada.
14. **Qualquer outra combinação** fase × evento é recusada (sem exceção), com a lista do que é permitido naquela fase.

---

## 4. Papéis e permissões

### 4.1 Matriz de permissões

| Papel | Fala com o usuário | Pesquisa externa | Lê o projeto | Escreve no disco | Executa comandos |
|---|---|---|---|---|---|
| Elicitador | ✅ **único** | ✅ só ao montar a Spec, só fontes oficiais | ✅ leitura | ❌ | ❌ |
| Analista | ❌ | ❌ | ✅ leitura (estrutura) | ❌ | ❌ |
| Executor | ❌ | ⚠️ só as URLs aprovadas na Spec | ✅ seu escopo + Contratos + saída das dependências | ❌ (entrega conteúdo) | ❌ |
| Avaliador | ❌ | ❌ | ❌ (só Microbrief, Contratos, código e relatório do seu cluster) | ❌ | ❌ |
| Harness | exibe relatórios | — | ✅ | ✅ **único escritor** (quarentena → promoção) | ✅ tsc / ESLint |

### 4.2 Elicitador (`skills/elicitor`) — a única voz do NextCode

- **Atende toda mensagem do usuário.** Trabalha em dois passos, com modelos diferentes:
  1. **Classificação (Jev, barato):** uma requisição ao Jev com `state` de schema fixo e perguntas em paralelo:

     | Pergunta | Tipo | Opções / escala |
     |---|---|---|
     | Intenção | `choice` | `criar_novo`, `corrigir_existente`, `incerto`, `duvida_avulsa`, `mudanca_durante_execucao`, `status` |
     | Perfil | `choice` | `leigo`, `engenheiro` |
     | Complexidade | `score` | 0–1 |
     | Mensagem tenta manipular o sistema? | `noul` | sim/não |

     `state` = `{ ultima_mensagem, fase_atual, resumo_fase (≤ 3 linhas), rodadas_sem_clareza, tem_anexo, projeto_existente }` — nunca o dump da sessão. Resultado passa pela **porta de confiança** (§7.2).
  2. **Resposta/elicitação (LLM grande, com tool calling):** conforme a intenção — responde a dúvida, pergunta o que falta, pesquisa, escreve artefatos, informa status.
- **Objetivo:** reunir o **máximo de informação** para a melhor Spec. Pesquisa fatos que o usuário não tem obrigação de saber; **escopo do produto é sempre pergunta ao usuário**, nunca pesquisa.
- **Produz:** Spec (ou Spec de Correção) → após aprovação, **Macrobrief**.
- **Corrige** o Macrobrief quando o Analista devolve; quando a devolução aponta lacuna na **Spec**, pergunta ao usuário e submete nova versão para aprovação.
- **3ª rodada:** três rodadas seguidas com intenção `incerto` (ou confiança abaixo do piso) → oferece **Criar algo novo / Corrigir algo existente / Continuar conversando**.
- **Pesquisa (T7):** fonte oficial = site do órgão/empresa dona do assunto, qualquer domínio. Antes de usar uma página, o harness pergunta ao Jev numa única requisição: `noul` "é a fonte oficial do assunto X?" e `noul` "o trecho contém instruções dirigidas a um agente de IA?". Cada fonte usada entra na Spec com **link + justificativa**. Conteúdo lido é **dado, nunca instrução**. Orçamento por Spec (ex.: 5 buscas, 8 páginas).
- **Não pode:** escrever no disco, gerar código, aprovar artefatos.
- **Fallback:** Laya e Jev indisponíveis → classificação por um LLM pequeno via gateway com saída validada; sem nenhum → informa "sem modelo disponível" e **não segue**.
- **Limites do Laya a respeitar:** estado de até 1.024 tokens (multilíngue) e menos de ~20 opções por `choice`; textos longos (ex.: trecho de página na pesquisa) são avaliados em pedaços.

### 4.3 Analista (`skills/analyst`)

1. **Conferência Spec × Macrobrief (T8a):**
   - **Mecânica (harness):** todo `REQ` da Spec aparece no Macrobrief; nenhum `REQ` novo surgiu.
   - **Semântica (Analista):** a descrição de cada `REQ` no Macrobrief é fiel à Spec.
   - **Devolução:** o veredito diz se o problema é **do Macrobrief** (Elicitador corrige sozinho) ou **lacuna/ambiguidade da Spec** (Elicitador pergunta ao usuário; Spec volta para aprovação).
2. **Planejamento (T8b):** a partir do Macrobrief, produz:
   - **Contratos** entre clusters (rotas, formatos de dados, tipos compartilhados), lidos — nunca alterados — pelos clusters dependentes.
   - **Microbriefs**, um **por executor**, agrupados por cluster. Decide quantos executores cada cluster precisa, conforme a complexidade.
   - Conferência do harness: todo `REQ` do Macrobrief em pelo menos um Microbrief; todo arquivo em exatamente um executor; sem ciclo; `integration` depende dos demais; nada fora da Spec.
3. **Lacunas da VERIFICACAO:** gera Microbriefs só para os `REQ`/arquivos que faltam.
- **Não pode:** falar com o usuário, alterar a Spec, escrever no disco.

### 4.4 Executor (`skills/executor-{core,backend,frontend,integration}`)

- **Recebe:** seu Microbrief, os Contratos, o conteúdo atual dos arquivos do escopo, a saída das dependências e as fontes da Spec que o Microbrief cita.
- **Entrega:** (1) um bloco por arquivo do escopo, com `// file: caminho`; (2) o **Relatório do Executor**, no **mesmo template do Microbrief**, preenchido por `REQ` (§5.7).
- **Travas:** T2 (escopo e destino explícito), T4 (quarentena + type-check/ESLint + rollback), T6 (3 tentativas **por executor**). Correções chegam por `REQ` ("REQ-012 não implementado").

### 4.5 Avaliador do cluster — duas lentes (`skills/blind-auditor`)

Um avaliador **por cluster**, com modelo **diferente** dos executores do cluster.

| Ordem | Lente | Compara | Não vê |
|---|---|---|---|
| 0 | **Tipo 1** (harness, por executor, sem token) | sintaxe, escopo, imports, contratos de tipo, segurança | — |
| 1 | **Lente Cega** | Microbriefs + Contratos do cluster **×** código produzido → veredito por `REQ` | o Relatório do Executor |
| 2 | **Verificação cruzada** (só no final) | veredito da Lente 1 **×** Relatório do Executor → divergências por `REQ` | — |

- Sem veredito válido da Lente 1 → rejeita (T5).
- Divergência na Lente 2 (executor afirma `implementado`, Lente 1 diz `ausente`) → rejeição com o `REQ` e o executor responsáveis; registrada como sinal de alucinação na telemetria.

### 4.6 Componentes do harness (não são skills)

| Componente | Função |
|---|---|
| Supervisor | tentativas, pausa por falta de LLM, bloqueio em cascata, relatório ao humano, retomada |
| Seletor de modelos | filtra os modelos verificados pela faixa do papel (§7.1) e pergunta ao Jev (`choice`, até 255 opções) qual executa a tarefa |
| Conferente de rastreabilidade | confere `REQ` entre Spec, Macrobrief, Microbriefs, relatórios e vereditos |
| Minerador de telemetria | gera **propostas** de melhoria (§9.4); nunca aplica nada sozinho |

---

## 5. Artefatos e templates

**Todos em Markdown com frontmatter YAML**, inclusive as mensagens do chat. Vereditos e relatórios de máquina também são MD + YAML (o YAML carrega os campos que o harness confere).

### 5.1 Envelope de mensagem (toda entrada do chat)
```yaml
---
tipo: mensagem
sessao: <id>
fase: ENTRADA
autor: usuario
anexos: []
classificacao:            # preenchido pelo Jev
  intencao: criar_novo
  confianca: 0.91
  perfil: leigo
  complexidade: 0.72
refs_req: []              # requisitos citados, quando houver
---
<texto normalizado da mensagem>
```
> Base existente: `InputPreprocessorEngine` já converte a entrada em Markdown + YAML, mas só no momento do envio ao LLM — hoje a mensagem gravada no banco é o texto cru (`chat/route.ts`). **O envelope passa a ser gravado** e é a fonte de verdade da mensagem.

### 5.2 Spec Canônica / Spec de Correção — Elicitador → **usuário aprova (T1)**
```yaml
---
tipo: spec            # ou spec_correcao
versao: 3
status: aguardando_aprovacao
titulo: ...
stack: [ ... ]
requisitos:
  - id: REQ-001
    descricao: ...
    criterios_aceite: [ ... ]
entidades: [ ... ]
rotas: [ ... ]
arquivos_afetados: [ ... ]
fontes:
  - url: ...
    por_que_oficial: ...
    usada_em: [REQ-004]
---
<descrição em linguagem de negócio>
```
Spec de Correção: `comportamento_atual`, `comportamento_esperado`, `arquivos_envolvidos` e `requisitos` com critérios de aceite.

### 5.3 Macrobrief — Elicitador → Analista confere (T8a)
```yaml
---
tipo: macrobrief
spec_versao: 3
modulos:
  - id: MOD-01
    nome: ...
    requisitos: [REQ-001, REQ-002]
---
<por módulo: o que construir, regras, critérios de aceite>
```

### 5.4 Contratos — Analista
```yaml
---
tipo: contratos
spec_versao: 3
tipos_compartilhados: [ ... ]
rotas_api:
  - metodo: GET
    caminho: /api/imoveis
    resposta: ...
    requisitos: [REQ-007]
---
```

### 5.5 Microbrief (template base) — Analista → Executor
```yaml
---
tipo: microbrief
id: MB-backend-01
cluster: backend
executor: 1
spec_versao: 3
requisitos: [REQ-007, REQ-008]
files_scope: [ ... ]
depende_de: [MB-core-01]
contratos_usados: [GET /api/imoveis]
fontes: [ ... ]
---
## Objetivo
## Requisitos (por REQ, com critérios de aceite)
## Seção do cluster
## Regras imutáveis
```

### 5.6 Seção específica por cluster
| Cluster | Seção |
|---|---|
| `core` | entidades, tipos, schema, utilidades compartilhadas |
| `backend` | endpoints, regras de negócio, erros e validações |
| `frontend` | telas, estados, interações, acessibilidade |
| `integration` | serviços externos, variáveis de ambiente, montagem final |

### 5.7 Relatório do Executor — **mesmo template do Microbrief**, preenchido
```yaml
---
tipo: relatorio_executor
microbrief: MB-backend-01
tentativa: 1
requisitos:
  - id: REQ-007
    status: implementado     # implementado | parcial | nao_implementado
    arquivos: [ ... ]
    como: ...
---
```

### 5.8 Veredito do Avaliador
```yaml
---
tipo: veredito
cluster: backend
lente1:
  - { id: REQ-007, resultado: implementado }
  - { id: REQ-008, resultado: ausente, motivo: ... }
lente2_divergencias:
  - { id: REQ-008, executor_afirma: implementado, lente1: ausente, microbrief: MB-backend-01 }
decisao: rejeitado
---
```

### 5.9 Onde cada artefato fica
| Artefato | Onde | Aprovação |
|---|---|---|
| Envelope de mensagem | sessão | — |
| Spec / Spec de Correção | sessão (versionada) + `docs/nextcode/spec.md` no projeto após aprovação | **Usuário (T1)** |
| Macrobrief | sessão | Analista (T8a) |
| Contratos, Microbriefs | sessão (por executor) | harness (T8b); engenheiro pode revisar |
| Relatório do Executor, Veredito | executor/cluster + trilha | Avaliador |
| Relatório de incidente | chat + trilha | humano |
| Relatório de entrega | chat + `docs/nextcode/entrega.md` | — |

---

## 6. Clusters

| Cluster | Responsável por | Depende de |
|---|---|---|
| `core` | modelos de dados, schema, tipos e utilidades compartilhadas | — |
| `backend` | APIs, serviços, regras de negócio | `core` |
| `frontend` | páginas, componentes, estado de UI | `core` + Contratos de `backend` |
| `integration` | integrações externas, wiring final, configuração | todos |

- Um Microbrief **por executor**; o Analista decide quantos executores cada cluster tem.
- Executores sem dependência mútua rodam em paralelo (até 3 por vez).
- Um **avaliador por cluster** (§4.5).

---

## 7. Seleção de modelo e porta de confiança

### 7.1 Faixa de modelo por papel
| Papel / passo | Faixa |
|---|---|
| Elicitador — classificação | **Laya → Jev** em cascata (fallback final: LLM pequeno) |
| Elicitador — elicitação, Spec, Macrobrief | maior disponível, com tool calling |
| Analista | grande |
| Executor | médio → grande, pela complexidade do Microbrief |
| Avaliador | grande, **diferente** dos executores do cluster (não usar o Jev: exige ler código grande) |

- Modelos verificados pela descoberta; somente gratuitos por padrão, pagos só com opt-in explícito; sem combos `auto/*`.
- O NextCode escolhe **o modelo dentro da faixa**; **quem chama o provedor é sempre o OmniRoute** (§12).
- Escolha final dentro da faixa: `choice` do Jev, com `criteria` descrevendo a **fronteira** entre os modelos.
- Sem modelo disponível → `PAUSADA`, sem consumir tentativa.

### 7.2 Porta de confiança (toda decisão do Jev)
| Faixa | Ação |
|---|---|
| Alta (≥ limiar da ação) | aplica a decisão |
| Zona cinzenta | **erra para cima**: rota mais segura |
| Abaixo do piso | não decide: pergunta ao usuário algo objetivo |

- Limiar maior para decisões caras de desfazer (iniciar execução, tratar mensagem como mudança de Spec).
- Valores iniciais a calibrar: piso 0,60; ações caras 0,85.
- Empates frequentes = opções mal descritas → ajustar a rubrica, não o limiar.

---

## 8. Travas e momento de acionamento

| Trava | O que garante | Acionada em |
|---|---|---|
| **T1** Aprovação | Nada segue sem Spec (ou Spec de Correção) aprovada pelo usuário | SPEC_REVISAO → MACROBRIEF |
| **T2** Escopo | Executor só entrega arquivos do seu Microbrief, com destino explícito | Tipo 1 por executor e na promoção |
| **T3** Trilha | Todo evento gravado, append-only | sempre |
| **T4** Quarentena | Código auditado = código promovido; type-check/ESLint; rollback | após aprovação do cluster |
| **T5** Duas lentes | Lente Cega por `REQ`, verificação cruzada no final, modelo diferente, sem veredito = rejeita | por cluster |
| **T6** D-RANHO | Até 3 tentativas por executor; bloqueio + cascata + relatório ao humano | a cada rejeição |
| **T7** Pesquisa | Só o Elicitador, só fontes oficiais (confirmadas pelo motor de decisão), orçamento, conteúdo = dado | elaboração da Spec |
| **T8a** Conferência | Spec × Macrobrief: todos os `REQ`, nenhum novo, descrição fiel | CONFERENCIA |
| **T8b** Plano | Macrobrief × Microbriefs: cobertura de `REQ`, sem colisão de arquivos, sem ciclo, contratos definidos, nada fora da Spec | PLANEJAMENTO |
| **T9** Fase | Só o papel da fase atual age; permissões da §4.1 | toda chamada a agente |
| **T10** Entrega | Só termina com todos os `REQ` implementados, Spec completa no disco e build ok; lacuna volta ao Analista | VERIFICACAO |

---

## 9. Telemetria

### 9.1 Onde fica
| Camada | Armazenamento | Uso |
|---|---|---|
| Eventos brutos | `TelemetryLog` (append-only, T3) | auditoria e mineração |
| Métricas agregadas | tabela por dia/sessão/papel/modelo (nova) | painel e metas |
| Propostas | `CandidateSkillProposal` (`source`: skill, bug_pattern, routing, elicitation) | revisão humana |
| Painel | modal de telemetria, ampliado | acompanhamento |

### 9.2 Eventos (mínimo)
`PHASE_CHANGED`, `MESSAGE_CLASSIFIED`, `ELICITATION_QUESTION`, `RESEARCH_SOURCE_USED`, `RESEARCH_SOURCE_REJECTED`, `SPEC_SUBMITTED`, `SPEC_APPROVED`, `SPEC_REVISED`, `MACROBRIEF_CHECKED` (`REQ` faltando, culpa: macrobrief|spec), `PLAN_CREATED`, `PLAN_REJECTED`, `AGENT_CALL` (papel, modelo, tokens, latência), `EXECUTOR_REJECTED` (`REQ`, camada, assinatura), `LENS2_DIVERGENCE`, `CLUSTER_APPROVED`, `EMPIRICAL_GATE_FAILED`, `NODE_BLOCKED_HUMAN_NOTIFIED`, `QUEUE_PAUSED_NO_LLM`, `DELIVERY_COMPLETED`, `USER_OVERRODE_CLASSIFICATION`, `JEV_DECISION` (pergunta, escolha, **probabilidades completas**, confiança, versão, faixa da porta).

> Cada `JEV_DECISION` é ligada ao desfecho real (o usuário corrigiu a rota? a Spec foi aprovada?) para calibrar limiares e rubricas pela distribuição acumulada, nunca por um caso isolado.

### 9.3 Metas (iniciais, a calibrar)
| Métrica | Meta |
|---|---|
| Classificação correta (usuário não corrige a rota) | ≥ 95% |
| Rodadas até intenção clara | ≤ 3 |
| Spec aprovada sem pedido de ajuste | ≥ 60% |
| Macrobrief aprovado na 1ª conferência | ≥ 80% |
| Executores aprovados na 1ª tentativa | ≥ 60% |
| Divergências na Lente 2 | tendência de queda |
| Executores bloqueados (3 tentativas) | ≤ 5% |
| Entregas com todos os `REQ` e build ok | ≥ 90% |
| Build quebrado após ENTREGUE | 0 |
| Latência da classificação (p95) | ≤ 1 s |
| Decisões do Jev abaixo do piso | ≤ 10% |
| Tokens por `REQ` entregue | tendência de queda |

### 9.4 O que vira skill × o que vira melhoria do sistema
| Padrão observado | Vira | Exemplo |
|---|---|---|
| Mesmo erro no **código gerado** se repete | regra na skill do executor do cluster | `'use client'` esquecido → `executor-frontend` |
| Mesma lacuna recorrente na elicitação de um domínio | **skill de domínio** (modelo de Spec) | "SaaS imobiliária" → perguntas e entidades padrão |
| Conferência T8a falha pelo mesmo motivo | regra na skill do elicitador | critério de aceite obrigatório por `REQ` |
| Divergências frequentes na Lente 2 com um modelo | ajuste do seletor de modelos | rebaixar o modelo X para executor |
| Erro do **harness** | correção no sistema (bug) | já existe: `bug_pattern` |
| Usuário corrige a classificação com frequência | ajuste da rubrica do Jev | `incerto` e `duvida_avulsa` empatando |

Toda proposta passa por revisão humana; skill aprovada ganha nova versão fixa.

---

## 10. Execução: checklist e acionamento do humano

### 10.1 Checklist por requisito
Durante a execução, o usuário vê um **checklist por módulo e por `REQ`**, ticado à medida que cada requisito é implementado:

```
Cadastro de imóveis
  ✅ REQ-001 Cadastrar imóvel com fotos
  ✅ REQ-002 Editar e arquivar imóvel
  ⏳ REQ-003 Busca por bairro e faixa de preço   (backend · tentativa 2/3)
Agenda de visitas
  ⬜ REQ-007 Agendar visita
  🛑 REQ-008 Lembrete por e-mail → precisa de você (ver relatório)
```

| Estado | Origem |
|---|---|
| ⬜ pendente | `REQ` em Microbrief ainda não executado |
| ⏳ em andamento | executor do `REQ` em execução ou em nova tentativa |
| ✅ implementado | **somente** o veredito da Lente 1 do avaliador (`implementado`) — **nunca** o relatório do executor; confirmado de novo pela T10 na entrega |
| 🛑 precisa de você | situação da lista fechada (§10.2), com link para o relatório |

- O progresso chega por eventos do servidor (não por recarga periódica) assim que cada cluster é avaliado.
- O perfil engenheiro pode expandir cada `REQ` para ver Microbrief, arquivos e veredito.

### 10.2 Lista fechada: o que vai para o humano
| Situação | Motivo |
|---|---|
| Aprovar a Spec / Spec de Correção | T1 |
| Lacuna na Spec que só o usuário sabe responder | escopo é decisão do usuário |
| Executor bloqueado após 3 tentativas | T6 |
| Analista e Elicitador sem acordo após 3 voltas | mesmo critério da T6 |
| Sem LLM disponível além do prazo (§15) | não há o que automatizar |
| Decisão do Jev abaixo do piso de confiança | o NextCode não adivinha |
| A tarefa exigiria modelo pago sem liberação | custo é decisão do usuário |

**Qualquer outra situação é resolvida automaticamente.** Uma nova situação só entra nesta lista por decisão registrada neste documento.

---

## 11. Estratégia de tokens

| Desperdício atual (medido no código) | Substituição |
|---|---|
| Dois classificadores por LLM a cada mensagem (`routeTaskSmart` e `classifyGraphifyEligibility`) | **uma** requisição ao Jev com várias perguntas |
| Histórico inteiro do chat enviado na conversa | contexto por artefato (P3) |
| Contexto genérico do projeto em toda chamada do executor (até 24.000 caracteres) | só Microbrief, Contratos e arquivos do escopo |
| Lente Cega e autocorreção refazendo tudo | Tipo 1 (sem token) antes de qualquer LLM; correção **por `REQ`** |
| Descoberta de modelos testando até 24 modelos a cada 30 min | testar menos e reaproveitar o resultado do uso real |

**Meta:** tokens por `REQ` entregue, medida nos projetos de referência (§14.1), com tendência de queda a cada versão.

---

## 12. Roteamento de provedores

- **Um único roteador: o OmniRoute.** Escolhe o provedor, faz failover entre provedores, controla cota e créditos, e guarda as chaves.
- **O NextCode (com o Jev)** decide só a faixa de modelo de cada papel (§7.1) e qual modelo verificado usar dentro dela.
- **Removida do NextCode** a cadeia própria de fallback (Groq, NVIDIA, DeepSeek e Gemini diretos), que competia com o OmniRoute e insistia em rotas mortas. No máximo, um "modo sem gateway" para desenvolvimento local.
- **Roteamento não é skill:** envolve rede, chaves, cotas, failover e timeouts — é infraestrutura do harness.
- **A imagem do OmniRoute é fixada numa versão testada** (hoje `diegosouzapw/omniroute:latest` no `docker-compose.yml`), como as skills e o Jev. Atualização só após passar pelos projetos de referência.
- O **Jev não passa pelo OmniRoute** (endpoint de decisão, não de chat): é uma integração própria, com chave própria.

---

## 13. Chaves de API do usuário (BYOK)

- O usuário cadastra as chaves **numa única tela do NextCode**.
- O NextCode guarda as chaves **criptografadas** (chave mestra obrigatória) e **registra cada uma como conexão no OmniRoute** pela API de gestão dele (`/api/providers`). Toda chave do usuário entra automaticamente no failover do gateway; o usuário não precisa abrir o painel do OmniRoute.
- A política de dados e de custo (§14.4) vale igualmente para todos os provedores.
- Cada chave registra **o dono** (usuário/organização), para que, em equipe, cotas e chaves não se misturem.
- Situação atual a corrigir: chaves de Gemini/Groq/NVIDIA/DeepSeek usadas direto pelo NextCode (fora do failover); chaves de Claude/OpenAI gravadas e nunca usadas; chave do OmniRoute em texto puro.

---

## 13b. Segredos

- **Nenhum segredo em texto puro, nunca** — inclusive em desenvolvimento.
- **Chave mestra gerada automaticamente** na 1ª inicialização, se não existir, guardada **fora do banco** (arquivo protegido ou cofre de credenciais do sistema operacional), com **aviso obrigatório de backup** (perder a chave mestra = perder acesso às chaves gravadas).
- **Migração** das chaves já gravadas em texto puro (atualizar `scripts/migrate-encrypt-keys.mjs`, hoje no formato antigo `enc:v1`).
- Cobertura: `Setting` (todas as chaves), `CustomProvider.apiKey`, **`McpServer.env`** (hoje sempre em texto puro) e qualquer chave de item do catálogo.
- **Formulário gerado:** toda integração tem formulário para colar a chave, montado a partir do que o item declara (14a.3, regra 5) — integração nova não exige tela nova.

---

## 14a. Catálogo de componentes (MCP, skills, plugins, motores, gateways)

### 14a.1 Funções e contratos
Tudo o que pode ser trocado é organizado por **função**. Cada função tem um **contrato** que toda opção deve cumprir; dentro da função, as opções ficam **em ordem de preferência**.

| Função (categoria) | Contrato | Opções iniciais (ordem) |
|---|---|---|
| Motor de decisão | API no formato do Jev (`state` + `questions` → `answers`) | 1. Laya · 2. Jev (D6) |
| Gateway de LLM | API compatível com OpenAI | definido pelos projetos de referência (D3) |
| Busca na web | MCP com ferramentas de busca e leitura de página | 1. Exa · 2. SearXNG (D2) |
| Skill de cada papel | `SKILL.md` no formato NextCode (Markdown + YAML, versionado) | skills próprias (D5) |
| Plugin / integração | contrato declarado pelo próprio plugin | — |

### 14a.2 O que a tela permite
- **ativar, desativar, remover, reordenar** (1ª opção, 2ª…) e **trocar** por outra opção da mesma função — sem alterar código;
- ver origem, versão fixada, status de saúde e uso (telemetria) de cada item.

### 14a.3 Regras
1. **Failover automático:** o NextCode usa a 1ª opção ativa; se ela falhar no teste de saúde ou em uso, passa para a próxima e registra o evento.
2. **"Sem código" vale dentro do contrato.** Algo que não segue o contrato da função precisa de um adaptador escrito uma única vez; a partir daí, a troca é pela tela.
3. **Item novo entra como "não validado"** até passar pelos projetos de referência (§14.1); antes disso nunca vira 1ª opção sozinho. Versão sempre fixada; origem sempre exibida (MCP `stdio` é código de terceiros executado na máquina).
4. **O catálogo nunca concede permissão.** Quem pode usar o quê é a matriz de permissões por papel (§4.1).
5. **Cada item declara de quais chaves precisa** (nome, formato, link para obter, como testar) — isso gera o formulário (§13b).

### 14a.4 Ponte única (hub MCP do harness)
- Uma **ponte única** liga o orquestrador aos itens do catálogo: MCPs (ferramentas), **skills publicadas como prompts MCP**, motor de decisão e gateway.
- A ponte é **parte do harness**, não um serviço independente com lógica própria: recebe em cada chamada **o papel e a fase** e só expõe o que a matriz de permissões libera. **Não decide sequência** — isso é só da máquina de fases (evita repetir o problema de dois roteadores competindo).
- Centraliza: failover e saúde (14a.3), injeção de credenciais (nenhum agente vê chave), telemetria de cada chamada (papel, item, versão).
- Antes de construir do zero, **avaliar gateways MCP prontos** (ex.: Docker MCP Gateway, MetaMCP, IBM ContextForge) quanto ao controle por papel; se nenhum cumprir, construir o nosso.
- **Mais adiante (etapa "mundo"):** expor a ponte para fora como servidor MCP, para ferramentas externas (Claude Code, Cursor) usarem as skills e MCPs do NextCode.

---

## 14. Roadmap de escala

### 14.1 Projetos de referência (meta que governa tudo)
5 a 8 projetos com Spec fixa e critérios de aceite (ex.: calculadora, CRUD com banco, autenticação, correção num projeto existente, integração com API externa, mini-SaaS de imobiliária). **Toda mudança** — skill, rubrica do Jev, modelo, trava ou versão do OmniRoute — roda esse conjunto antes de entrar.
**Métrica principal do projeto:** % dos projetos de referência entregues completos e com build ok.

### 14.2 Orquestração inteiramente no servidor
- Máquina de fases guiada por eventos, com estado no banco; a interface só acompanha.
- Um único serviço de orquestração (hoje a execução está duplicada em `execute_node` e `process_queue`, em `dag/route.ts`).
- Execução num **worker** com fila de tarefas, fora da requisição HTTP.

### 14.3 Entrega por Git
- Cada execução trabalha numa **branch**; um commit por cluster, com os `REQ` na mensagem; no fim, um **Pull Request** com o relatório de entrega.
- Quarentena e rollback (T4) passam a ser uma branch descartada; rastreabilidade `REQ` → commit → linha.

### 14.4 Privacidade e política de dados
- Política por workspace: só provedores que não retêm dados / só pagos com contrato / gratuito liberado. A política decide quais modelos o seletor pode usar.
- Nenhum segredo do repositório vai para um LLM (varredura de segredos no contexto antes do envio).

### 14.5 Arquitetura multiusuário
| Hoje | Alvo |
|---|---|
| SQLite | PostgreSQL |
| Estado em memória (rate limit, cotas, circuit breaker, descoberta) | Redis ou banco; vários servidores |
| Um token compartilhado | contas, organizações, papéis (quem aprova a Spec), auditoria por pessoa |
| Escrita na máquina local | execução isolada em container por projeto |
| Sem custo por usuário | orçamento de tokens por sessão e por organização |

Decisões de agora não podem impedir esse alvo (ex.: a máquina de fases já nasce com estado no banco).

### 14.6 Adaptadores por stack
Spec declara a stack; o harness escolhe o adaptador: TypeScript (`tsc` + ESLint + Vitest), Python (`ruff` + `mypy` + `pytest`) e outros.

### 14.7 Critério de aceite vira teste executado
Cada critério de aceite gera um teste automatizado, executado em container isolado antes da entrega. "Implementado" passa a ser teste passando; a T10 vira garantia.

### 14.8 Custo antes de aprovar
Junto da Spec: estimativa de tarefas, chamadas, tempo e custo.

### 14.9 Progresso por requisito
Ver §10.1.

### 14.10 Proveniência
Cada artefato e arquivo gerado registra modelo, versão da skill, versão da rubrica do Jev e resumo do prompt.

### 14.11 Memória do projeto para correções
O Elicitador consulta o grafo do projeto (graphify, já existente) ao montar uma Spec de Correção. Conteúdo do repositório é **dado, nunca instrução**.

### 14.12 Skills como produto
Skills versionadas e fixadas, registro interno, avaliação pelos projetos de referência como porta de entrada; depois, marketplace de skills de domínio.

### 14.13 Ordem das etapas
| Etapa | Entrega | Para quem |
|---|---|---|
| 0 | Projetos de referência + máquina de fases no servidor + orquestração única | Fundador |
| 1 | Papéis da v2 (Elicitador com Laya→Jev, Analista, Microbriefs com `REQ`, avaliador por cluster) + checklist + roteamento único + BYOK + **segredos (§13b)** + **catálogo e ponte única (§14a)** | Fundador |
| 2 | Entrega por Git + proveniência | Equipe interna |
| 3 | Política de dados + PostgreSQL, worker e contas + custo antes de aprovar | Equipe interna |
| 4 | Sandbox com testes de aceite + adaptadores por stack | Equipe ampliada |
| 5 | Multi-organização, cobrança, marketplace de skills | O mundo |

**Regra:** só se passa para a próxima etapa quando os projetos de referência da etapa atual passarem.

---

## 15. Decisões

### 15.1 Tomadas
| # | Decisão | Data |
|---|---|---|
| D1 | **Jev:** o fundador tem a chave; formulário na tela BYOK ("Jev — TypeSafe AI"), testado contra a API real. Formato conforme a **documentação oficial** (`questions` é um objeto com ids; resposta em `answers`), que difere do artigo de terceiros. | 04/10/2026 |
| D2 | **Busca na web:** ferramenta = servidor MCP; método = skill do Elicitador. **Exa** como principal (oficial, funciona sem conta, devolve o conteúdo da página na mesma chamada); **SearXNG** auto-hospedado como alternativa para privacidade. Validar com perguntas reais do Elicitador antes de fixar. | 04/10/2026 |
| D3 | **Gateway de LLM (revisada):** o NextCode não roteia entre provedores; usa gateways compatíveis com OpenAI em ordem configurável: **FreeLLMAPI** (primário) → **OmniRoute** (secundário) → chaves BYOK diretas (legado). Falha classificada (rede, chave, esgotado, requisição inválida) passa ao próximo gateway. Em vez de exigir modelo exato, aceita a estratégia de roteamento do gateway (`auto`, `auto:smart`) **desde que o modelo que respondeu seja registrado** (`X-Routed-Via` → telemetria `llm.gateway_call`); no OmniRoute, modelo exato configurável. A ordem final continua decidida pelo bench (passo 8). Detalhes: `docs/LLM-GATEWAYS.md`. Para equipe/mundo, provedores com contrato de privacidade (§14.4). | 05/10/2026 (revisa 04/10) |
| D4 | **Pausa sem LLM:** após **1 minuto** sem modelo disponível, o Elicitador avisa no chat que parou por falta de cota/provedor e sugere recarregar; mostra quando a cota volta, se o gateway informar; **não consome tentativa**; o NextCode continua tentando e **retoma sozinho** quando houver modelo. | 04/10/2026 |
| D5 | **Skills próprias** para Elicitador, Analista, os 4 Executores e o Avaliador cego: Markdown + YAML, versionadas, curtas, aprovadas pelos projetos de referência. Skills de terceiros só como complemento (revisadas e com versão fixa). Rubricas do Jev são configuração versionada do harness, não skills. | 04/10/2026 |
| D6 | **Motor de decisão em cascata:** adaptador de decisão único no formato da API do Jev. **Laya** (modelo aberto, local, Apache 2.0, checkpoint `laya-multilingual`) decide primeiro; se a confiança ficar abaixo do limiar, a mesma pergunta vai ao **Jev**; o resultado segue para a porta de confiança (§7.2). Laya roda como **serviço à parte** (container com o pacote Python oficial, ~2 GB de RAM), nunca dentro do servidor Next.js. Se um dos dois cair, o outro assume. O papel de cada um (principal/reserva) é decidido por medição: conjunto de ~100 mensagens reais em português com a classificação correta. | 04/10/2026 |
| D7 | **Cliente MCP real** com controle por papel, dentro da ponte única do harness (§14a.4). | 04/10/2026 |
| D8 | **Catálogo de componentes** por função, com contrato, ordem de preferência, failover, saúde e entrada como "não validado"; o catálogo nunca concede permissão (§14a). | 04/10/2026 |
| D9 | **Segredos:** criptografia obrigatória sempre, chave mestra gerada automaticamente com aviso de backup, migração das chaves atuais, `McpServer.env` cifrado, formulário gerado por item (§13b). | 04/10/2026 |
| D10 | **Ponte única** (hub MCP) dentro do harness, skills como prompts MCP, avaliação de gateways MCP prontos antes de construir; exposição externa só na etapa "mundo" (§14a.4). | 04/10/2026 |

### 15.2 Em aberto
1. **Metas da §9.3** — ajustar valores.

---

## 16. Base existente no código

| Peça | Situação |
|---|---|
| Envelope MD + YAML | `InputPreprocessorEngine` (parcial) |
| Brief com YAML e cluster | `BriefBuilder` (não usado) |
| Ciclo e colisão de escopo | `DAGEngine.detectCycles` / `hasScopeCollision` (não usados) |
| Duas lentes | `DualLensAuditor` (hoje por nó, sem `REQ`) |
| Quarentena + gate empírico + rollback | `QuarantineManager`, `empirical-gate` |
| Skills de terceiros como não confiáveis | `skill-resolver` |
| Modelos verificados | `omni-model-discovery` |
| Trilha append-only | `TelemetryLog` + triggers |
| Grafo do projeto | `graphify-runner` |
| Gestão de conexões do OmniRoute | API `/api/providers` do gateway (consultada em `omniroute/audit`) |
| Cadastro de MCP | tabela `McpServer` + aba MCP (grava configuração; nada a usa; `env` em texto puro) |
| Provedores customizados | tabela `CustomProvider` (sem prioridade nem failover) |
| Migração de chaves | `scripts/migrate-encrypt-keys.mjs` (formato antigo `enc:v1`) |
