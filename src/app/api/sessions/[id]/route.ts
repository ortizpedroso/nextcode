import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, path: true },
        },
        tasks: {
          orderBy: { createdAt: "asc" },
        },
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao buscar sessão", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, projectId } = body;

    const dataToUpdate: Record<string, unknown> = {};
    if (title !== undefined) dataToUpdate.title = String(title).trim();
    if (projectId !== undefined) {
      dataToUpdate.projectId = projectId ? String(projectId).trim() : null;
    }
    if (body.specApproved !== undefined) dataToUpdate.specApproved = Boolean(body.specApproved);
    if (body.canonicalSpec !== undefined) dataToUpdate.canonicalSpec = String(body.canonicalSpec);

    const updated = await prisma.session.update({
      where: { id },
      data: dataToUpdate,
      include: {
        project: {
          select: { id: true, name: true, path: true },
        },
      },
    });

    return NextResponse.json({ success: true, session: updated });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar sessão", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.session.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao remover sessão", details: String(error) },
      { status: 500 }
    );
  }
}
