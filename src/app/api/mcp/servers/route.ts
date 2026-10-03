import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const servers = await prisma.mcpServer.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ servers });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao listar servidores MCP", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json();
    const { action, id, name, type, command, args, url, env } = body;

    // Ação: Testar Ping / Conexão com um servidor MCP
    if (action === "ping" && id) {
      const server = await prisma.mcpServer.findUnique({ where: { id } });
      if (!server) {
        return NextResponse.json({ error: "Servidor MCP não encontrado" }, { status: 404 });
      }

      // Se for do tipo SSE/HTTP, simula ou realiza um ping real
      let pingSuccess = true;
      let statusMessage = "Servidor MCP operacional";

      if (server.url) {
        try {
          const res = await safeFetch(server.url, { timeoutMs: 3000 }).catch(() => null);
          pingSuccess = Boolean(res && (res.ok || res.status === 404 || res.status === 405));
        } catch (err) {
          // SsrfError ou falha de rede: trata como servidor inacessível (não propaga URL/erro interno).
          pingSuccess = false;
        }
      }

      const updatedStatus = pingSuccess ? "online" : "error";
      await prisma.mcpServer.update({
        where: { id },
        data: { status: updatedStatus },
      });

      return NextResponse.json({
        success: pingSuccess,
        status: updatedStatus,
        message: pingSuccess ? statusMessage : "Falha na conexão com o servidor MCP",
      });
    }

    // Criar / Cadastrar Novo Servidor MCP
    if (!name) {
      return NextResponse.json({ error: "Nome do servidor MCP é obrigatório" }, { status: 400 });
    }

    const newServer = await prisma.mcpServer.create({
      data: {
        name,
        type: type || "stdio",
        command: command || null,
        args: Array.isArray(args) ? JSON.stringify(args) : args || "[]",
        url: url || null,
        env: typeof env === "object" ? JSON.stringify(env) : env || "{}",
        status: url || command ? "online" : "offline",
      },
    });

    return NextResponse.json({
      success: true,
      server: newServer,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao salvar servidor MCP", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID é obrigatório para remoção" }, { status: 400 });
    }

    await prisma.mcpServer.delete({ where: { id } });

    return NextResponse.json({ success: true, message: `Servidor MCP ${id} removido` });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao remover servidor MCP", details: String(error) },
      { status: 500 }
    );
  }
}
