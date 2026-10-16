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
