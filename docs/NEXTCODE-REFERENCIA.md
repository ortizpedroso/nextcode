# NextCode — Documento Único de Referência (o que foi feito e o que falta fazer)

> **Fonte única do projeto NextCode (`C:\projetos\nextcode`).**
> Consolidado em 23/10/2026 a partir do commit `cabc2d7`. O primeiro rascunho foi feito pelo Antigravity, lendo os 270 arquivos de `docs/`. A auditoria do Claude corrigiu os nomes de arquivo, função e evento conferindo cada um com `git grep` / `git ls-files`.
> - Toda melhoria aprovada entra **aqui antes** de ser executada (regra 1 do `CLAUDE.md`).
> - Os documentos antigos saíram da pasta e continuam recuperáveis com `git show cabc2d7:<caminho>` (lista na §10).
> - Registro de cada passo: `memory/diario.md`. Decisões do fundador: `memory/decisoes.md`. Números medidos: `memory/medicoes.md`.

## Índice
1. Visão geral, regras e estado atual
2. O que foi feito (linha do tempo)
3. **O que falta fazer (fila única, em ordem)**
4. Arquitetura (fases, travas, papéis)
5. Uso do Jev
6. Templates e memória do projeto
7. Benchmarks e o Gateway real
8. Terceiros e licenças
9. Protocolo: o Antigravity implementa, o Claude audita (+ prompt TESTE-E5)
10. Documentos consolidados e como recuperar

---

## 1. Visão geral, regras e estado atual

### 1.1 O que é
Harness que transforma um pedido (de leigo ou de engenheiro) em software entregue. Ele funciona assim:
1. Uma Spec com `REQ-nnn` é aprovada pelo humano.
2. A máquina de fases (`src/core/orchestrator/phase-machine.ts`) e a fila persistente em SQLite (`job-queue.ts`, `job-worker.ts`) conduzem o trabalho.
3. O escopo de arquivos é fechado por etapa, a quarentena e o portão empírico (`tsc`/ESLint) verificam o código, e o avaliador é independente.
4. No fim, a revisão final usa uma bancada de testes em contêiner sem rede.

Cada papel é uma skill em `skills/<nome>/SKILL.md`, e o harness aplica as travas.

### 1.2 Regras do fundador (obrigatórias — `CLAUDE.md`)
1. Fonte única é este documento; melhoria aprovada entra aqui antes de executar.
2. Tudo documentado: entrada no diário a cada passo. Fase de implementação fecha com relatório de auditoria.
3. Não alucinar: só citar arquivo/função conferido com `git grep`; "funciona" só com saída real colada.
4. Documento antigo só sai resumido aqui, com hash para recuperar (§10).
5. Um passo por vez; um commit por passo, com `tsc` e `vitest` daquele commit.
6. Discordar com veredito técnico quando a ideia estiver errada.
7. Nenhum segredo em texto puro e nenhum segredo sai da máquina (máscara `maskSecretsForJev` em `src/core/governance/secret-guard.ts`; cifra `enc:v2` em `src/core/security/crypto.ts`).
8. Papéis críticos só em modelo pago; o avaliador nunca é da família do executor; gratuito só no fim e nunca aprova sozinho.

### 1.3 Estado em 23/10/2026 (HEAD `cabc2d7`)
- **Suíte:** 162 arquivos / 1045 testes no `vitest`; `tsc` 0; `next build` ok. Versões: Next `^15.0.3`, Prisma `^5.22.0`, Vitest `^2.1.9`.
- **Dependências:** `npm audit --omit=dev` → 0 vulnerabilidades (restam 13 só em desenvolvimento).
- **Bench P1–P4 (J4, 22/10):** 8/8 ENTREGUE, aceite 47/47. Com Jev o custo foi US$ 0,75; sem Jev, US$ 1,00. Arquivos: `bench/2026-10-22-1538`, `-1628`, `-1835`.
- **Gateway real (`4d019f00`):**
  - 65 REQ; 41 etapas mais a base; depois, rodadas de reparo.
  - Defeitos provados por teste, por revisão: 8 → 1 → 7 → 6 → 5.
  - A rodada 8 (23/10) terminou `BLOQUEADA` sem relação com o código: o DeepSeek pelo FreeLLMAPI ficou sem cota ("All models exhausted… reset ~24h").
- **Papéis e modelos:**
  - Elicitador: Claude Opus 5.5 direto (`src/core/llm/elicitador-claude.ts`).
  - Analista: `deepseek-v4-pro`, via FreeLLMAPI `custom/`.
  - Executor: `deepseek-v4-pro`, ou `deepseek-flash` no nível `rapido` com confiança ≥ 0,85.
  - Avaliador da etapa, testador e revisão final: Claude Sonnet 5.5, com Opus 5.5 de reserva (`src/core/llm/evaluator-models.ts`).

---

## 2. O que foi feito (linha do tempo)

### 2.1 Fundação (27/09–05/10)
- **Segurança:** cofre `enc:v2` (`src/core/security/crypto.ts`), anti-SSRF (`src/core/security/safe-fetch.ts`), autenticação local (`local-auth.ts`), chave mestra gerada sozinha.
- **Travas T1–T6:**
  - quarentena (`src/core/governance/quarantine-manager.ts`);
  - portão empírico (`empirical-gate.ts`);
  - Tipo 1 mecânico (`dual-lens-auditor.ts`);
  - 3 tentativas (Trava T6 / D-RANHO, `incident-reporter.ts`);
  - trilha `TelemetryLog`, só acrescenta.
- **Etapa 0:** máquina de fases, fila com reserva atômica e lease (`job-queue.ts`), worker com retomada, gateways FreeLLMAPI e OmniRoute (`src/core/llm/gateways.ts`). Esta fase está nos commits `1476128`, `9f9584e`, `52bc206` e `e0a9c90`.

### 2.2 E0 — base (06/10–15/10)
| Pacote | O que ficou | Commits |
|---|---|---|
| Runtime de skills, laço do executor, 2 lentes | `skill-runtime.ts`, `executor-tool-loop.ts`, Lente Cega por REQ + Lente 2 | `7f1c5c8`, `d3c90f4`, `1d4f331` |
| R1 — papéis críticos só pagos | `paid-routing.ts`, trava `X-Routed-Via` (`prefixos_rota_paga: "custom/"`), Flash só com confiança ≥ 0,85 | `69d8a94`…`88ab558` |
| P0 | `McpServer.env` cifrado (`src/core/security/mcp-env.ts`); causa do teste intermitente (ordem no mesmo milissegundo) | `77b3adb` |
| P1 — núcleo do Jev | custo do Jev em `LLM_COST`, nova tentativa em 429/529, alerta em 422, `JEV_STATE_TOO_LARGE` sem cortar JSON, 14 limiares lidos do YAML (`src/core/decision/jev.ts`) | `4dd6733`…`c8b63a6` |
| P2/P2b — bench real | `scripts/bench.ts`, contêiner `docker/aceite` sem rede, régua `bench/aceite/` (P1 10, P2 13, P3 12, P4 12 testes) | `a559364`, `53b62ae`, `efd8c1c` |
| P3 | cadeia do avaliador pelo FreeLLMAPI (depois trocada por Claude na mudança 23) | `cbdb0a0`, `3e93e8b` |
| S0/S1 — skills | custo por `nodeId`; Jev liga referências do avaliador de tela; avaliadores sem ferramentas falsas | `4447198`, `2e91335`, `60e81f0` |
| C1 | desfez a cascata não aprovada de `786d393`; chave do cache do Jev (`jev-cache.ts`, `stableStringify`) | `f19152c`, `af431e8` |
| D1/D1b | primeira consolidação de documentos | `bc63e09`, `98beb93`, `0664efc` |
| J1/J2 | J1 mediu que a auditoria final do Jev reprovava código correto (0/5); J2: aviso num lugar só (`human-notice.ts`), `FALHA_REPETIDA`, pausa longa, vigia de silêncio | `ce3fb55`, `b7a21e2`…`3cbcde1` |
| I1 | inventário ligado/desligado/morto | `7de28df` |
| P5/P5.5/P5.5b | máscara de segredo antes do Jev (duas passadas), peneira M0 com a conversa inteira, conferência Macrobrief × Spec (sombra) | `76da16f`…`cde4b47` |

### 2.3 E1 inicial (15/10–18/10)
- **P5c/P5c.3/P5c.4:** elicitador Opus direto, com streaming, teto de 48 mil tokens e indicador "Gerando Spec…". Commits `95f6c23`, `ba893ce`, `4283a68`, `ed803ff`. Smoke da Fase 8 na sessão `c0377632`: 56 REQ, 10/10 totais certos.
- **B1/B1c:** o avaliador Claude direto lia só o bloco `thinking`. Corrigido (`3890924`); o bench passou a P1–P4 ENTREGUE com o Opus avaliando.
- **PJ1:** arquivados com Desarquivar, abrir a mesma pasta reabre o projeto, Apagar pergunta pela pasta, sessão sem projeto não executa. Commits `c4155a5`…`5692e21`. Smoke na tela feito em 20/10.
- **A3:** `plan_error` detectado só mecanicamente (`detectPlanErrorMechanically` em `src/core/decision/jev-execution-checks.ts`). O roteamento ao dono fica em `roteamento_falha: sombra`. Commits `5f8fbf5`…`a2508ed`.

### 2.4 Execução autônoma 1 — mudança 23 (17–18/10)
- **A2 — o analista planeja de verdade:**
  - `decomposeWithAnalistaSkill` em `src/core/skills/spec-decomposer.ts` faz o plano;
  - a T8b confere o escopo (`plan-scope-check.ts`), e um plano impossível dispara `PLANO_REPROVADO`;
  - no replay da Spec real foram 35 etapas, 0 REQ repetido, US$ 0,10.
  - Commits `3ea5ef9`, `801864b`, `f404648`.
- **AV1 — avaliador:**
  - Claude Sonnet → Opus, recusando a família do executor;
  - lê o arquivo inteiro (até 60 mil caracteres por arquivo e 200 mil por etapa);
  - aponta problemas por severidade e tem a evidência conferida;
  - o porteiro roda `tsc`+ESLint antes dele;
  - controles: 7/7.
  - Commits `a06fa8d`…`42b878e`.
- **Outros itens:**
  - M20 desligou a memória do projeto (`324a586`);
  - SM1 confere a Spec mecanicamente e carimba a data (`c10d3b7`);
  - M24: avaliador fora do ar dá 3 tentativas grátis, depois pausa de 5 min com sonda no Claude.

### 2.5 Execução autônoma 2 — mudança 26 (19–20/10)
Passos P1 a P13, um commit cada, de `fbda610` a `835e98f`:
- **Executor:**
  - até 8 ações por turno;
  - contexto fixo no 1º prompt;
  - a nova tentativa parte do código anterior (`codigoTentativa`);
  - o relatório aceita lista de `arquivo:linha` (`parseFileLineRefList`);
  - oscilação repete o turno e a pausa guarda o progresso;
  - regra do harness vira "Dono: harness".
- **Avaliação:**
  - só `critico` reprova;
  - cache de prompt no avaliador (`buildAnthropicCachedBody`).
- **Custo e controle:**
  - teto pelo plano: max(US$ 0,50; etapas × 0,35 × 1,5);
  - placar (`session-scoreboard.ts`);
  - M2 só na trilha; Graphify só com ≥ 5 arquivos-fonte;
  - trava de pasta-mãe (`src/core/project/folder-safety.ts`).
- **Resultado:** bench P1–P4 ENTREGUE com no máximo 4 chamadas do executor por etapa. Duas correções saíram do bench: D41 (Lente 2 com lista) e D42 (prazo do gateway no turno).

### 2.6 Execuções autônomas 3 e 4 — mudanças 27–42 (20–22/10)
- **Mudanças 28–34:**
  - 28 (SUP1): a sonda só considera gateways pagos;
  - 29: cache no elicitador;
  - 30: prazo do analista de 600 s;
  - 31: rota `custom` no FreeLLMAPI com 300 s;
  - 32: `DATABASE_URL` no compose;
  - 33: `resolveTscBin` (caminho falso do `tsc` dentro do `next dev`);
  - 34: `recheckFinalBuild` (a entrega julga o projeto final).
- **Mudanças 35–36:** `tsc` que falha sem nenhuma linha `error TS` é tratado como `FALHA_AMBIENTE`. O aviso diz a ação certa e tem o botão Retomar (`resume_session`).
- **G1–G3:** leitor de ação tolerante, motivo do descarte do avaliador na trilha, culpado certo do bloqueio (`blocked-culprit.ts`).
- **J2b + J2.7:** reparo automático da entrega (`delivery-repair.ts`), até 3 rodadas; as listas `PHASES`/`MESSAGE_INTENTIONS` agora vêm do código (`f37c08f`).
- **J3:** revisão final cega e fechada (`src/core/governance/final-reviewer.ts`, skill `avaliador-final`), controles 8/8 (`471ef92`, `57c3d44`).
- **TS1:** fim dos timeouts aumentados nos testes e2e (`dbacd91`).
- **Mudanças 40–42:**
  - 40: reabrir a entrega (`REABRIR_ENTREGA`, `scripts/retomar-sessao.ts --reabrir`);
  - 41: client do Prisma regerado e erro do `next build` atribuído à etapa dona;
  - 42: pausa que pisca vira `SEM_LLM_PERSISTENTE`.
  - Commits `8a8b52a`, `b3ab02a`, `b6b5077`.
- **Teste independente:** relatório `TESTE-E1-4-antigravity.md`, aceito com ressalvas.

### 2.7 Mudança 43 — revisor com bancada de testes (22/10)
- **Bancada:** `src/core/execution/test-bench.ts`, imagem `nextcode-test-bench:2` (`docker/test-bench`). A instalação usa rede num volume de cache; os testes rodam sem rede e com o projeto só leitura.
- **Revisor:** reproduz cada suspeita com um teste (`src/core/governance/defect-reproducer.ts`).
- **Reparo:** recebe o teste como contrato (`run_check test`).
- **Aviso:** sai pela saída do revisor, com "Autorizar mais uma rodada" (`REPAIR_ROUND_AUTHORIZED`).

### 2.8 Execução autônoma 5 — mudanças 44 e 45 (22–23/10)
Commits `1f5234f`…`bacbd2e`; relatórios `AUDITORIA-E5`, `IMPLEMENTADO-E5`, `DECISOES-AUTONOMAS-E5` (E5-D1…D35).
- **Reparo e prova:**
  - **44.1:** o reparo alcança todos os arquivos citados (`codeFilesCitedIn`, `escopoExtra`).
  - **44.2:** a entrega é decidida pela prova (`splitDefectsByEvidence` em `delivery-diagnosis.ts`). As provas anteriores são re-rodadas (`rerunPriorProofs`, `src/core/orchestrator/prior-proofs.ts`). Regressão no portão (`attachRegressionProofs`). Revisão final que não rodou → `FALHA_AMBIENTE`.
- **Correções e medições:**
  - **44.4 F10:** `sessionId` em `llm.gateway_failure`.
  - **44.5:** `effort` medido; o padrão foi mantido (efeito teto).
  - **44.6 J4:** com × sem Jev (§1.3).
- **Jev e projetos:**
  - **44.7 JV1:** M3 em lotes (`chunkPlanningInputs`); `verificacao_evidencia` e `auditoria_entrega` desligadas por medição (15/15 divergências falsas; o estado nunca coube no limite).
  - **44.8 PJ2b:** fechar/reabrir projeto (`project-lifecycle.ts`, `OPEN_PROJECT_SESSION`).
  - **44.9 S3:** skills alinhadas ao código; papel desconhecido falha fechado; M1/M4 removidos.
- **44.10 E2 — entrada completa:**
  - P8/T7: pesquisa oficial (`src/core/intake/official-docs-research.ts`, limiar de injeção 0,80);
  - J11: origem por REQ (`req-origin-check.ts`);
  - J8: lacunas obrigatórias (`mandatory-gaps.ts`);
  - J7: perfil;
  - TR1 (7): correção da Spec por trecho (`spec-patch.ts`).
- **Testes, segurança e operação:**
  - **44.11 E5:** skill `testador` escreve testes de aceite sem ver o código (`src/core/governance/acceptance-tests.ts`). Há testes visíveis e escondidos; a trava `presumedTechnology` impede tecnologia não pedida.
  - **44.12 J20:** marca injeção em arquivo lido (`src/core/governance/injection-scan.ts`).
  - **44.13 E6:** CI (`.github/workflows/ci.yml`, ainda não publicado), imagens fixadas por digest, OmniRoute em `127.0.0.1`, produção com 0 vulnerabilidades.
- **Mudança 45:** o escritor de testes da revisão final consulta a documentação oficial antes de transformar uma dúvida de integração em pergunta (`buildWriterPrompt` com `docsOficiais`).

---

## 3. O que falta fazer (fila única, em ordem)

Ordem de execução: 3.1 → 3.2 → 3.3 → 3.4 → 3.5. Cada item vira um prompt para o Antigravity (§9). O Claude audita e só depois marca ✅ aqui. Item novo só entra com data, motivo e evidência.

### 3.1 Agora
| # | Item | Porta (pronto quando) |
|---|---|---|
| 1 | **TESTE-E5:** teste independente das mudanças 43–45 (§9.4) | relatório entregue (ACEITO COM RESSALVA) — aguarda auditoria do Claude |
| 2 | **Gate 1 do Gateway `4d019f00` (E3/P10):** retomar quando o DeepSeek tiver cota ou crédito (`npx tsx scripts/retomar-sessao.ts 4d019f00 --rodada-extra --motivo "..."`) | `ENTREGUE` com 0 defeito provado; parar se os provados não caírem em 2 rodadas; aceite escrito do Gate 1 |
| 2a | **DG1 — diagnóstico dos defeitos do Gateway** (só leitura) | relatório `docs/relatorios/DIAG-GATEWAY-DEFEITOS.md` entregue; aguarda auditoria do Claude |
| 3 | **Consertar o que a consolidação deixou apontando para arquivos apagados:** `CLAUDE.md` (linhas 7 e 12) e comentários em `src/core/decision/jev-decisions.ts:3,450`, `src/core/decision/jev.ts:3`, `src/core/templates/artifact-templates.ts:4`, `src/core/governance/final-reviewer.ts:90`, `src/core/orchestrator/delivery-repair.ts:21`, `src/core/llm/gateways.ts:2`, `src/core/router/smart-router.ts:1121`, `src/core/orchestrator/phase-machine.ts:4-5`, `src/core/execution/project-base.ts:2`, `tests/llm/gateways.test.ts:2`, `scripts/teste-pesado.ts:11` | `git grep` sem citação de documento apagado (fora do git) |
| 4 | **Reserva da política desatualizada:** `src/core/config/orchestration-policy.ts:367` lê `docs/rascunhos/politicas-orquestracao.yaml` quando `config/` falta, mas essa cópia é antiga e diferente (sem `roteamento_papeis_criticos`). Tirar a reserva (falhar fechado com o padrão do código) e apagar o arquivo | teste: sem `config/`, a política é a do código; arquivo removido |
| 5 | **Saídas do bench fora de `docs/`:** `scripts/bench.ts` e `scripts/teste-pesado.ts` gravam em `docs/relatorios/` e recriam a pasta | relatórios gerados em pasta própria (ex.: `bench/resultados/`), citada aqui |

### 3.2 Defeitos e dívidas conferidos no código (23/10)
| # | Item | Onde |
|---|---|---|
| 6 | Terminal sem bloqueio de comandos Windows (`rd /s`, `del /s`, `Remove-Item -Recurse`, `set`/`Get-ChildItem env:`) — achado C9 de 12/10 | `src/core/skills/sandboxed-terminal.ts:28` |
| 7 | "Apagar pasta" ainda apaga qualquer `project.path` (fora a trava de pasta-mãe); proposta: só pasta criada pelo NextCode (marcador `.nextcode`) — achado C10 | `src/app/api/projects/[id]/route.ts:80-115` |
| 8 | Chat mostra `reasoning_content` (raciocínio interno) como resposta quando `content` vem vazio | `src/app/api/chat/route.ts:812-813` |
| 9 | Código morto ou desligado: `CONTINGENCY_EXECUTOR_MODELS` (`src/core/llm/paid-routing.ts:23`), benchmark simulado `/api/dag/benchmark` (+ `benchmark-modal.tsx`), `partitionRepairsByCluster` e `renderMacrobriefMarkdown` sem uso em produção | remover com teste verde |
| 10 | Caminho inexistente `docs/spec-architecture.md` | `src/core/skills/spec-decomposer.ts:618` |
| 11 | Fases `MACROBRIEF`/`CONFERENCIA` existem, mas `etapa1Ativa` está fixo `false` (`session-phase.ts:129`): decidir entre ligar e remover | decisão do fundador |
| 11b | `NEXTCODE_DISABLE_JEV=1` não é checado no `readJevKey` (com chave no banco, não desativa por ambiente) — achado TESTE-E5 4g | `src/core/decision/jev.ts:68` |

### 3.3 Portas em modo sombra (dependem de dados reais)
| # | Item | O que falta |
|---|---|---|
| 12 | `conferencia_entrada: sombra` (P5.4) | ≥ 5 aprovações reais com `CONFERENCIA_ENTRADA` e 0 recusa indevida; antes, montar fixture de Spec canônica nos testes (8 arquivos usam Spec antiga) |
| 13 | `roteamento_falha: sombra` (A3) | decidir com mais sessões reais; hoje só o `plan_error` mecânico age |

### 3.4 Ações do fundador
| # | Ação |
|---|---|
| 14 | Desligar `router9` e `electronhub` no painel do FreeLLMAPI: são revenda e já receberam pedido (regra 7) |
| 15 | Apagar a pasta vazia `C:\projetos\nextcode-43` pelo Explorer |
| 16 | Clicar na tela: Retomar, Reabrir entrega, Autorizar mais uma rodada, Fechar/Reabrir projeto, indicador "Gerando Spec…" (P5c.4); Fase 8 V2 (Spec cara não trava o 1º lote) |
| 17 | Autorizar `git push` do CI quando quiser |

### 3.5 Depois do Gate 1
| # | Item | Gatilho |
|---|---|---|
| 18 | Dependências de desenvolvimento (13): `vitest` 5, `tailwind` 4 — mudança própria com bench | qualquer momento |
| 19 | E6: Trivy no CI, HTTPS local | antes de expor na rede |
| 20 | Memória do projeto (M20) acumulando contratos/decisões/lições, não copiando a Spec | 2ª sessão real no mesmo projeto |
| 21 | E4 J18/J19 (contexto por linha, skill sugerida) | só se as chamadas do executor passarem de 10 por etapa |
| 22 | P9 aprendizado (J26/R10) | ≥ 3 entregas reais |
| 23 | P10 Gates 2…n do Gateway | depois do Gate 1 |
| 24 | Roteiro da arquitetura: checklist por REQ na tela, custo antes de aprovar, entrega por Git, proveniência, PostgreSQL/multiusuário, cliente MCP e catálogo (D7, D8, D10), Laya (D6), Exa (D2) | etapas 2–5 |

---

## 4. Arquitetura (síntese de `ARQUITETURA-ORQUESTRACAO.md`)

### 4.1 Princípios
O harness decide e o LLM propõe. Skill ensina, nunca autoriza. Os princípios práticos:
- contexto por artefato;
- menor privilégio por papel;
- nada sem Spec aprovada (T1);
- para por 2 motivos: Spec completa no disco, ou 3 tentativas esgotadas;
- falta de LLM pausa, não gasta tentativa;
- tudo vai para a trilha;
- rastreio por `REQ-nnn`;
- o Jev decide, o LLM escreve;
- uma só voz com o usuário (o elicitador);
- nenhum segredo em texto puro.

### 4.2 Fases (`PHASES` em `phase-machine.ts`)
`ENTRADA, CONVERSA, INTERVENCAO, ELICITACAO, ELICITACAO_CORRECAO, SPEC_REVISAO, MACROBRIEF, CONFERENCIA, PLANEJAMENTO, EXECUCAO, PAUSADA, BLOQUEADA, VERIFICACAO, ENTREGUE`.

Caminhos principais:
- Spec aprovada → `PLANEJAMENTO` (o `etapa1Ativa: false` pula `MACROBRIEF`/`CONFERENCIA`) → `EXECUCAO` → `VERIFICACAO` → `ENTREGUE`.
- Entrega reprovada → reparo J2b (até 3 rodadas) → `BLOQUEADA` com aviso.
- `ENTREGUE` → `REABRIR_ENTREGA`.

### 4.3 Travas
| Trava | Garante |
|---|---|
| T1 | aprovação humana da Spec |
| T2 | escopo de arquivos por etapa |
| T3 | trilha `TelemetryLog`, só acrescenta |
| T4 | quarentena + `tsc`/ESLint + rollback |
| T5 | duas lentes (cega por REQ + conferência mecânica com o relatório); avaliador de outra família |
| T6 | 3 tentativas, depois bloqueio + relatório ao humano |
| T7 | pesquisa só em fonte oficial, com guarda de injeção |
| T8a/T8b | Spec × plano: todo REQ coberto, nenhum inventado, escopo, sem ciclo |
| T9 | só o papel da fase age |
| T10 | entrega: arquivos, REQ, build do projeto final, revisão final com prova na bancada |

### 4.4 Papéis
- Elicitador (Opus 5.5) → Spec.
- Analista (DeepSeek) → plano; o código monta o Microbrief.
- Testador (Claude) → testes de aceite antes do código.
- Executores `executor-core|backend|frontend|integration` (DeepSeek) → código, no máximo 8 ações por turno.
- Avaliadores `avaliador-*` (Claude Sonnet → Opus) → veredito por REQ.
- `avaliador-final` (Claude) → revisão do projeto inteiro, com reprodução na bancada.

---

## 5. Uso do Jev (`jev-1.13.0`)

- **Adaptador próprio:** `src/core/decision/jev.ts`, chamando `POST https://api.typesafe.ai/v1/systemone`. Não usa SDK.
- **Proteções do adaptador:** máscara de segredo antes de enviar, nova tentativa em 429/529, alerta em 422, recusa de estado grande (`JEV_STATE_TOO_LARGE`) e custo registrado em `LLM_COST`.
- **Primitivas:** `choice`, `score` e `noul`.
- **Regras da documentação oficial:** instruções em inglês, leitura literal, sem conta nem contagem, estado pequeno, viés para a 1ª opção. Por isso as perguntas são feitas com as opções em ordem invertida.
- **Sem Jev:** o bench mede a variante `sem-jev`, que tira a chave na cópia do banco.

| Uso (`purpose`) | Onde | Estado |
|---|---|---|
| `m0_peneira_afunilamento_universal` | `src/core/intake/universal-funnel.ts` | ativo (lê a conversa inteira; incerto vira `[A CONFIRMAR]`) |
| `m2_clareza_spec` | `jev-decisions.ts` | só trilha (`SPEC_CLARITY_SHADOW`) |
| `m3_planejamento_microbriefs_lote` | `jev-decisions.ts` | ativo, em lotes |
| `m5_seguranca_pesquisa_t7` | `jev-decisions.ts` | ativo na pesquisa oficial |
| `j8_lacunas_obrigatorias` | `src/core/intake/mandatory-gaps.ts` | ativo |
| `classificacao_mensagem`, `p4_chat_fanout` | `message-intent.ts`, `jev-decisions.ts` | ativo |
| `jev_graphify_eligibility` | `jev-decisions.ts` | ativo (com ≥ 5 arquivos-fonte) |
| `failure_diagnosis` | `jev-execution-checks.ts` | ativo; roteamento em sombra (A3) |
| `evidence_check` | `jev-execution-checks.ts` | desligado (`verificacao_evidencia`, JV1) |
| `final_project_delivery_audit` | `jev-execution-checks.ts` | desligado (`auditoria_entrega`, JV1); papel feito pelo J3 |
| `macrobrief_coverage_conference` | `jev-execution-checks.ts` | sombra (`conferencia_entrada`) |
| `skill_install_guard` | `jev-execution-checks.ts` | ativo |
| `secret_guard`, `secret_guard_chat` | `secret-guard.ts` | ativo (`limiar_segredo_noul: 0.70`) |

O que não usar: o Jev Router do OpenRouter, porque o pedido inteiro sairia da máquina (fere a regra 7). Também não usar o Jev para texto, conta ou juízo final de código.

---

## 6. Templates e memória do projeto
- **Templates (`src/core/templates/artifact-templates.ts`, origem `TEMPLATES.md`):** Spec, Macrobrief, Microbrief, Relatório do Executor (mesmo molde do Microbrief) e Veredito. Todos são YAML + Markdown. Os campos `medido_pelo_harness` são preenchidos pelo código, nunca pelo modelo.
- **Memória `.nextcode/MEMORY.md` (formato de `MEMORIA-DO-PROJETO-FORMATO.md`):** escrita pelo código (`src/core/memory/project-memory.ts`), hoje desligada (M20). Tem 3 seções:
  1. Diretrizes e Regras do Fundador;
  2. Decisões de Arquitetura e Contratos;
  3. Armadilhas e Lições.
  
  O teto é de 50 linhas e 6.000 bytes, e o corte é sempre avisado.

---

## 7. Benchmarks e o Gateway real

### 7.1 Bench P1–P4 (relatórios em `git show cabc2d7:docs/relatorios/bench/<arquivo>`)
| Data / arquivo | O que mediu | Resultado |
|---|---|---|
| `2026-10-09-0713` | 1ª rodada P1/P2 × 3 variantes | 100% aceite (efeito teto) |
| `2026-10-09-1358` | P3/P4 × 3 variantes × 3 | P3 100%; P4 BLOQUEADA 9/12 (erro na base, corrigido) |
| `2026-10-10-1020` | S1, P1–P4 × 2 × 2 | 16/16 ENTREGUE |
| `2026-10-12-1533` … `-2116` | código do `786d393` | P3 1/12, 0/12 — cascata desfeita no C1 |
| `2026-10-15-1927` | B0 | 4/4 ENTREGUE |
| `2026-10-16-1658` / `-1822` | B1 / B1c (Opus avaliando) | B1 inválido (lia só o `thinking`); B1c 4/4 ENTREGUE, US$ 0,78 |
| `2026-10-20-1244` / `-1314` | mudança 26 | 4/4 ENTREGUE, máx. 4 chamadas/etapa |
| `2026-10-22-1538`, `-1628`, `-1835` | J4 | 8/8 ENTREGUE, 47/47; US$ 0,75 × 1,00 |
| `2026-10-21-j3-controles-avaliador-final.json`, `2026-10-22-j3-*.json`, `2026-10-22-44-5-effort-*.json`, `2026-10-22-43-2-reproducao-gateway.json` | controles do J3, esforço, reprodução no Gateway | J3 8/8; 8 de 10 suspeitas provadas |

### 7.2 Gateway `4d019f00` (whitelabel sobre Asaas, 65 REQ)
- **21/10:** 41/41 etapas, 31/40 aprovadas na 1ª, US$ 12,33, 0 pausas sem LLM. Bloqueou por portão cego (mudanças 33/34) e falta de memória.
- **22/10:** com memória livre, os erros caíram de 71 para 9, o reparo J2b fez 3/3, e a sessão foi `ENTREGUE`. A revisão J3 rodada depois achou 15 REQ parciais, o que levou à reabertura (mudança 40) e às rodadas 2–3.
- **Mudanças 43–45:** defeitos provados 8 → 1 → 7 → 6 → 5; nenhuma prova anterior voltou a falhar; sessão em ≈ US$ 37.
- **23/10:** a rodada 8 bloqueou por cota do DeepSeek no FreeLLMAPI (item 2 da §3.1).
- **Spec antiga do Gateway (sem `REQ`):** `git show cabc2d7:docs/specs/gatway-system-spec.md`.

---

## 8. Terceiros e licenças (de `TERCEIROS.md`; MIT e Apache pedem atribuição)
| Fonte | Commit/versão | Licença | Aproveitado |
|---|---|---|---|
| `obra/superpowers` (subagent-driven-development, writing-plans, verification-before-completion, TDD, code-reviewer) | `8ca22db` | MIT | seleção de modelo em 3 níveis, "Do Not Trust the Report", severidades, revisão da nova tentativa, prova antes de afirmar, Task Brief |
| `vercel-labs/agent-skills` (web-design-guidelines, react-best-practices) | `063bee9` | MIT | regras CRITICAL/HIGH no `avaliador-frontend` |
| `vercel-labs/web-interface-guidelines` (`command.md`) | `434b7f9` | MIT | 104 regras, cópia local fixa |
| `microsoft/playwright-cli` | `b85c7a7` | Apache-2.0 | comandos só de inspeção (a tela é conferida pelo `ui-check`) |
| `ui-ux-pro-max` | 2.11.0 | MIT | checklist pré-entrega (32 itens) |
| `Leonxlnx/taste-skill` | `e3c9203` | MIT | 39 itens, só para página pública |
| `docs.typesafe.ai` | jev-1.13.0 | documentação pública | primitivas, limites, cookbooks |

Proibidos: `find-skills`/`npx skills add` (cadeia de suprimentos), `taste-skill` inteiro, `DESIGN.md`/getdesign (imitação de marca) e repositórios `perplexity-super-skill` (sinais de isca).

---

## 9. Protocolo: o Antigravity implementa, o Claude audita

### 9.1 Ciclo
1. O Claude escreve o prompt de um item da §3, só depois de o item estar aqui. O prompt vai inteiro no chat, entre marcas de início e fim.
2. O Antigravity implementa e grava o relatório do pacote (`relatorios/<pacote>.md`, recuperável pelo git) no último commit.
3. O Claude audita (§9.3) e registra o veredito no diário: aceito, aceito com ressalvas ou rejeitado.
4. Só então o item vira ✅ aqui.

### 9.2 Travas de todo prompt
| Trava | Regra |
|---|---|
| **T-A** | `git status` limpo; HEAD igual ao hash do prompt |
| **T-B** | só os arquivos de PODE ALTERAR; nunca aumentar timeout nem silenciar erro |
| **T-C** | literalidade; ambiguidade → PARE |
| **T-D** | todo nome conferido com `git grep -n` |
| **T-E** | um passo = um commit com `tsc` 0 e `vitest` verde; proibido `--amend`, `rebase`, `reset`, `push --force`, `--no-verify`, `git add -A` |
| **T-F** | nunca escrever em `prisma/dev.db` |
| **T-G** | nenhum segredo |
| **T-H** | nenhum pacote novo sem o prompt dizer |
| **T-I** | preservar o fim de linha |
| **T-J** | paradas obrigatórias: 422 do Jev, teste antigo quebrando, custo acima do teto, contradição |
| **T-K** | linha `Co-Authored-By` no commit |
| **T-L** | relatório fiel: todo número copiado da saída real; "Desvios" verdadeiro |
| **T-M** | código gerado nunca roda no host, só no contêiner sem rede |
| **T-N** | `git reflog` conferido; comando git fora da lista vai em Desvios |
| **T-O** | nenhum documento paralelo (plano/log); só o relatório e as seções deste documento que o prompt mandar |

Regra zero de todo prompt:
- ler tudo antes de começar e resumir o que vai mudar;
- fazer só o que está escrito;
- o que achar fora do escopo vai em "Sugestões", nunca no código.

### 9.3 Auditoria do Claude
1. Compila e roda a suíte de cada commit numa cópia (`git worktree` + `prisma db push` no `test.db`), e roda o HEAD 2×.
2. Confere o escopo (`git diff --stat`) e o reflog.
3. Confere os nomes citados com `git grep`, procura segredos no diff e compara o relatório com o código.
4. Para cada correção, reverte o código e mostra que o teste falha sem ela.

### 9.4 TESTE-E5 (Executado e Concluído em 23/10/2026)
- **Veredito:** **ACEITO COM RESSALVA** (Relatório: [docs/relatorios/TESTE-E5-antigravity.md](file:///C:/projetos/nextcode/docs/relatorios/TESTE-E5-antigravity.md)).
- **Baseline 2×:** `tsc` 0 erros e `vitest` 162 arquivos / 1.045 testes verdes nas 2 rodadas.
- **Os 12 testes "falha sem a correção":** Todos os 12 itens provados falhando sem a correção em worktree isolada (`../nc-teste-e5`).
- **Caça adversarial (9 frentes):** Bancada Docker, Spec Patch, J20/T7, Autoteste E5, PJ2b e modelos pagos auditados sem falhas graves.
- **Ressalva identificada:** `src/core/decision/jev.ts` não valida `process.env.NEXTCODE_DISABLE_JEV === "1"` no `readJevKey` (adicionado ao backlog §3.2 item 11b).
- **Trava T-F:** Horário de `prisma/dev.db` permaneceu idêntico (`22/10/2026 18:54:59`).

---

## 10. Documentos consolidados e como recuperar
Todos os 270 arquivos que existiam em `docs/` no commit `cabc2d7` foram retirados da pasta. Para ler qualquer um: `git show cabc2d7:<caminho>`. Para listar: `git ls-tree -r --name-only cabc2d7 docs`.

| Grupo | O que tinha | Onde ficou o conteúdo |
|---|---|---|
| `docs/NEXTCODE-REFERENCIA.md` (versão de 861 linhas) | §5.0 cronograma com as 45 "Mudanças do cronograma" (data, motivo, evidência, aprovação), §5.1–5.5, §6 decisões pendentes (todas decididas), §8 protocolo, §9 registro e documentos apagados no D1 | §2, §3, §9 deste documento; histórico completo no git |
| `docs/ARQUITETURA-ORQUESTRACAO.md` | desenho v4: princípios P1–P17, fases, permissões, templates, travas, telemetria e metas, roteiro, decisões D1–D10 | §4 e §3.5 |
| `docs/MEMORIA-DO-PROJETO-FORMATO.md` | formato da memória | §6 |
| `docs/rascunhos/` (`JEV-DECISOES.md`, `TEMPLATES.md`, `TERCEIROS.md`, `FASE8-pedido-sintetico-p5c.md`) | catálogo do Jev, templates, licenças, pedido do smoke | §5, §6, §8, §2.3 |
| `docs/rascunhos/politicas-orquestracao.yaml` | reserva antiga da política (ainda no disco) | sai no item 4 da §3.1 |
| `docs/specs/gatway-system-spec.md` | Spec antiga do Gateway | §7.2 |
| `docs/prompts/` (34 arquivos) | prompts de cada pacote (R1, P0–P5c, S1, C1, D1, I1, J1, J2, J2.7, A2, A3, B1, B1c, PJ1, auditorias do Cursor, TESTE-E1-4, TESTE-E5) | §2 e §9 |
| `docs/relatorios/` (54 arquivos, fora `bench/`) | relatório de cada pacote, auditorias consolidadas (E1, E1-4, 43, E5), decisões autônomas (E1, E1-2, E1-3, E1-4, E5), JV1, perfil de provedores, pesquisador, testes reais | §2, §3, §7 |
| `docs/relatorios/bench/` (59 arquivos) | rodadas do bench (`.md` + `.yaml`) e provas em JSON | §7.1 |
| `docs/terceiros/jev-docs/` | cópia oficial da documentação do Jev (`llms-full.txt`, `model-jaggedness_jev-1.13.md`, `primitives_*`, `cookbooks_*`) | §5; ler com `git show cabc2d7:docs/terceiros/jev-docs/llms-full.txt` |
