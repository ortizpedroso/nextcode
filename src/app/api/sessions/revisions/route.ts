import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/core/security/local-auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json({ error: "Parâmetro 'sessionId' é obrigatório" }, { status: 400 });
    }

    const logs = await prisma.telemetryLog.findMany({
      where: {
        sessionId,
        action: "REVISION_SNAPSHOT",
      },
      orderBy: { createdAt: "desc" },
    });

    const revisions = logs.map((log) => {
      let detailsObj: Record<string, any> = {};
      try {
        if (log.details) detailsObj = JSON.parse(log.details);
      } catch {}

      return {
        id: log.id,
        label: detailsObj.label || "Snapshot Automático de DAG",
        taskCount: detailsObj.taskCount || 0,
        specApproved: detailsObj.specApproved || false,
        createdAt: log.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ sessionId, revisions });
  } catch (error: unknown) {
    console.error("Erro ao buscar revisões da sessão:", error);
    return NextResponse.json(
      { error: "Falha interna ao buscar revisões da sessão", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;

  try {
    const body = await req.json();
    const { action, sessionId, label, snapshotId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "ID da sessão é obrigatório" }, { status: 400 });
    }

    if (action === "create_snapshot") {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          tasks: true,
          messages: true,
        },
      });

      if (!session) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });

      const details = {
        label: label || `Snapshot #${session.turnCount + 1}`,
        taskCount: session.tasks.length,
        specApproved: Boolean(session.specApproved),
        canonicalSpec: session.canonicalSpec,
        tasks: session.tasks,
        messages: session.messages,
      };

      const newLog = await prisma.telemetryLog.create({
        data: {
          sessionId,
          action: "REVISION_SNAPSHOT",
          details: JSON.stringify(details),
          durationMs: 0,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Snapshot "${details.label}" criado com sucesso!`,
        revisionId: newLog.id,
      });
    }

    if (action === "restore_snapshot") {
      if (!snapshotId) return NextResponse.json({ error: "ID do snapshot é obrigatório" }, { status: 400 });

      const log = await prisma.telemetryLog.findUnique({ where: { id: snapshotId } });
      if (!log || !log.details) {
        return NextResponse.json({ error: "Snapshot de revisão não encontrado" }, { status: 404 });
      }

      const details = JSON.parse(log.details);

      // Atualiza spec da sessão
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          canonicalSpec: details.canonicalSpec || null,
          specApproved: Boolean(details.specApproved),
        },
      });

      // Limpa e restaura tarefas
      await prisma.taskNode.deleteMany({ where: { sessionId } });
      if (details.tasks && details.tasks.length > 0) {
        await prisma.taskNode.createMany({
          data: details.tasks.map((t: any) => ({
            sessionId,
            title: t.title,
            role: t.role || "developer",
            status: t.status || "pending",
            dependencies: t.dependencies || "[]",
            mcpScope: t.mcpScope || null,
            result: t.result || null,
            attempts: t.attempts || 0,
          })),
        });
      }

      return NextResponse.json({
        success: true,
        message: `Sessão restaurada com sucesso para o estado do snapshot "${details.label}"!`,
      });
    }

    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Erro no gerenciamento de revisões:", error);
    return NextResponse.json(
      { error: "Falha no gerenciamento de revisões", details: String(error) },
      { status: 500 }
    );
  }
}
