import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export async function GET() {
    try {
        const servers = await prisma.mcpServer.findMany({
            orderBy: { createdAt: "desc" },
        });
        return NextResponse.json({ servers });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao buscar servidores MCP", details: String(error) }, { status: 500 });
    }
}
export async function POST(request) {
    try {
        const body = await request.json();
        const { name, type, command, args, url, env, status } = body;
        if (!name || typeof name !== "string" || !name.trim()) {
            return NextResponse.json({ error: "Nome do servidor MCP é obrigatório." }, { status: 400 });
        }
        const server = await prisma.mcpServer.create({
            data: {
                name: name.trim(),
                type: type === "sse" ? "sse" : "stdio",
                command: command ? command.trim() : null,
                args: typeof args === "string" ? args : JSON.stringify(args || []),
                url: url ? url.trim() : null,
                env: typeof env === "string" ? env : JSON.stringify(env || {}),
                status: status || "online",
            },
        });
        return NextResponse.json({ success: true, server });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao registrar servidor MCP", details: String(error) }, { status: 500 });
    }
}
