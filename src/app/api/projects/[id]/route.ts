import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const resolvedParams = await Promise.resolve(params);
    const id = resolvedParams.id;

    if (!id) {
      return NextResponse.json({ error: "ID do projeto é obrigatório" }, { status: 400 });
    }

    // 1. Busca o projeto e suas sessões vinculadas para expurgo seguro em cascata
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        sessions: {
          select: { id: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
    }

    // 2. Limpeza mecânica em cascata de dependências do SQLite (Mensagens, Tarefas e Sessões)
    const sessionIds = project.sessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      await prisma.message.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
      await prisma.taskNode.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
      await prisma.session.deleteMany({
        where: { projectId: id },
      });
    }

    // 3. Exclusão de arquivos físicos com tratamento de exceção (resiliente a locks no Windows)
    let physicalDeleted = false;
    let physicalWarning: string | null = null;

    if (project.path) {
      try {
        const resolvedPath = path.resolve(project.path);
        const cwd = process.cwd();
        const rootDir = path.parse(cwd).root; // Ex: "C:\" ou "/"
        const parentProjectsDir = path.dirname(cwd); // Ex: "C:\projetos"

        // Trava de Segurança: impede exclusão acidental de raízes críticas do sistema
        const isCriticalSystemPath =
          resolvedPath === rootDir ||
          resolvedPath === cwd ||
          resolvedPath === parentProjectsDir;

        if (!isCriticalSystemPath && fs.existsSync(resolvedPath)) {
          fs.rmSync(resolvedPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          physicalDeleted = true;
          console.log(`[PROJECT_DELETE] Pasta física removida com sucesso do computador: "${resolvedPath}"`);
        }
      } catch (fsErr) {
        console.warn(`[PROJECT_DELETE] Aviso: Não foi possível apagar pasta física no disco: ${String(fsErr)}`);
        physicalWarning = `A pasta local não pôde ser apagada do disco (${String(fsErr)})`;
      }
    }

    // 4. Deleta o registro do projeto no banco de dados SQLite
    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: physicalDeleted
        ? "Projeto e pasta física excluídos com sucesso do computador."
        : "Registro do projeto excluído com sucesso do banco de dados.",
      physicalDeleted,
      warning: physicalWarning,
    });
  } catch (error) {
    console.error("[PROJECT_DELETE_ERROR]", error);
    return NextResponse.json(
      { error: "Falha ao excluir projeto", details: String(error) },
      { status: 500 }
    );
  }
}
