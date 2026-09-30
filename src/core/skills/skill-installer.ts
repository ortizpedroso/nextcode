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
  let cleaned = url.trim();
  // Se for URL de blob: https://github.com/user/repo/blob/main/path/to/file.md
  if (cleaned.includes("github.com") && cleaned.includes("/blob/")) {
    cleaned = cleaned.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  } else if (cleaned.includes("github.com") && !cleaned.includes("raw.githubusercontent.com")) {
    // Se for URL de repositório sem arquivo especificado, busca SKILL.md ou .cursorrules na raiz
    if (!cleaned.endsWith("/SKILL.md") && !cleaned.endsWith("/.cursorrules")) {
      cleaned = `${cleaned.replace(/\/$/, "")}/raw/main/SKILL.md`;
    }
  }
  return cleaned;
}

export function parseSkillContent(content: string, filenameHint: string = ""): {
  detectedType: "google" | "claude" | "cursor" | "codex" | "generic";
  skillName: string;
  description: string;
  cleanContent: string;
} {
  const isCursorRules = filenameHint.endsWith(".cursorrules") || filenameHint.endsWith(".mdc") || content.includes(".cursor/rules");
  
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

    if (yamlHeader.includes("google") || content.toLowerCase().includes("gemini") || content.toLowerCase().includes("antigravity")) {
      detectedType = "google";
    } else if (yamlHeader.includes("claude") || content.toLowerCase().includes("anthropic")) {
      detectedType = "claude";
    } else {
      detectedType = "google"; // Padrão SKILL.md do Google/Antigravity
    }
  } else if (isCursorRules) {
    detectedType = "cursor";
    skillName = filenameHint.replace(/\.(cursorrules|mdc)$/, "") || "cursor-rules";
    description = "Diretrizes de código do Cursor";
  } else if (content.includes("codex") || content.includes("openai")) {
    detectedType = "codex";
    skillName = "codex-skill";
  }

  // Normaliza o nome da skill (apenas letras, números, hífen)
  skillName = skillName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!skillName) skillName = "installed-skill";

  return { detectedType, skillName, description, cleanContent };
}

export async function installSkillFromGithub(opts: {
  url: string;
  projectPath?: string | null;
}): Promise<InstalledSkillResult> {
  const rawUrl = convertGithubUrlToRaw(opts.url);

  let responseText = "";
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      // Se /raw/main/SKILL.md falhar, tenta /raw/master/SKILL.md ou /raw/main/.cursorrules
      if (rawUrl.includes("/raw/main/SKILL.md")) {
        const altUrl = rawUrl.replace("/raw/main/SKILL.md", "/raw/main/.cursorrules");
        const altRes = await fetch(altUrl);
        if (altRes.ok) {
          responseText = await altRes.text();
        } else {
          throw new Error(`HTTP ${res.status}: Não foi possível baixar a skill da URL.`);
        }
      } else {
        throw new Error(`HTTP ${res.status}: Não foi possível baixar a skill da URL.`);
      }
    } else {
      responseText = await res.text();
    }
  } catch (err) {
    throw new Error(`Falha ao se conectar ao GitHub: ${(err as Error).message}`);
  }

  if (!responseText || !responseText.trim()) {
    throw new Error("Conteúdo retornado pelo GitHub está vazio.");
  }

  const filenameHint = path.basename(opts.url);
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
