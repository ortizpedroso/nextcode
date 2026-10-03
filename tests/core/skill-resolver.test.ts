import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveSkillOrCommand, findSkillContent } from "@/core/skills/skill-resolver";
import prisma from "@/lib/prisma";

let tmpDir = "";

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-resolver-test-"));

  // Criar uma skill de teste em .gemini/skills/my-code-reviewer/SKILL.md
  const skillFolder = path.join(tmpDir, ".gemini", "skills", "my-code-reviewer");
  fs.mkdirSync(skillFolder, { recursive: true });
  fs.writeFileSync(
    path.join(skillFolder, "SKILL.md"),
    `---
name: my-code-reviewer
description: Skill de teste para revisão
---
Siga as regras de clean code e SOLID.`
  );
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("skill-resolver — findSkillContent", () => {
  it("encontra o conteúdo da skill instalada no diretório do projeto", () => {
    const res = findSkillContent("my-code-reviewer", tmpDir);
    expect(res).not.toBeNull();
    expect(res!.content).toContain("SOLID");
    expect(res!.type).toBe("google");
  });

  it("retorna null se a skill não existir", () => {
    const res = findSkillContent("non-existent-skill", tmpDir);
    expect(res).toBeNull();
  });
});

describe("skill-resolver — resolveSkillOrCommand", () => {
  it("ignora prompts comuns que não começam com /", async () => {
    const res = await resolveSkillOrCommand("Criar uma API em Node", tmpDir);
    expect(res.isSkillOrCommand).toBe(false);
  });

  it("resolve comando embutido /plan", async () => {
    const res = await resolveSkillOrCommand("/plan Refatorar módulo de autenticação", tmpDir);
    expect(res.isSkillOrCommand).toBe(true);
    expect(res.commandName).toBe("plan");
    expect(res.userRequest).toBe("Refatorar módulo de autenticação");
    expect(res.skillBlock).toContain("EXECUÇÃO DE COMANDO: /plan");
  });

  it("resolve comando embutido /goal", async () => {
    const res = await resolveSkillOrCommand("/goal Criar SaaS de automação", tmpDir);
    expect(res.isSkillOrCommand).toBe(true);
    expect(res.commandName).toBe("goal");
    expect(res.userRequest).toBe("Criar SaaS de automação");
    expect(res.skillBlock).toContain("EXECUÇÃO DE COMANDO: /goal");
  });

  it("resolve skill personalizada instalada /my-code-reviewer com pedido do usuário", async () => {
    const res = await resolveSkillOrCommand("/my-code-reviewer revise este arquivo index.ts", tmpDir);
    expect(res.isSkillOrCommand).toBe(true);
    expect(res.commandName).toBe("my-code-reviewer");
    expect(res.userRequest).toBe("revise este arquivo index.ts");
    expect(res.skillBlock).toContain("EXECUÇÃO ATIVA DA SKILL: /my-code-reviewer");
    expect(res.skillBlock).toContain("SOLID");
    expect(res.skillBlock).toContain("RELATÓRIO DE RESULTADOS & EXCEÇÕES");
  });

  it("bloqueia execução quando a skill github foi desativada pelo operador", async () => {
    const proposal = await prisma.candidateSkillProposal.create({
      data: {
        name: "my-code-reviewer",
        description: "Skill de teste para revisão",
        triggerPattern: "/my-code-reviewer",
        sampleContent: "Siga as regras de clean code e SOLID.",
        status: "disabled",
        source: "github",
        installedPath: path.join(tmpDir, ".gemini", "skills", "my-code-reviewer", "SKILL.md"),
      },
    });

    try {
      const res = await resolveSkillOrCommand("/my-code-reviewer revise este arquivo index.ts", tmpDir);
      expect(res.isSkillOrCommand).toBe(true);
      expect(res.skillBlock).toContain("BLOQUEADA PELO OPERADOR");
    } finally {
      await prisma.candidateSkillProposal.delete({ where: { id: proposal.id } });
    }
  });
});
