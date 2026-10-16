# Prompt P5c — Claude Opus no elicitador e teto da Spec (início da E1)

> Origem: testes de 15/10 (`memory/medicoes.md` 15/10) e aprovação do fundador (diário 48, `memory/decisoes.md` 15/10).
> Item P5c da referência §5.0 (mudança 5). Porta: Spec do Gateway pelo caminho do chat sem corte e com a regra de taxas.
> Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa P5c — na Spec, o chat usa Claude Opus primeiro e não corta o documento

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro e os arquivos citados antes de alterar qualquer coisa. Na seção 0 do relatório, escreva em 3 linhas o que vai mudar.
2. **Faça exatamente o que está escrito, nada além.** Fora da fase de Spec (`isSpecDraftingPhase` falso) o chat tem de continuar idêntico.
3. Qualquer teste existente que quebrar → **PARE** e relate. Não altere teste existente.
4. Trecho citado não existe como descrito → **PARE** e pergunte. Ideias → "Sugestões de melhoria".

## POR QUE (para entender, não para mudar)
- Hoje a Spec sai do gateway (`deepseek-v4-pro`) com teto de 8.192 tokens (`src/app/api/chat/route.ts:696`, `:741`, `:783`): a Spec do Gateway foi cortada em todos os modelos testados.
- Só o Claude Opus 5.5 transformou a regra de taxas do fundador em valores certos (10/10). Ele usou 30.655 tokens → teto 48.000. Levou 244 s; o gateway desiste em 120 s (`src/core/llm/gateways.ts:204-205`) → caminho direto com prazo próprio.
- A Spec do Opus tem 47.598 caracteres; a correção da Spec corta em 12.000 (`route.ts:774`) → 60.000.

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/P5c-elicitador-opus-teto.md`. Diferente → PARE (inclusive se o HEAD for mais novo).
- **T-B** PODE CRIAR: `src/core/llm/elicitador-claude.ts`, `tests/llm/elicitador-claude.test.ts`, `docs/relatorios/P5c-elicitador-opus-teto.md`. PODE ALTERAR só: `src/app/api/chat/route.ts`, apenas nos pontos do passo P5c.2. Mais nada (nem YAML, nem `cost.ts`, nem `smart-router.ts`, nem `gateways.ts`).
- **T-C** Literalidade. **T-D** nomes conferidos com `git grep -n` (saída colada): `readSecret`, `safeFetch`, `UsageLike`, `recordLlmCost`, `TelemetryLogger`, `DispatchMessage`, `isSpecDraftingPhase`, `activeSessionId`, `parseSpecDocument`.
- **T-E** um commit por passo (P5c.1, P5c.2) + commit R; cada commit com `npx tsc --noEmit` (0) e `npx vitest run` completo verde, saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-F** nunca escreva em `prisma/dev.db`. **T-G** nenhum segredo real (chave falsa montada por concatenação, ex.: `"sk-ant-" + "teste-p5c"`); a chave nunca entra em log, telemetria, `detail` ou relatório. **T-H** nenhum pacote novo (sem SDK da Anthropic: use `safeFetch`). **T-I** preservar o fim de linha de `route.ts`; arquivos novos em LF.
- **T-J** nenhuma chamada real à Anthropic, ao Jev ou ao gateway nos testes (`fetch` simulado com `vi.spyOn(globalThis, "fetch")`, como em `tests/llm/evaluator-freellmapi.test.ts:198`). **T-K** commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L** relatório fiel (saídas brutas, `git diff --stat` real, "Desvios" verdadeiro — tudo que não estava no prompt é desvio, mesmo pequeno; se houver desvio, a 1ª linha da seção 5 não pode dizer "nenhum"). **T-O** nenhum plano ou log paralelo.

## PASSO P5c.1 — chamada direta ao Claude para o elicitador
Arquivo novo `src/core/llm/elicitador-claude.ts` (comentário de cabeçalho curto em português, no estilo de `evaluator-models.ts`):

```ts
export const ELICITADOR_CLAUDE_MAX_TOKENS = 48000;
export const ELICITADOR_CLAUDE_TIMEOUT_MS = 540_000;

export type ElicitadorClaudeResult =
  | { ok: true; text: string; model: string; usage: UsageLike | null; stopReason: string | null; ms: number }
  | { ok: false; detail: string };

export async function callElicitadorClaude(opts: {
  messages: ReadonlyArray<{ role: string; content: string }>;
  claudeKey: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ElicitadorClaudeResult>
```
Comportamento, nesta ordem:
1. Chave vazia (após `trim`) ou começando com `"••••"` ou `"****"` → `{ ok: false, detail: "sem chave Claude" }` sem chamar a rede.
2. `model = process.env.ELICITADOR_CLAUDE_MODEL || "claude-opus-5-5"`.
3. `system` = conteúdos das mensagens com `role === "system"`, unidos por `"\n\n"` (omitido do corpo se vazio).
4. Demais mensagens: `role === "assistant"` fica `assistant`; qualquer outro papel vira `user`. Descarte as mensagens `assistant` que vierem **antes** do primeiro `user`. Mensagens seguidas do mesmo papel são unidas em uma só, com `"\n\n"`. Nenhuma sobrando → `{ ok: false, detail: "sem mensagem do usuário" }` sem chamar a rede.
5. `safeFetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": chave.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: opts.maxTokens ?? ELICITADOR_CLAUDE_MAX_TOKENS, system?, messages }), timeoutMs: opts.timeoutMs ?? (Number(process.env.ELICITADOR_TIMEOUT_MS) || ELICITADOR_CLAUDE_TIMEOUT_MS) })`.
6. Status diferente de 200 → `{ ok: false, detail: \`HTTP ${status} ${mensagem de erro do corpo, se houver, até 140 caracteres}\` }`.
7. `text` = junção dos blocos `content` com `type === "text"` (ignore `thinking` e outros). Vazio → `{ ok: false, detail: "resposta sem texto" }`.
8. Sucesso → `{ ok: true, text, model, usage: json.usage ?? null, stopReason: json.stop_reason ?? null, ms }` (`ms` = tempo da chamada).
9. Qualquer exceção (incluindo prazo esgotado) → `{ ok: false, detail: String(err).slice(0, 140) }`. A função nunca lança.

Teste novo `tests/llm/elicitador-claude.test.ts`:
- (a) Sucesso: entrada `[system "S1", system "S2", assistant "A0", user "U1", user "U2", assistant "A1", user "U3"]`; resposta simulada `content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "---\nSpec" }]`, `usage: { input_tokens: 100, output_tokens: 50 }`, `stop_reason: "end_turn"`. Confere: `ok: true`, `text === "---\nSpec"`, `model === "claude-opus-5-5"`, `usage` igual ao simulado; na requisição capturada: URL contém `api.anthropic.com/v1/messages`, cabeçalho `x-api-key` igual à chave falsa, `max_tokens === 48000`, `system === "S1\n\nS2"`, `messages` igual a `[{ role: "user", content: "U1\n\nU2" }, { role: "assistant", content: "A1" }, { role: "user", content: "U3" }]`.
- (b) HTTP 529 → `ok: false` e `detail` contém `"529"`; não lança.
- (c) Chave `""` e chave `"••••abc"` → `ok: false` e `fetch` não chamado.
- (d) `process.env.ELICITADOR_CLAUDE_MODEL = "claude-teste-x"` → corpo com `model === "claude-teste-x"` (restaure o valor original no fim do teste).
- (e) 200 só com bloco `thinking` → `ok: false`.
- (f) Em nenhum caso a chave falsa aparece em `detail`.

Commit: `feat(elicitador): P5c.1 - chamada direta ao Claude para a Spec`.

## PASSO P5c.2 — o chat usa o Claude na Spec, com reserva e tetos novos
Só em `src/app/api/chat/route.ts`:

1. Imports novos: `import { callElicitadorClaude } from "@/core/llm/elicitador-claude";` e `import { recordLlmCost } from "@/core/llm/cost";`.
2. Logo depois da linha `let effectiveTier: string = modelOverride || intent.tier || "fast";` (hoje `:687`), insira:
```ts
    // P5c (fundador, 15/10 — medicoes.md): na Spec, Claude Opus direto é o 1º modelo do elicitador; o gateway
    // fica de reserva. Uma falha do Claude desliga a tentativa nas chamadas seguintes deste mesmo pedido.
    const SPEC_GATEWAY_MAX_TOKENS = 32000;
    const elicitadorClaudeKey = isSpecDraftingPhase ? readSecret(setting?.claudeKey) : "";
    let elicitadorClaudeFalhou = false;
    const dispatchSpecWithClaude = async (messages: DispatchMessage[]): Promise<string | null> => {
      if (!elicitadorClaudeKey || elicitadorClaudeFalhou) return null;
      const res = await callElicitadorClaude({ messages, claudeKey: elicitadorClaudeKey });
      if (!res.ok) {
        elicitadorClaudeFalhou = true;
        TelemetryLogger.log({ sessionId: activeSessionId, action: "ELICITADOR_CLAUDE", details: { ok: false, detalhe: res.detail } });
        return null;
      }
      await recordLlmCost({ sessionId: activeSessionId, papel: "outro", provider: "anthropic", model: res.model, usage: res.usage });
      TelemetryLogger.log({
        sessionId: activeSessionId,
        action: "ELICITADOR_CLAUDE",
        details: { ok: true, modelo: res.model, ms: res.ms, stopReason: res.stopReason },
      });
      return res.text;
    };
```
3. Chamada principal (hoje `:690-721`):
   - Antes de `const dispatchRes = await smartRouter.dispatchWithFallback({`, insira `const claudeSpecText = isSpecDraftingPhase ? await dispatchSpecWithClaude(dispatchMessages) : null;`.
   - Troque `const dispatchRes = await smartRouter.dispatchWithFallback({` por `const dispatchRes = claudeSpecText !== null ? null : await smartRouter.dispatchWithFallback({` (os campos do objeto ficam iguais, exceto o item 3c).
   - c) Troque `...(isSpecDraftingPhase ? { maxTokens: 8192 } : {}),` por `...(isSpecDraftingPhase ? { maxTokens: SPEC_GATEWAY_MAX_TOKENS } : {}),` e o comentário das 3 linhas acima dele (`// Spec: o fundador pediu...` até `...sem truncamento.`) por: `// Spec: Claude Opus direto vem antes (P5c); aqui é a reserva (gateway pago forte, depois o gratuito), com teto de 32.000 tokens.`
   - d) Depois do objeto, troque o trecho que vai de `effectiveTier = dispatchRes.tierTag;` até o `}` que fecha o último `else { const errorDetail ... }` por:
```ts
      if (claudeSpecText !== null) {
        aiResponseContent = claudeSpecText;
        effectiveTier = "anthropic";
      } else if (dispatchRes) {
        <o trecho original, sem mudar nenhuma linha interna>
      }
```
   - e) Na condição da 2ª tentativa, troque `dispatchRes.providerUsed !== "none" &&` por `(claudeSpecText !== null || dispatchRes?.providerUsed !== "none") &&`.
4. 2ª tentativa (hoje `:730-752`): troque o bloco de `const retryRes = await smartRouter.dispatchWithFallback({` até o `}` do `if (parseSpecDocument(retryText)) { ... }` por:
```ts
        const retryMessages: DispatchMessage[] = [
          <os mesmos 3 itens do array `messages` atual, sem mudar>
        ];
        let retryText: string = (await dispatchSpecWithClaude(retryMessages)) ?? "";
        let retryTier = "anthropic";
        if (!retryText) {
          const retryRes = await smartRouter.dispatchWithFallback({
            messages: retryMessages,
            <os demais campos atuais, sem mudar, exceto `maxTokens: 8192` → `maxTokens: SPEC_GATEWAY_MAX_TOKENS`>
          });
          const retryJson = await retryRes.response.json().catch(() => ({}));
          retryText = retryJson.choices?.[0]?.message?.content || "";
          retryTier = retryRes.tierTag;
        }
        if (parseSpecDocument(retryText)) {
          aiResponseContent = retryText;
          effectiveTier = retryTier;
        }
```
5. Correção da estrutura (hoje `:771-790`): mesmo padrão do item 4:
```ts
          const fixMessages: DispatchMessage[] = [
            <os mesmos 3 itens atuais, com uma única mudança: `guardRes.finalSpec!.slice(0, 12000)` → `guardRes.finalSpec!.slice(0, 60000)`>
          ];
          let fixText: string = (await dispatchSpecWithClaude(fixMessages)) ?? "";
          if (!fixText) {
            const fixRes = await smartRouter.dispatchWithFallback({
              messages: fixMessages,
              <os demais campos atuais, sem mudar, exceto `maxTokens: 8192` → `maxTokens: SPEC_GATEWAY_MAX_TOKENS`>
            });
            const fixJson = await fixRes.response.json().catch(() => ({}));
            fixText = fixJson.choices?.[0]?.message?.content || "";
          }
```
   O resto do bloco (de `const fixedGuard = applyCumulativeSpecGuard(` em diante) fica igual.
6. Nada mais muda no arquivo. Confira com `git diff -U0 src/app/api/chat/route.ts` e cole a saída no relatório.

Commit: `feat(elicitador): P5c.2 - Spec no chat usa Claude Opus com reserva e teto maior`.

## RELATÓRIO — `docs/relatorios/P5c-elicitador-opus-teto.md` (commit R: `docs(relatorio): P5c - elicitador Opus e teto da Spec`)
0. Leitura (3 linhas). 1. Identificação. 2. Por commit: `git show --stat`, `tsc`, `vitest`. 3. O que mudou (`arquivo:linha`), com o `git diff -U0` do `route.ts`. 4. Escopo (`git diff --stat` real desde o commit do prompt). 5. Desvios. 6. Checklist T-A…T-O. 7. Sugestões. 8. Dúvidas.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
