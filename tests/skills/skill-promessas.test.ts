import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadRoleSkill, buildSkillSystemPrompt } from "../../src/core/skills/skill-runtime";

describe("S1.3 — Promessas das Skills e Avaliador de Frontend", () => {
  it("ferramentas de cada executor existem no laço de ferramentas", () => {
    const FERRAMENTAS_LACO = [
      "read_file",
      "list_files",
      "grep",
      "write_file",
      "edit_file",
      "run_check",
      "finish",
    ];

    const executores = [
      "executor-core",
      "executor-backend",
      "executor-frontend",
      "executor-integration",
    ];

    for (const name of executores) {
      const skill = loadRoleSkill(name);
      expect(skill.ferramentas.length).toBeGreaterThan(0);
      for (const tool of skill.ferramentas) {
        expect(FERRAMENTAS_LACO).toContain(tool);
      }
    }
  });

  it("avaliadores não declaram ferramentas", () => {
    const avaliadores = [
      "avaliador",
      "avaliador-core",
      "avaliador-backend",
      "avaliador-frontend",
      "avaliador-integration",
    ];

    for (const name of avaliadores) {
      const skill = loadRoleSkill(name);
      expect(skill.ferramentas).toEqual([]);
    }
  });

  it("nenhuma skill cita playwright_cli_readonly", () => {
    const skillsDir = path.resolve(process.cwd(), "skills");
    const subdirs = fs.readdirSync(skillsDir);

    for (const dir of subdirs) {
      const skillFile = path.join(skillsDir, dir, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, "utf8");
        expect(content).not.toContain("playwright_cli_readonly");
      }
    }
  });

  it("toda referência declarada existe e todo arquivo em references/ está declarado", () => {
    const skillsDir = path.resolve(process.cwd(), "skills");
    const subdirs = fs.readdirSync(skillsDir);

    for (const dir of subdirs) {
      const skillFile = path.join(skillsDir, dir, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const skill = loadRoleSkill(dir);

      for (const ref of skill.referenciasLocaisFixas) {
        const fullPath = path.resolve(process.cwd(), ref.caminho);
        expect(
          fs.existsSync(fullPath),
          `Referência declarada não encontrada em disco: ${ref.caminho}`
        ).toBe(true);
      }

      const referencesDir = path.join(skillsDir, dir, "references");
      if (fs.existsSync(referencesDir)) {
        const files = fs.readdirSync(referencesDir);
        const declared = new Set(
          skill.referenciasLocaisFixas.map((r) =>
            path.normalize(r.caminho).replace(/\\/g, "/")
          )
        );

        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const relPath = `skills/${dir}/references/${file}`;
          expect(
            declared.has(relPath),
            `Arquivo em references/ não declarado em SKILL.md: ${relPath}`
          ).toBe(true);
        }
      }
    }
  });

  it("texto do avaliador-frontend: dashboard ≤ 40000 caracteres; página pública = dashboard + referência taste-skill", () => {
    const evalFront = loadRoleSkill("avaliador-frontend");

    const promptDashboard = buildSkillSystemPrompt(evalFront, {
      includeLocalReferences: true,
      includeTasteSkillPublic: false,
    });
    expect(promptDashboard.length).toBeLessThanOrEqual(40000);

    const promptPublico = buildSkillSystemPrompt(evalFront, {
      includeLocalReferences: true,
      includeTasteSkillPublic: true,
    });

    const tastePath = "skills/avaliador-frontend/references/taste-skill-preflight-publico.md";
    const tasteContent = evalFront.resolvedReferencesContent[tastePath];
    expect(tasteContent).toBeDefined();

    const expectedBlock = `\n\n--- REFERÊNCIA LOCAL FIXA (${tastePath}) ---\n${tasteContent}`;
    expect(promptPublico).toBe(promptDashboard + expectedBlock);
  });
});
