import { loadGatewayConfigs } from "../src/core/llm/gateways.js";

async function main() {
  const gateways = await loadGatewayConfigs();
  const free = gateways.find(g => g.id === "freellmapi");
  if (!free) return;

  const res = await fetch("http://localhost:3100/v1/models", {
    headers: {
      "Authorization": `Bearer ${free.apiKey}`
    }
  });

  const json = await res.json();
  console.log("Status:", res.status);
  console.log("Total de modelos:", json?.data?.length || 0);
  const models = (json?.data || []).map(m => m.id);
  console.log("\nTodos os modelos no FreeLLMAPI:");
  console.log(models);

  const claudeModels = models.filter(m => m.toLowerCase().includes("claude") || m.toLowerCase().includes("anthropic") || m.toLowerCase().includes("sonnet"));
  console.log("\nModelos Claude encontrados:", claudeModels);
}

main().catch(console.error);
