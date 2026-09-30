import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

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
    const { name, description, path: requestedPath, isPinned } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome do projeto é obrigatório" }, { status: 400 });
    }

    const trimmedName = name.trim();
    // Resolve o caminho absoluto de forma segura
    const slugName = trimmedName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    let targetPath = requestedPath ? path.resolve(requestedPath.trim()) : null;

    if (!targetPath) {
      // Se não informado, gera o caminho padrão na pasta raiz de projetos (ex: c:\projetos\nome-do-projeto)
      const rootProjectsDir = path.dirname(process.cwd());
      targetPath = path.join(rootProjectsDir, slugName);
    } else {
      // Se o usuário selecionou uma pasta pai (ex: c:\projetos) e digitou o nome do projeto (ex: Gatway),
      // anexa a subpasta com o nome do projeto para que ela seja fisicamente criada no computador!
      const currentBaseName = path.basename(targetPath).toLowerCase();
      if (currentBaseName !== slugName && currentBaseName !== trimmedName.toLowerCase()) {
        targetPath = path.join(targetPath, slugName);
      }
    }

    // Cria a pasta física no sistema de arquivos se ela não existir
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // Se o diretório estiver novo ou vazio, inicializa a estrutura base de projeto
    const existingFiles = fs.readdirSync(targetPath);
    if (existingFiles.length === 0) {
      const readmeContent = `# ${trimmedName}\n\n${description || "Projeto criado via NextCode."}\n\n## Estrutura do Projeto\n- Gerado autonomamente pelo NextCode v5.\n`;
      fs.writeFileSync(path.join(targetPath, "README.md"), readmeContent, "utf-8");

      const packageJsonContent = JSON.stringify(
        {
          name: trimmedName.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
          version: "0.1.0",
          private: true,
          description: description || "Projeto autônomo NextCode",
          scripts: {
            test: "vitest run",
          },
        },
        null,
        2
      );
      fs.writeFileSync(path.join(targetPath, "package.json"), packageJsonContent, "utf-8");

      const gitignoreContent = "node_modules/\n.env\n.quarantine/\ndist/\n.next/\n";
      fs.writeFileSync(path.join(targetPath, ".gitignore"), gitignoreContent, "utf-8");
    }

    const project = await prisma.project.create({
      data: {
        name: trimmedName,
        description: description || null,
        path: targetPath,
        isPinned: Boolean(isPinned),
      },
      include: {
        sessions: true,
      },
    });

    return NextResponse.json({
      success: true,
      project,
      physicalPathCreated: targetPath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao criar projeto", details: String(error) },
      { status: 500 }
    );
  }
}

