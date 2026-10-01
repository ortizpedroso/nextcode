import * as fs from "fs";
import * as path from "path";

export interface InstalledSkillResult {
  success: boolean;
  detectedType: "google" | "claude" | "cursor" | "codex" | "generic";
  skillName: string;
  description: string;
  installedPath: string;
  message?: string;
}

export function convertGithubUrlToRaw(url: string): string {
  const candidates = getGithubRawCandidateUrls(url);
  return candidates[0] || url;
}

export function getGithubRawCandidateUrls(url: string): string[] {
  let cleaned = url.trim();

  // Se for Gist: https://gist.github.com/user/gist_id
  if (cleaned.includes("gist.github.com")) {
    const gistMatch = cleaned.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/i);
    if (gistMatch) {
      return [
        `https://gist.githubusercontent.com/${gistMatch[1]}/${gistMatch[2]}/raw`,
      ];
    }
  }

  // Se já for raw.githubusercontent.com
  if (cleaned.includes("raw.githubusercontent.com")) {
    return [cleaned];
  }

  // Se for URL de arquivo blob ou tree: https://github.com/user/repo/blob/main/path/to/SKILL.md
  if (cleaned.includes("github.com") && (cleaned.includes("/blob/") || cleaned.includes("/tree/"))) {
    const rawUrl = cleaned
      .replace("github.com", "raw.githubusercontent.com")
      .replace(/\/blob\//, "/")
      .replace(/\/tree\//, "/");

    const candidates = [rawUrl];
    if (rawUrl.includes("/main/")) {
      candidates.push(rawUrl.replace("/main/", "/master/"));
    } else if (rawUrl.includes("/master/")) {
      candidates.push(rawUrl.replace("/master/", "/main/"));
    }
    return candidates;
  }

  // Se for URL raiz do repositório: https://github.com/owner/repo
  if (cleaned.includes("github.com")) {
    const repoMatch = cleaned.match(/github\.com\/([^\/]+)\/([^\/#?]+)/i);
    if (repoMatch) {
      const owner = repoMatch[1];
      const repo = repoMatch[2].replace(/\.git$/i, "");
      return [
        `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
        `https://raw.githubusercontent.com/${owner}/${repo}/main/.cursorrules`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/.cursorrules`,
        `https://raw.githubusercontent.com/${owner}/${repo}/main/.cursor/rules/main.mdc`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/.cursor/rules/main.mdc`,
        `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
      ];
    }
  }

  return [cleaned];
}

export function parseSkillContent(content: string, filenameHint: string = ""): {
  detectedType: "google" | "claude" | "cursor" | "codex" | "generic";
  skillName: string;
  description: string;
  cleanContent: string;
} {
  const lowerHint = filenameHint.toLowerCase();
  const isCursorRules = lowerHint.endsWith(".cursorrules") || lowerHint.endsWith(".mdc") || content.includes(".cursor/rules");

  let detectedType: "google" | "claude" | "cursor" | "codex" | "generic" = "generic";
  let skillName = "custom-skill";
  let description = "Skill personalizada instalada via GitHub";
  let cleanContent = content;

  // Extrai Frontmatter YAML se existir (--- \n name: ... \n description: ... \n ---)
  const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (yamlMatch) {
    const yamlHeader = yamlMatch[1];
    cleanContent = yamlMatch[2].trim();

    const nameMatch = yamlHeader.match(/name:\s*['"]?([^'"\n]+)['"]?/);
    if (nameMatch) skillName = nameMatch[1].trim();

    const descMatch = yamlHeader.match(/description:\s*['"]?([^'"\n]+)['"]?/);
    if (descMatch) description = descMatch[1].trim();

    const lowerHeader = yamlHeader.toLowerCase();
    const lowerBody = content.toLowerCase();

    if (lowerHeader.includes("google") || lowerBody.includes("gemini") || lowerBody.includes("antigravity")) {
      detectedType = "google";
    } else if (lowerHeader.includes("claude") || lowerBody.includes("anthropic")) {
      detectedType = "claude";
    } else {
      detectedType = "google"; // Padrão SKILL.md do Google/Antigravity
    }
  } else if (isCursorRules) {
    detectedType = "cursor";
    skillName = filenameHint.replace(/\.(cursorrules|mdc)$/i, "") || "cursor-rules";
    description = "Diretrizes de código do Cursor";
  } else if (content.toLowerCase().includes("codex") || content.toLowerCase().includes("openai")) {
    detectedType = "codex";
    skillName = "codex-skill";
  }

  // Normaliza o nome da skill (apenas letras, números, hífen)
  skillName = skillName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!skillName) skillName = "installed-skill";

  return { detectedType, skillName, description, cleanContent };
}

import { safeFetch } from "@/core/security/safe-fetch";

export async function installSkillFromGithub(opts: {
  url: string;
  projectPath?: string | null;
}): Promise<InstalledSkillResult> {
  const candidateUrls = getGithubRawCandidateUrls(opts.url);

  let responseText = "";
  let successfulUrl = "";
  let lastHttpStatus = 0;
  let networkErrorMsg = "";

  for (const candidateUrl of candidateUrls) {
    try {
      const res = await safeFetch(candidateUrl, {
        headers: {
          "User-Agent": "NextCode-Skill-Installer/1.0",
          "Accept": "text/plain, text/markdown, text/html, */*",
        },
        timeoutMs: 10000,
      });

      lastHttpStatus = res.status;
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim()) {
          responseText = text;
          successfulUrl = candidateUrl;
          break;
        }
      }
    } catch (err) {
      networkErrorMsg = (err as Error).message;
    }
  }

  if (!responseText) {
    if (networkErrorMsg) {
      throw new Error(`Falha de rede ao conectar ao GitHub (${networkErrorMsg}). Verifique sua conexão de internet.`);
    }
    if (lastHttpStatus === 404) {
      throw new Error(
        `Não foi possível localizar o arquivo de skill (SKILL.md, .cursorrules ou .mdc) no repositório (HTTP 404). Verifique se o link ou a branch do repositório no GitHub está correto.`
      );
    }
    if (lastHttpStatus === 403) {
      throw new Error(`Acesso negado pelo GitHub (HTTP 403). Certifique-se de que o repositório é público.`);
    }
    throw new Error(`Não foi possível baixar o conteúdo do GitHub (HTTP ${lastHttpStatus || "erro"}). Verifique a URL informada.`);
  }

  const filenameHint = path.basename(successfulUrl || opts.url);
  const parsed = parseSkillContent(responseText, filenameHint);

  const baseDir = opts.projectPath && opts.projectPath.trim()
    ? opts.projectPath.trim()
    : process.cwd();

  let targetSubdir = "";
  let targetFilename = "";

  if (parsed.detectedType === "cursor") {
    targetSubdir = path.join(baseDir, ".cursor", "rules");
    targetFilename = `${parsed.skillName}.mdc`;
  } else if (parsed.detectedType === "claude") {
    targetSubdir = path.join(baseDir, ".claude", "skills", parsed.skillName);
    targetFilename = "SKILL.md";
  } else {
    // Google Antigravity / Gemini / Generic
    targetSubdir = path.join(baseDir, ".gemini", "skills", parsed.skillName);
    targetFilename = "SKILL.md";
  }

  fs.mkdirSync(targetSubdir, { recursive: true });
  const finalFilePath = path.join(targetSubdir, targetFilename);

  // Recria o conteúdo final no formato SKILL.md ou .mdc
  let finalContent = responseText;
  if (!responseText.startsWith("---") && parsed.detectedType !== "cursor") {
    finalContent = `---\nname: ${parsed.skillName}\ndescription: ${parsed.description}\n---\n\n${responseText}`;
  }

  fs.writeFileSync(finalFilePath, finalContent, "utf8");

  return {
    success: true,
    detectedType: parsed.detectedType,
    skillName: parsed.skillName,
    description: parsed.description,
    installedPath: finalFilePath,
    message: `Skill "${parsed.skillName}" do formato ${parsed.detectedType.toUpperCase()} instalada com sucesso!`,
  };
}
