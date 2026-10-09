# Auditoria das skills — S0 (auditor, 09/10/2026)

Método aprovado pelo fundador (09/10): (1) promessa × código; (2) entrada × o que chega; (3) saída × validador;
(4) contradições/duplicação; (5) tamanho × efeito (bench); (6) erro plantado + controle. Esta é a parte (1)–(4), lida no
código em `8e284fb`+; (5)–(6) entram com o pacote S1 (`docs/prompts/S1-skills-ligar-e-enxugar.md`).
Medições feitas com `loadRoleSkill` + `buildSkillSystemPrompt` reais (mesma montagem de `dual-lens-auditor.ts:521-533`).

## Tamanho real do texto da skill que vai ao avaliador (caracteres)
| skill | herdado (`avaliador`) | próprio | referências | total |
|---|---|---|---|---|
| avaliador-core | 19.665 | 739 | — | 20.406 |
| avaliador-backend | 19.665 | 745 | — | 20.412 |
| avaliador-integration | 19.665 | 564 | — | 20.231 |
| **avaliador-frontend** | 19.665 | **29.760** | 2 arquivos | **60.576** (igual com e sem página pública) |
| executores (4) | — | 2.297–3.286 | — | — |
O código da etapa vem por cima disso. O avaliador de tela é o que estoura o tempo do Nemotron (P2, tela: > 120 s).

## Achados
| # | Skill | Promete | Realidade no código | Veredito |
|---|---|---|---|---|
| A1 | avaliador-frontend | checklist de página pública "SOMENTE em páginas públicas, nunca em dashboard" (§5 do corpo) | o checklist está **copiado no corpo**, que sempre entra → aplicado em **toda** tela, inclusive painéis; o arquivo `references/taste-skill-preflight-publico.md` **não está declarado** em `referencias_locais_fixas` → nunca carregado; `isPublicPage` nunca é passado (`dual-lens-auditor.ts:531`) | **não cumpre** (faz o contrário) |
| A2 | avaliador-frontend | checklist `ui-ux-pro-max` (§4) via `references/ui-ux-pro-max-checklist.md` | arquivo não declarado → nunca carregado; conteúdo copiado no corpo | cumpre por cópia (duplicação) |
| A3 | avaliador-frontend | 104 regras do `web-interface-guidelines` (§1) e regras do `react-best-practices` (§2) | corpo resume as regras **e** a referência inteira também entra → mesmo conteúdo duas vezes | cumpre, duplicado |
| A4 | avaliador-frontend | ferramenta `playwright_cli_readonly` e sequência de comandos `playwright-cli` (§3) | não existe; o avaliador é **uma chamada só, sem ferramentas** (`dispatchFn(messages)`); a tela em execução é checada à parte pelo `ui-check` (contêiner) | **não cumpre** (risco de inventar "rodei o playwright") |
| A5 | avaliador (geral) e 4 por cluster | ferramentas `read_file`, `list_files`, `grep`, `finish`; `passos_max` | avaliador não roda laço de ferramentas; o código vai dentro do prompt; `passos_max` só vale no executor | **não cumpre** (promessa inofensiva, mas falsa) |
| A6 | Jev → skills | Jev decide `aplicarTasteSkillPublico`, `aplicarReactPerfCritico`, `skillApoioPrincipal` (`jev-decisions.ts:345-372`) | calculados e **descartados**: `withJevPlan` (`execution-trigger.ts:409-424`) só grava nivelModelo/source/precisaDividir/cluster | pago e não usado |
| A7 | Jev `skill_apoio_principal` | escolher "pacote de apoio" (`apoio_api_rest_validation`, `apoio_ui_web_guidelines`, `apoio_dominio_typescript`) | **nenhum pacote com esses nomes existe**; a escolha repete o cluster | pergunta sem efeito possível |
| A8 | elicitador | ferramenta `fetch_official_docs_t7` | não existe | **não cumpre** |
| A9 | elicitador, analista | conduzir conversa / conferir Spec × Macrobrief e dividir Microbriefs (T8a/T8b) | `intake-engine.ts:221-222` só carrega para gravar o **nome**; a divisão é feita por código (`SpecDecomposerSkill`) | **não executadas** (pacote P4+) |
| A10 | executores (4) | ferramentas `read_file`, `list_files`, `grep`, `write_file`, `edit_file`, `run_check`, `finish` | todas existem em `executor-tool-loop.ts` | cumpre |

## Custo do Jev × executor (pergunta do fundador, 09/10)
`rapido` → `deepseek-flash`; `medio` e `pesado` → `deepseek-v4-pro` (`config/politicas-orquestracao.yaml`). Sem Jev, etapa com ≤ 3
arquivos vai para `medio` → **mesmo modelo**. No P3 (3 pares) as etapas e tentativas foram idênticas com e sem Jev → a diferença de
custo do executor **não** vem da escolha de modelo; vem de tokens. Causa não identificável: o bench apaga a cópia do banco e não guarda
modelo/tokens por etapa → instrumentar (S1.1).
