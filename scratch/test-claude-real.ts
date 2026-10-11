import { loadGatewayConfigs } from "../src/core/llm/gateways.js";

async function testModel(modelName) {
  const gateways = await loadGatewayConfigs();
  const free = gateways.find(g => g.id === "freellmapi");
  if (!free) return;

  console.log(`\n=== Testando modelo ${modelName} ===`);
  const res = await fetch("http://localhost:3100/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${free.apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: "Diga apenas: 'CLAUDE RESPONDEU'" }],
      max_tokens: 30
    })
  });

  const routedVia = res.headers.get("x-routed-via") || res.headers.get("x-model") || "n/a";
  const json = await res.json().catch(() => null);
  console.log("Status HTTP:", res.status);
  console.log("X-Routed-Via:", routedVia);
  console.log("Resposta:", JSON.stringify(json, null, 2));
}

async function main() {
  await testModel("claude-sonnet-4-5");
  await testModel("claude-haiku-4-5");
  await testModel("claude-opus-4-5");
}

main().catch(console.error);
