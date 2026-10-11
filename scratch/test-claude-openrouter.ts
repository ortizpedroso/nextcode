export async function testClaudeViaOpenRouter(openRouterKey: string) {
  console.log(`\n=== Testando Claude 3.5 Sonnet via OpenRouter ===`);
  const models = [
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-3-haiku",
  ];

  for (const model of models) {
    try {
      console.log(`\nDisparando para o modelo: ${model}...`);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "NextCode Evaluator Engine",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: "Responda exatamente: CLAUDE_VIA_OPENROUTER_ONLINE",
            },
          ],
          max_tokens: 30,
        }),
      });

      console.log(`Status HTTP: ${res.status}`);
      const json = await res.json().catch(() => null);

      if (res.ok) {
        console.log("✅ Resposta com Sucesso!");
        console.log("Conteúdo:", json?.choices?.[0]?.message?.content);
        console.log("Modelo que respondeu:", json?.model);
        console.log("Tokens usados:", json?.usage);
        return { ok: true, model: json?.model, content: json?.choices?.[0]?.message?.content };
      } else {
        console.log("❌ Falha na resposta:", JSON.stringify(json, null, 2));
      }
    } catch (err: any) {
      console.log("Erro na requisição:", err.message);
    }
  }

  return { ok: false };
}

// Se uma chave for passada via linha de comando:
const cliKey = process.argv[2];
if (cliKey) {
  testClaudeViaOpenRouter(cliKey);
}
