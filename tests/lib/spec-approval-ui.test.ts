import { describe, expect, it } from "vitest";
import { specSealLiberado, specTravaT1Pendente } from "@/lib/spec-approval-ui";

describe("specTravaT1Pendente", () => {
  it("SPEC_REVISAO exige re-aprovação mesmo com flag true", () => {
    expect(specTravaT1Pendente("SPEC_REVISAO", true)).toBe(true);
  });

  it("EXECUCAO com spec aprovada não está pendente; PLANEJAMENTO sempre pendente", () => {
    expect(specTravaT1Pendente("EXECUCAO", true)).toBe(false);
    expect(specTravaT1Pendente("PLANEJAMENTO", true)).toBe(true);
  });

  it("MACROBRIEF com flag true não libera o selo", () => {
    expect(specTravaT1Pendente("MACROBRIEF", true)).toBe(true);
    expect(specSealLiberado(false, "MACROBRIEF", true)).toBe(false);
  });
});
