import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
