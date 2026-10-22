# Análise Profunda de Engenharia da Pasta `docs/` e Ponto de Retomada Pós-Reinício

- **Data da análise:** 21/10/2026 (06:52 BRT)
- **Propósito:** Mapear de forma exata a arquitetura, o histórico documental da pasta `docs/`, o estado atual do código/git, o diagnóstico técnico do que estava em execução antes do reinício da máquina e o roteiro exato de continuação da implementação.

---

## 1. Visão Macro da Pasta `docs/` (Mapa Documental Completo)

A pasta `docs/` contém **133 arquivos** divididos em 6 áreas funcionais. Abaixo está a síntese de engenharia de cada bloco e o que vale hoje como fonte de verdade:

### 1.1 Documentos Canônicos de Arquitetura e Cronograma (Raiz de `docs/`)
1. **`docs/NEXTCODE-REFERENCIA.md` (795 linhas, atualizado em 21/10/2026 às 03:48):**
   - **Papel:** Fonte única da verdade do projeto (instituído pelo passo D1 em 13/10).
   - **Estrutura:**
     - **§1–§3:** Visão do produto, regras inegociáveis do fundador (7 regras de ouro: sem parada silenciosa, escopo estrito de arquivos T2, trilha append-only T3, independência executor × avaliador, mascaramento de segredos antes de sair da máquina, rotas oficiais sem revenda) e estado real da fundação (E0).
     - **§4 (`§4.1–§4.5`):** Manual operacional do **Jev (`jev-1.13.0`, TypeSafe System One)** e catálogo dos pontos de decisão (`J1` a `J27`). Define onde o Jev brilha (perguntas atômicas e estreitas com estado ≤ 8k chars) e onde é proibido (gerar código/texto, contar, datas, juiz único de entrega).
     - **§5.0 (Cronograma Único Aprovado):** A fila única de execução (`E0` → `E1` → `E2` → `E3` → `E4` → `E5` → `E6`), o marcador **`▶ AGORA`** (linha 285), os checklists das Execuções Autônomas 1 (Mudança 23) e 2 (Mudança 26) e o registro histórico das **27 Mudanças do Cronograma** (linhas 371–398).
     - **§6–§8:** Decisões do fundador, protocolo de benchmark hermético (P1–P4 em contêiner Docker sem rede) e protocolo de travas de implementação/auditoria (`T-A` a `T-K`, `R1` a `R3`).
2. **`docs/ARQUITETURA-ORQUESTRACAO.md` (13/10/2026):**
   - **Papel:** Documento de desenho estrutural do pipeline ponta a ponta (Funil Universal de Entrada → Spec Canônica YAML/Markdown → Decomposição em DAG / Microbriefs → Execução em Quarentena com Tool Loop → Auditoria Cega em 2 Lentes + Porteiro Empírico → Promoção Atômica e Verificação T10).
   - **Status:** Base arquitetural consolidada em `NEXTCODE-REFERENCIA.md`.

### 1.2 Relatórios de Implementação, Auditoria e Decisões (`docs/relatorios/`)
Os relatórios documentam a evolução empírica do sistema desde 08/10 até 21/10:
- **Fundação e Roteamento (`08/10 a 14/10`):**
  - `P0-arrumacao.md`, `P1-nucleo-jev.md`, `P2-bench-real.md`, `P2b-bench-dificil.md`, `P3-avaliador-freellmapi.md`, `R1-roteamento-pago-primeiro.md`, `S1-skills.md`, `C1-correcoes-auditoria.md`, `D1-documento-unico.md`, `J1-diagnostico-entrega-jev.md`, `J2-nenhuma-parada-silenciosa.md`, `I1-inventario-ligado-desligado.md`.
- **Entrada, Segurança de Segredos e Elicitador Claude Opus (`14/10 a 16/10`):**
  - `P5-entrada-como-pensada.md`, `P5.5-mascara-json-asaas.md`, `P5.5b-mascara-duas-passadas.md`: Mascaramento em 2 passadas antes do Jev e do chat (incluindo chaves JSON e Asaas).
  - `P5c-elicitador-opus-teto.md`, `P5c.3-elicitador-claude-stream.md`, `P5c.4-indicador-spec-chat.md`, `F8-smoke-P5c-fechamento.md`: Elicitador de Spec rodando em Claude Opus 5.5 direto com streaming, teto de 48k tokens de saída e 60k chars na correção.
  - `B1-bench-avaliador-claude.md` e **`B1c-PJ1.md` (atualizado em 20/10 às 22:47):** Correção do ramo Anthropic direto (leitura de blocos `text` após `thinking`), marcação de execução inválida por falha de rota no bench, e entrega completa do pacote **PJ1** (`PJ1.1` a `PJ1.5` — arquivar/desarquivar, reabrir pasta existente sem duplicar, apagar projeto com opção de manter/remover pasta do disco, exigir vínculo de projeto antes de aprovar Spec, e smoke 4/4 no navegador real concluído em 20/10).
- **Auditorias Profundas de Subsistemas (`16/10 a 17/10`):**
  - `AUDITORIA-SKILLS.md`: Diagnóstico brutal das 12 skills (`skills/*/SKILL.md`) mostrando discrepâncias entre o que o texto das skills pedia e o que o código executava (deu origem aos ajustes de AV1, A2, P1, P4, P7 e à linha **S3**).
  - `PERFIL-PROVEDORES.md`: Perfil técnico oficial e sonda real de repasse para **DeepSeek v4 Pro** (`custom/`), **Claude Sonnet/Opus 5.5** (Anthropic direto) e **Nemotron 3 Super 120B**. Provou que `response_format` e `tools` passam pelo FreeLLMAPI e identificou tentativa de revenda (`router9/`), reforçando o filtro estrito `prefixos_rota_paga: "custom/"`.
  - `AUDITORIA-JEV.md`: Mapeamento dos usos do Jev contra os cookbooks oficiais da TypeSafe (deu origem à linha **JV1** e ao catálogo único P10).
  - `A3-falha-roteada-ao-dono.md` e `A2-analista-planeja.md`: Roteamento de falha ao dono (com pré-checagem mecânica de `plan_error`) e planejamento real pelo analista LLM validado pela trava T8b.
- **Execução Autônoma 1 — Mudança 23 (`17/10 a 18/10`):**
  - `DECISOES-AUTONOMAS-E1.md`, `AUDITORIA-E1-autonoma.md`, `AUDITORIA-E1-autonoma-cursor.md`: Entrega e auditoria de `A2.1–A2.3`, `AV1.1–AV1.5` (porteiro `tsc` antes do avaliador, controles com defeito plantado 7/7 no Sonnet), `PJ1.6b`, `M20` (memória desligada) e `SM1` (conferência mecânica da Spec).
- **Execução Autônoma 2 — Mudança 26 (`19/10 a 20/10`):**
  - `IMPLEMENTADO-E1-producao.md`, `DECISOES-AUTONOMAS-E1-2.md` (D1–D42), `AUDITORIA-E1-producao.md` e `AUDITORIA-E1-producao-cursor.md`:
    - Implementação dos 13 passos de produção (**P1 a P13**) + correções **D41** e **D42** nascidas dos achados do teste real `8e2f2052` (Multi_Gateway).
    - Reduziu as chamadas do executor no bench P1–P4 para **2 a 5 chamadas por etapa** (meta TR1 ≤ 10), com P1–P4 100% `ENTREGUE` (`10/10`, `13/13`, `12/12`, `12/12`).
    - Fechamento pós-auditoria no commit `dc1d583` (alinhamento de `skills/avaliador/SKILL.md:72` e chave sintética no `TESTE PESADO 3` em `tests/intake/mega-stress-e1-e5.test.ts`) e merge de **TR1 (6)** no commit `708b22f` (`package.json` com dono único + `installDeclaredDependencies` pelo harness).
- **Execução Autônoma 3 — Mudança 27 (`21/10/2026`, em andamento no momento do reinício):**
  - `DECISOES-AUTONOMAS-E1-3.md` (criado em 21/10 às 03:48): Documenta as decisões **E1 a E11** e o desenho técnico completo do **J2b + J2.7** (`J1` a `J8`).

### 1.3 Relatórios de Benchmark (`docs/relatorios/bench/`)
- Contém **21 pares `.md` + `.yaml`** de medições históricas (`2026-10-09` a `2026-10-20-1314`).
- Os mais recentes (`2026-10-20-1244.md` e `2026-10-20-1314.md`, além da rodada da auditoria do Cursor em 20/10) comprovam que no conjunto P1–P4 todas as etapas passam com `tsc = 0`, aceite `47/47` (`10/10`, `13/13`, `12/12`, `12/12`) e custo total ~`US$ 0,31–0,38`.

### 1.4 Prompts Históricos (`docs/prompts/`), Rascunhos (`docs/rascunhos/`), Specs (`docs/specs/`) e Terceiros (`docs/terceiros/jev-docs/`)
- `docs/prompts/`: 26 prompts operacionais que guiaram as fases anteriores (`P0` a `AUDITORIA-E1-producao-cursor.md`).
- `docs/rascunhos/`: Rascunhos originais de 06–16/10 (`TEMPLATES.md`, `TERCEIROS.md`, `JEV-DECISOES.md`, `FASE8-pedido-sintetico-p5c.md`) já absorvidos em `config/politicas-orquestracao.yaml` e `docs/NEXTCODE-REFERENCIA.md`.
- `docs/terceiros/jev-docs/`: Cópia local da documentação oficial da TypeSafe System One (Jev).

---

## 2. Onde Exatamente Paramos (Estado do Git e da Máquina em 21/10)

### 2.1 Últimos Commits no `main` (`HEAD = 19d3bcd`)
```text
19d3bcd fix(pj1.5): smoke na tela 4/4; painel diz reaberto ao abrir pasta ja cadastrada (189)
ec1dc98 docs: diario 187 sem marcas de conflito e com a suite da branch (187)
708b22f fix(tr1-6): package.json com um dono para cada coisa; harness instala o que a etapa declarou (187)
dc1d583 fix(auditoria): fecha ressalvas do Cursor da mudanca 26 (skill do avaliador, teste sem .env) (188)
2d5f18b docs(auditoria): Cursor audita a execucao autonoma 2
```

### 2.2 Arquivos Modificados / Não Commitados na Árvore (`git status --short`)
Há **4 arquivos de trabalho da Execução Autônoma 3 (Mudança 27)** ainda não commitados (mais os 2 marcadores locais de ferramentas que nunca devem ser commitados):
1. `M docs/NEXTCODE-REFERENCIA.md` — adiciona a linha **TS1** e atualiza a linha **J2b + J2.7** e a **Mudança 27** na §5.0.
2. `M memory/diario.md` — adiciona as entradas **(190)** e **(191)** sobre o início e reinício do Teste Pesado.
3. `?? docs/relatorios/DECISOES-AUTONOMAS-E1-3.md` — relatório das decisões autônomas E1–E11 e desenho J1–J8 do J2b + J2.7.
4. `?? scripts/teste-pesado.ts` — script que executa o Teste Pesado da E1 (Spec real da sessão `8e2f2052`, Multi_Gateway) usando cópia do banco em `%TEMP%\nc-teste-pesado\dev-copy.db`.
*(Arquivos de ambiente a ignorar como sempre: `M .claude/.headroom_wrap_marker.json` e `M .serena/project.yml`).*

---

## 3. Diagnóstico Crítico de Engenharia: O Que Aconteceu no Teste Pesado (`scripts/teste-pesado.ts`)

Ao inspecionar o processo ativo de `scripts/teste-pesado.ts` e o banco temporário `%TEMP%\nc-teste-pesado\dev-copy.db` (sessão `314176ef-c2a5-4fd5-9cd3-0020e4648968`), identificamos **exatamente por que** tanto a 1ª tentativa (sessão `d527f2bc`, diário 190) quanto a 2ª tentativa (sessão `314176ef`, diário 191) entraram em loop de `SESSION_PAUSED_NO_LLM` / `EXECUTOR_TURN_RETRY` sem avançar nas etapas de IA:

### 3.1 Os Fatos no Banco Temporário (`%TEMP%\nc-teste-pesado\dev-copy.db`)
- **Planejamento funcionou:** O analista (`deepseek-v4-pro` direto via `https://api.deepseek.com/v1`) aprovou o plano (`ANALISTA_PLAN_APPROVED` + `PLANO_T8B_OK`) gerando **57 nós** (1 etapa base mecânica `completed` + 56 etapas de IA), custando `US$ 0,1040`.
- **Execução travou em vaivém infinito:** Logo após a etapa base completar, as 3 primeiras etapas paralelas (`Etapa 1/56`, `Etapa 2/56`, `Etapa 5/56`) falharam repetidamente com:
  - `135` eventos `SESSION_PAUSED_NO_LLM`
  - `276` eventos `EXECUTOR_TURN_RETRY` (`motivo: "nenhum provedor respondeu"`)
  - `94` eventos `PHASE_TRANSITION` (`PAUSADA -> EXECUCAO` com evento `LLM_VOLTOU`)
- **O erro real gravado em `llm.gateway_failure`:**
  ```json
  {
    "gateway": "freellmapi",
    "requestedModel": "deepseek-v4-pro",
    "kind": "network",
    "status": null,
    "detail": "inacessível em http://localhost:3100/v1: TypeError: fetch failed"
  }
  ```

### 3.2 As Duas Causas Combinadas (Operacional + Bug no Supervisor)
1. **Causa Operacional (FreeLLMAPI na porta `3100` desligado):**
   - No diário (191), a sonda feita antes de reiniciar testou `probeGateway("deepseek")` (que chama `https://api.deepseek.com/v1` direto) e respondeu em 603 ms.
   - Porém, o executor em modo `somente_pago: true` (`loadPaidGatewaysForTier` em `src/core/llm/paid-routing.ts:43`) busca **exclusivamente** o gateway `id === "freellmapi"` (`http://localhost:3100/v1`)!
   - Como o contêiner Docker do FreeLLMAPI (`localhost:3100`) estava parado (provavelmente fechado junto com o Docker para liberar memória RAM), todas as chamadas do executor bateram em `http://localhost:3100/v1` e falharam instantaneamente com `fetch failed`.
2. **Bug Arquitetural no Supervisor de Pausa (`src/core/orchestrator/job-worker.ts:39-48`):**
   - Quando o executor não consegue falar com `freellmapi` (`localhost:3100`) após as esperas de 5s e 20s (P5), ele pausa a sessão com `SEM_LLM`.
   - Porém, a cada ciclo do worker (2s, com cache de 30s), `supervisePausedSessions` (`job-worker.ts:129-150`) chama `isAnyLlmGatewayReachable()` (`job-worker.ts:39-48`), que testa `gateways.map(gw => isGatewayAnswering(gw))` e faz `checks.some(Boolean)`.
   - Como a lista de gateways inclui `deepseek` direto (`https://api.deepseek.com/v1`), que está de pé, `isAnyLlmGatewayReachable()` retorna **`true`** mesmo com `freellmapi` (`localhost:3100`) morto!
   - Resultado: o supervisor emite `LLM_VOLTOU` (`PAUSADA -> EXECUCAO`) a cada ~27 segundos, o executor tenta `localhost:3100` de novo, falha de novo, volta para `PAUSADA`, e como a sessão pisca para `EXECUCAO` a cada 27s, o contador `pausadaDesde` em `scripts/teste-pesado.ts:95` é zerado a cada ciclo e nunca atinge o limite de 45 minutos!

---

## 4. Plano de Continuação Imediato Após o Reinício da Máquina

Quando a máquina voltar do reinício, siga exatamente esta ordem:

### Passo 1 — Conferir o estado do Git e dos arquivos pendentes
Os 4 arquivos da Mudança 27 já estão salvos no disco:
- `docs/NEXTCODE-REFERENCIA.md`
- `memory/diario.md`
- `docs/relatorios/DECISOES-AUTONOMAS-E1-3.md`
- `scripts/teste-pesado.ts`

### Passo 2 — Corrigir a coerência Sonda × Executor antes de rodar o Teste Pesado
Antes de disparar `npx tsx scripts/teste-pesado.ts` novamente:
1. **Subir o gateway `freellmapi` (`http://localhost:3100/v1`)** (ex.: `docker compose up -d freellmapi` ou serviço local equivalente) e validar com `probeGateway("freellmapi")` que `http://localhost:3100/v1` responde `chatOk: true` com `servedBy: "custom/deepseek-v4-pro"`.
2. **Alinhar `isAnyLlmGatewayReachable()` (`src/core/orchestrator/job-worker.ts:39-48`) com a política `somente_pago`:**
   - Quando `isPaidOnlyRouting(policy)` for `true`, a sonda de retomada de `SEM_LLM` deve verificar se o gateway pago exigido pelo executor (`freellmapi` via `loadPaidGatewaysForTier`) está respondendo, e **não** `checks.some(Boolean)` em cima de `deepseek`/`omniroute` que o executor pago não usa. Isso elimina definitivamente o vaivém `PAUSADA ↔ EXECUCAO` quando o `freellmapi` cai.

### Passo 3 — Rodar o Teste Pesado da E1 (`scripts/teste-pesado.ts`)
- Executar `npx tsx scripts/teste-pesado.ts` (com a máquina limpa de processos pesados concorrentes).
- O script criará nova cópia em `%TEMP%\nc-teste-pesado` (mantendo `prisma/dev.db` intocado, trava T-F) e ao terminar gravará `docs/relatorios/TESTE-PESADO-E1.md`.
- **Porta de aprovação do Teste Pesado (`DECISOES-AUTONOMAS-E1-3.md` E4):**
  - Fase final = `ENTREGUE`
  - `≤ 10` chamadas do executor em **cada** etapa com IA
  - Custo total `< US$ 18,78`

### Passo 4 — Próximos Itens da Fila Oficial (`docs/NEXTCODE-REFERENCIA.md` §5.0)
Assim que o Teste Pesado fechar, a fila de implementação segue na ordem exata da §5.0:
1. **`J2b + J2.7` (Mudança 27 — desenho já pronto em `DECISOES-AUTONOMAS-E1-3.md` J1–J8):**
   - Quando todas as etapas terminam e a verificação final reprova (`VERIFICACAO_COM_LACUNAS` em `phase-machine.ts`), em vez de ir direto para `BLOQUEADA`, transicionar `VERIFICACAO → PLANEJAMENTO → EXECUCAO`.
   - Gerar em código (sem LLM) etapas de reparo por etapa dona de cada REQ/arquivo com lacuna, semeando o código atual na quarentena (mecanismo do P3), com limite de **3 rodadas** de reparo por sessão (na 4ª reprovação → `BLOQUEADA` com relatório completo).
   - Junto: implementar **J2.7** (teste estrutural de `phase-machine.ts` usando as listas exportadas `PHASES` e verificando todos os eventos aceitos).
   - **Porta:** teste com defeito plantado reparado até `ENTREGUE` + teste com defeito persistente indo a `BLOQUEADA` após 3 rodadas + bench P1–P4 sem regressão.
2. **`TS1` (Mudança 27 — ressalva D23 da auditoria):**
   - Medir onde `tests/harness/end-to-end-harness-plan.test.ts` e `tests/orchestrator/step-4b.test.ts` gastam tempo de setup/I/O, enxugar o peso e voltar ambos ao timeout padrão de 15s (suíte verde 2×).
3. **`J3` (`avaliador-final` cego e fechado, Mudança 12 e 17):**
   - Skill `avaliador-final` (família diferente do executor) lendo Spec inteira + todos os arquivos entregues + provas mecânicas (`tsc`, testes) + 2ª checagem atômica do Jev por REQ; reprovação aciona o reparo do `J2b`.
4. **`J4`:**
   - Religar `auditoria_entrega: ativo` após validação no J3 e medir com × sem Jev em `medicoes.md`.
5. **Fechamento da E1 e entrada na E2 (`P5.4 → ativo`, `J11`, `J7/J8/J9`, `P8` pesquisador T7, correção da Spec por trecho com cache Anthropic).**
