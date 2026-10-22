# Medições reais (não estimativas, salvo indicação)

| Data | Rodada | Resultado | Custo LLM | Jev |
|---|---|---|---|---|
| 07/10 | P1, executor chamada única, Jev decidindo nível | ENTREGUE | US$ 0,0282 (exec+aval) / 0,0416 total | < US$ 0,0002 |
| 07/10 | P2, chamada única | ENTREGUE, `UI_CHECK_PASSED` | US$ 0,0774 | < US$ 0,0002 |
| 07/10 | Estimativa sem Jev (armazenamento também na DeepSeek) | **estimativa** | P1 ~0,039 (−28%) · P2 ~0,089 (−13%) | — |
| 08/10 | P1, laço de ferramentas (item 2) — etapa feita no modelo gratuito | ENTREGUE, 0 reprovações | US$ 0,0247 (−41%) | — |
| 08/10 | P2, laço de ferramentas | ENTREGUE, `ui-check` ok | US$ 0,1146 (+48%: laço reenvia conversa) | — |
| 08/10 | P1, item 10 (Jev na execução) | ENTREGUE, 162 s | US$ 0,0394 | 3 chamadas, 7.089 tokens, US$ 0,0003 |
| 08/10 | P2, item 10 | ENTREGUE, 426 s | US$ 0,1398 | 4 chamadas, 8.902 tokens, US$ 0,0004 |
| 13/10 | J1 — auditoria final do Jev (`verifyProjectDeliveryWithJev`) 5× em `p1-referencia` (correto) e `p4-base` (3 bugs) | p1 reprovado 5/5 (falso negativo); p4 reprovado 5/5 (certo). Separam: requisitos 0,92×0,06 · regras 0,88×0,14 · contratos 0,92×0,45 · integração 0,96×0,81. **Não separam:** stubs 0,45×0,46 · segurança 0,38×0,37 | — | 10 chamadas, 17.960 tokens, US$ 0,00075 |

## Achados de custo (07–08/10)
- Raciocínio da DeepSeek = 75–90% da saída (ex.: 5.256 de 7.200 tokens na etapa de tela); saída custa 3× a entrada.
- Cache do provedor: 85–93% da entrada do avaliador vem do cache.
- Markdown+YAML: ~0% de economia de tokens; ganho é de precisão.
- Modelo gratuito às vezes erra (P2: mandou o mesmo arquivo 3×) e a nova tentativa sobe para a DeepSeek.
- `measureJevSelectorComparison` (`jev-decisions.ts`) é **simulação** com constantes, não medição — e usa DeepSeek 0,28/0,42 por M, enquanto `cost.ts` usa `deepseek-v4-pro` 1,32/3,96. Divergência a resolver.

## Preço do Jev
US$ 0,042 por 1M tokens de entrada; saída grátis (docs oficiais e `jev.ts`).

## Modelos disponíveis na chave DeepSeek (08/10)
`GET /v1/models` → `["deepseek-flash", "deepseek-v4-pro"]` (conferido pelo Antigravity no R1.0 e pelo Claude). Não existe `deepseek-v4-flash`.

## FreeLLMAPI — sonda de 08/10 (max_tokens 8)
| modelo pedido | resultado |
|---|---|
| deepseek-v4-pro | 503 sem chave de provedor utilizável |
| deepseek-v4-flash | 200 via `electronhub` (gratuito), 49,9 s |
| claude-sonnet-4-5 | 404 fora do catálogo |
| gemini-3.8-flash | 429 cota esgotada (~24 h) |
| auto:smart | 200 via `openrouter/dots-3-note:free`, 7,0 s |
| auto:perfil-inexistente | 400 Profile not found |

## FreeLLMAPI — sonda 2 (08/10, após cadastrar DeepSeek)
| modelo | resultado |
|---|---|
| deepseek-v4-pro | 400 — ID salvo como `• deepseek-v4-pro` (marcador no nome) |
| deepseek-flash | 400 — mesmo defeito (`• deepseek-flash`) |
| deepseek-v4-flash | 200 via `electronhub` (gratuito), 11,8 s |
| auto:smart | 200 via `openrouter/dots-3-note:free`, 10,3 s |
Uma falha 400 deixa a chave ~13 s em espera (429 em seguida).

## FreeLLMAPI — sonda 3 (08/10, após o fundador corrigir o ID)
| modelo | resultado |
|---|---|
| deepseek-v4-pro | 200 `custom/deepseek-v4-pro`, 2,8 s, 29 tokens de raciocínio |
| deepseek-flash | 200 `custom/deepseek-flash`, 1,6 s |
| auto:nextcode-pago-forte / -barato | 400 perfil inexistente (perfis opcionais; padrão vazio no R1 v3) |

## R1 (08/10) — papéis críticos só pago, pelo FreeLLMAPI (relatório `docs/relatorios/R1-roteamento-pago-primeiro.md`)
| Rodada | Resultado | Custo LLM | Jev | Observação |
|---|---|---|---|---|
| P1 | ENTREGUE, tsc 0, 2 etapas, **2/2 aprovadas na 1ª** | US$ 0,0478 (+21% vs 0,0394) | US$ 0,0003 | etapa simples: `custom/deepseek-flash` (antes grátis no groq) |
| P2 | ENTREGUE, tsc 0, UI_CHECK ok, **3/3 aprovadas na 1ª** | US$ 0,1101 (−21% vs 0,1398) | US$ 0,0004 | 0 chamadas a gratuito/OmniRoute; avaliador = DeepSeek direto (BYOK) |
Jev: P1 etapa 1 `rapido` conf 0,98 → Flash; P2 etapa 2 `medio` conf 0,46 → sobe a `pesado`.

## Nemotron no FreeLLMAPI (08/10 noite, função TS trivial)
| modelo | resultado |
|---|---|
| nemotron-3-ultra | 200 via `ollama/nemotron-3-ultra`, 3,5 s, correto |
| nemotron-3-ultra-550b | 200 via `nvidia/nvidia/nemotron-3-ultra-550b-a55b`, 20,5 s, correto |
Qualidade como avaliador: **não medida** (P3.3 faz divergência plantada).

## P1 real — rodada do auditor (08/10 noite, após o pacote P1)
ENTREGUE, 195 s, tsc 0, 2/2 etapas na 1ª. LLM_COST US$ 0,0499 = executor 0,0260 + avaliador 0,0237 + **jev 0,00026** (Jev agora entra na conta).
**1ª divergência real do `JEV_EVIDENCE_CHECK` (sombra):** etapa `lib/tarefas.ts` (executor `deepseek-flash`): evidência citada pelo executor para REQ-001 → Jev `unrelated` 0,81; evidência do avaliador → `supports` 0,94. Leitura: código certo, citação do executor errada (relatório vago). Mantém o modo sombra; reforça o valor da checagem.

## P3 — avaliador Nemotron pelo FreeLLMAPI (09/10)
**Controle do auditor (mesmo brief, REQ-001 = 201, REQ-002 = salvar em memória):**
| caso | rodada | servedBy | veredito | REQs |
|---|---|---|---|---|
| código correto | 1 | ollama/nemotron-3-ultra | APPROVED | 001 implementado, 002 implementado |
| código correto | 2 | ollama/nemotron-3-ultra | APPROVED | 001 implementado, 002 implementado |
| só REQ-001 errado (200), relatório mentindo "201" | 1 | ollama/nemotron-3-ultra | REJECTED | 001 ausente, 002 implementado |
| só REQ-001 errado | 2 | ollama/nemotron-3-ultra | REJECTED | 001 parcial, 002 implementado |
Leitura: discrimina certo × errado e não se deixa levar pelo relatório. Amostra pequena (4).
**P1/P2 reais (Antigravity):** ambos ENTREGUE, tsc 0; P1 US$ 0,0349; P2 US$ 0,0624. Avaliador: Nemotron em 4 de 5 etapas; **etapa de tela do P2 → timeout do Nemotron (>120 s) → DeepSeek**. Prompt do avaliador de tela ~47 mil caracteres (skill + referências) — provável causa.
Custo do avaliador caiu (P2: US$ 0,0121 vs 0,0237 no P1 do P1 com DeepSeek).

## Prova da régua do bench (`bench/aceite/`, 09/10, auditor)
Implementação de referência (escrita pelo auditor) e variantes com 1 erro cada, rodadas no host (código do auditor, não gerado por IA):
| variante | P1 | P2 | testes que caíram |
|---|---|---|---|
| referência correta | 10/10 | 13/13 | — |
| POST devolve 200 em vez de 201 | 9/10 | 12/13 | A3 |
| 404 trocado por 200 (PATCH e DELETE) | 8/10 | 11/13 | A8, A10 |
| aceita título vazio | 8/10 | 11/13 | A4, A5 |
| tela sem `use client` | 10/10 | 12/13 | T1 |
| `concluida` não inicia false | 9/10 | 12/13 | A3 |
1ª versão tinha cascata (erro no A3 derrubava A6/A7/A9); corrigido — cada teste cria sua própria tarefa.

## Bench — 1ª rodada (09/10, `docs/relatorios/bench/2026-10-09-0713.md`) + execução do auditor (`...0722-auditor.md`)
| projeto | variante | fase | aceite | tempo | custo total | executor / avaliador / jev |
|---|---|---|---|---|---|---|
| P1 | padrão | ENTREGUE | 10/10 | 162 s | 0,0265 | 0,0262 / 0 / 0,0003 |
| P1 | padrão (auditor) | ENTREGUE | 10/10 | 229 s | 0,0306 | 0,0304 / 0 / 0,0003 |
| P1 | sem Jev | ENTREGUE | 10/10 | 176 s | 0,0303 | 0,0303 / 0 / 0 |
| P1 | avaliador DeepSeek | ENTREGUE | 10/10 | 168 s | 0,0521 | 0,0344 / 0,0175 / 0,0003 |
| P2 | padrão | ENTREGUE | 13/13 | 537 s | 0,1078 | 0,0994 / 0,0080 / 0,0004 |
| P2 | sem Jev | ENTREGUE | 13/13 | 471 s | 0,0886 | 0,0886 / 0 / 0 |
| P2 | avaliador DeepSeek | ENTREGUE | 13/13 | 350 s | 0,1013 | 0,0646 / 0,0362 / 0,0004 |
**Leitura:** (1) efeito teto — aceite 100% em todas as variantes; P1/P2 não separam qualidade. (2) "Economia do Jev" no P1 **não se sustenta**: padrão variou 0,0265–0,0306 entre execuções e sem Jev deu 0,0303 → dentro do ruído. (3) Nemotron avaliando poupa o custo do avaliador inteiro (0,0175/0,0362) mas o P2 padrão levou +187 s (timeout na tela). (4) Custo do executor varia ±15% entre execuções iguais → precisa ≥ 3 repetições.

## Prova da régua P3/P4 (09/10, auditor) — `bench/aceite/auth.mjs`, `correcao-tarefas.mjs`
| variante (código do auditor) | resultado | caiu |
|---|---|---|
| P3 referência (scrypt+sal, token randomBytes) | 12/12 | — |
| P3 senha guardada em texto | 11/12 | L2 |
| P3 login com mensagens diferentes (revela e-mail) | 11/12 | L8 |
| P3 logout não invalida o token | 11/12 | L12 |
| P3 token fixo derivado do e-mail | 11/12 | L9 |
| P3 registro devolve o hash | 11/12 | L3 |
| P4 base com bugs (`bench/projetos/p4-base`) | 9/12 | A4, A5, A8 |
| P4 correção certa | 12/12 | — |
| P4 correção que apaga o GET por id | 10/12 | X1, X2 |
Lição: rodar a régua **de dentro da pasta do projeto** (fora dela o `@/` não resolve e tudo cai — inclusive a referência).

## Bench P3/P4 — rodada `2026-10-09-1358` (Antigravity) + execução do auditor (09/10)
**P4 da rodada é inválido:** as 9 execuções bloquearam na etapa de base (`npm install` ERESOLVE, `@types/react@19.1.0` × `@types/react-dom@^19`)
por erro **do auditor** na base. Corrigido; execução do auditor: P4 padrão → ENTREGUE 12/12, US$ 0,0483.
**P3 (login), 3 repetições, todas ENTREGUE 12/12:**
| variante | custo por repetição (US$) | média | executor médio | avaliador médio | tempo médio |
|---|---|---|---|---|---|
| padrão | 0,0684 · 0,0816 · 0,1211 | 0,0904 | 0,0811 | 0,0090 (rep 3: Nemotron falhou → DeepSeek 0,027) | 376 s |
| sem Jev | 0,0539 · 0,0717 · 0,0851 | 0,0702 | 0,0702 | 0 | 330 s |
| avaliador DeepSeek | 0,0984 · 0,1169 · 0,0966 | 0,1040 | 0,0747 | 0,0289 | 279 s |
**Leitura:** (1) teto de novo: 100% de aceite em tudo — o NextCode acerta login com segurança (hash, token, 401 igual, logout). (2) Executor
**mais caro com Jev** nas 3 repetições pareadas (+0,014 · +0,010 · +0,009), mas as faixas se sobrepõem (n=3) → indício, não prova, de que a
escolha de modelo do Jev não economiza. (3) Nemotron poupa ~US$ 0,03 de avaliador por execução; custa ~100 s a mais.

## 15/10 — Sondas, B0 e Spec DeepSeek × Claude (auditor; nenhum código alterado)
**Sondas (8 tokens):** FreeLLMAPI `deepseek-v4-pro` 200 (3,5 s, `custom/`), `deepseek-flash` 200; Anthropic direto `claude-sonnet-4-5-20250929`, `claude-opus-5-5`, `claude-sonnet-5-5` 200. O 429 de 13/10 passou.
**B0 — bench P1–P4, padrão, 1 rep (`docs/relatorios/bench/2026-10-15-1927.md`):** todas ENTREGUE, aceite 100%: P1 10/10 US$ 0,0258 277 s · P2 13/13 US$ 0,1242 975 s (tela ok) · P3 12/12 US$ 0,0598 431 s · P4 12/12 US$ 0,0273 304 s. tsc 0 em todas; avaliador Nemotron (P2 também DeepSeek). 1ª entrega de ponta a ponta desde 09/10.
**Spec com a mesma conversa e o mesmo pipeline do chat (peneira M0 + prompt do chat + guarda + auto-cura + M2 + conferência):**

| pedido | teto | modelo | Spec válida | REQ | correções automáticas | M2 clareza (0–3) | custo US$ | tempo |
|---|---|---|---|---|---|---|---|---|
| Gateway (3 msgs reais) | 8192 (o de produção) | DeepSeek v4-pro | 1 de 2 (a válida com 0 REQ; a outra entrou em repetição) | 0 | — | 0,05 | 0,036 | 53–60 s |
| Gateway | 8192 | Claude Sonnet 5.5 | 0 de 2 (6.210 dos 8.192 tokens gastos raciocinando; texto cortado) | — | — | — | 0,089 | 57 s |
| Gateway | 8192 | Claude Opus 5.5 | 0 de 2 (cortado) | — | — | — | 0,178 | 72–75 s |
| Gateway | 32000 | DeepSeek v4-pro | sim | 18 | 4 | 1,73 | 0,049 | 73 s |
| Gateway | 32000 | Claude Sonnet 5.5 | sim (bateu o teto de 32k) | 71 | 57 | 1,43 | 0,327 | 199 s |
| Gateway | 32000 | Claude Opus 5.5 | sim | 41 | 0 | 1,45 | 0,627 | 244 s |
| Login (1 msg) | 8192 | DeepSeek v4-pro | 2 de 2 (rep 1 com 0 REQ, bateu o teto) | 0 · 8 | 1 · 0 | 2,33 · 2,30 | 0,034 · 0,027 | 48–63 s |
| Login | 8192 | Claude Sonnet 5.5 | 2 de 2 | 14 · 16 | 1 · 1 | 2,60 · 2,57 | 0,062 · 0,067 | 35–40 s |
| Login | 8192 | Claude Opus 5.5 | 2 de 2 | 17 · 15 | 0 · 0 | 2,84 · 2,70 | 0,151 · 0,135 | 51–58 s |

**Regra de negócio explícita do fundador (taxas Asaas +1 ponto percentual e +R$ 0,49; antecipação sem mudança), Specs do Gateway com teto 32k:** Opus 10/10 valores calculados certos (3,99%+R$0,98; 4,49%; 4,99%; 5,29%; débito 2,89%+R$0,84; voucher 4,59%; Pix/boleto R$2,48; antecipação mantida); Sonnet escreveu a regra ("+1 ponto percentual e +R$ 0,49") sem a tabela; **DeepSeek só "markup", sem os números da regra**. Os 13 itens pedidos na conversa (whitelabel, painel, inadimplentes, API, link, checkout, comprovante, WhatsApp, chaves Asaas, financeiro dono×cliente, split, taxa, antecipação): Opus 13/13, DeepSeek 13/13 por palavra-chave, Sonnet 12/13.
**Leitura:** (1) o teto de 8.192 tokens do chat (`route.ts:~695`) corta a Spec do Gateway em **todos** os modelos — defeito do NextCode, não do modelo; (2) M2 não separa os modelos no Gateway (1,4–1,7 para todos) e a conferência reprova todas com 1–2 problemas → M2 e conferência ainda não servem de régua para escolher modelo; (3) Opus foi o único a transformar a regra do fundador em valores certos, a 12,8× o custo do DeepSeek (US$ 0,63 × 0,049 por Spec — custo de uma vez por projeto); (4) n pequeno (1–2 por célula): indício forte no Gateway, não prova estatística.

## 15/10 — Auditoria do P5c: Spec do Gateway pelo caminho novo (Claude Opus direto)
Mesma conversa (3 msgs reais do Gateway), mesmo prompt do chat, `callElicitadorClaude` do `95f6c23`, teto 48.000. **Tentativa 1:** `TypeError: fetch failed` (tempo não medido). **Tentativa 2:** ok em 289 s, `end_turn`, 35.898 tokens de saída (11.401 de raciocínio), 52.431 caracteres, **46 REQ, 0 problema de estrutura** (nenhuma correção necessária), US$ 0,73. Regra de taxas do fundador: **10/10 valores certos** de novo (3,99%+R$0,98; 4,49%; 4,99%; 5,29%; débito 2,89%+R$0,84; voucher 4,59%; Pix/boleto R$2,48; antecipação mantida) + exemplo calculado (R$100 crédito à vista → líquido R$95,03).
**Prova da causa da falha:** servidor local que demora 310 s para responder; `fetch` do Node 24 com `AbortSignal.timeout(540000)` → `TypeError: fetch failed` aos 305 s (`UND_ERR_HEADERS_TIMEOUT`). A 2ª tentativa passou a 11 s do limite. Correção: streaming (P5c.3).

## 16/10 — B1 bench: avaliador `claude-opus-5-5` 1º × cadeia atual (Nemotron → …)
Rodada: `docs/relatorios/bench/2026-10-16-1658.md` · teto bench US$ 3,00/sessão · executor DeepSeek inalterado · 1 rep · P1–P4.

| Projeto | Variante | Fase | Aceite | Custo total | Avaliador (trilha) | Tempo (s) |
|---|---|---|---:|---:|---|---:|
| P1 | padrao | ENTREGUE | 10/10 | 0,0220 | Nemotron | 209,5 |
| P1 | avaliador-claude | BLOQUEADA | 1/10 | 0,1731 | claude-opus-5-5 (eval ~0,049) | 424,2 |
| P2 | padrao | ENTREGUE | 13/13 | 0,0660 | Nemotron (+1 DeepSeek) | 498,6 |
| P2 | avaliador-claude | BLOQUEADA | 10/13 | 0,3177 | claude-opus-5-5 (~0,10 eval) | 601,5 |
| P3 | padrao | ENTREGUE | 12/12 | 0,0611 | Nemotron | 373,4 |
| P3 | avaliador-claude | BLOQUEADA | 0/12 | 0,1127 | (sem eval pago na trilha agregada) | 351,6 |
| P4 | padrao | ENTREGUE | 12/12 | 0,0375 | Nemotron | 153,7 |
| P4 | avaliador-claude | BLOQUEADA | 9/12 | 0,1737 | — | 466,6 |

**Soma custos:** padrao US$ 0,1866 · avaliador-claude US$ 0,7772 · **delta +US$ 0,5906** na variante Opus (avaliador pago onde rodou).

**Resposta à pergunta do B1:** sim, aceite e fase final mudam — **padrao 4/4 ENTREGUE 100%** vs **avaliador-claude 0/4 ENTREGUE (4× BLOQUEADA)** e aceite agregado muito menor (P3 0/12). Opus reprova mais (mais retentativas, sessões bloqueadas por 3 tentativas). Custo avaliador sobe onde há chamadas Opus (ex. P1 +~US$ 0,049 eval vs ~0 no Nemotron gratuito).

Relatório completo: `docs/relatorios/B1-bench-avaliador-claude.md`.

## 16/10 — B1c bench: avaliador-claude após fix ramo Anthropic direto
Rodada: `docs/relatorios/bench/2026-10-16-1822.md` · variante `avaliador-claude` · 1 rep · P1–P4 · custo acumulado US$ 0,7804.

| Projeto | Fase | Aceite | Custo total | Exec / Eval / Jev | Aval. indisp. | Aval. por provedor (trilha) |
|---|---|---|---:|---|---:|---|
| P1 | ENTREGUE | 10/10 | 0,1590 | 0,0302 / 0,1283 / 0,0004 | 0 | claude:2 |
| P2 | ENTREGUE | 13/13 | 0,3131 | 0,0875 / 0,2249 / 0,0006 | 0 | claude:3 |
| P3 | ENTREGUE | 12/12 | 0,1949 | 0,0649 / 0,1295 / 0,0005 | 0 | claude:2 |
| P4 | ENTREGUE | 12/12 | 0,1134 | 0,0478 / 0,0654 / 0,0002 | 0 | claude:1 |

**Porta B1c:** 4/4 válidas (sem INVÁLIDA: rota); `EVALUATOR_MODEL` com `provider: claude` e modelo `claude-opus-5-5` nas etapas avaliadas. Baseline `padrao` do B1 (4/4, US$ 0,19) inalterado.

**Auditoria do B1 (Claude, 16/10, trilha das cópias `nc-bench-p*-avaliador-claude-1/dev-copy.db`): a variante `avaliador-claude` NÃO mede o Opus.** Das 47 chamadas de avaliação, só 3 tiveram veredito do Opus (P1 1, P2 2, P3 0, P4 0); as outras deram `nenhum-pago` (FreeLLMAPI 404 para o Opus e o ramo Anthropic direto voltou sem texto e sem registrar falha; 1× `claude/direct: HTTP 400`). Os 4 BLOQUEADA vieram de "auditor LLM não respondeu um veredito válido" (`EVALUATOR_UNAVAILABLE` 5–7 por projeto, `auditMethod: heuristic_fallback`), não de reprovação do Opus. O aceite baixo (1/10, 10/13, 0/12, 9/12) é de projeto parado no meio. Conclusão "Opus muda materialmente o resultado" = inválida. `padrao` (4/4, US$ 0,19) vale. Observação: no `padrao` P2 a etapa de tela foi avaliada por `custom/deepseek-v4-pro` (mesma família do executor; Nemotron falhou) — T-N.

**Auditoria do B1c (Claude, 16/10):** confere com `docs/relatorios/bench/2026-10-16-1822.yaml`: P1–P4 ENTREGUE, aceite 47/47, 0 tentativas extras, avaliações `claude` 2·3·2·1 (100% Opus), 0 `EVALUATOR_UNAVAILABLE`. Avaliador US$ 0,55 de US$ 0,78. **Leitura:** resultado idêntico ao `padrao` (4/4, 0 reprovação, US$ 0,19) → efeito teto: P1–P4 não têm defeito para o avaliador achar; o bench **não separa** Opus × Nemotron em qualidade, só em custo (~4×). Separar exige controles com defeito plantado (J3). Cópias do banco do B1c não existem mais (só o YAML).

## 16/10 (noite) — Catálogo do FreeLLMAPI e sonda de rota (auditor; 8 tokens por modelo, prompt "Responda apenas: ok")
`GET /v1/models` (localhost:3100): **263 modelos**, **136 disponíveis**, 127 indisponíveis (`no_key`). Disponíveis por família: outros 35 (mistral/ministral/codestral, step, laguna…), gemini 13, nemotron 13, qwen 12, gpt 11, llama 11, gemma 9, mistral 8, deepseek 5, claude 3 (`claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`), minimax 3, gpt-oss 3, glm 2, o3 2, o4-mini, phi-4, command-r, hunyuan, dots3, `auto`. "Disponível" = existe chave para algum provedor; não diz se é pago, gratuito nem por onde passa.
Sonda (15 candidatos): 200 — `deepseek-v4-pro` via **`custom/`** (pago, chave do fundador) 2,0 s; `gpt-5.6-luna`, `gpt-4.1`, `deepseek-v4-flash`, `minimax-m3` via **`electronhub/`** (revenda não oficial) 2,3–6,4 s; `nemotron-3-ultra` via `ollama/` 4,4 s; `nemotron-3-super-120b` via `openrouter/…:free` 1,2 s; `gpt-oss-120b` via `groq/` 0,7 s. 429 (cota) — `gemini-3.8-flash`, `qwen3-235b`, `glm-5.2`, `llama-4-maverick`. 502 — `o3`. **404 — `claude-opus-4-5` e `claude-sonnet-4-5`: listados como disponíveis, mas "not in the catalog"** (catálogo do `/v1/models` não bate com o roteador).

## 17/10 — Sonda de repasse do FreeLLMAPI (auditor; custo ≈ US$ 0,001)
`deepseek-v4-pro` (custom/): JSON ✅ · tools ✅ com `auto`, ❌ `required` (400 thinking) · `thinking: disabled` ignorado. `nemotron-3-super-120b` → servido por `openrouter/…:free`: JSON ✅ · tools ✅ · `enable_thinking:false` ignorado. Uma tentativa caiu em `router9/deepseek/deepseek-v4-pro` (revenda, 429). Jev no teste real `934939fc`: 30 decisões (7 intenção, 7 M0, 7 M2, 6 evidência, 3 diagnóstico de falha); diagnóstico deu `evaluator_error` 0,85–0,98 nas 3 vezes da etapa 3 (causa real: plano) — não há categoria "erro de plano" em `FAILURE_CAUSE_CRITERIA`. Detalhe: `docs/relatorios/PERFIL-PROVEDORES.md` §5.

## 17/10 — Execução autônoma da E1 (A2.3, AV1.1, AV1.5)
- **Analista DeepSeek, Spec real `934939fc` (43 REQ, 58 arquivos, 38.624 caracteres):** 16 mil tokens → 3× `length` sem JSON (US$ 0,21); 32 mil + prazo 120 s → 3× corte; 32 mil + 300 s → aprovado na rodada 1, 152 s, 15.063 in / 24.819 out, **US$ 0,099**, 35 etapas, 0 REQ repetido, T8b válida.
- **Sonda avaliador:** `claude-sonnet-5-5` e `claude-opus-5-5` respondem pela Anthropic (US$ 0,00013 / 0,00026 por "ok").
- **Controles do avaliador (Sonnet 5.5, 7 casos com defeito plantado):** 7/7 pelo motivo certo na rodada final; casos LLM 14/14 na rodada dupla; ≈ US$ 0,01 por avaliação; arquivo de 52.912 caracteres lido até o fim.

## 18–19/10 — Teste real `8e2f2052` (fundador; Multi_Gateway, 51 REQ, 54 etapas)
49/55 etapas concluídas, 6 bloqueadas; 34/54 aprovadas na 1ª; **US$ 18,78** (executor 13,91 em **1.724 chamadas**, avaliador 3,89 em 78, Spec 0,83, analista 0,13, Jev 0,01); 548 pausas `SEM_LLM`; 35 autorizações de teto; 52 relatórios recusados; limite de 25 passos estourado 3× (diário 165).

## 20/10 — Bench P1–P4 `padrao` depois da mudança 26 (Claude; `docs/relatorios/bench/2026-10-20-1244.md` + `-1314.md`)
P1 ENTREGUE 10/10 US$ 0,0675 · P2 ENTREGUE 13/13 US$ 0,2134 (depois do `835e98f`; antes PAUSADA 10/13 2× por gateway cortar em 120 s) · P3 ENTREGUE 12/12 US$ 0,1243 · P4 ENTREGUE 12/12 US$ 0,0612. Chamadas do executor por etapa: média 2,5–4, **máx. 4** (meta TR1 ≤ 10); todas as etapas aprovadas na 1ª. Cache do avaliador: 3.236 tokens lidos + 1.713 gravados numa avaliação do P2. n = 1 por projeto.

## 21–22/10 — Execução autônoma 4 (Claude; `docs/relatorios/AUDITORIA-E1-4.md`)
- **Retomada `4d019f00`:** 71 → 9 erros reais com memória livre; J2b 3 reparos, 3/3 aprovados na 1ª, 4/6/4 ações do executor; tsc final 0; ENTREGUE; US$ 0,2351 (executor 0,153, avaliador 0,081). Total da sessão US$ 12,56 (+~0,76 não registrados de 2 chamadas sem texto).
- **G1 na trilha real:** 9/9 turnos antes recusados (inteiros na trilha) agora aceitos; antes 0/9.
- **J3 controles** (P1 correto 5×, integração, stub, P4 base): Opus 5.5 8/8 US$ 0,259; Sonnet 5.5 8/8 US$ 0,118; Sonnet com linhas numeradas 8/8 US$ 0,072.
- **J3 no Gateway entregue:** Sonnet 5.5, 208 mil tokens de entrada, ~19 mil de saída, 136 s, US$ 0,68; 65 REQ → 50 implementados, 15 parciais, 0 citação inválida. Com teto de 8 mil tokens: só raciocínio (`stop_reason=max_tokens`). Sem linhas numeradas: 2 descartes por fim de intervalo 1–2 linhas além do arquivo (US$ 1,01).
- **TS1:** teste mais lento dos 2 e2e = 5,6 s; suíte 145/961 2× com o prazo padrão.

## 22/10 — Reabertura do Gateway `4d019f00` (mudanças 40–42)
- Revisão final dentro do fluxo: Sonnet 5.5, US$ 0,67, reprovou → rodada 2: 13 reparos, 13/13 aprovados (10 na 1ª, 2 na 2ª, 1 na 3ª), ~29 min.
- Client do Prisma velho depois de mudar o schema: `tsc` 0 erros (falso) × `next build` 1 erro; com o client regerado: 16 erros reais.
- Rodada 3: 7 reparos, 2 aprovados antes do DeepSeek `out_of_credits` (FreeLLMAPI 429 "All models exhausted").
- Custo desde a reabertura US$ 3,56 (executor 2,06; avaliador 1,49; Jev 0,002).

## 22/10 08:22 — Retomada final do Gateway (rodada 3)
- 5/5 reparos aprovados; tsc 0; UI 10/10; revisão final 5 parciais (eram 15 → 14). US$ 1,48; sessão US$ 19,28.
- FreeLLMAPI: falta de crédito põe pausa de 24 h na chave (`rate_limit_cooldowns`, `source: credit`), que fica depois da recarga até alguém limpar no painel.

