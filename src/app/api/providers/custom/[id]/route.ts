import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const { id } = await params;
    await prisma.customProvider.delete({
      where: { id },
    });
    return NextResponse.json({ success: true, message: "Provedor removido." });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao remover provedor", details: String(error) },
      { status: 500 }
    );
  }
}
