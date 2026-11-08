import { describe, expect, it } from "vitest";
import { transition, type PhaseContext } from "@/core/orchestrator/phase-machine";

describe("PLANO_REPROVADO (T8b)", () => {
  it("bloqueia com retorno previsto à revisão da Spec", () => {
    const ctx: PhaseContext = { phase: "PLANEJAMENTO", rodadasSemClareza: 0, voltasConferencia: 0 };
    const res = transition(ctx, { type: "PLANO_REPROVADO" }, { etapa1Ativa: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ctx.phase).toBe("BLOQUEADA");
    expect(res.ctx.faseAntesDoBloqueio).toBe("SPEC_REVISAO");
  });
});
