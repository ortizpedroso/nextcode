import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("includeArchived") === "true";

    const projects = await prisma.project.findMany({
      where: includeArchived ? {} : { isArchived: false },
      orderBy: [
        { isPinned: "desc" },
        { updatedAt: "desc" },
      ],
      include: {
        sessions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao buscar projetos", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, path, isPinned } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome do projeto é obrigatório" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        description: description || null,
        path: path ? path.trim() : null,
        isPinned: Boolean(isPinned),
      },
      include: {
        sessions: true,
      },
    });

    return NextResponse.json({ success: true, project });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao criar projeto", details: String(error) },
      { status: 500 }
    );
  }
}
