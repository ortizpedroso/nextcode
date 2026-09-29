import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { name, description, path, isPinned, isArchived } = body;
        const dataToUpdate = {};
        if (name !== undefined)
            dataToUpdate.name = String(name).trim();
        if (description !== undefined)
            dataToUpdate.description = description ? String(description).trim() : null;
        if (path !== undefined)
            dataToUpdate.path = path ? String(path).trim() : null;
        if (isPinned !== undefined)
            dataToUpdate.isPinned = Boolean(isPinned);
        if (isArchived !== undefined)
            dataToUpdate.isArchived = Boolean(isArchived);
        const project = await prisma.project.update({
            where: { id },
            data: dataToUpdate,
            include: {
                sessions: {
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        return NextResponse.json({ success: true, project });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao atualizar projeto", details: String(error) }, { status: 500 });
    }
}
export async function DELETE(_request, { params }) {
    try {
        const { id } = await params;
        await prisma.project.delete({
            where: { id },
        });
        return NextResponse.json({ success: true, message: "Projeto excluído com sucesso." });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao excluir projeto", details: String(error) }, { status: 500 });
    }
}
