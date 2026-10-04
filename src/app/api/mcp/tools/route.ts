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
    const serverId = searchParams.get("serverId");

    const whereClause = serverId ? { id: serverId } : {};
    const servers = await prisma.mcpServer.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    // Retorna ferramentas simuladas/descbertas por servidor MCP cadastrado
    const toolsResult = servers.map((s) => ({
      serverId: s.id,
      serverName: s.name,
      status: s.status,
      type: s.type,
      tools: [
        {
          name: `${s.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_read_file`,
          description: `Lê conteúdo de arquivo via ${s.name}`,
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Caminho do arquivo" },
            },
            required: ["path"],
          },
        },
        {
          name: `${s.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_list_dir`,
          description: `Lista diretório via ${s.name}`,
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Caminho da pasta" },
            },
            required: ["path"],
          },
        },
      ],
    }));

    return NextResponse.json({ servers: toolsResult });
  } catch (error: unknown) {
    console.error("Erro ao listar ferramentas MCP:", error);
    return NextResponse.json(
      { error: "Falha interna ao listar ferramentas MCP", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;

  try {
    const body = await req.json();
    const { serverId, toolName, args } = body;

    if (!toolName) {
      return NextResponse.json({ error: "Nome da ferramenta MCP é obrigatório" }, { status: 400 });
    }

    const server = serverId
      ? await prisma.mcpServer.findUnique({ where: { id: serverId } })
      : null;

    // Simula execução de ferramenta MCP via protocolo JSON-RPC
    const executionResult = {
      tool: toolName,
      serverId: server?.id || "local",
      serverName: server?.name || "MCP Local Engine",
      args: args || {},
      status: "success",
      output: {
        content: [
          {
            type: "text",
            text: `[MCP JSON-RPC] Ferramenta "${toolName}" executada com sucesso com os argumentos: ${JSON.stringify(args || {})}`,
          },
        ],
      },
      executedAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, result: executionResult });
  } catch (error: unknown) {
    console.error("Erro ao executar ferramenta MCP:", error);
    return NextResponse.json(
      { error: "Falha ao executar ferramenta MCP", details: String(error) },
      { status: 500 }
    );
  }
}
