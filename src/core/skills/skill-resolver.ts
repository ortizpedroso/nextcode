import * as fs from "fs";
import * as path from "path";

export interface SkillResolutionResult {
  isSkillOrCommand: boolean;
  commandName?: string;
  userRequest?: string;
  skillBlock?: string;
  builtInAction?: "plan" | "goal" | "help" | "clear" | null;
  skillName?: string;
}

export function findSkillContent(
  skillName: string,
  targetDir: string
): { content: string; path: string; type: string } | null {
  const normalizedName = skillName.toLowerCase().replace(/^\//, "").trim();
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";

  const candidateDirs = [
    { dir: path.join(targetDir, ".gemini", "skills"), type: "google" },
    { dir: path.join(targetDir, ".claude", "skills"), type: "claude" },
    { dir: path.join(targetDir, ".cursor", "rules"), type: "cursor" },
    ...(homeDir && homeDir !== targetDir
      ? [
          { dir: path.join(homeDir, ".gemini", "skills"), type: "google" },
          { dir: path.join(homeDir, ".gemini", "antigravity", "builtin", "skills"), type: "google" },
          { dir: path.join(homeDir, ".claude", "skills"), type: "claude" },
        ]
      : []),
  ];

  for (const item of candidateDirs) {
    if (!fs.existsSync(item.dir)) continue;

    try {
      // 1. Tenta pasta exata da skill contendo SKILL.md (ex: .gemini/skills/my-skill/SKILL.md)
      const exactSkillFolder = path.join(item.dir, normalizedName, "SKILL.md");
      if (fs.existsSync(exactSkillFolder)) {
        return {
          content: fs.readFileSync(exactSkillFolder, "utf8"),
          path: exactSkillFolder,
          type: item.type,
        };
      }

      // 2. Tenta arquivo direto .mdc (ex: .cursor/rules/my-skill.mdc)
      const mdcFile = path.join(item.dir, `${normalizedName}.mdc`);
      if (fs.existsSync(mdcFile)) {
        return {
          content: fs.readFileSync(mdcFile, "utf8"),
          path: mdcFile,
          type: "cursor",
        };
      }

      // 3. Escaneia subpastas verificando metadados 'name:'
      const entries = fs.readdirSync(item.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMd = path.join(item.dir, entry.name, "SKILL.md");
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf8");
            const nameMatch = content.match(/name:\s*['"]?([^'"\n]+)['"]?/i);
            const foundName = nameMatch ? nameMatch[1].trim().toLowerCase() : entry.name.toLowerCase();
            if (foundName === normalizedName || entry.name.toLowerCase() === normalizedName) {
              return { content, path: skillMd, type: item.type };
            }
          }
        }
      }
    } catch {}
  }

  // Tenta .cursorrules na raiz do projeto
  const rootCursor = path.join(targetDir, ".cursorrules");
  if (normalizedName === "cursor-rules" || normalizedName === "cursorrules") {
    if (fs.existsSync(rootCursor)) {
      return {
        content: fs.readFileSync(rootCursor, "utf8"),
        path: rootCursor,
        type: "cursor",
      };
    }
  }

  return null;
}

export function resolveSkillOrCommand(
  prompt: string,
  targetDir: string = process.cwd()
): SkillResolutionResult {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) {
    return { isSkillOrCommand: false };
  }

  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return { isSkillOrCommand: false };
  }

  const commandName = match[1].toLowerCase();
  const userRequest = (match[2] || "").trim();

  // Comandos integrados do sistema
  if (commandName === "plan") {
    return {
      isSkillOrCommand: true,
      commandName: "plan",
      userRequest,
      builtInAction: "plan",
      skillBlock: `<system_instruction mode="planning">\n[EXECUÇÃO DE COMANDO: /plan]\nIdentifique sua resposta com "📋 **[Plano de Arquitetura]**". Analise a arquitetura e elabore um plano de implementação detalhado com passos de execução e verificações para:\n"${userRequest || "Elaborar plano de desenvolvimento"}"\n</system_instruction>`,
    };
  }

  if (commandName === "goal") {
    return {
      isSkillOrCommand: true,
      commandName: "goal",
      userRequest,
      builtInAction: "goal",
      skillBlock: `<system_instruction mode="goal">\n[EXECUÇÃO DE COMANDO: /goal]\nIdentifique sua resposta com "🎯 **[Objetivo Autônomo]**". Defina o plano autônomo e execute as tarefas até a conclusão para:\n"${userRequest || "Executar objetivo definido"}"\n</system_instruction>`,
    };
  }

  if (commandName === "help") {
    return {
      isSkillOrCommand: true,
      commandName: "help",
      userRequest,
      builtInAction: "help",
      skillBlock: `<system_instruction mode="help">\n[EXECUÇÃO DE COMANDO: /help]\nIdentifique sua resposta com "💡 **[Ajuda & Habilidades de IA]**". Exiba a lista de comandos e explique como instalar skills do GitHub em Configurações > Skills MCP.\n</system_instruction>`,
    };
  }

  // Busca skill personalizada instalada
  const foundSkill = findSkillContent(commandName, targetDir);
  if (foundSkill) {
    const skillBlock = `<skill_execution_context name="${commandName}" type="${foundSkill.type}">
[EXECUÇÃO ATIVA DA SKILL: /${commandName}]
ATENÇÃO MODELO: O usuário acionou a skill "/${commandName}". Você DEVE assumir a autoridade e o papel desta skill e EXECUTAR COMPLETAMENTE a instrução enviada.

REGRAS OBRIGATÓRIAS DE EXECUÇÃO:
1. IDENTIFICAÇÃO: Inicie sua resposta identificando expressamente a skill acionada com o cabeçalho: ⚡ **[Skill /${commandName}]**.
2. EXECUÇÃO COMPLETA: NÃO apenas descreva o que vai fazer nem pare no meio. Execute as tarefas até o fim.
3. RELATÓRIO DE RESULTADOS & EXCEÇÕES: Ao finalizar, apresente um resumo claro relatando o que foi executado (códigos/arquivos alterados) ou quais problemas/exceções foram encontrados durante o processo.
4. DIRETRISES DA SKILL: Siga rigorosamente as instruções e especificações técnicas abaixo:

--- ESPECIFICAÇÃO TÉCNICA DA SKILL (/${commandName}) ---
${foundSkill.content}
--- FIM DA ESPECIFICAÇÃO ---
</skill_execution_context>`;

    return {
      isSkillOrCommand: true,
      commandName,
      userRequest,
      skillName: commandName,
      skillBlock,
    };
  }

  return {
    isSkillOrCommand: true,
    commandName,
    userRequest,
  };
}
