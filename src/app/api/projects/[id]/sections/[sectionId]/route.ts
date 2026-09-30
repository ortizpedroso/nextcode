import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const { id, sectionId } = await params;
    const body = await request.json();
    const { title, content, order } = body;

    const existingSection = await prisma.section.findUnique({
      where: { id: sectionId },
    });

    if (!existingSection || existingSection.projectId !== id) {
      return NextResponse.json({ error: "Seção não encontrada no projeto" }, { status: 404 });
    }

    const dataToUpdate: Record<string, unknown> = {};
    if (title !== undefined) dataToUpdate.title = String(title).trim();
    if (content !== undefined) dataToUpdate.content = String(content);
    if (order !== undefined) dataToUpdate.order = Number(order);

    const updatedSection = await prisma.section.update({
      where: { id: sectionId },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, section: updatedSection });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar seção", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const { id, sectionId } = await params;

    const existingSection = await prisma.section.findUnique({
      where: { id: sectionId },
    });

    if (!existingSection || existingSection.projectId !== id) {
      return NextResponse.json({ error: "Seção não encontrada no projeto" }, { status: 404 });
    }

    await prisma.section.delete({
      where: { id: sectionId },
    });

    return NextResponse.json({ success: true, message: "Seção removida com sucesso" });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao remover seção", details: String(error) },
      { status: 500 }
    );
  }
}
