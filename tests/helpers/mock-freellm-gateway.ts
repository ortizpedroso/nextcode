import prisma from "@/lib/prisma";
import { resetGatewayState, saveGatewayConfig } from "@/core/llm/gateways";

export const MOCK_FREELLM_KEY = "freellmapi-test-key";

/** Liga o HTTP mock local como gateway FreeLLMAPI nos testes. */
export async function seedMockFreellmGateway(baseUrl: string) {
  resetGatewayState();
  await prisma.llmGateway.deleteMany({}).catch(() => {});
  const root = baseUrl.replace(/\/+$/, "");
  await saveGatewayConfig("freellmapi", {
    enabled: true,
    priority: 0,
    baseUrl: `${root}/v1`,
    apiKey: MOCK_FREELLM_KEY,
    modelFast: "auto/best-free",
    modelHeavy: "auto:smart",
  });
}

export async function stripByokForMockGateway() {
  await prisma.setting.upsert({
    where: { id: "default" },
    update: {
      geminiKey: null,
      groqKey: null,
      nvidiaKey: null,
      deepseekKey: null,
      customGatewayKey: null,
      customEndpoint: null,
    },
    create: { id: "default" },
  });
}
