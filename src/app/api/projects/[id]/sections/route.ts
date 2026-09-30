import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
    }

    const sections = await prisma.section.findMany({
      where: { projectId: id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ sections });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao buscar seções do projeto", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, content, order } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Título da seção é obrigatório" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
    }

    const section = await prisma.section.create({
      data: {
        projectId: id,
        title: title.trim(),
        content: typeof content === "string" ? content.trim() : "",
        order: typeof order === "number" ? order : 0,
      },
    });

    return NextResponse.json({ success: true, section });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao anexar seção ao projeto", details: String(error) },
      { status: 500 }
    );
  }
}
