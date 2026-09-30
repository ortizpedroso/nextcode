import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";

export interface SkillItemInfo {
  name: string;
  description: string;
  type: "google" | "claude" | "cursor" | "codex" | "generic";
  path: string;
}

function scanSubdirsForSkills(baseDir: string): SkillItemInfo[] {
  const list: SkillItemInfo[] = [];
  const seenPaths = new Set<string>();

  const homeDir = process.env.USERPROFILE || process.env.HOME || "";

  const candidates = [
    { dir: path.join(baseDir, ".gemini", "skills"), defaultType: "google" as const },
    { dir: path.join(baseDir, ".claude", "skills"), defaultType: "claude" as const },
    { dir: path.join(baseDir, ".cursor", "rules"), defaultType: "cursor" as const },
    ...(homeDir && homeDir !== baseDir ? [
      { dir: path.join(homeDir, ".gemini", "skills"), defaultType: "google" as const },
      { dir: path.join(homeDir, ".claude", "skills"), defaultType: "claude" as const },
    ] : []),
  ];

  for (const item of candidates) {
    if (!fs.existsSync(item.dir)) continue;
    try {
      const entries = fs.readdirSync(item.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMd = path.join(item.dir, entry.name, "SKILL.md");
          if (fs.existsSync(skillMd) && !seenPaths.has(skillMd)) {
            seenPaths.add(skillMd);
            const content = fs.readFileSync(skillMd, "utf8");
            const nameMatch = content.match(/name:\s*['"]?([^'"\n]+)['"]?/);
            const descMatch = content.match(/description:\s*['"]?([^'"\n]+)['"]?/);
            list.push({
              name: nameMatch ? nameMatch[1].trim() : entry.name,
              description: descMatch ? descMatch[1].trim() : "Skill de IA",
              type: item.defaultType,
              path: skillMd,
            });
          }
        } else if (entry.isFile() && (entry.name.endsWith(".mdc") || entry.name === ".cursorrules")) {
          const mdcPath = path.join(item.dir, entry.name);
          if (!seenPaths.has(mdcPath)) {
            seenPaths.add(mdcPath);
            const content = fs.readFileSync(mdcPath, "utf8");
            const descMatch = content.match(/description:\s*['"]?([^'"\n]+)['"]?/);
            list.push({
              name: entry.name.replace(/\.(mdc|cursorrules)$/, ""),
              description: descMatch ? descMatch[1].trim() : "Diretrizes de código do Cursor",
              type: "cursor",
              path: mdcPath,
            });
          }
        }
      }
    } catch {}
  }

  // Verifica .cursorrules na raiz do projeto se existir
  const rootCursorRules = path.join(baseDir, ".cursorrules");
  if (fs.existsSync(rootCursorRules)) {
    list.push({
      name: "cursor-rules",
      description: "Regras principais de código (.cursorrules)",
      type: "cursor",
      path: rootCursorRules,
    });
  }

  return list;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    let projectPath: string | null = null;
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { path: true },
      });
      projectPath = project?.path || null;
    }

    const targetDir = projectPath && fs.existsSync(projectPath) ? projectPath : process.cwd();
    const skills = scanSubdirsForSkills(targetDir);

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao listar skills de IA", details: (error as Error).message },
      { status: 500 }
    );
  }
}
