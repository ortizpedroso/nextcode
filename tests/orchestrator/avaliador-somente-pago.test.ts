import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SmartRouter, type DispatchOptions, type DispatchResult } from "@/core/router/smart-router";
import * as evaluatorModelsMod from "@/core/llm/evaluator-models";
import * as orchestrationPolicyMod from "@/core/config/orchestration-policy";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import {
  makeBlindAuditDispatchFn,
  setPaidOnlyRoutingForTests,
} from "@/core/orchestrator/node-executor";

describe("Passo R1.4 — Avaliador sem queda para o gratuito", () => {
  beforeEach(() => {
    setPaidOnlyRoutingForTests(null);
  });

  afterEach(() => {
    setPaidOnlyRoutingForTests(null);
    vi.restoreAllMocks();
  });

  it("avaliador pago falha → não chama a rota gratuita e devolve null", async () => {
    vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    vi.spyOn(evaluatorModelsMod, "dispatchStrongEvaluator").mockResolvedValue({
      content: null,
      provider: null,
      model: null,
      independent: false,
      failures: ["gemini: sem chave", "claude: sem chave", "deepseek: sem chave"],
    });

    const router = new SmartRouter();
    const dispatchSpy = vi.spyOn(router, "dispatchWithFallback");
    const dispatchFn = makeBlindAuditDispatchFn(router, null, "sess-r1-4");

    const res = await dispatchFn([{ role: "user", content: "audite este código" }]);
    expect(res).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("EVALUATOR_MODEL registra provider nenhum-pago", async () => {
    const logs: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      logs.push(entry);
    });
    vi.spyOn(evaluatorModelsMod, "dispatchStrongEvaluator").mockResolvedValue({
      content: null,
      provider: null,
      model: null,
      independent: false,
      failures: ["deepseek: timeout"],
    });

    const router = new SmartRouter();
    vi.spyOn(router, "dispatchWithFallback");
    const dispatchFn = makeBlindAuditDispatchFn(router, null, "sess-r1-4");

    await dispatchFn([{ role: "user", content: "audite este código" }]);
    const evalLogs = logs.filter((l) => l.action === "EVALUATOR_MODEL");
    expect(evalLogs).toHaveLength(1);
    expect(evalLogs[0]).toEqual({
      sessionId: "sess-r1-4",
      action: "EVALUATOR_MODEL",
      details: {
        provider: "nenhum-pago",
        model: null,
        independentFromExecutor: false,
        failures: ["deepseek: timeout"],
      },
    });
  });

  it("somentePago false → mantém a rota gratuita (comportamento antigo)", async () => {
    const logs: any[] = [];
    vi.spyOn(TelemetryLogger, "log").mockImplementation((entry) => {
      logs.push(entry);
    });
    const basePolicy = orchestrationPolicyMod.loadOrchestrationPolicy();
    vi.spyOn(orchestrationPolicyMod, "loadOrchestrationPolicy").mockReturnValue({
      ...basePolicy,
      roteamentoPapeisCriticos: {
        ...basePolicy.roteamentoPapeisCriticos,
        somentePago: false,
      },
    });
    vi.spyOn(evaluatorModelsMod, "dispatchStrongEvaluator").mockResolvedValue({
      content: null,
      provider: null,
      model: null,
      independent: false,
      failures: ["sem chave"],
    });

    const router = new SmartRouter();
    const dispatchSpy = vi
      .spyOn(router, "dispatchWithFallback")
      .mockImplementation(async (_opts: DispatchOptions): Promise<DispatchResult> => ({
        response: new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"verdict":"APROVADO"}' } }],
          })
        ),
        providerUsed: "freellmapi",
        badge: "",
        tierTag: "freellmapi",
        modelUsed: "auto:fast",
      }));

    const dispatchFn = makeBlindAuditDispatchFn(router, null, "sess-r1-4");
    const res = await dispatchFn([{ role: "user", content: "audite este código" }]);

    expect(res).toBe('{"verdict":"APROVADO"}');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0][0].tier).toBe("fast");

    const evalLogs = logs.filter((l) => l.action === "EVALUATOR_MODEL");
    expect(evalLogs).toHaveLength(1);
    expect(evalLogs[0].details.provider).toBe("freellmapi-fallback");
  });
});
