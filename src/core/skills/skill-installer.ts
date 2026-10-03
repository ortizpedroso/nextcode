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
import * as crypto from "crypto";

export interface FetchedSkillResult {
  responseText: string;
  successfulUrl: string;
  parsed: ReturnType<typeof parseSkillContent>;
  contentHash: string;
  commitSha: string | null;
  riskFlags: string[];
}

/**
 * Busca e interpreta o conteúdo de uma skill de terceiros SEM gravar nada em disco.
 * Usada pelo fluxo de revisão (quarantine gate): a instalação via GitHub agora passa
 * por aqui + cria uma CandidateSkillProposal pendente, em vez de ativar a skill na hora.
 */
export async function fetchSkillFromGithub(url: string): Promise<FetchedSkillResult> {
  const candidateUrls = getGithubRawCandidateUrls(url);

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

  const filenameHint = path.basename(successfulUrl || url);
  const parsed = parseSkillContent(responseText, filenameHint);
  const contentHash = crypto.createHash("sha256").update(responseText).digest("hex");
  const commitSha = await resolvePinnedCommitSha(successfulUrl);
  const riskFlags = scanSkillContentForRisks(responseText);

  return { responseText, successfulUrl, parsed, contentHash, commitSha, riskFlags };
}

/**
 * Melhor esforço: resolve a URL raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
 * para o SHA do commit atual da branch, via API pública do GitHub. Serve apenas de
 * registro de auditoria (qual versão exata foi revisada) — nunca bloqueia o fluxo se
 * a API falhar (rate limit, repo privado, URL de Gist, etc.).
 */
export async function resolvePinnedCommitSha(rawUrl: string): Promise<string | null> {
  const match = rawUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//);
  if (!match) return null;
  const [, owner, repo, branch] = match;
  try {
    const res = await safeFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, {
      headers: {
        "User-Agent": "NextCode-Skill-Installer/1.0",
        Accept: "application/vnd.github.v3+json",
      },
      timeoutMs: 5000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.sha === "string" ? data.sha : null;
  } catch {
    return null;
  }
}

/**
 * Varredura heurística e NÃO-BLOQUEANTE do conteúdo de uma skill de terceiros. Serve só
 * para dar sinal ao humano que vai revisar/aprovar — nunca impede a instalação por si só,
 * pois o conteúdo legítimo de skills frequentemente menciona esses termos de forma inócua.
 */
export function scanSkillContentForRisks(content: string): string[] {
  const flags: string[] = [];

  if (/ignore\s+(all\s+|any\s+)?(previous|above|prior)\s+instructions?/i.test(content)) {
    flags.push("possible-prompt-injection: tenta sobrescrever instruções anteriores");
  }
  if (/(reveal|print|show|exfiltrate|dump)\s+(your\s+)?(system prompt|api[\s_-]?key|master[\s_-]?key|token|secret)/i.test(content)) {
    flags.push("possible-secret-exfiltration: solicita revelar segredos/chaves/tokens");
  }
  if (/\b(NEXTCODE_MASTER_KEY|NEXTCODE_AUTH_TOKEN|process\.env\[)\b/.test(content)) {
    flags.push("references-env-secrets: referencia nomes de variáveis de ambiente sensíveis do próprio projeto");
  }
  if (/[A-Za-z0-9+/]{200,}={0,2}/.test(content)) {
    flags.push("large-base64-blob: contém um bloco longo codificado em base64");
  }
  if (/(curl|iwr|invoke-webrequest)[^\n]{0,80}\|\s*(sh|bash|iex|powershell)/i.test(content)) {
    flags.push("remote-code-execution-pattern: baixa e executa script remoto diretamente");
  }
  if (/https?:\/\/(webhook\.site|ngrok\.io|requestbin\.com|pastebin\.com)/i.test(content)) {
    flags.push("suspicious-outbound-url: referencia domínio comum de exfiltração/teste de SSRF");
  }

  return flags;
}

export interface WrittenSkillResult {
  installedPath: string;
  targetPath: string;
}

/** Grava em disco o conteúdo já revisado/aprovado de uma skill (fetch e aprovação já concluídos). */
export function writeParsedSkillToDisk(
  parsed: ReturnType<typeof parseSkillContent>,
  responseText: string,
  baseDirInput?: string | null
): WrittenSkillResult {
  const baseDir = baseDirInput && baseDirInput.trim() ? baseDirInput.trim() : process.cwd();

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

  return { installedPath: finalFilePath, targetPath: baseDir };
}

/**
 * Atalho de instalação imediata (busca + grava), mantido para compatibilidade com
 * chamadores que não precisam do fluxo de revisão (ex.: testes, uso programático direto).
 * A rota HTTP de instalação (/api/skills/install-github) NÃO usa mais esta função —
 * ela passa pelo quarantine gate via fetchSkillFromGithub + proposta pendente de aprovação.
 */
export async function installSkillFromGithub(opts: {
  url: string;
  projectPath?: string | null;
}): Promise<InstalledSkillResult> {
  const { responseText, parsed } = await fetchSkillFromGithub(opts.url);
  const { installedPath } = writeParsedSkillToDisk(parsed, responseText, opts.projectPath);

  return {
    success: true,
    detectedType: parsed.detectedType,
    skillName: parsed.skillName,
    description: parsed.description,
    installedPath,
    message: `Skill "${parsed.skillName}" do formato ${parsed.detectedType.toUpperCase()} instalada com sucesso!`,
  };
}
