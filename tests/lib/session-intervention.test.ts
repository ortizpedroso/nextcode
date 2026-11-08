import { describe, expect, it } from "vitest";
import { sessionNeedsHumanIntervention } from "@/lib/session-intervention";

describe("sessionNeedsHumanIntervention", () => {
  it("só liga em BLOQUEADA", () => {
    expect(sessionNeedsHumanIntervention({ phase: "BLOQUEADA" })).toBe(true);
    expect(sessionNeedsHumanIntervention({ phase: "SPEC_REVISAO" })).toBe(false);
    expect(sessionNeedsHumanIntervention({ phase: "EXECUCAO" })).toBe(false);
    expect(sessionNeedsHumanIntervention({ phase: null })).toBe(false);
  });
});
