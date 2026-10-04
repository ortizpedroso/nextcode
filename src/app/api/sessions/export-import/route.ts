import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";

export async function GET(req: NextRequest) {
  // requireReadAuth: GET expõe dados locais (sessões, DAG, projetos, configurações) — exige
  // o token da sessão local, sem rate limit (a UI faz polling).
  const readGuard = requireReadAuth(req);
  if (readGuard.response) return readGuard.response;
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json({ error: "Parâmetro 'sessionId' é obrigatório" }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        tasks: { orderBy: { createdAt: "asc" } },
        messages: { orderBy: { createdAt: "asc" } },
        project: { select: { id: true, name: true } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    const backupPayload = {
      version: "5.0",
      exportTimestamp: new Date().toISOString(),
      session: {
        id: session.id,
        title: session.title,
        projectId: session.projectId,
        projectName: session.project?.name || null,
        canonicalSpec: session.canonicalSpec || "",
        specApproved: Boolean(session.specApproved),
        createdAt: session.createdAt.toISOString(),
      },
      tasks: session.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        role: t.role,
        status: t.status,
        dependencies: t.dependencies,
        mcpScope: t.mcpScope,
        result: t.result,
        attempts: t.attempts,
      })),
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokens: m.tokens,
        tier: m.tier,
        createdAt: m.createdAt.toISOString(),
      })),
    };

    return new NextResponse(JSON.stringify(backupPayload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="nextcode-session-${sessionId.substring(0, 8)}.json"`,
      },
    });
  } catch (error: unknown) {
    console.error("Erro na exportação de sessão JSON:", error);
    return NextResponse.json(
      { error: "Falha interna ao exportar sessão em JSON", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;

  try {
    const body = await req.json();
    const backupData = typeof body.backup === "string" ? JSON.parse(body.backup) : body.backup || body;

    if (!backupData || !backupData.session || !Array.isArray(backupData.tasks)) {
      return NextResponse.json(
        { error: "Formato de arquivo JSON de backup inválido" },
        { status: 400 }
      );
    }

    // Cria nova sessão restaurada
    const newSession = await prisma.session.create({
      data: {
        title: `${backupData.session.title || "Sessão Restaurada"} (Importada)`,
        projectId: backupData.session.projectId || null,
        canonicalSpec: backupData.session.canonicalSpec || null,
        specApproved: Boolean(backupData.session.specApproved),
      },
    });

    // Restaura tarefas da DAG
    if (backupData.tasks && backupData.tasks.length > 0) {
      await prisma.taskNode.createMany({
        data: backupData.tasks.map((t: { title: string; role: string; status?: string; dependencies?: string; mcpScope?: string; result?: string; attempts?: number }) => ({
          sessionId: newSession.id,
          title: t.title || "Tarefa Restaurada",
          role: t.role || "developer",
          status: t.status || "pending",
          dependencies: t.dependencies || "[]",
          mcpScope: t.mcpScope || null,
          result: t.result || null,
          attempts: t.attempts || 0,
        })),
      });
    }

    // Restaura histórico de mensagens
    if (backupData.messages && backupData.messages.length > 0) {
      await prisma.message.createMany({
        data: backupData.messages.map((m: { role: string; content: string; tokens?: number; tier?: string }) => ({
          sessionId: newSession.id,
          role: m.role || "user",
          content: m.content || "",
          tokens: m.tokens || 0,
          tier: m.tier || "fast",
        })),
      });
    }

    return NextResponse.json({
      success: true,
      message: "Sessão restaurada com sucesso a partir do arquivo JSON!",
      session: newSession,
    });
  } catch (error: unknown) {
    console.error("Erro na importação de sessão JSON:", error);
    return NextResponse.json(
      { error: "Falha ao restaurar sessão a partir do JSON", details: String(error) },
      { status: 500 }
    );
  }
}
