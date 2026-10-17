# Auditoria das skills — 16/10/2026

> Parêntese aberto pelo fundador (diário 95): "revisar a fundo todas as skills — fazem o que dizem? bem construídas? acionadas no momento certo? travas e ordem funcionando? Seja brutal."
> Auditor: Claude. Nada de código ou skill alterado. Evidência: código no HEAD `6ef547d`, carga real de cada skill pelo `loadRoleSkill` (script fora do repo) e trilha do teste real `934939fc` + bench `2026-10-16-1822`.

## 1. Veredito

**As skills não são o que governa o NextCode hoje.** Das 12, só 2 grupos chegam ao modelo no momento certo (executor-* e avaliador-*), e mesmo esses brigam com o texto que o código monta em volta. O resto é carregado só para registrar o nome, nunca é carregado, ou roda num caminho que nunca completa. O que realmente decide são heurísticas de texto no código, caladas. Por isso tantos problemas num harness que deveria "só orquestrar skills".

| Skill | Carregada onde | Chega ao modelo? | Faz o que promete? |
|---|---|---|---|
| `elicitador` | `spec-draft.ts:99` (prompt da Spec) | ✅ sim | ⚠️ parcial — não fixa o contrato que o plano precisa |
| `analista` | `spec-decomposer.ts:344` (LLM) e `intake-engine.ts:224` (só o nome) | ❌ na prática nunca (5 s de limite) | ❌ quem planeja é a heurística |
| `executor-core/backend/frontend/integration` | `node-executor.ts:896` | ✅ sim | ⚠️ parcial — 6 falhas (seção 3.3) |
| `avaliador` + 4 de cluster | `dual-lens-auditor.ts:528` | ✅ sim | ❌ o texto pede outro formato e outro método do que o código usa |
| `project-memory` | nenhum lugar | ❌ nunca | ❌ quem escreve a memória é código fixo |

## 2. Falhas que valem para todas as skills

1. **Campos do frontmatter decorativos.** `checagens`, `entrada`, `saida` são lidos (`skill-runtime.ts`) e **nenhum código os usa** (`git grep` de `.checagens`: só a definição). As 7 checagens do avaliador, as 2 do elicitador ("seção de dúvidas vazia para aprovar") e as 4 do analista não são conferidas por ninguém. Prova: a Spec do teste real foi aprovável com 4 "DÚVIDA" abertas.
2. **`ferramentas`/`permissoes` só valem no laço do executor** (`enforceSkillToolPermission`, `executor-tool-loop.ts:450,626`). Elicitador e analista declaram `read_file`, `list_files`, `grep`, mas o chat e o planejamento não dão ferramenta nenhuma.
3. **Papel inválido vira executor sem aviso.** `project-memory` declara `papel: memoria`; o carregador só aceita 4 papéis e transforma em `executor`; `escrever: ".nextcode/MEMORY.md"` vira `nunca` (saída do carregamento real).
4. **O texto da skill descreve um sistema que não existe.** Avaliador "abre arquivos com read_file", "faz a Lente 2", "roda em Claude/Gemini"; o real: sem ferramentas, Lente 2 feita pelo código, avaliador Nemotron (gratuito).
5. **Nenhuma skill tem teste de comportamento.** Os testes conferem que a skill carrega e que o prompt contém trechos; nenhum mede se o modelo, com a skill, faz o certo.

## 3. Skill por skill

### 3.1 `elicitador` (39 linhas)
- Carregada no momento certo (fase Spec). O formato da Spec vem de `spec-draft.ts` (`buildElicitadorSpecSystemPrompt`), não da skill.
- **Não exige o que o plano precisa:** não diz que cada REQ deve ter **um** arquivo dono dentro de `arquivos_afetados`, nem separar "implementa" de "usa". Resultado no teste real: REQ-032 cita `validacao.ts` só como referência e o plano o mandou para a etapa errada (diário 93).
- Regra "lacunas vão para a seção de dúvidas" fez o Opus **escrever dúvidas na Spec em vez de perguntar** (4 "DÚVIDA" no teste real); a checagem "dúvidas vazias para aprovar" não existe no código.
- Promete "Macrobrief inicial": o Macrobrief é gerado por código.
- Pesquisa T7 desligada (correto até o P8, mas a Spec do Asaas saiu sem fonte).

### 3.2 `analista` (39 linhas)
- **Nunca planejou.** `decomposeWithAnalistaSkill` chama o modelo com `AbortSignal.timeout(5000)` e `maxTokens: 4096` (`spec-decomposer.ts:370-381`). Sem JSON a tempo → volta calado à heurística. Banco inteiro: **0** `ANALISTA_PLAN_APPROVED` e **0** `ANALISTA_PLAN_FALLBACK`.
- Em `intake-engine.ts:224` é carregada só para gravar o nome no resultado ("teatro").
- Promete T8a/T8b, partição disjunta, contratos TypeScript explícitos: hoje feitos (ou não) pela heurística `assignReqsForGroup`, que distribui REQ por menção de nome de arquivo — inclusive só `route.ts`/`page.tsx` (teste real: 6 etapas com as mesmas 17 REQ).
- Promete "contratos explícitos definidos": o plano grava `"// Contratos propostos pelo Analista"` como texto fixo (`spec-decomposer.ts` ≈408).

### 3.3 `executor-*` (4 arquivos, mesmo molde)
- Carga certa por cluster; permissões e passos aplicados de verdade no laço. É a skill mais honesta.
- Falhas (diário 74, confirmadas na trilha): (1) relatório P12 aceita **um** `caminho:linha` por REQ e a skill não diz → teste real etapa 1: 3 `EXECUTOR_REPORT_INVALID`; B1 P4: 11; (2) "depois dos blocos de código" contradiz o laço de ferramentas; (3) protocolo de ferramentas repetido (skill + `buildExecutorToolProtocolPrompt`, 1.427 caracteres a mais); (4) `comandos: test` × `run_check` só `typecheck`; (5) `executor-frontend` cita web-interface-guidelines/react-best-practices mas **não tem `referencias_locais_fixas`** (carregamento real: 0 referências) — o executor nunca vê as regras que o avaliador cobra; (6) sem regra para REQ impossível no escopo (teste real etapa 3: o executor não tinha como avisar "este REQ não cabe aqui").

### 3.4 `avaliador` + `avaliador-core/backend/frontend/integration`
- Carga certa por cluster. Frontend com 4 referências reais (36.554 caracteres com elas).
- **Formato contraditório:** o código pede "SOMENTE um JSON de uma linha, sem markdown" (`dual-lens-auditor.ts:571-586`) e **cola logo depois** a skill, cuja seção 7 é um veredito completo em markdown com frontmatter e tabelas. Resposta fora do JSON → descartada → nova chamada → `heuristic_fallback` → `EVALUATOR_UNAVAILABLE`.
- **Método que não existe:** a skill manda usar `read_file`/`grep` (o avaliador não tem ferramentas — ela mesma diz isso na 1ª linha), fazer a Lente 2 (feita pelo código), emitir `divergencias_lente_2`, `contagem_severidade`, `APROVADO_COM_RESSALVA` com ressalvas — o código só lê `implemented`, `missingRequirements`, `reqVerdicts`, `ressalvas`.
- **O sinal mais útil se perde:** `induzido_pelo_plano: true` ("o defeito é do plano, chame o Analista") — exatamente o caso da etapa 3 do teste real — **não é lido por código nenhum**. A tentativa é gasta e a falha volta ao executor.
- Promete que o Tipo 1 fez "linting e scanner de segredos" e "resolução de imports": o Tipo 1 real (`dual-lens-auditor.ts:125`) confere JSON, Prisma, `use client`, export default, métodos HTTP, comentário CSS e balanceamento de chaves; compilação vem do `tsc`; segredos por `secret-guard`. Lint não existe.
- Custo: ~20.500 caracteres de skill em **toda** avaliação (`EVALUATOR_SKILL_REFS`), a maior parte sobre um formato que o código descarta. Com Opus como avaliador (B1b) isso vira dinheiro.

### 3.5 `project-memory`
- Nunca carregada. A memória é escrita por `consolidateMemoryFromSpec` (código fixo).
- Corte calado: teste real registrou 66 linhas; o arquivo gravado tem 41 (teto de linhas e bytes em `project-memory.ts:63-66`), sem aviso — a seção "Armadilhas" pode sumir.

## 4. Acionadas no momento certo? Ordem e travas

| Momento do fluxo | Deveria agir | Age hoje |
|---|---|---|
| Entrada/Spec | elicitador (+ pesquisador) | elicitador ✅; pesquisador ❌ (existe em código, desligado) |
| Conferência Spec × plano | analista + Jev | código em sombra (`CONFERENCIA_ENTRADA ok:false` ignorado no teste real) |
| Planejamento | analista | heurística ❌ |
| Execução | executor-* | ✅ |
| Avaliação por etapa | avaliador-* | ✅ carregado, ⚠️ formato contraditório |
| Falha de plano na etapa | analista replaneja | ❌ volta ao executor (3 tentativas impossíveis) |
| Revisão final | avaliador-final (J3) | ❌ não existe |
| Memória | project-memory | código fixo |

## 5. Como testar as skills de verdade

A `skill-creator` serve como **método** (casos de teste, assertivas objetivas, comparação com e sem a skill, iterar), mas **não como executor**: ela roda o Claude, e no NextCode cada skill roda em outro modelo (DeepSeek, Nemotron, Opus) dentro do harness. Teste válido = o caminho real do NextCode com o modelo real:

| Skill | Caso de teste | Assertiva objetiva |
|---|---|---|
| elicitador | 3 pedidos sintéticos (P1, Fase 8, gateway sem segredo) | todo REQ tem 1 arquivo dono em `arquivos_afetados`; 0 dúvida escrita na Spec sem pergunta |
| analista | Spec do teste real `934939fc` (já paga) | cada REQ em exatamente 1 etapa; 0 REQ com arquivo-alvo fora do escopo; DAG sem ciclo |
| executor | Microbrief P1 + Microbrief com REQ impossível | relatório válido na 1ª; REQ impossível marcado `nao_atendido` com motivo |
| avaliador | 4 controles do J3 (P1 certo, bug, TODO, chave plantada) | aprova o certo; reprova cada defeito; JSON válido 100%; `induzido_pelo_plano` quando o defeito é do plano |

## 6. Recomendação (para decisão do fundador)

1. **Regra única:** a skill é o contrato do papel — o que ela promete, o código entrega ou aplica; o que o código não aplica sai da skill. Campo de frontmatter sem uso no código é removido ou passa a ser conferido.
2. **Reescrever na ordem do fluxo, cada uma com seus casos de teste antes de ligar:** elicitador (contrato REQ→arquivo dono) → analista (planejar de verdade, tempo e espaço adequados, falha registrada e devolvida a ele) → executor (relatório, REQ impossível, protocolo único) → avaliador (um formato só, enxuto, `induzido_pelo_plano` lido e roteado ao analista) → pesquisador (skill nova sobre o `UniversalDocsFetcher` existente) → avaliador-final (J3). `project-memory`: decidir entre virar skill de verdade ou sair da pasta.
3. Isso é o bloco A da proposta macro (diário 94) com as skills no centro: A1 = elicitador, A2 = analista, A3 = falha roteada ao dono, P8 = pesquisador.
