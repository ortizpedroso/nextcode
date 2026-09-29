import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export async function GET(request, { params }) {
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
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao buscar sessão", details: String(error) }, { status: 500 });
    }
}
export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { title } = body;
        const updated = await prisma.session.update({
            where: { id },
            data: {
                ...(title !== undefined && { title: String(title).trim() }),
            },
            include: {
                project: {
                    select: { id: true, name: true },
                },
            },
        });
        return NextResponse.json({ success: true, session: updated });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao atualizar sessão", details: String(error) }, { status: 500 });
    }
}
export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        await prisma.session.delete({ where: { id } });
        return NextResponse.json({ success: true });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao remover sessão", details: String(error) }, { status: 500 });
    }
}
