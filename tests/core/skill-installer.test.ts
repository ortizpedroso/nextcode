import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  convertGithubUrlToRaw,
  getGithubRawCandidateUrls,
  parseSkillContent,
  installSkillFromGithub,
} from "@/core/skills/skill-installer";

let tmpDir = "";

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-skills-test-"));
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("skill-installer — getGithubRawCandidateUrls", () => {
  it("converte URL de blob do GitHub para raw.githubusercontent.com", () => {
    const blobUrl = "https://github.com/user/repo/blob/main/skills/SKILL.md";
    const raw = convertGithubUrlToRaw(blobUrl);
    expect(raw).toBe("https://raw.githubusercontent.com/user/repo/main/skills/SKILL.md");
  });

  it("gera candidatos para URL de repositório (main, master, SKILL.md, .cursorrules)", () => {
    const repoUrl = "https://github.com/user/my-skill-repo";
    const candidates = getGithubRawCandidateUrls(repoUrl);
    expect(candidates).toContain("https://raw.githubusercontent.com/user/my-skill-repo/main/SKILL.md");
    expect(candidates).toContain("https://raw.githubusercontent.com/user/my-skill-repo/master/SKILL.md");
    expect(candidates).toContain("https://raw.githubusercontent.com/user/my-skill-repo/main/.cursorrules");
  });

  it("suporta URLs de Gists do GitHub", () => {
    const gistUrl = "https://gist.github.com/user/1234567890abcdef";
    const candidates = getGithubRawCandidateUrls(gistUrl);
    expect(candidates[0]).toBe("https://gist.githubusercontent.com/user/1234567890abcdef/raw");
  });
});

describe("skill-installer — parseSkillContent", () => {
  it("detecta skill com frontmatter do Google/Antigravity", () => {
    const content = `---
name: code-reviewer
description: Skill de revisão de código para Google Antigravity
---
Instruções para revisão de PRs.`;

    const parsed = parseSkillContent(content, "SKILL.md");
    expect(parsed.detectedType).toBe("google");
    expect(parsed.skillName).toBe("code-reviewer");
    expect(parsed.description).toContain("revisão de código");
  });

  it("detecta skill do Claude Code com frontmatter", () => {
    const content = `---
name: claude-assistant
description: Skill para Claude Code
---
Instruções para o Claude.`;

    const parsed = parseSkillContent(content, "SKILL.md");
    expect(parsed.detectedType).toBe("claude");
    expect(parsed.skillName).toBe("claude-assistant");
  });

  it("detecta regra do Cursor (.cursorrules ou .mdc)", () => {
    const content = "Regras de estilo de código do projeto em TypeScript.";
    const parsed = parseSkillContent(content, "my-rules.mdc");
    expect(parsed.detectedType).toBe("cursor");
    expect(parsed.skillName).toBe("my-rules");
  });
});

describe("skill-installer — gravação local no diretório do projeto", () => {
  it("instala skill no formato Google Antigravity em .gemini/skills/<nome>/SKILL.md", async () => {
    const mockContent = `---
name: unit-test-builder
description: Gera testes unitários com Vitest
---
Instruções de teste.`;

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(mockContent, { status: 200, headers: { "Content-Type": "text/plain" } });

    try {
      const result = await installSkillFromGithub({
        url: "https://github.com/user/unit-test-builder",
        projectPath: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.skillName).toBe("unit-test-builder");
      expect(result.detectedType).toBe("google");

      const expectedPath = path.join(tmpDir, ".gemini", "skills", "unit-test-builder", "SKILL.md");
      expect(fs.existsSync(expectedPath)).toBe(true);

      const savedContent = fs.readFileSync(expectedPath, "utf8");
      expect(savedContent).toContain("unit-test-builder");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("instala regras do Cursor em .cursor/rules/<nome>.mdc", async () => {
    const mockContent = "Instruções do Cursor.";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(mockContent, { status: 200, headers: { "Content-Type": "text/plain" } });

    try {
      const result = await installSkillFromGithub({
        url: "https://github.com/user/repo/blob/main/rules.mdc",
        projectPath: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.detectedType).toBe("cursor");

      const expectedPath = path.join(tmpDir, ".cursor", "rules", "rules.mdc");
      expect(fs.existsSync(expectedPath)).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retorna mensagem de erro detalhada em caso de 404", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response("", { status: 404 });

    try {
      await expect(
        installSkillFromGithub({
          url: "https://github.com/user/repo-inexistente",
          projectPath: tmpDir,
        })
      ).rejects.toThrow("HTTP 404");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
