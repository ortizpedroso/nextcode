# Prompt P5c.3 — Elicitador Claude por streaming (corrige o corte de 300 s)

> Origem: auditoria do P5c (diário 49). A Spec do Gateway pelo caminho novo falhou 1 vez com `TypeError: fetch failed`
> e passou na 2ª em 289 s. Causa provada pelo auditor: o `fetch` do Node desiste quando os cabeçalhos demoram mais de
> 300 s (`UND_ERR_HEADERS_TIMEOUT`), mesmo com prazo de 540 s; sem streaming, a Anthropic só manda os cabeçalhos no fim.
> Item P5c da referência §5.0. Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa P5c.3 — a chamada do elicitador ao Claude passa a ser por streaming

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro e os arquivos citados antes de alterar qualquer coisa. Na seção 0 do relatório, escreva em 2 linhas o que vai mudar.
2. **Faça exatamente o que está escrito, nada além.** A assinatura de `callElicitadorClaude` e o tipo `ElicitadorClaudeResult` não mudam; `route.ts` não muda.
3. Qualquer teste existente que quebrar, **fora** de `tests/llm/elicitador-claude.test.ts`, → **PARE** e relate.
4. Trecho citado não existe como descrito → **PARE** e pergunte. Ideias → "Sugestões de melhoria".

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/P5c.3-elicitador-claude-stream.md`. Diferente → PARE (inclusive se o HEAD for mais novo).
- **T-B** PODE ALTERAR só: `src/core/llm/elicitador-claude.ts` e `tests/llm/elicitador-claude.test.ts` (este pode ser ajustado porque nasceu no P5c e simula a resposta antiga, sem streaming). PODE CRIAR: `docs/relatorios/P5c.3-elicitador-claude-stream.md`. Mais nada.
- **T-C** Literalidade. **T-D** nomes conferidos com `git grep -n` (saída colada).
- **T-E** um commit do passo + commit R; cada commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde, saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-F** nunca escreva em `prisma/dev.db`. **T-G** nenhum segredo real (chave falsa por concatenação, como hoje no teste); a chave nunca entra em `detail`. **T-H** nenhum pacote novo (nem SDK da Anthropic, nem `undici`). **T-I** preservar o fim de linha (os dois arquivos estão em LF).
- **T-J** nenhuma chamada real à rede nos testes. **T-K** commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L** relatório fiel (saídas brutas, `git diff --stat` real, "Desvios" verdadeiro — tudo que não estava no prompt é desvio, mesmo pequeno, inclusive o que você acrescentar "por segurança"; se houver desvio, a 1ª linha da seção 5 não pode dizer "nenhum"). **T-O** nenhum plano ou log paralelo.

## PASSO P5c.3 — `src/core/llm/elicitador-claude.ts`
1. No corpo enviado, acrescente `stream: true` (os demais campos ficam iguais).
2. Status diferente de 200: igual a hoje (a Anthropic devolve o erro em JSON antes do stream).
3. Status 200: leia `res.body` com `getReader()` e `TextDecoder`, acumulando o texto num buffer; troque `"\r\n"` por `"\n"`; cada evento termina em `"\n\n"`; em cada evento, as linhas que começam com `"data:"` têm o restante (sem espaços nas pontas) passado a `JSON.parse` (linha que não for JSON válido é ignorada). Tratamento por `type` do JSON:
   - `message_start`: guarde `message.usage` (objeto) como base do uso.
   - `content_block_delta` com `delta.type === "text_delta"`: some `delta.text` ao texto. Outros tipos de delta (`thinking_delta`, `signature_delta`, `input_json_delta`) são ignorados.
   - `message_delta`: se houver `delta.stop_reason`, guarde como `stopReason`; se houver `usage`, mescle sobre o uso guardado (`{ ...usoAtual, ...usage }` — o `output_tokens` do `message_delta` é o total acumulado).
   - `error`: devolva `{ ok: false, detail: \`stream ${error.message ?? "erro"}\` }` (mesma proteção atual: a chave nunca aparece; até 140 caracteres).
   - `ping`, `content_block_start`, `content_block_stop`, `message_stop` e qualquer outro: ignorados.
4. Ao terminar o stream: texto vazio (após `trim`) → `{ ok: false, detail: "resposta sem texto" }`; senão `{ ok: true, text, model, usage: <uso mesclado ou null se nenhum veio>, stopReason: <ou null>, ms }`, com `ms` medido **no fim do stream** (não no recebimento dos cabeçalhos).
5. O resto (passos 1–4 e 9 atuais: chave, modelo, `system`, mensagens, prazo `timeoutMs`, `catch` que nunca lança) fica igual. Atualize o comentário de cabeçalho com 1 linha: por que streaming (o `fetch` do Node desiste se os cabeçalhos demoram mais de 300 s).

## TESTES — `tests/llm/elicitador-claude.test.ts`
Os casos (a)–(f) continuam com o mesmo objetivo; (a) e (e) passam a simular a resposta em stream. Crie no arquivo uma função auxiliar que monta `new Response(<ReadableStream de texto SSE>, { status: 200, headers: { "content-type": "text/event-stream" } })` a partir de uma lista de eventos, cada um no formato `event: <tipo>\ndata: <json>\n\n`.
- (a) eventos: `message_start` (`usage: { input_tokens: 100, output_tokens: 1 }`), `ping`, bloco `thinking` com `thinking_delta`, bloco `text` com dois `text_delta` (`"---\n"` e `"Spec"`), `message_delta` (`delta: { stop_reason: "end_turn" }`, `usage: { output_tokens: 50 }`), `message_stop`. Confere os mesmos itens de hoje, mais: `capturedBody.stream === true`, `usage.input_tokens === 100`, `usage.output_tokens === 50`, `stopReason === "end_turn"`.
- (e) stream só com `thinking_delta` → `ok: false`, `detail === "resposta sem texto"`.
- (g) novo: evento `error` no meio do stream (`{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }`) → `ok: false` e `detail` contém `"Overloaded"`.
- (h) novo: um `text_delta` dividido em dois pedaços do stream no meio do JSON (o leitor recebe `data: {"type":"content_block_de` e depois o resto) → texto montado corretamente.
- (i) novo: eventos com `\r\n` no lugar de `\n` → mesmo resultado do (a).
- (b), (c), (d), (f) continuam passando (ajuste só o que for preciso para o (d) devolver um stream válido).

Commit: `fix(elicitador): P5c.3 - chamada ao Claude por streaming (corte de 300 s do fetch)`.

## RELATÓRIO — `docs/relatorios/P5c.3-elicitador-claude-stream.md` (commit R: `docs(relatorio): P5c.3 - elicitador Claude por streaming`)
0. Leitura (2 linhas). 1. Identificação. 2. Por commit: `git show --stat`, `tsc`, `vitest`. 3. O que mudou (`arquivo:linha`). 4. Escopo (`git diff --stat` real). 5. Desvios. 6. Checklist T-A…T-O. 7. Sugestões. 8. Dúvidas.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
