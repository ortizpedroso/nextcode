import { describe, it, expect } from "vitest";
import { transition, initialContext, type PhaseContext, type PhaseEffect } from "@/core/orchestrator/phase-machine";
import { humanActionText } from "@/core/orchestrator/human-notice";
import { isResumeCommand } from "@/core/orchestrator/session-resume";

const at = (phase: PhaseContext["phase"]): PhaseContext => ({ ...initialContext(), phase });
const aviso = (effects: PhaseEffect[]) => effects.find((e) => e.type === "AVISAR_HUMANO") as Extract<PhaseEffect, { type: "AVISAR_HUMANO" }> | undefined;

describe("mudanças 35 e 36 — falha de ambiente e aviso conforme a causa", () => {
  it("FALHA_AMBIENTE na verificação → BLOQUEADA com Retomar (volta à execução)", () => {
    const r = transition(at("VERIFICACAO"), { type: "FALHA_AMBIENTE" }, { etapa1Ativa: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ctx.phase).toBe("BLOQUEADA");
    expect(r.ctx.faseAntesDoBloqueio).toBe("EXECUCAO");
    expect(aviso(r.effects)?.acao).toBe("retomar");
  });

  it("cada causa leva a ação certa", () => {
    const casos: Array<[PhaseContext["phase"], Parameters<typeof transition>[1], string]> = [
      ["EXECUCAO", { type: "TETO_CUSTO" }, "autorizar_verba"],
      ["EXECUCAO", { type: "EXECUTOR_BLOQUEADO" }, "retentar_etapa"],
      ["EXECUCAO", { type: "FALHA_REPETIDA" }, "retomar"],
      ["EXECUCAO", { type: "SILENCIO_DETECTADO" }, "retomar"],
      ["VERIFICACAO", { type: "VERIFICACAO_COM_LACUNAS" }, "ajustar_spec"],
      ["PLANEJAMENTO", { type: "PLANO_REPROVADO" }, "ajustar_spec"],
    ];
    for (const [fase, ev, acao] of casos) {
      const r = transition(at(fase), ev, { etapa1Ativa: false });
      expect(r.ok, `${fase} ${ev.type}`).toBe(true);
      if (r.ok) expect(aviso(r.effects)?.acao, `${fase} ${ev.type}`).toBe(acao);
    }
  });

  it("texto do aviso: Retomar não manda revisar a Spec", () => {
    expect(humanActionText("retomar")).toContain("Retomar");
    expect(humanActionText("retomar")).not.toMatch(/Spec volta para revisão/);
    expect(humanActionText("autorizar_verba")).toContain("Autorizar");
    expect(humanActionText("ajustar_spec")).toMatch(/Spec volta para revisão/);
  });

  it("'retomar' sozinho no chat é o comando; frase com retomar não é", () => {
    expect(isResumeCommand("retomar")).toBe(true);
    expect(isResumeCommand("  Retomar! ")).toBe(true);
    expect(isResumeCommand("retomar o projeto mudando a tela")).toBe(false);
  });
});
