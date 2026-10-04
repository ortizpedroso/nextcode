import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireAuth, requireReadAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  // requireReadAuth: GET expõe dados locais (sessões, DAG, projetos, configurações) — exige
  // o token da sessão local, sem rate limit (a UI faz polling).
  const readGuard = requireReadAuth(request);
  if (readGuard.response) return readGuard.response;
  try {
    const { searchParams } = new URL(request.url);
    const adhocOnly = searchParams.get("adhocOnly") === "true";

    const sessions = await prisma.session.findMany({
      where: adhocOnly ? { projectId: null } : {},
      orderBy: { createdAt: "desc" },
      include: {
        project: {
          select: { id: true, name: true },
        },
        _count: {
          select: { tasks: true, messages: true },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao carregar sessões", details: String(error) },
      { status: 500 }
    );
  }
}

// C1 — criação de sessão é mutação: exige auth local.
export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const body = await request.json();
    const { projectId, title } = body;

    let defaultTitle = "Nova Sessão Ad-hoc";
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (project) {
        defaultTitle = `Sessão - ${project.name}`;
      }
    }

    const session = await prisma.session.create({
      data: {
        title: title?.trim() || defaultTitle,
        projectId: projectId || null,
      },
      include: {
        project: {
          select: { id: true, name: true },
        },
        tasks: true,
        messages: true,
      },
    });

    return NextResponse.json({ success: true, session });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao criar sessão", details: String(error) },
      { status: 500 }
    );
  }
}
