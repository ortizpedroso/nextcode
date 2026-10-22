import { describe, it, expect } from "vitest";
import { buildElicitadorSpecSystemPrompt, perfilDirective } from "../../src/core/orchestrator/spec-draft.js";

// J7 (E2, mudança 44): o perfil que o Jev calcula no fan-out muda como o elicitador conversa.
describe("J7 — perfil do usuário no elicitador", () => {
  it("leigo: sem jargão, pergunta pelo comportamento; técnico: direto; sem perfil: prompt igual ao de antes", () => {
    expect(perfilDirective("leigo_ou_negocio")).toContain("sem jargão");
    expect(perfilDirective("desenvolvedor_tecnico")).toContain("direto");
    expect(perfilDirective(null)).toBe("");
    const base = buildElicitadorSpecSystemPrompt("brief");
    expect(buildElicitadorSpecSystemPrompt("brief", null, null)).toBe(base);
    expect(buildElicitadorSpecSystemPrompt("brief", null, "leigo_ou_negocio")).toContain("PERFIL DO USUÁRIO (J7): leigo");
  });
});
