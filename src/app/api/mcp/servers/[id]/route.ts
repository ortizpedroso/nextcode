import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { encryptMcpEnv, maskMcpEnv } from "@/core/security/mcp-env";
import prisma from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
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
    if (env !== undefined) {
      const atual = await prisma.mcpServer.findUnique({ where: { id } });
      try {
        dataToUpdate.env = encryptMcpEnv(env, atual?.env);
      } catch {
        return NextResponse.json({ error: "env deve ser um objeto JSON" }, { status: 400 });
      }
    }
    if (status !== undefined) dataToUpdate.status = String(status);

    const server = await prisma.mcpServer.update({
      where: { id },
      data: dataToUpdate,
    });

    return NextResponse.json({
      success: true,
      server: { ...server, env: maskMcpEnv(server.env) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao atualizar servidor MCP", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAuth(_request);
  if (guard.response) return guard.response;
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
