import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { installSkillFromGithub } from "@/core/skills/skill-installer";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { githubUrl, projectId } = body;

    if (!githubUrl || typeof githubUrl !== "string" || !githubUrl.trim()) {
      return NextResponse.json(
        { error: "URL do GitHub é obrigatória" },
        { status: 400 }
      );
    }

    let projectPath: string | null = null;
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { path: true },
      });
      projectPath = project?.path || null;
    }

    const result = await installSkillFromGithub({
      url: githubUrl.trim(),
      projectPath,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao instalar skill do GitHub", details: (error as Error).message },
      { status: 500 }
    );
  }
}
