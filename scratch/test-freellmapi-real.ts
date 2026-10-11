import { loadGatewayConfigs, callGateway } from "../src/core/llm/gateways.js";
import { dispatchStrongEvaluator } from "../src/core/llm/evaluator-models.js";

async function main() {
  console.log("--- Carregando Gateways ---");
  const gateways = await loadGatewayConfigs();
  console.log("Gateways carregados:", gateways.map(g => ({ id: g.id, baseUrl: g.baseUrl, modelFast: g.modelFast, modelHeavy: g.modelHeavy, keyLen: g.apiKey.length })));

  const free = gateways.find(g => g.id === "freellmapi");
  if (!free) {
    console.log("FreeLLMAPI não encontrado!");
    return;
  }

  console.log("\n--- Testando chamada direta no FreeLLMAPI com claude-sonnet-4-5 ---");
  const res = await callGateway(free, {
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "Por favor, responda apenas: CLAUDE_OPERACIONAL" }],
    stream: false,
    maxTokens: 20
  });

  console.log("Status callGateway:", res.ok ? "OK" : "FALHA");
  if (res.ok) {
    console.log("HTTP status:", res.response.status);
    console.log("Served By:", res.servedBy);
    const json = await res.response.json().catch(() => ({}));
    console.log("Resposta JSON:", JSON.stringify(json, null, 2));
  } else {
    console.log("Falha no Gateway:", { kind: res.kind, status: res.status, detail: res.detail });
  }

  console.log("\n--- Testando dispatchStrongEvaluator com preferIndependentFirst (Claude prioritário) ---");
  const evalRes = await dispatchStrongEvaluator(
    [{ role: "user", content: "Confirme que o avaliador está online respondendo: AVALIADOR_PRONTO" }],
    { preferIndependentFirst: true, executorFamily: "deepseek" }
  );
  console.log("Resultado dispatchStrongEvaluator:", {
    provider: evalRes.provider,
    model: evalRes.model,
    independent: evalRes.independent,
    failures: evalRes.failures,
    content: evalRes.content?.slice(0, 100),
  });
}

main().catch(console.error);
