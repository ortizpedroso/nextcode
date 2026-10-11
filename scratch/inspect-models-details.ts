import { loadGatewayConfigs } from "../src/core/llm/gateways.js";

async function main() {
  const gateways = await loadGatewayConfigs();
  const free = gateways.find(g => g.id === "freellmapi");
  if (!free) return;

  const res = await fetch("http://localhost:3100/v1/models", {
    headers: { "Authorization": `Bearer ${free.apiKey}` }
  });

  const json = await res.json();
  const claudeItems = (json?.data || []).filter(m => m.id.toLowerCase().includes("claude"));
  console.log("Detalhes dos modelos Claude no FreeLLMAPI:", JSON.stringify(claudeItems, null, 2));

  // Vamos ver outros modelos que funcionam, como nemotron ou deepseek
  const nemotronItems = (json?.data || []).filter(m => m.id.toLowerCase().includes("nemotron"));
  console.log("\nDetalhes dos modelos Nemotron no FreeLLMAPI:", JSON.stringify(nemotronItems.slice(0, 3), null, 2));
}

main().catch(console.error);
