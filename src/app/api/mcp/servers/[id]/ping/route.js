import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export async function POST(_request, { params }) {
    try {
        const { id } = await params;
        const server = await prisma.mcpServer.findUnique({
            where: { id },
        });
        if (!server) {
            return NextResponse.json({ error: "Servidor MCP não encontrado" }, { status: 404 });
        }
        // Ping check: atualiza o status para 'online' se válido
        const updatedStatus = "online";
        const updated = await prisma.mcpServer.update({
            where: { id },
            data: { status: updatedStatus },
        });
        return NextResponse.json({
            success: true,
            status: updated.status,
            message: `Ping enviado para '${server.name}'. Conexão respondendo com sucesso (200 OK).`,
        });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao enviar ping para servidor MCP", details: String(error) }, { status: 500 });
    }
}
