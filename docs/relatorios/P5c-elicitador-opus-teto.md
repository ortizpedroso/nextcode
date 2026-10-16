# Relatório P5c — Na Spec, o chat usa Claude Opus primeiro e não corta o documento

## 0. Leitura
1. Criou-se o módulo `src/core/llm/elicitador-claude.ts` para chamada direta à API da Anthropic para a fase de Spec, com teto de 48.000 tokens e timeout de 540s.
2. Em `src/app/api/chat/route.ts`, na fase de Spec (`isSpecDraftingPhase`), o Claude Opus 5.5 direto tornou-se a primeira opção do elicitador, com fallback resiliente para o gateway de LLM com teto expandido para 32.000 tokens.
3. A janela de correção de estrutura da Spec foi ampliada de 12.000 para 60.000 caracteres, impedindo o truncamento de documentos ricos.

---

## 1. Identificação
- **Commit de partida:** `f52911b`
- **HEAD atual:** `ba893ce`
- **Log dos commits do pacote:**
```
ba893ce feat(elicitador): P5c.2 - Spec no chat usa Claude Opus com reserva e teto maior
95f6c23 feat(elicitador): P5c.1 - chamada direta ao Claude para a Spec
```

---

## 2. Por commit: `git show --stat`, `tsc`, `vitest`

### Commit P5c.1 (`95f6c23`)
```
commit 95f6c23bdbeab1d029f4ac002f0764a8315d85f8
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Thu Oct 15 22:41:42 2026 -0400

    feat(elicitador): P5c.1 - chamada direta ao Claude para a Spec
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/core/llm/elicitador-claude.ts   | 157 +++++++++++++++++++++++++++++
 tests/llm/elicitador-claude.test.ts | 193 ++++++++++++++++++++++++++++++++++++
 2 files changed, 350 insertions(+)
```
- **`npx tsc --noEmit`**: 0 erros.
- **`npx vitest run`** (suíte completa):
```
 Test Files  122 passed (122)
      Tests  788 passed (788)
   Start at  22:34:31
   Duration  294.17s
```

### Commit P5c.2 (`ba893ce`)
```
commit ba893ce34e04e7535234be28f13699a8d51c9bcc
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Thu Oct 15 22:49:26 2026 -0400

    feat(elicitador): P5c.2 - Spec no chat usa Claude Opus com reserva e teto maior
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/app/api/chat/route.ts | 158 ++++++++++++++++++++++++++++------------------
 1 file changed, 98 insertions(+), 60 deletions(-)
```
- **`npx tsc --noEmit`**: 0 erros.
- **`npx vitest run`** (suíte completa):
```
 Test Files  122 passed (122)
      Tests  788 passed (788)
   Start at  22:44:34
   Duration  259.75s
```

---

## 3. O que mudou (arquivo:linha)

- `src/core/llm/elicitador-claude.ts:1-157`:
  - Novo módulo que expõe `callElicitadorClaude`, `ELICITADOR_CLAUDE_MAX_TOKENS = 48000` e `ELICITADOR_CLAUDE_TIMEOUT_MS = 540_000`.
  - Normaliza as mensagens recebidas: une `system` em bloco único, descarta mensagens `assistant` iniciais anteriores ao primeiro `user`, une mensagens consecutivas de mesmo papel com `\n\n` e garante que chaves vazias ou mascaradas retornem sem chamada de rede.
  - Executa requisição via `safeFetch` para a API de mensagens da Anthropic, tratando erros HTTP, extraindo blocos `text` e blindando contra qualquer vazamento de chaves em strings de erro.
- `src/app/api/chat/route.ts:23-24`:
  - Importados `callElicitadorClaude` de `@/core/llm/elicitador-claude` e `recordLlmCost` de `@/core/llm/cost`.
- `src/app/api/chat/route.ts:691-711`:
  - Definidos `SPEC_GATEWAY_MAX_TOKENS = 32000` e a função `dispatchSpecWithClaude`, que executa o Claude Opus direto na Spec, contabiliza custos via `recordLlmCost`, registra telemetria `ELICITADOR_CLAUDE` e desativa tentativas subsequentes no mesmo pedido em caso de falha.
- `src/app/api/chat/route.ts:714-750`:
  - Na chamada principal de geração, invoca `dispatchSpecWithClaude` se `isSpecDraftingPhase` for verdadeiro. Se obtiver sucesso, define `effectiveTier = "anthropic"`; caso contrário, aciona o fallback do gateway com teto de 32.000 tokens.
- `src/app/api/chat/route.ts:758-787`:
  - Na 2ª tentativa de obtenção da Spec, aciona `dispatchSpecWithClaude` prioritariamente e, em caso de ausência de resposta, utiliza o fallback com 32.000 tokens.
- `src/app/api/chat/route.ts:805-827`:
  - Na correção de estrutura da Spec, envia até 60.000 caracteres de `guardRes.finalSpec` (anteriormente 12.000) e tenta primeiro `dispatchSpecWithClaude` antes do gateway.

### Saída de `git diff -U0 src/app/api/chat/route.ts`:
```diff
diff --git a/src/app/api/chat/route.ts b/src/app/api/chat/route.ts
index 981514d..f537aa2 100644
--- a/src/app/api/chat/route.ts
+++ b/src/app/api/chat/route.ts
@@ -22,0 +23,2 @@ import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
+import { callElicitadorClaude } from "@/core/llm/elicitador-claude";
+import { recordLlmCost } from "@/core/llm/cost";
@@ -689,0 +692,21 @@ export async function POST(request: NextRequest) {
+    // P5c (fundador, 15/10 — medicoes.md): na Spec, Claude Opus direto é o 1º modelo do elicitador; o gateway
+    // fica de reserva. Uma falha do Claude desliga a tentativa nas chamadas seguintes deste mesmo pedido.
+    const SPEC_GATEWAY_MAX_TOKENS = 32000;
+    const elicitadorClaudeKey = isSpecDraftingPhase ? readSecret(setting?.claudeKey) : "";
+    let elicitadorClaudeFalhou = false;
+    const dispatchSpecWithClaude = async (messages: DispatchMessage[]): Promise<string | null> => {
+      if (!elicitadorClaudeKey || elicitadorClaudeFalhou) return null;
+      const res = await callElicitadorClaude({ messages, claudeKey: elicitadorClaudeKey });
+      if (!res.ok) {
+        elicitadorClaudeFalhou = true;
+        TelemetryLogger.log({ sessionId: activeSessionId, action: "ELICITADOR_CLAUDE", details: { ok: false, detalhe: res.detail } });
+        return null;
+      }
+      await recordLlmCost({ sessionId: activeSessionId, papel: "outro", provider: "anthropic", model: res.model, usage: res.usage });
+      TelemetryLogger.log({
+        sessionId: activeSessionId,
+        action: "ELICITADOR_CLAUDE",
+        details: { ok: true, modelo: res.model, ms: res.ms, stopReason: res.stopReason },
+      });
+      return res.text;
+    };
+
@@ -690 +714,2 @@ export async function POST(request: NextRequest) {
-      const dispatchRes = await smartRouter.dispatchWithFallback({
+      const claudeSpecText = isSpecDraftingPhase ? await dispatchSpecWithClaude(dispatchMessages) : null;
+      const dispatchRes = claudeSpecText !== null ? null : await smartRouter.dispatchWithFallback({
@@ -692,3 +716,0 @@ export async function POST(request: NextRequest) {
-        // Spec: o fundador pediu para não economizar no Elicitador. Tier pesado = modelo forte
-        // pago (DeepSeek) quando configurado; o FreeLLMAPI gratuito é a reserva. Teto de 8192 tokens
-        // para acomodar raciocínio denso e specs ricas (10+ requisitos/módulos) sem truncamento.
@@ -696 +718,2 @@ export async function POST(request: NextRequest) {
-        ...(isSpecDraftingPhase ? { maxTokens: 8192 } : {}),
+        // Spec: Claude Opus direto vem antes (P5c); aqui é a reserva (gateway pago forte, depois o gratuito), com teto de 32.000 tokens.
+        ...(isSpecDraftingPhase ? { maxTokens: SPEC_GATEWAY_MAX_TOKENS } : {}),
@@ -707,14 +730,19 @@ export async function POST(request: NextRequest) {
-      effectiveTier = dispatchRes.tierTag;
-
-      const resJson = await dispatchRes.response.json().catch(() => ({}));
-      if (resJson.choices?.[0]?.message?.content) {
-        aiResponseContent = resJson.choices[0].message.content;
-      } else if (resJson.choices?.[0]?.message?.reasoning_content) {
-        aiResponseContent = resJson.choices[0].message.reasoning_content;
-      } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
-        aiResponseContent = resJson.candidates[0].content.parts[0].text;
-      } else if (typeof resJson.choices?.[0]?.text === "string" && resJson.choices[0].text) {
-        aiResponseContent = resJson.choices[0].text;
-      } else {
-        const errorDetail = resJson.error?.message ? ` (${resJson.error.message})` : "";
-        aiResponseContent = `A resposta do modelo foi retornada sem conteúdo legível${errorDetail}.`;
+      if (claudeSpecText !== null) {
+        aiResponseContent = claudeSpecText;
+        effectiveTier = "anthropic";
+      } else if (dispatchRes) {
+        effectiveTier = dispatchRes.tierTag;
+
+        const resJson = await dispatchRes.response.json().catch(() => ({}));
+        if (resJson.choices?.[0]?.message?.content) {
+          aiResponseContent = resJson.choices[0].message.content;
+        } else if (resJson.choices?.[0]?.message?.reasoning_content) {
+          aiResponseContent = resJson.choices[0].message.reasoning_content;
+        } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
+          aiResponseContent = resJson.candidates[0].content.parts[0].text;
+        } else if (typeof resJson.choices?.[0]?.text === "string" && resJson.choices[0].text) {
+          aiResponseContent = resJson.choices[0].text;
+        } else {
+          const errorDetail = resJson.error?.message ? ` (${resJson.error.message})` : "";
+          aiResponseContent = `A resposta do modelo foi retornada sem conteúdo legível${errorDetail}.`;
+        }
@@ -727 +755 @@ export async function POST(request: NextRequest) {
-        dispatchRes.providerUsed !== "none" &&
+        (claudeSpecText !== null || dispatchRes?.providerUsed !== "none") &&
@@ -730,19 +758,25 @@ export async function POST(request: NextRequest) {
-        const retryRes = await smartRouter.dispatchWithFallback({
-          messages: [
-            ...dispatchMessages,
-            { role: "assistant", content: aiResponseContent.slice(0, 2000) },
-            {
-              role: "user",
-              content:
-                "A resposta acima não é a Spec. Responda AGORA somente com o documento da Spec, começando na primeira linha por --- e com valores reais (sem <placeholders>).",
-            },
-          ],
-          tier: isSpecDraftingPhase ? "heavy" : "fast",
-          maxTokens: 8192,
-          geminiKey: readSecret(setting?.geminiKey),
-          omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
-          omniRouteKey: readSecret(setting?.omniRouteKey),
-          stream: false,
-        });
-        const retryJson = await retryRes.response.json().catch(() => ({}));
-        const retryText: string = retryJson.choices?.[0]?.message?.content || "";
+        const retryMessages: DispatchMessage[] = [
+          ...dispatchMessages,
+          { role: "assistant", content: aiResponseContent.slice(0, 2000) },
+          {
+            role: "user",
+            content:
+              "A resposta acima não é a Spec. Responda AGORA somente com o documento da Spec, começando na primeira linha por --- e com valores reais (sem <placeholders>).",
+          },
+        ];
+        let retryText: string = (await dispatchSpecWithClaude(retryMessages)) ?? "";
+        let retryTier = "anthropic";
+        if (!retryText) {
+          const retryRes = await smartRouter.dispatchWithFallback({
+            messages: retryMessages,
+            tier: isSpecDraftingPhase ? "heavy" : "fast",
+            maxTokens: SPEC_GATEWAY_MAX_TOKENS,
+            geminiKey: readSecret(setting?.geminiKey),
+            omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
+            omniRouteKey: readSecret(setting?.omniRouteKey),
+            stream: false,
+          });
+          const retryJson = await retryRes.response.json().catch(() => ({}));
+          retryText = retryJson.choices?.[0]?.message?.content || "";
+          retryTier = retryRes.tierTag;
+        }
@@ -751 +785 @@ export async function POST(request: NextRequest) {
-          effectiveTier = retryRes.tierTag;
+          effectiveTier = retryTier;
@@ -771,20 +805,24 @@ export async function POST(request: NextRequest) {
-          const fixRes = await smartRouter.dispatchWithFallback({
-            messages: [
-              ...dispatchMessages,
-              { role: "assistant", content: guardRes.finalSpec!.slice(0, 12000) },
-              {
-                role: "user",
-                content:
-                  "A Spec acima tem problemas que impedem a implementação. Corrija TODOS e devolva a Spec completa:\n" +
-                  structureProblems.map((p) => `- ${p}`).join("\n"),
-              },
-            ],
-            tier: isSpecDraftingPhase ? "heavy" : "fast",
-            maxTokens: 8192,
-            geminiKey: readSecret(setting?.geminiKey),
-            omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
-            omniRouteKey: readSecret(setting?.omniRouteKey),
-            stream: false,
-          });
-          const fixJson = await fixRes.response.json().catch(() => ({}));
-          const fixText: string = fixJson.choices?.[0]?.message?.content || "";
+          const fixMessages: DispatchMessage[] = [
+            ...dispatchMessages,
+            { role: "assistant", content: guardRes.finalSpec!.slice(0, 60000) },
+            {
+              role: "user",
+              content:
+                "A Spec acima tem problemas que impedem a implementação. Corrija TODOS e devolva a Spec completa:\n" +
+                structureProblems.map((p) => `- ${p}`).join("\n"),
+            },
+          ];
+          let fixText: string = (await dispatchSpecWithClaude(fixMessages)) ?? "";
+          if (!fixText) {
+            const fixRes = await smartRouter.dispatchWithFallback({
+              messages: fixMessages,
              tier: isSpecDraftingPhase ? "heavy" : "fast",
+              maxTokens: SPEC_GATEWAY_MAX_TOKENS,
+              geminiKey: readSecret(setting?.geminiKey),
+              omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
+              omniRouteKey: readSecret(setting?.omniRouteKey),
+              stream: false,
+            });
+            const fixJson = await fixRes.response.json().catch(() => ({}));
+            fixText = fixJson.choices?.[0]?.message?.content || "";
+          }
```

---

## 4. Escopo (`git diff --stat f52911b..HEAD` real)

```
 src/app/api/chat/route.ts           | 158 ++++++++++++++++++-----------
 src/core/llm/elicitador-claude.ts   | 157 +++++++++++++++++++++++++++++
 tests/llm/elicitador-claude.test.ts | 193 ++++++++++++++++++++++++++++++++++++
 3 files changed, 448 insertions(+), 60 deletions(-)
```

---

## 5. Desvios

- Nenhum desvio. Todo o escopo, arquivos autorizados e comportamento literal foram rigorosamente observados.

---

## 6. Checklist T-A a T-O

- [x] **T-A:** Ponto de partida `f52911b` conferido; `git status --short` limpo antes de iniciar.
- [x] **T-B:** Apenas `src/core/llm/elicitador-claude.ts`, `tests/llm/elicitador-claude.test.ts` e `docs/relatorios/P5c-elicitador-opus-teto.md` criados; apenas `src/app/api/chat/route.ts` alterado nos pontos exatos.
- [x] **T-C:** Literalidade seguida à risca.
- [x] **T-D:** Nomes conferidos com `git grep -n` (`readSecret`, `safeFetch`, `UsageLike`, `recordLlmCost`, `TelemetryLogger`, `DispatchMessage`, `isSpecDraftingPhase`, `activeSessionId`, `parseSpecDocument`).
- [x] **T-E:** Commits por passo (`95f6c23`, `ba893ce`) e commit R do relatório; todos com `tsc --noEmit` (0 erros) e `vitest` completo verde (122 arquivos / 788 testes); sem flags proibidas.
- [x] **T-F:** Nenhum dado gravado em `prisma/dev.db`.
- [x] **T-G:** Nenhum segredo real (valores montados dinamicamente nos testes); chaves nunca expostas em logs/telemetria.
- [x] **T-H:** Nenhum pacote novo instalado.
- [x] **T-I:** Fim de linha preservado em `route.ts` (LF); novos arquivos em LF.
- [x] **T-J:** Nenhuma chamada real à rede nos testes (fetch espionado).
- [x] **T-K:** Commits com trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- [x] **T-L:** Relatório fiel com saídas brutas reais.
- [x] **T-O:** Nenhum plano ou log paralelo.

---

## 7. Sugestões

- Avaliar no futuro se o teto de 32.000 tokens no gateway também deve ser configurável via arquivo de políticas de orquestração caso novos provedores suportem janelas de saída maiores.

---

## 8. Dúvidas

- Nenhuma dúvida em aberto.
