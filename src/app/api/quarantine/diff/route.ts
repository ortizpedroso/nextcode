import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import * as fs from "fs";
import * as path from "path";

export async function GET(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({ error: "taskId é obrigatório" }, { status: 400 });
    }

    const task = await prisma.taskNode.findUnique({
      where: { id: taskId },
      include: {
        session: {
          include: { project: true },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    }

    const resultData = task.result ? JSON.parse(task.result) : {};
    const outputText = resultData.output || "";
    const auditVerdict = resultData.auditVerdict || "PENDING";
    const filesScope: string[] = task.filesScope ? JSON.parse(task.filesScope) : [];

    // Extrai o mapa de arquivos gerados a partir do resultado da tarefa
    const qm = new QuarantineManager();
    // Mesma extração estrita da DAG (Trava T2): a prévia mostra exatamente o que seria promovido.
    const generatedCodeMap = qm.extractAndWriteCodeBlocks(`${task.id}-preview`, outputText, filesScope, {
      strictPaths: true,
    });
    const extractionIssues = qm.extractionIssues;
    qm.purgeWorkspace(`${task.id}-preview`);

    const projectRoot = task.session.project?.path || process.cwd();
    const fileDiffs = [];

    const resolvedProjectRoot = path.resolve(projectRoot);
    for (const [filePath, newContent] of Object.entries(generatedCodeMap)) {
      // SEGURANÇA: filePath vem de conteúdo gerado por LLM (extractAndWriteCodeBlocks); garante
      // que a leitura de diff não escape de projectRoot via path traversal ("../../etc/...").
      const fullPath = path.resolve(resolvedProjectRoot, filePath);
      if (fullPath !== resolvedProjectRoot && !fullPath.startsWith(resolvedProjectRoot + path.sep)) {
        continue;
      }
      const existsInProject = fs.existsSync(fullPath);
      let existingContent = "";

      if (existsInProject) {
        try {
          existingContent = fs.readFileSync(fullPath, "utf-8");
        } catch {
          existingContent = "";
        }
      }

      fileDiffs.push({
        filePath,
        newContent,
        existingContent,
        isNewFile: !existsInProject,
      });
    }

    return NextResponse.json({
      taskId: task.id,
      taskTitle: task.title,
      extractionIssues,
      role: task.role,
      status: task.status,
      auditVerdict,
      projectRoot,
      files: fileDiffs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao carregar diff da quarentena", details: String(error) },
      { status: 500 }
    );
  }
}
