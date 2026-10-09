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
