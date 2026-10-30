import { describe, it, expect } from "vitest";
import { pickBlockedCulprit } from "@/core/orchestrator/blocked-culprit";

// G3: teste real 4d019f00 — a dependente bloqueada pela cascata (mais recente) era apontada como culpada.
describe("pickBlockedCulprit — relatório de incidente aponta a etapa que falhou", () => {
  it("pula a dependente sem tentativa própria, mesmo sendo a mais recente", () => {
    const dependente = { id: "dep", failureHistory: "[]" };
    const culpada = { id: "falhou", failureHistory: JSON.stringify([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }]) };
    expect(pickBlockedCulprit([dependente, culpada])?.id).toBe("falhou");
  });

  it("sem histórico em nenhuma → a mais recente (comportamento antigo)", () => {
    expect(pickBlockedCulprit([{ id: "a", failureHistory: null }, { id: "b", failureHistory: "[]" }])?.id).toBe("a");
    expect(pickBlockedCulprit([])).toBeUndefined();
  });
});
