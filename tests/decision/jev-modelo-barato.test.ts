import { describe, it, expect, afterEach, vi } from "vitest";
import * as jevMod from "@/core/decision/jev";
import { decideMicrobriefsPlanningBatch, type MicrobriefPlanningInput } from "@/core/decision/jev-decisions";
import { loadOrchestrationPolicy } from "@/core/config/orchestration-policy";

const singleMicrobrief: MicrobriefPlanningInput = {
  id: "MB-001",
  arquivos: ["src/lib/calc.ts"],
  reqsCobertos: ["REQ-001"],
  resumo: "Implementar soma simples em src/lib/calc.ts",
};

function makeJevBatchForConfidence(confidence: number): Record<string, jevMod.JevBatchAnswer> {
  return {
    "MB-001::complexidade_microbrief": {
      type: "choice",
      choice: "rapido",
      confidence,
      probs: { forte: 0.02, medio: Number((0.98 - confidence).toFixed(4)), rapido: confidence },
    },
    "MB-001::precisa_dividir_microbrief": {
      type: "noul",
      noul: 0.05,
      symmetricConfidence: 0.9,
      probs: { true: 0.05, false: 0.95 },
    },
    "MB-001::cluster_microbrief": {
      type: "choice",
      choice: "core",
      confidence: 0.95,
      probs: { core: 0.95, backend: 0.03, frontend: 0.01, integration: 0.01 },
    },
    "MB-001::skill_apoio_principal": {
      type: "choice",
      choice: "apoio_dominio_typescript",
      confidence: 0.9,
      probs: {
        apoio_dominio_typescript: 0.9,
        apoio_api_rest_validation: 0.05,
        apoio_ui_web_guidelines: 0.02,
        nenhuma_extra: 0.03,
      },
    },
    "MB-001::aplicar_taste_skill_publico": {
      type: "noul",
      noul: 0.01,
      symmetricConfidence: 0.98,
      probs: { true: 0.01, false: 0.99 },
    },
    "MB-001::aplicar_react_perf_critico": {
      type: "noul",
      noul: 0.01,
      symmetricConfidence: 0.98,
      probs: { true: 0.01, false: 0.99 },
    },
  };
}

describe("Passo R1.5 — Jev: modelo barato só com confiança alta; sem Jev, Pro", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rapido com confiança 0.90 → rapido", async () => {
    vi.spyOn(jevMod, "askJevBatch").mockResolvedValue(makeJevBatchForConfidence(0.9));
    const res = await decideMicrobriefsPlanningBatch({
      microbriefs: [singleMicrobrief],
      policy: loadOrchestrationPolicy(),
    });
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe("jev");
    expect(res[0].nivelModelo).toBe("rapido");
  });

  it("rapido com confiança 0.80 → medio", async () => {
    vi.spyOn(jevMod, "askJevBatch").mockResolvedValue(makeJevBatchForConfidence(0.8));
    const res = await decideMicrobriefsPlanningBatch({
      microbriefs: [singleMicrobrief],
      policy: loadOrchestrationPolicy(),
    });
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe("jev");
    expect(res[0].nivelModelo).toBe("medio");
  });

  it("sem Jev, 1 arquivo → medio", async () => {
    vi.spyOn(jevMod, "askJevBatch").mockResolvedValue(null);
    const res = await decideMicrobriefsPlanningBatch({
      microbriefs: [singleMicrobrief],
      policy: loadOrchestrationPolicy(),
    });
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe("fallback");
    expect(res[0].nivelModelo).toBe("medio");
  });

  it("limiar vem da política (0.95 → confiança 0.90 vira medio)", async () => {
    vi.spyOn(jevMod, "askJevBatch").mockResolvedValue(makeJevBatchForConfidence(0.9));
    const basePolicy = loadOrchestrationPolicy();
    const customPolicy = {
      ...basePolicy,
      roteamentoPapeisCriticos: {
        ...basePolicy.roteamentoPapeisCriticos,
        confiancaMinimaModeloBarato: 0.95,
      },
    };
    const res = await decideMicrobriefsPlanningBatch({
      microbriefs: [singleMicrobrief],
      policy: customPolicy,
    });
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe("jev");
    expect(res[0].nivelModelo).toBe("medio");
  });
});
