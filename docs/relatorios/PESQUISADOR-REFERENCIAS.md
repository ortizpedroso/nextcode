# Pesquisador (P8) — análise de referências externas — 17/10/2026

> Pedido do fundador (diário 114): analisar a skill `deep-research` como nosso pesquisador ou como base, e o tópico GitHub `perplexity-super-skill`. Só leitura; nada baixado nem executado; nada alterado no código.

## 1. Veredito
**Não usar nenhuma das duas como está. Aprender com a `deep-research` (método) e escrever a nossa sobre o `UniversalDocsFetcher`, que já existe.** O tópico `perplexity-super-skill` não traz nada aproveitável e tem repositórios com sinais de isca de malware.

## 2. `deep-research` (skill da Anthropic, instalada localmente; 146 linhas + `references/researcher.md` e `report-writer.md`)
Como funciona: um coordenador divide a pergunta em subtemas independentes, dispara 3–6 subagentes pesquisadores em paralelo (WebSearch + WebFetch, ~10–15 chamadas cada), no máximo 1 rodada extra, e um subagente escritor junta tudo num relatório narrativo com citação inline.

**Por que não serve como está:**
| Ponto | `deep-research` | O que o NextCode precisa |
|---|---|---|
| Ambiente | roda no Claude Code, com ferramenta de subagente e WebSearch | o harness chama LLM por API, sem essas ferramentas |
| Saída | relatório em prosa para humano, sem listas | fatos estruturados para o elicitador (endpoint, campos, autenticação, limites), cada um com URL e trecho literal |
| Fontes | "prefira primária", julgamento do modelo | T7: só fonte oficial, por regra do harness (allowlist + `scoreUrlAuthority`) |
| Injeção | nenhuma guarda; texto baixado vai direto ao modelo | guarda Jev T7 (`decideExternalDocsSafetyT7`, já existe) |
| Custo | 3–6 subagentes × 10–15 chamadas | orçamento fixo (`createDefaultResearchBudget`: 3 buscas, 5 páginas, 8.000 caracteres/página) |
| Segredo | a consulta sai como foi escrita | consulta mascarada antes de sair (regra 7) |

**O que vale copiar (método):**
1. Perguntar ao usuário só quando a resposta muda a pesquisa.
2. Dividir em sub-perguntas independentes e sem sobreposição.
3. **Notas em três partes: fatos citados / inferências / lacunas.** Encaixa direto no NextCode: fato com fonte → Spec; inferência → marcada como tal; lacuna → pergunta ao usuário (nunca "DÚVIDA" escrita na Spec).
4. "Nunca invente; sem fonte, vai para lacunas"; fontes em conflito são registradas, não escolhidas caladas.
5. Condição de parada e teto de chamadas; no máximo uma rodada extra.

## 3. Tópico `perplexity-super-skill` (18 repositórios, 17/10)
- **`get-zeked/*` (13 repos, 6–365 estrelas, MIT):** coletâneas de prompts que juntam skills do Perplexity Computer com skills do Claude Code (finanças, marketing, vendas, pesquisa…). O `research-knowledge-super-skill` tem só `README.md` + `SKILL.md`, cobre de tudo (grafo de conhecimento, YouTube, estatística, RAG) e nada específico de pesquisa em documentação oficial para gerar Spec. Valor baixo; o método útil já está na `deep-research`.
- **Sinais de isca** em `tessellated-statisticalcommission243/deep-research-skill`, `Kungfookenny123/aso-skills`, `davzpogi01/…`, `Gamer123l/…`: contas com nome gerado, criadas em 13–14/10, 0–4 estrelas, enchimento de tags, README vazio e pasta sem explicação (`unhooper`), sem licença. **Não clonar nem executar.**

## 4. Desenho proposto do nosso pesquisador (entra no P8; aguarda decisão)
1. **Gatilho:** lacuna que depende de fato externo (API, biblioteca, regra) — `noul` do Jev por lacuna da M0/J8: "isto precisa de documentação externa?".
2. **Consulta:** sub-perguntas atômicas; texto mascarado antes de sair.
3. **Busca:** `UniversalDocsFetcher.fetchOfficialDocsWithGovernance` (existe) com orçamento fixo e allowlist de domínios oficiais.
4. **Filtro pelo Jev:** guarda de injeção (T7, existe) + `noul` de relevância por trecho (receita oficial "Classifying RAG passages") → só os trechos que importam seguem.
5. **Extração:** modelo de custo baixo (não o Opus) escreve as notas no formato fatos citados / inferências / lacunas, com URL + trecho literal + data de acesso.
6. **Conferência mecânica:** cada trecho citado precisa existir literalmente na página baixada; o que não existir sai.
7. **Elicitador (Opus):** recebe só as notas. Lacunas viram pergunta ao usuário.
A skill `pesquisador` é o contrato (o que procurar, formato das notas, regra de lacuna); orçamento, allowlist, máscara e conferência de citação são do harness.
