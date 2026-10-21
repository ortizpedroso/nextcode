import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import type { GatewayConfig } from "../../src/core/llm/gateways.js";
import {
  gatewaysToProbeForExecutor,
  isAnyLlmGatewayReachable,
  supervisePausedSessions,
} from "../../src/core/orchestrator/job-worker.js";

// SUP1 (mudança 28): com `somente_pago` o executor só sai pelo FreeLLMAPI; a retomada da pausa SEM_LLM
// não pode acontecer só porque o DeepSeek direto responde (teste pesado 314176ef: vaivém PAUSADA ↔ EXECUCAO).

const gw = (id: GatewayConfig["id"]): GatewayConfig => ({
  id,
  enabled: true,
  priority: 0,
  baseUrl: `http://${id}.invalid/v1`,
  apiKey: "k",
  modelFast: null,
  modelHeavy: null,
});

const gateways = [gw("freellmapi"), gw("deepseek"), gw("omniroute")];
const loader = async () => gateways;
const soDeepseekDePe = async (g: GatewayConfig) => g.id === "deepseek";
const freellmapiDePe = async (g: GatewayConfig) => g.id === "freellmapi";

const createdSessionIds: string[] = [];

afterAll(async () => {
  await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
  await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
});

async function sessaoPausadaSemLlm(): Promise<string> {
  const session = await prisma.session.create({
    data: {
      title: "SUP1 sonda de retomada",
      phase: "PAUSADA",
      phaseContext: JSON.stringify({ phase: "PAUSADA", faseAntesDaPausa: "EXECUCAO" }),
    },
  });
  createdSessionIds.push(session.id);
  return session.id;
}

describe("SUP1 — sonda de retomada alinhada ao somente_pago", () => {
  it("somente_pago: só o FreeLLMAPI é sondado; sem somente_pago, todos", () => {
    expect(gatewaysToProbeForExecutor(gateways, true).map((g) => g.id)).toEqual(["freellmapi"]);
    expect(gatewaysToProbeForExecutor(gateways, false).map((g) => g.id)).toEqual(["freellmapi", "deepseek", "omniroute"]);
  });

  it("somente_pago com FreeLLMAPI fora e DeepSeek de pé → não alcançável", async () => {
    expect(await isAnyLlmGatewayReachable({ loader, probe: soDeepseekDePe, paidOnly: async () => true })).toBe(false);
    expect(await isAnyLlmGatewayReachable({ loader, probe: freellmapiDePe, paidOnly: async () => true })).toBe(true);
  });

  it("sem somente_pago o comportamento antigo continua: qualquer gateway de pé basta", async () => {
    expect(await isAnyLlmGatewayReachable({ loader, probe: soDeepseekDePe, paidOnly: async () => false })).toBe(true);
  });

  it("sessão pausada continua PAUSADA com FreeLLMAPI fora; volta a EXECUCAO quando ele responde", async () => {
    const id = await sessaoPausadaSemLlm();

    const fora = await supervisePausedSessions(() =>
      isAnyLlmGatewayReachable({ loader, probe: soDeepseekDePe, paidOnly: async () => true })
    );
    expect(fora).toBe(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id } })).phase).toBe("PAUSADA");

    const voltou = await supervisePausedSessions(() =>
      isAnyLlmGatewayReachable({ loader, probe: freellmapiDePe, paidOnly: async () => true })
    );
    expect(voltou).toBeGreaterThanOrEqual(1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id } })).phase).toBe("EXECUCAO");
  });
});
