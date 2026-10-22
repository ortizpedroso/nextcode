import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { checkFolderSafeToDelete } from "@/core/project/folder-safety";

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
    // PJ2b: arquivar = fechar (a fila para; guarda onde parou); desarquivar = reabrir e continuar.
    if (isArchived !== undefined) {
      const before = await prisma.project.findUnique({ where: { id }, select: { isArchived: true } });
      const { closeProject, reopenProject } = await import("@/core/orchestrator/project-lifecycle");
      if (Boolean(isArchived) && !before?.isArchived) await closeProject(id);
      else if (!isArchived && before?.isArchived) await reopenProject(id);
    }

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

    const { searchParams } = new URL(request.url);
    const apagarPasta = searchParams.get("apagarPasta") === "true";

    // P12 (PJ2, segurança): antes de mexer em qualquer coisa, recusa apagar pasta-mãe — pasta que
    // contém outro projeto cadastrado, outro repositório, o NextCode ou a pasta de projetos.
    if (apagarPasta && project.path) {
      const others = await prisma.project.findMany({ where: { id: { not: id }, path: { not: null } }, select: { path: true } });
      const safety = checkFolderSafeToDelete(project.path, { otherProjectPaths: others.map((o) => o.path!) });
      if (!safety.ok) {
        return NextResponse.json(
          {
            error: `Recusado: a pasta "${project.path}" ${safety.motivo}. Nada foi apagado. Use "Remover" sem apagar a pasta, ou apague à mão.`,
          },
          { status: 409 }
        );
      }
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

    // 3. Exclusão de arquivos físicos com tratamento de exceção e retries forçados no Windows
    let physicalDeleted = false;
    let physicalWarning: string | null = null;

    if (apagarPasta && project.path) {
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
          // Método 1: fs.rmSync nativo do Node com retries
          try {
            fs.rmSync(resolvedPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          } catch {
            // Método 2 (Windows Fallback): Limpa atributos de somente-leitura e executa remoção forçada de sistema
            if (process.platform === "win32") {
              const { execSync } = await import("child_process");
              try {
                execSync(`cmd.exe /c "attrib -r /s /d \\"${resolvedPath}\\*.*\\""`, { stdio: "ignore" });
                execSync(`cmd.exe /c "rd /s /q \\"${resolvedPath}\\""`, { stdio: "ignore" });
              } catch {
                try {
                  execSync(`powershell -Command "Remove-Item -Path \\"${resolvedPath}\\" -Recurse -Force"`, { stdio: "ignore" });
                } catch {}
              }
            }
          }

          physicalDeleted = !fs.existsSync(resolvedPath);
          if (physicalDeleted) {
            console.log(`[PROJECT_DELETE] Pasta física removida com sucesso do computador: "${resolvedPath}"`);
          } else {
            console.warn(`[PROJECT_DELETE] Aviso: Alguns arquivos da pasta física "${resolvedPath}" podem estar em uso.`);
            physicalWarning = `A pasta física continha arquivos em uso pelo SO e não pôde ser inteiramente removida.`;
          }
        }
      } catch (fsErr) {
        console.warn(`[PROJECT_DELETE] Exceção ao apagar pasta física: ${String(fsErr)}`);
        physicalWarning = `Falha ao excluir pasta local (${String(fsErr)})`;
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
