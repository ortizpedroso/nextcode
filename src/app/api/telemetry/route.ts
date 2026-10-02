import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Number(limitParam), 200) : 50;

    const logs = await prisma.telemetryLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const totalEvents = await prisma.telemetryLog.count();
    const completedNodes = await prisma.taskNode.count({ where: { status: "completed" } });
    const failedNodes = await prisma.taskNode.count({ where: { status: { in: ["failed", "blocked"] } } });
    const activeSessions = await prisma.session.count();

    const formattedLogs = logs.map((l) => ({
      id: l.id,
      sessionId: l.sessionId,
      action: l.action,
      durationMs: l.durationMs,
      details: l.details ? JSON.parse(l.details) : null,
      createdAt: l.createdAt,
    }));

    return NextResponse.json({
      summary: {
        totalEvents,
        completedNodes,
        failedNodes,
        activeSessions,
      },
      logs: formattedLogs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao recuperar logs de telemetria", details: String(error) },
      { status: 500 }
    );
  }
}
