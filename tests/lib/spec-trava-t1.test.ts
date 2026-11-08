import { describe, expect, it } from "vitest";
import {
  phaseInPlanoEmCurso,
  phaseRequiresSpecReapproval,
  specApprovalFlagStuck,
  specApprovalShouldRestore,
  specEffectivelyApproved,
  specSealLiberado,
  specTravaT1Pendente,
} from "@/core/orchestrator/spec-trava-t1";

describe("spec-trava-t1 (plataforma)", () => {
  it("SPEC_REVISAO e BLOQUEADA exigem reaprovação na UI", () => {
    expect(phaseRequiresSpecReapproval("SPEC_REVISAO")).toBe(true);
    expect(phaseRequiresSpecReapproval("BLOQUEADA")).toBe(true);
    expect(phaseRequiresSpecReapproval("EXECUCAO")).toBe(false);
  });

  it("specTravaT1Pendente ignora specApproved em revisão, bloqueio e planejamento sem commit", () => {
    expect(specTravaT1Pendente("SPEC_REVISAO", true)).toBe(true);
    expect(specTravaT1Pendente("BLOQUEADA", true)).toBe(true);
    expect(specTravaT1Pendente("PLANEJAMENTO", false)).toBe(true);
    expect(specTravaT1Pendente("PLANEJAMENTO", true)).toBe(true);
    expect(specTravaT1Pendente(null, true)).toBe(true);
    expect(specTravaT1Pendente("EXECUCAO", true)).toBe(false);
  });

  it("specEffectivelyApproved falso em BLOQUEADA mesmo com flag true", () => {
    expect(specEffectivelyApproved("BLOQUEADA", true)).toBe(false);
    expect(specEffectivelyApproved("EXECUCAO", true)).toBe(true);
  });

  it("MACROBRIEF e CONFERENCIA ficam pendentes com a flag ainda true", () => {
    expect(specTravaT1Pendente("MACROBRIEF", true)).toBe(true);
    expect(specTravaT1Pendente("CONFERENCIA", true)).toBe(true);
    expect(specEffectivelyApproved("MACROBRIEF", true)).toBe(false);
    expect(specApprovalFlagStuck("MACROBRIEF", true)).toBe(true);
    expect(specApprovalFlagStuck("EXECUCAO", true)).toBe(false);
    expect(specApprovalFlagStuck("PLANEJAMENTO", false)).toBe(false);
    expect(
      specApprovalFlagStuck("BLOQUEADA", true, {
        faseAntesDoBloqueio: "EXECUCAO",
        activeTasksForCurrentVersion: 33,
      })
    ).toBe(false);
    expect(
      specApprovalShouldRestore("BLOQUEADA", false, {
        faseAntesDoBloqueio: "EXECUCAO",
        activeTasksForCurrentVersion: 33,
      })
    ).toBe(true);
    expect(
      specApprovalShouldRestore("BLOQUEADA", false, {
        faseAntesDoBloqueio: "SPEC_REVISAO",
        activeTasksForCurrentVersion: 0,
      })
    ).toBe(false);
  });

  it("MACROBRIEF, CONFERENCIA e PLANEJAMENTO são plano em curso, não recusa de concorrência", () => {
    expect(phaseInPlanoEmCurso("MACROBRIEF")).toBe(true);
    expect(phaseInPlanoEmCurso("CONFERENCIA")).toBe(true);
    expect(phaseInPlanoEmCurso("PLANEJAMENTO")).toBe(true);
    expect(phaseInPlanoEmCurso("SPEC_REVISAO")).toBe(false);
    expect(phaseInPlanoEmCurso("EXECUCAO")).toBe(false);
    expect(phaseInPlanoEmCurso("BLOQUEADA")).toBe(false);
  });

  it("selo verde exige fase de execução; travaT1Pendente false sozinho não libera", () => {
    expect(specSealLiberado(false, "MACROBRIEF", true)).toBe(false);
    expect(specSealLiberado(false, "PLANEJAMENTO", true)).toBe(false);
    expect(specSealLiberado(true, "EXECUCAO", true)).toBe(false);
    expect(specSealLiberado(false, "EXECUCAO", true)).toBe(true);
    expect(specSealLiberado(undefined, "EXECUCAO", true)).toBe(true);
    expect(specSealLiberado(undefined, "MACROBRIEF", true)).toBe(false);
  });
});
