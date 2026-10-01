import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, path, isPinned, isArchived } = body;

    const dataToUpdate: Record<string, unknown> = {};
    if (name !== undefined) dataToUpdate.name = String(name).trim();
    if (description !== undefined) dataToUpdate.description = description ? String(description).trim() : null;
    if (path !== undefined) dataToUpdate.path = path ? String(path).trim() : null;
    if (isPinned !== undefined) dataToUpdate.isPinned = Boolean(isPinned);
    if (isArchived !== undefined) dataToUpdate.isArchived = Boolean(isArchived);

    const project = await prisma.project.update({
      where: { id },
      data: dataToUpdate,
      include: {
        sessions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return NextResponse.json({ success: true, project });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar projeto", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Busca o projeto para obter o caminho físico antes de deletar do SQLite
    const project = await prisma.project.findUnique({
      where: { id },
    });

    let physicalDeleted = false;
    if (project?.path) {
      const resolvedPath = path.resolve(project.path);
      const cwd = process.cwd();
      const rootDir = path.parse(cwd).root; // Ex: "C:\" ou "/"
      const parentProjectsDir = path.dirname(cwd); // Ex: "C:\projetos"

      // Trava de Segurança: impede exclusão acidental de raízes críticas de sistema
      const isCriticalSystemPath =
        resolvedPath === rootDir ||
        resolvedPath === cwd ||
        resolvedPath === parentProjectsDir;

      if (!isCriticalSystemPath && fs.existsSync(resolvedPath)) {
        fs.rmSync(resolvedPath, { recursive: true, force: true });
        physicalDeleted = true;
        console.log(`[PROJECT_DELETE] Pasta física removida com sucesso do computador: "${resolvedPath}"`);
      }
    }

    // 2. Deleta o registro do banco de dados SQLite
    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: physicalDeleted
        ? "Projeto e pasta física excluídos com sucesso do computador."
        : "Registro do projeto excluído com sucesso do banco de dados.",
      physicalDeleted,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao excluir projeto", details: String(error) },
      { status: 500 }
    );
  }
}
