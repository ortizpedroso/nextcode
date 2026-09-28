import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const adhocOnly = searchParams.get("adhocOnly") === "true";

    const sessions = await prisma.session.findMany({
      where: adhocOnly ? { projectId: null } : {},
      orderBy: { createdAt: "desc" },
      include: {
        project: {
          select: { id: true, name: true },
        },
        _count: {
          select: { tasks: true, messages: true },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao carregar sessões", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectId, title } = body;

    let defaultTitle = "Nova Sessão Ad-hoc";
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (project) {
        defaultTitle = `Sessão - ${project.name}`;
      }
    }

    const session = await prisma.session.create({
      data: {
        title: title?.trim() || defaultTitle,
        projectId: projectId || null,
      },
      include: {
        project: {
          select: { id: true, name: true },
        },
        tasks: true,
        messages: true,
      },
    });

    return NextResponse.json({ success: true, session });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao criar sessão", details: String(error) },
      { status: 500 }
    );
  }
}
