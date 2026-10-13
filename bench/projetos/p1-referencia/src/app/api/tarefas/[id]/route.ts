import { NextResponse } from "next/server";
import { atualizarTarefa, removerTarefa } from "@/lib/tarefas";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dados = await req.json().catch(() => ({}));
  const t = atualizarTarefa(id, dados);
  if (!t) return NextResponse.json({ erro: "não encontrada" }, { status: 404 });
  return NextResponse.json(t, { status: 200 });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!removerTarefa(id)) return NextResponse.json({ erro: "não encontrada" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
