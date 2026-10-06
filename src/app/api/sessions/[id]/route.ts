import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import {
  approveSpecAndStart,
  type ApproveSpecResult,
} from "@/core/orchestrator/execution-trigger";

// GET fica aberto para a UI local, como as demais rotas de leitura (ver sessions/route.ts).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // requireReadAuth: GET expõe dados locais (sessões, DAG, projetos, configurações) — exige
  // o token da sessão local, sem rate limit (a UI faz polling).
  const readGuard = requireReadAuth(request);
  if (readGuard.response) return readGuard.response;
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, projectId } = body;

    const currentBeforePatch = await prisma.session.findUnique({
      where: { id },
    });
    const frozenPhases = new Set([
      "PLANEJAMENTO",
      "EXECUCAO",
      "PAUSADA",
      "BLOQUEADA",
      "VERIFICACAO",
      "ENTREGUE",
    ]);
    const isSpecFrozen =
      Boolean(currentBeforePatch?.specApproved) &&
      frozenPhases.has(currentBeforePatch?.phase || "");

    const dataToUpdate: Record<string, unknown> = {};
    if (title !== undefined) dataToUpdate.title = String(title).trim();
    if (projectId !== undefined) {
      dataToUpdate.projectId = projectId ? String(projectId).trim() : null;
    }
    if (body.specApproved === false && !isSpecFrozen) {
      dataToUpdate.specApproved = false;
    }
    if (body.canonicalSpec !== undefined && body.specApproved !== true && !isSpecFrozen) {
      dataToUpdate.canonicalSpec = String(body.canonicalSpec);
    }

    if (Object.keys(dataToUpdate).length > 0) {
      await prisma.session.update({
        where: { id },
        data: dataToUpdate,
      });
    }

    let triggerResult: ApproveSpecResult | null = null;
    if (body.specApproved === true) {
      triggerResult = await approveSpecAndStart(
        id,
        body.canonicalSpec !== undefined ? String(body.canonicalSpec) : undefined
      );
      if (!triggerResult.ok) {
        const currentSession = await prisma.session.findUnique({
          where: { id },
          include: {
            project: {
              select: { id: true, name: true, path: true },
            },
          },
        });
        return NextResponse.json(
          {
            ok: false,
            success: false,
            reason: triggerResult.reason,
            error: triggerResult.reason,
            session: currentSession,
          },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.session.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, path: true },
        },
      },
    });

    if (!updated) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      success: true,
      ...(triggerResult
        ? { alreadyStarted: triggerResult.alreadyStarted, phase: triggerResult.phase }
        : {}),
      session: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar sessão", details: String(error) },
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
