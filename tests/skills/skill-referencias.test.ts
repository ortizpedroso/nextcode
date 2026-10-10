import { describe, it, expect } from "vitest";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";

describe("S1.2 — skill-referencias.test.ts", () => {
  it("as 4 referências do avaliador-frontend estão declaradas e existem", () => {
    const skill = loadRoleSkill("skills/avaliador-frontend/SKILL.md");
    expect(skill.referenciasLocaisFixas).toHaveLength(4);

    const caminhos = skill.referenciasLocaisFixas.map((r) => r.caminho);
    expect(caminhos).toContain("skills/avaliador-frontend/references/web-interface-guidelines-command.md");
    expect(caminhos).toContain("skills/avaliador-frontend/references/react-best-practices-critical-high.md");
    expect(caminhos).toContain("skills/avaliador-frontend/references/ui-ux-pro-max-checklist.md");
    expect(caminhos).toContain("skills/avaliador-frontend/references/taste-skill-preflight-publico.md");

    // Todas as 4 devem ter sido lidas com sucesso do disco
    expect(Object.keys(skill.resolvedReferencesContent)).toHaveLength(4);
    for (const caminho of caminhos) {
      expect(skill.resolvedReferencesContent[caminho]).toBeTruthy();
    }
  });

  it("página pública inclui taste-skill; dashboard não", () => {
    const skill = loadRoleSkill("skills/avaliador-frontend/SKILL.md");

    // Dashboard (não pública)
    const promptDashboard = buildSkillSystemPrompt(skill, {
      includeLocalReferences: true,
      includeTasteSkillPublic: false,
    });
    expect(promptDashboard).not.toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/taste-skill-preflight-publico.md)");
    expect(promptDashboard).toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/web-interface-guidelines-command.md)");

    // Página pública
    const promptPublic = buildSkillSystemPrompt(skill, {
      includeLocalReferences: true,
      includeTasteSkillPublic: true,
    });
    expect(promptPublic).toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/taste-skill-preflight-publico.md)");
    expect(promptPublic).toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/web-interface-guidelines-command.md)");
  });

  it("includeReactPerf false tira react-best-practices", () => {
    const skill = loadRoleSkill("skills/avaliador-frontend/SKILL.md");

    const promptSemReact = buildSkillSystemPrompt(skill, {
      includeLocalReferences: true,
      includeReactPerf: false,
    });
    expect(promptSemReact).not.toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/react-best-practices-critical-high.md)");
    expect(promptSemReact).toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/web-interface-guidelines-command.md)");

    const promptComReact = buildSkillSystemPrompt(skill, {
      includeLocalReferences: true,
      includeReactPerf: true,
    });
    expect(promptComReact).toContain("REFERÊNCIA LOCAL FIXA (skills/avaliador-frontend/references/react-best-practices-critical-high.md)");
  });
});
