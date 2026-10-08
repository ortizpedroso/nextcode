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
