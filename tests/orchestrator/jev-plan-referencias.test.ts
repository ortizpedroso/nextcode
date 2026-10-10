import { describe, it, expect } from "vitest";
import { withJevPlan } from "@/core/orchestrator/execution-trigger";
import type { MicrobriefPlanningDecision } from "@/core/decision/jev-decisions";

describe("S1.2 — jev-plan-referencias.test.ts", () => {
  it("jevPlan guarda aplicarTasteSkillPublico e aplicarReactPerfCritico", () => {
    const decision: MicrobriefPlanningDecision = {
      id: "node-1",
      nivelModelo: "pesado",
      precisaDividir: false,
      divisaoPorJev: false,
      cluster: "frontend",
      skillApoioPrincipal: "nenhuma_extra",
      aplicarTasteSkillPublico: true,
      aplicarReactPerfCritico: false,
      source: "jev",
    };

    const payload = withJevPlan({ outroDado: 123 }, decision);
    expect(payload.jevPlan).toEqual({
      nivelModelo: "pesado",
      source: "jev",
      precisaDividir: false,
      clusterSugerido: "frontend",
      aplicarTasteSkillPublico: true,
      aplicarReactPerfCritico: false,
    });
  });

  it("etapa sem jevPlan → fallback seguro", () => {
    // Quando decision é undefined, payload não ganha jevPlan
    const payload = withJevPlan({ outroDado: 456 }, undefined);
    expect(payload.jevPlan).toBeUndefined();

    // A leitura de nodePayload em node-executor:
    // isPublicPage: Boolean(nodePayload.jevPlan?.aplicarTasteSkillPublico) -> false
    // includeReactPerf: nodePayload.jevPlan?.aplicarReactPerfCritico ?? true -> true
    const jevPlan = (payload as any).jevPlan;
    const isPublicPage = Boolean(jevPlan?.aplicarTasteSkillPublico);
    const includeReactPerf = jevPlan?.aplicarReactPerfCritico ?? true;

    expect(isPublicPage).toBe(false);
    expect(includeReactPerf).toBe(true);
  });
});
