import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, type, command, args, url, env, status } = body;

    const dataToUpdate: Record<string, unknown> = {};
    if (name !== undefined) dataToUpdate.name = String(name).trim();
    if (type !== undefined) dataToUpdate.type = type === "sse" ? "sse" : "stdio";
    if (command !== undefined) dataToUpdate.command = command ? String(command).trim() : null;
    if (args !== undefined) dataToUpdate.args = typeof args === "string" ? args : JSON.stringify(args);
    if (url !== undefined) dataToUpdate.url = url ? String(url).trim() : null;
    if (env !== undefined) dataToUpdate.env = typeof env === "string" ? env : JSON.stringify(env);
    if (status !== undefined) dataToUpdate.status = String(status);

    const server = await prisma.mcpServer.update({
      where: { id },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, server });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar servidor MCP", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.mcpServer.delete({
      where: { id },
    });
    return NextResponse.json({ success: true, message: "Servidor MCP removido." });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao remover servidor MCP", details: String(error) },
      { status: 500 }
    );
  }
}
