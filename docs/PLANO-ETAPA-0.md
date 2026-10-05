# Plano da Etapa 0 — Fundação medida

> **Status:** aprovado pelo fundador em 04/10/2026.
> **Referência:** `docs/ARQUITETURA-ORQUESTRACAO.md` (v4), §14.13 (etapa 0).

## Objetivo

Entregar **projetos de referência**, **máquina de fases no servidor** e **orquestração única**. Os novos papéis (Elicitador, Analista, Microbriefs, Avaliador por cluster) são da **etapa 1**.

Ao fim desta etapa, a *qualidade* do código gerado ainda será baixa (DAG de 3 nós e agentes sem contexto continuam). A etapa 0 garante:

1. **O critério de parada do fundador vale:** a execução só termina com tudo entregue ou com um nó esgotando 3 tentativas.
2. **Medição:** a etapa 1 parte de uma pontuação de partida e precisa superá-la.

## Entregas

### E1. Projetos de referência + executor de avaliação

| # | Projeto | Exercita |
|---|---|---|
| P1 | Calculadora (`calc.ts` + `main.ts`) | caso mínimo; teste de fumaça |
| P2 | API de tarefas (CRUD com persistência em arquivo) | backend, vários arquivos |
| P3 | Login com sessão | regras e segurança básica |
| P4 | Correção num projeto pronto com bug plantado | caminho de correção |
| P5 | Integração com API pública oficial (ex.: ViaCEP) | integração externa |
| P6 | Mini-SaaS de imobiliária (imóveis, busca, visitas) | vários módulos; caso real |

- Cada projeto: Spec fixa, critérios de aceite e **testes de aceite escritos por humanos** (código confiável, nunca gerado pela IA).
- `npm run bench`: roda cada projeto **sem a interface**, direto pela orquestração; gera relatório Markdown + YAML com: entregue completo?, build ok?, testes de aceite aprovados, tokens, chamadas a LLM, tempo e **motivo da parada** (classificado).
- **Testes de aceite rodam em container Docker sem rede** (importam código gerado pela IA). Sem Docker, o bench avisa e não roda.
- **Orçamento:** P1 + P4 a cada mudança (fumaça); conjunto completo sob demanda, **máximo ~150 chamadas a LLM** por execução completa.

### E2. Máquina de fases no servidor

- Campo `phase` na sessão; cada transição gera evento na trilha append-only.
- `src/core/orchestrator/phase-machine.ts` com **todas** as fases e transições da arquitetura (§3), com teste para cada transição.
- Fases dos papéis da etapa 1 (Macrobrief, Conferência, Planejamento por Microbriefs) existem mas ficam **desligadas**: aprovação segue para a DAG atual como planejamento provisório.
- A interface deixa de conduzir o fluxo: `page.tsx` não chama mais `create_dag`/`process_queue`; só envia ações (mensagem, aprovação, retry) e acompanha por eventos do servidor.

### E3. Orquestração única

- Um único serviço em `src/core/orchestrator/`; a execução de nó, hoje duplicada em `execute_node` e `process_queue` (`src/app/api/dag/route.ts`, 1.362 linhas), passa a existir uma vez. Rotas ficam finas.
- Correções da revisão do fluxo:

| Problema | Correção |
|---|---|
| Aprovar pelo botão não criava a DAG | um único gatilho: aprovar (botão ou chat) grava a Spec e dispara a execução |
| Cada mensagem pós-aprovação criava DAG nova | mensagem em fase de execução não cria DAG |
| Chat e DAG implementavam o mesmo pedido | com Spec aprovada, só a DAG executa |
| DAG nascia da mensagem "aprovo" | DAG nasce da Spec gravada |
| Duas filas na mesma sessão | trava por sessão + reserva atômica do nó |
| Timeouts diferentes nos dois caminhos | valor único |

### E4. Execução fora da requisição HTTP + retomada

- Fila de tarefas no banco (tabela `Job` com reserva por tempo) + worker.
- Nesta etapa o worker roda no processo do servidor, iniciado por `instrumentation.ts`; o mesmo código roda como processo separado na etapa 3. Estado em `globalThis` para não iniciar duas vezes no `next dev`.
- Retomada automática após queda do servidor.
- Pausa sem LLM (D4): aviso no chat após 1 minuto; não consome tentativa; retoma sozinho.

### E5. Pontuação de partida + escolha do gateway (D3)

- Rodar o conjunto completo e registrar a pontuação de partida na arquitetura.
- Rodar o mesmo conjunto com OmniRoute e com FreeLLMAPI e decidir a D3 com números.

## Ordem (um commit por passo, cada um com testes)

| Passo | Entrega | Depende de |
|---|---|---|
| 1 | Máquina de fases (módulo puro + testes de todas as transições) | — |
| 2 | Serviço único de orquestração (extração do `dag/route.ts` **sem mudar comportamento**; testes de caracterização antes e depois) | — |
| 3 | Fila no banco + worker + retomada automática | 2 |
| 4 | Gatilho único, sem DAG duplicada, sem execução dupla, trava por sessão | 1, 3 |
| 5 | Pausa sem LLM (1 min, sem consumir tentativa, retomada) | 3 |
| 6 | Interface só observa (eventos do servidor no lugar da consulta periódica) | 4 |
| 7 | Projetos de referência + `npm run bench` + container de aceite | 2 |
| 8 | Pontuação de partida + comparação OmniRoute × FreeLLMAPI | 7 |

## Critérios de aceite da etapa 0

1. Em 100% das execuções do bench, o motivo da parada é "entregue completo" ou "bloqueado após 3 tentativas".
2. Servidor derrubado no meio → retoma sozinho ao subir (teste automatizado).
3. Dois gatilhos simultâneos → uma única fila; nenhum nó executa duas vezes (teste).
4. Aprovar pelo botão ou pelo chat → exatamente uma DAG (teste).
5. Sem LLM → pausa, aviso em 1 minuto, nenhuma tentativa consumida, retomada (teste com gateway falso).
6. Pontuação de partida registrada e D3 decidida.
7. Toda a suíte atual continua passando.

## Fora da etapa 0

Elicitador com Laya → Jev, Analista, Microbriefs com `REQ`, Avaliador por cluster, checklist por requisito, catálogo, ponte MCP, segredos com chave mestra automática, remoção da cadeia de fallback própria do router.

## Riscos

- Cota de modelos gratuitos: orçamento por execução e fumaça só com P1 + P4.
- Refatoração do `dag/route.ts`: passo 2 sem mudança de comportamento, com testes antes e depois.
- `instrumentation.ts` no `next dev`: worker não pode iniciar duas vezes (estado em `globalThis`).
- Docker obrigatório para os testes de aceite.

## Modo de execução

Os passos podem ser implementados por outro agente (ex.: Antigravity). Cada passo é **auditado** antes do próximo: diff, testes, critérios do passo e aderência à arquitetura.
